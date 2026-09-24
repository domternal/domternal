#!/usr/bin/env node
/**
 * Remove personal data from a capture bundle or a source document before it is committed, and write the
 * declaration that a version 2 manifest carries. A capture keeps every length and total: each occurrence
 * of a given ASCII text in its text flavors becomes the reserved token, padded to the same length. A
 * Word package keeps every part except the named elements, which are emptied. The declaration records
 * the original and redacted hashes and fingerprints of everything the redaction left unchanged, taken
 * from the original, or from an already redacted copy when the original no longer exists.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { crc32, deflateRawSync } from 'node:zlib';
import { TEXT_FORMATS } from './capture.mjs';
import { maskedCaptureDigest, maskedPart, readPackageParts, readRedactions, REDACTION_TOKEN, redactionToken, verifyCaptureRedaction,
  verifyPackageRedaction } from './offline.mjs';

const HASH = /^[a-f0-9]{64}$/u;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

function provenance({ reason, claimedOriginal, originalRetained = false }, originalBytes) {
  if (typeof reason !== 'string' || !reason.trim() || reason.length > 1024) throw new Error('A redaction needs a reason of at most 1024 characters');
  if (claimedOriginal !== undefined && !HASH.test(claimedOriginal)) throw new Error('The claimed original hash must be 64 lowercase hexadecimal digits');
  // Without the original, its hash is the recorded claim and every fingerprint comes from the redacted copy.
  return claimedOriginal === undefined
    ? { reason, originalSha256: digest(originalBytes), originalRetained, basis: 'original' }
    : { reason, originalSha256: claimedOriginal, originalRetained: false, basis: 'redacted-copy' };
}

/** Replace every occurrence of each text in a capture's text flavors by the reserved token of the same length. */
export function redactCaptureBytes(input, texts, options) {
  if (!Array.isArray(texts) || texts.length === 0) throw new Error('Name at least one text to replace');
  for (const value of texts) {
    // Printable ASCII without quotes or backslashes appears verbatim in JSON, so the bytes change in place.
    if (typeof value !== 'string' || value.length < REDACTION_TOKEN.length || value.length > 512 || !/^[\x20-\x7e]+$/u.test(value) || /["\\]/u.test(value)) {
      throw new Error(`Each text is printable ASCII without quotes or backslashes, ${String(REDACTION_TOKEN.length)} to 512 characters; extend a shorter one with its surroundings`);
    }
  }
  const source = input.toString('utf8');
  const original = JSON.parse(source);
  const flavors = original?.payload?.text;
  if (!flavors || typeof flavors !== 'object') throw new Error('The input is not a capture bundle with text flavors');
  const outside = JSON.stringify({ ...original, payload: { ...original.payload, text: {} } });
  if (texts.some(value => outside.includes(value))) throw new Error('A text to replace also appears outside the text flavors; that is not supported');
  const replacements = [];
  const expected = structuredClone(original);
  for (const flavor of TEXT_FORMATS) {
    let value = flavors[flavor];
    if (typeof value !== 'string') continue;
    for (let at = 0; at < value.length;) {
      const match = texts.filter(candidate => value.startsWith(candidate, at)).sort((left, right) => right.length - left.length)[0];
      if (match === undefined) { at++; continue; }
      replacements.push({ flavor, offset: at, length: match.length, token: redactionToken(match.length) });
      value = `${value.slice(0, at)}${redactionToken(match.length)}${value.slice(at + match.length)}`;
      at += match.length;
    }
    expected.payload.text[flavor] = value;
  }
  if (replacements.length === 0) throw new Error('None of the texts appears in the capture');
  let output = source;
  for (const value of [...texts].sort((left, right) => right.length - left.length)) output = output.split(value).join(redactionToken(value.length));
  const bytes = Buffer.from(output, 'utf8');
  if (bytes.byteLength !== input.byteLength || JSON.stringify(JSON.parse(output)) !== JSON.stringify(expected)) throw new Error('The replacement changed more than the text flavors');
  const masked = maskedCaptureDigest(expected, replacements);
  if (maskedCaptureDigest(original, replacements) !== masked) throw new Error('The redacted capture differs from its input outside the replacements');
  const declaration = order({ artifact: 'capture', format: 'capture-text', ...provenance(options, input), redactedSha256: digest(bytes), replacements, maskedSha256: masked });
  // The same checks the offline verifier applies to the committed fixture.
  verifyCaptureRedaction(JSON.parse(output), readRedactions([declaration]).capture);
  return { bytes, declaration };
}

/** Write a ZIP package with the given part contents, in order, deflated, with fixed timestamps. */
export function writePackage(parts) {
  const locals = [];
  const directory = [];
  let offset = 0;
  for (const [name, content] of parts) {
    const nameBytes = Buffer.from(name, 'latin1');
    const data = deflateRawSync(content, { level: 9 });
    const crc = crc32(content);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0, 6); header.writeUInt16LE(8, 8);
    header.writeUInt16LE(0, 10); header.writeUInt16LE(0x21, 12); header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18); header.writeUInt32LE(content.length, 22); header.writeUInt16LE(nameBytes.length, 26); header.writeUInt16LE(0, 28);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(0, 8); entry.writeUInt16LE(8, 10);
    entry.writeUInt16LE(0, 12); entry.writeUInt16LE(0x21, 14); entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(content.length, 24); entry.writeUInt16LE(nameBytes.length, 28); entry.writeUInt32LE(offset, 42);
    locals.push(header, nameBytes, data);
    directory.push(entry, nameBytes);
    offset += header.length + nameBytes.length + data.length;
  }
  const central = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(parts.size, 8); end.writeUInt16LE(parts.size, 10);
  end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, end]);
}

