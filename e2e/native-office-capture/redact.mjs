#!/usr/bin/env node
/**
 * Remove personal data from a capture bundle or a source document before it is committed, and write the
 * declaration that a version 2 manifest carries. A capture keeps every length and total: each occurrence
 * of a given ASCII text in its text flavors becomes the reserved token, padded to the same length, and the
 * source hash its operator recorded can be withheld the same way, for a source that is redacted too. A
 * Word package keeps every part except the named elements, which are emptied. A PNG clipboard file, such
 * as Chrome's picture of a Word selection, keeps every chunk except its display profile, whose fields that
 * name the display unit are zeroed; the bundle's record of the file, its size and the file total follow.
 * The declaration records the redacted hash and fingerprints of everything the redaction left unchanged,
 * taken from the original, or from an already redacted copy when the original no longer exists. It never
 * records a hash of the original: an unsalted hash of text that held a name or an address confirms a
 * guess of it, and one of a picture whose profile held a serial number confirms a guess of that number.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { crc32, deflateRawSync, deflateSync } from 'node:zlib';
import { TEXT_FORMATS } from './capture.mjs';
import { DEVICE_FIELDS, deviceTagOffset, maskedCaptureDigest, maskedPart, maskedPngDigest, profileIdentifier, readPackageParts, readPngChunks,
  readPngProfile, readRedactions, REDACTION_TOKEN, redactionToken, verifyCaptureRedaction, verifyFileRedactions, verifyPackageRedaction,
  WITHHELD_SOURCE_HASH } from './offline.mjs';

const HASH = /^[a-f0-9]{64}$/iu;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

/** Why, and from what: the original, or a copy redacted before the original was deleted, whose fingerprints it then holds. */
function provenance({ reason, basis = 'original', originalRetained = false }) {
  if (typeof reason !== 'string' || !reason.trim() || reason.length > 1024) throw new Error('A redaction needs a reason of at most 1024 characters');
  if (!['original', 'redacted-copy'].includes(basis)) throw new Error('The basis is original or redacted-copy');
  if (typeof originalRetained !== 'boolean' || (basis === 'redacted-copy' && originalRetained)) throw new Error('Only a redaction of the original can say the original is retained');
  return { reason, originalRetained, basis };
}

/**
 * Replace every occurrence of each text in a capture's text flavors by the reserved token of the same length
 * and, with `withholdFixtureHash`, the source hash the operator recorded by the token of 64 characters.
 * `files` names the clipboard files, by item index, whose redaction is declared already: their records are
 * outside the fingerprint, as their own declarations hold them.
 */
export function redactCaptureBytes(input, texts, options) {
  const withheld = options?.withholdFixtureHash === true ? ['fixtureSha256'] : [];
  const files = options?.files ?? [];
  if (!Array.isArray(texts) || (texts.length === 0 && withheld.length === 0)) throw new Error('Name at least one text to replace, or withhold the source hash');
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
  if (texts.length > 0 && replacements.length === 0) throw new Error('None of the texts appears in the capture');
  let output = source;
  for (const value of [...texts].sort((left, right) => right.length - left.length)) output = output.split(value).join(redactionToken(value.length));
  if (withheld.length > 0) {
    // The recorded hash is replaced where it stands, so the bytes keep their length and nothing else moves.
    const recorded = original?.operator?.fixtureSha256;
    if (typeof recorded !== 'string' || !HASH.test(recorded)) throw new Error('The capture records no source hash to withhold');
    const field = `"fixtureSha256": "${recorded}"`;
    const compact = `"fixtureSha256":"${recorded}"`;
    const form = output.split(field).length === 2 ? field : output.split(compact).length === 2 ? compact : undefined;
    if (form === undefined || output.split(recorded).length !== 2) throw new Error('The source hash must appear once, as the operator field');
    output = output.replace(form, form.replace(recorded, WITHHELD_SOURCE_HASH));
    expected.operator.fixtureSha256 = WITHHELD_SOURCE_HASH;
  }
  const bytes = Buffer.from(output, 'utf8');
  if (bytes.byteLength !== input.byteLength || JSON.stringify(JSON.parse(output)) !== JSON.stringify(expected)) throw new Error('The replacement changed more than the text flavors and the withheld field');
  const masked = maskedCaptureDigest(expected, replacements, withheld, files);
  if (maskedCaptureDigest(original, replacements, withheld, files) !== masked) throw new Error('The redacted capture differs from its input outside the replacements');
  const declaration = order({ artifact: 'capture', format: 'capture-text', ...provenance(options ?? {}), redactedSha256: digest(bytes), replacements, withheld, maskedSha256: masked });
  // The same checks the offline verifier applies to the committed fixture.
  verifyCaptureRedaction(JSON.parse(output), readRedactions([declaration]).capture, files);
  return { bytes, declaration };
}

const DEVICE_FIELD_NAMES = Object.freeze(Object.keys(DEVICE_FIELDS));

/**
 * Zero the fields of a PNG's display profile that name the display unit, in Apple's make and model tag. Every
 * other chunk keeps its bytes, so the pixels and how they are drawn do not change; the profile is compressed
 * again, and its ID, when it has one, is computed again. A picture whose fields are zero already keeps its bytes.
 */
export function clearDisplayProfile(input, fields = DEVICE_FIELD_NAMES) {
  const chunks = readPngChunks(input);
  let found;
  try { found = readPngProfile(chunks); } catch { throw new Error('The picture has no display profile before its image data'); }
  const { index, name, profile } = found;
  let tag;
  try { tag = deviceTagOffset(profile); } catch { throw new Error('The display profile has no make and model tag to clear'); }
  const cleared = Buffer.from(profile);
  for (const field of fields) cleared.fill(0, tag + DEVICE_FIELDS[field], tag + DEVICE_FIELDS[field] + 4);
  if (cleared.equals(profile)) return { bytes: Buffer.from(input), changed: false };
  if (cleared.subarray(84, 100).some(byte => byte !== 0)) profileIdentifier(cleared).copy(cleared, 84);
  const data = Buffer.concat([name, Buffer.from([0, 0]), deflateSync(cleared, { level: 9 })]);
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0); chunk.write('iCCP', 4, 'latin1'); data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.length)) >>> 0, 8 + data.length);
  const parts = [Buffer.from(input.subarray(0, 8))];
  for (const [at, [type, content]] of chunks.entries()) {
    if (at === index) { parts.push(chunk); continue; }
    const length = Buffer.alloc(4); length.writeUInt32BE(content.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), content])) >>> 0);
    parts.push(length, Buffer.from(type, 'latin1'), content, crc);
  }
  return { bytes: Buffer.concat(parts), changed: true };
}

/**
 * Clear the display profile of one PNG clipboard file of a capture, as `clearDisplayProfile` does, and update its
 * record, its item's size and the file total. `declarations` are the capture's declarations so far: the capture
 * text's declaration then names the new bundle and fingerprints it outside the redacted files' records, which
 * equals that fingerprint of its original, since the two differ only inside the replacements and those records.
 * Returns the bundle, the file's declaration and every declaration, updated.
 */
export function redactCaptureFileBytes(input, { itemIndex, declarations = [], ...options } = {}) {
  const source = input.toString('utf8');
  const original = JSON.parse(source);
  // The bundle is written back in the same form, compact as the capture page writes it or indented as a test does.
  const indented = JSON.stringify(original, null, 2);
  const form = source === JSON.stringify(original) ? 'compact' : source === indented ? 'indented' : source === `${indented}\n` ? 'indented-line' : undefined;
  if (form === undefined) throw new Error('The capture is not written as the capture page or this tool writes it');
  const item = Number.isSafeInteger(itemIndex) ? original?.payload?.items?.[itemIndex] : undefined;
  const record = Array.isArray(original?.payload?.files) ? original.payload.files.find(file => file?.itemIndex === itemIndex) : undefined;
  if (item?.kind !== 'file' || item.type !== 'image/png' || item.file?.type !== 'image/png' || typeof record?.base64 !== 'string') {
    throw new Error('The item is not a PNG clipboard file of this capture');
  }
  const meta = provenance(options);
  const declared = readRedactions(declarations);
  if (declared.files.some(entry => entry.itemIndex === itemIndex)) throw new Error('This clipboard file has a declared redaction already');
  const picture = Buffer.from(record.base64, 'base64');
  const { bytes: cleared, changed } = clearDisplayProfile(picture);
  if (!changed && meta.basis === 'original') throw new Error('The picture\'s display profile has nothing to clear');
  const expected = structuredClone(original);
  Object.assign(expected.payload.files.find(file => file.itemIndex === itemIndex), { byteLength: cleared.length, sha256: digest(cleared), base64: cleared.toString('base64') });
  expected.payload.items[itemIndex].file.size = cleared.length;
  expected.payload.totals.fileBytes += cleared.length - picture.length;
  const files = [...declared.files.map(entry => entry.itemIndex), itemIndex].sort((left, right) => left - right);
  if (maskedCaptureDigest(original, [], [], files) !== maskedCaptureDigest(expected, [], [], files)) throw new Error('The redaction changed more than the picture\'s record');
  const output = form === 'compact' ? JSON.stringify(expected) : `${JSON.stringify(expected, null, 2)}${form === 'indented-line' ? '\n' : ''}`;
  const bytes = Buffer.from(output, 'utf8');
  const declaration = order({ artifact: 'clipboard-file', format: 'png-display-profile', ...meta, redactedSha256: digest(cleared), itemIndex,
    clearedFields: [...DEVICE_FIELD_NAMES], maskedSha256: maskedPngDigest(picture, DEVICE_FIELD_NAMES) });
  const capture = declared.capture === undefined ? undefined : { ...declared.capture, redactedSha256: digest(bytes),
    maskedSha256: maskedCaptureDigest(expected, declared.capture.replacements, declared.capture.withheld, files) };
  // The declarations keep their order, the file's added last.
  const updated = [...declarations.map(entry => (entry.artifact === 'capture' ? capture : entry)), declaration];
  // The same checks the offline verifier applies to the committed fixture.
  const result = readRedactions(updated);
  const written = JSON.parse(output);
  verifyCaptureRedaction(written, result.capture, files);
  verifyFileRedactions(written, result.files);
  return { bytes, declaration, declarations: updated };
}
// Declarations in a stable order: the source, the capture text, then the clipboard files by item.
const rank = entry => (entry.artifact === 'source' ? -2 : entry.artifact === 'capture' ? -1 : entry.itemIndex);

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
  const declaration = order({ artifact: 'source', format: 'ooxml-package', ...provenance(options ?? {}), redactedSha256: digest(bytes),
    clearedElements: cleared.map(({ part, elements }) => ({ part, elements: [...elements] })), parts: fingerprints });
  // An original must change; a redacted copy is already cleared and keeps its bytes.
  if (!changed && declaration.basis === 'original') throw new Error('The package has nothing to clear');
  verifyPackageRedaction(bytes, readRedactions([declaration]).source);
  return { bytes, declaration };
}