/**
 * Empty the named elements of a Word package's parts, for example `dc:creator` in `docProps/core.xml`.
 * A package whose elements are already empty is returned unchanged, so its hash stays the same.
 */
export function redactPackageBytes(input, cleared, options) {
  if (!Array.isArray(cleared) || cleared.length === 0) throw new Error('Name at least one part and its elements to clear');
  const parts = readPackageParts(input);
  const next = new Map(parts);
  let changed = false;
  for (const { part, elements } of cleared) {
    const content = parts.get(part);
    if (content === undefined) throw new Error(`The package has no part ${part}`);
    const masked = Buffer.from(maskedPart(content, elements), 'utf8');
    if (!masked.equals(content)) { next.set(part, masked); changed = true; }
  }
  const bytes = changed ? writePackage(next) : Buffer.from(input);
  const fingerprints = {};
  for (const [name, content] of parts) {
    const elements = cleared.find(entry => entry.part === name)?.elements;
    fingerprints[name] = elements === undefined ? digest(content) : digest(Buffer.from(maskedPart(content, elements), 'utf8'));
  }
  const declaration = order({ artifact: 'source', format: 'ooxml-package', ...provenance(options, input), redactedSha256: digest(bytes),
    clearedElements: cleared.map(({ part, elements }) => ({ part, elements: [...elements] })), parts: fingerprints });
  if (declaration.originalSha256 === declaration.redactedSha256) throw new Error('The package has nothing to clear');
  verifyPackageRedaction(bytes, readRedactions([declaration]).source);
  return { bytes, declaration };
}

const FIELD_ORDER = ['artifact', 'format', 'reason', 'originalSha256', 'redactedSha256', 'originalRetained', 'basis',
  'clearedElements', 'parts', 'replacements', 'maskedSha256'];
function order(declaration) {
  return Object.fromEntries(FIELD_ORDER.filter(key => Object.hasOwn(declaration, key)).map(key => [key, declaration[key]]));
}

/** Add or replace one artifact's declaration in a declarations file. */
async function recordDeclaration(path, declaration) {
  let declarations = [];
  try { declarations = JSON.parse(await readFile(path, 'utf8')); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  declarations = [...declarations.filter(entry => entry.artifact !== declaration.artifact), declaration]
    .sort((left, right) => left.artifact.localeCompare(right.artifact));
  readRedactions(declarations);
  await writeFile(path, `${JSON.stringify(declarations, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const usage = 'Usage: node redact.mjs capture <input.json> <output.json> --replace <text> [--replace <text>] --reason <text> --declarations <redactions.json> [--claimed-original <sha256> | --original-retained]\n'
    + '       node redact.mjs package <input.docx> <output.docx> --clear <part>=<element>[,<element>] --reason <text> --declarations <redactions.json> [--claimed-original <sha256> | --original-retained]';
  try {
    const { values, positionals } = parseArgs({ allowPositionals: true, options: {
      replace: { type: 'string', multiple: true }, clear: { type: 'string', multiple: true }, reason: { type: 'string' },
      declarations: { type: 'string' }, 'claimed-original': { type: 'string' }, 'original-retained': { type: 'boolean', default: false },
    } });
    const [mode, input, output] = positionals;
    if (positionals.length !== 3 || !['capture', 'package'].includes(mode) || !values.declarations
      || (values['claimed-original'] !== undefined && values['original-retained'])) throw new Error(usage);
    const options = { reason: values.reason, claimedOriginal: values['claimed-original'], originalRetained: values['original-retained'] };
    const bytes = await readFile(resolve(input));
    const result = mode === 'capture' ? redactCaptureBytes(bytes, values.replace ?? [], options)
      : redactPackageBytes(bytes, (values.clear ?? []).map(entry => {
        const [part, elements = ''] = entry.split('=');
        return { part, elements: elements.split(',').filter(Boolean) };
      }), options);
    await writeFile(resolve(output), result.bytes, { flag: resolve(output) === resolve(input) ? 'w' : 'wx' });
    await recordDeclaration(resolve(values.declarations), result.declaration);
    // Only hashes and locations: the replaced text is never printed.
    process.stdout.write(`${JSON.stringify({ artifact: result.declaration.artifact, basis: result.declaration.basis,
      originalSha256: result.declaration.originalSha256, redactedSha256: result.declaration.redactedSha256 }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error?.code ?? error?.message ?? 'redaction-failed'}\n`);
    process.exitCode = 1;
  }
}