const FIELD_ORDER = ['artifact', 'format', 'reason', 'redactedSha256', 'originalRetained', 'basis',
  'clearedElements', 'parts', 'replacements', 'withheld', 'itemIndex', 'clearedFields', 'maskedSha256'];
function order(declaration) {
  return Object.fromEntries(FIELD_ORDER.filter(key => Object.hasOwn(declaration, key)).map(key => [key, declaration[key]]));
}

/** The declarations a declarations file holds, or none when it does not exist yet. */
async function readDeclarations(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch (error) { if (error?.code !== 'ENOENT') throw error; return []; }
}

/** Write a declarations file, in the stable order. */
async function writeDeclarations(path, declarations) {
  const sorted = [...declarations].sort((left, right) => rank(left) - rank(right));
  readRedactions(sorted);
  await writeFile(path, `${JSON.stringify(sorted, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const usage = 'Usage: node redact.mjs capture <input.json> <output.json> [--replace <text>]... [--withhold-fixture-hash] --reason <text> --declarations <redactions.json> [--redacted-copy | --original-retained]\n'
    + '       node redact.mjs package <input.docx> <output.docx> --clear <part>=<element>[,<element>] --reason <text> --declarations <redactions.json> [--redacted-copy | --original-retained]\n'
    + '       node redact.mjs file <input.json> <output.json> --item <index> --reason <text> --declarations <redactions.json> [--redacted-copy | --original-retained]';
  try {
    const { values, positionals } = parseArgs({ allowPositionals: true, options: {
      replace: { type: 'string', multiple: true }, clear: { type: 'string', multiple: true }, reason: { type: 'string' },
      declarations: { type: 'string' }, 'redacted-copy': { type: 'boolean', default: false }, 'original-retained': { type: 'boolean', default: false },
      'withhold-fixture-hash': { type: 'boolean', default: false }, item: { type: 'string' },
    } });
    const [mode, input, output] = positionals;
    if (positionals.length !== 3 || !['capture', 'package', 'file'].includes(mode) || !values.declarations
      || (values['redacted-copy'] && values['original-retained']) || (mode !== 'capture' && values['withhold-fixture-hash'])
      || (mode === 'file') !== (values.item !== undefined) || (values.item !== undefined && !/^(?:0|[1-9][0-9]{0,2})$/u.test(values.item))) throw new Error(usage);
    const options = { reason: values.reason, basis: values['redacted-copy'] ? 'redacted-copy' : 'original', originalRetained: values['original-retained'],
      withholdFixtureHash: values['withhold-fixture-hash'] };
    const bytes = await readFile(resolve(input));
    const declarations = await readDeclarations(resolve(values.declarations));
    // A clipboard file redacted before the text keeps its own declaration; the text's fingerprint leaves its record out.
    const files = readRedactions(declarations).files;
    const result = mode === 'file' ? redactCaptureFileBytes(bytes, { ...options, itemIndex: Number(values.item), declarations })
      : mode === 'capture' ? redactCaptureBytes(bytes, values.replace ?? [], { ...options, files: files.map(entry => entry.itemIndex) })
        : redactPackageBytes(bytes, (values.clear ?? []).map(entry => {
          const [part, elements = ''] = entry.split('=');
          return { part, elements: elements.split(',').filter(Boolean) };
        }), options);
    await writeFile(resolve(output), result.bytes, { flag: resolve(output) === resolve(input) ? 'w' : 'wx' });
    await writeDeclarations(resolve(values.declarations), mode === 'file' ? result.declarations
      : [...declarations.filter(entry => entry.artifact !== result.declaration.artifact), result.declaration]);
    // Only the redacted hash and the basis: neither the replaced text nor a hash of the original is printed.
    process.stdout.write(`${JSON.stringify({ artifact: result.declaration.artifact, basis: result.declaration.basis,
      redactedSha256: result.declaration.redactedSha256 }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error?.code ?? error?.message ?? 'redaction-failed'}\n`);
    process.exitCode = 1;
  }
}
