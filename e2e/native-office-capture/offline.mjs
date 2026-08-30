/** Offline evidence integrity checks. No saved JSON can authenticate a native paste. */
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HARD_LIMITS, TEXT_FORMATS } from './capture.mjs';

const MAX_SOURCE_BYTES = 16 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 128 * 1024;
const MAX_EXPECTED_UNITS = 32 * 1024;
const HASH = /^[a-f0-9]{64}$/u;
const stored = new WeakMap();
const cleanupRequire = createRequire(new URL('../../packages/extension-paste-cleanup/package.json', import.meta.url));
const normalize = value => value.toLowerCase();
const digest = value => createHash('sha256').update(value).digest('hex');
const freeze = value => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
export class CaptureEvidenceError extends Error {
  constructor(code) { super(code); this.name = 'CaptureEvidenceError'; this.code = code; }
}
const fail = code => { throw new CaptureEvidenceError(code); };
function shape(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('evidence-schema');
  const keys = Object.keys(value);
  if (keys.length !== fields.length || keys.some(key => !fields.includes(key))) fail('evidence-schema');
  return value;
}
function text(value, maximum = HARD_LIMITS.maxMetadataLength, empty = false) {
  if (typeof value !== 'string' || value.length > maximum || (!empty && !value.trim())) fail('evidence-schema');
  return value;
}
function integer(value, maximum, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail('evidence-limit');
  return value;
}
function list(value, maximum) {
  if (!Array.isArray(value)) fail('evidence-schema');
  integer(value.length, maximum); return value;
}
function hash(value) { if (typeof value !== 'string' || !HASH.test(value)) fail('evidence-schema'); return value; }
function bytes(value, maximum) {
  if (!(value instanceof Uint8Array) || value.buffer instanceof SharedArrayBuffer) fail('evidence-input');
  integer(value.byteLength, maximum); return value;
}
function utf8Size(value, maximum) {
  // Length is checked before encoding. Buffer.byteLength does not allocate a second payload.
  if (value.length > maximum) fail('evidence-limit');
  const size = Buffer.byteLength(value, 'utf8'); integer(size, maximum); return size;
}
function parseJSON(input, maximum) {
  bytes(input, maximum);
  let source;
  try { source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(input); }
  catch { fail('evidence-json'); }
  // A lexical resource guard precedes JSON.parse. JSON.parse still establishes validity.
  const stack = []; let tokens = 0;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (char === '{' || char === '[') {
      if (++tokens > 8192 || stack.length >= 12) fail('evidence-limit');
      stack.push({ object: char === '{', keys: new Set() });
    } else if (char === '}' || char === ']') stack.pop();
    else if (char === '"') {
      if (++tokens > 8192) fail('evidence-limit');
      const start = index++;
      for (; index < source.length; index++) {
        if (source[index] === '\\') index++;
        else if (source[index] === '"') break;
      }
      let next = index + 1;
      while (next < source.length && /[\t\n\r ]/u.test(source[next])) next++;
      if (source[next] === ':') {
        if (index - start > 256) fail('evidence-schema');
        let key;
        try { key = JSON.parse(source.slice(start, index + 1)); } catch { fail('evidence-json'); }
        const frame = stack.at(-1);
        if (!frame?.object) fail('evidence-json');
        if (frame.keys.has(key)) fail('evidence-duplicate-key');
        frame.keys.add(key);
      }
    } else if (!/[\t\n\r ,:]/u.test(char)) {
      if (++tokens > 8192) fail('evidence-limit');
      while (index + 1 < source.length && !'\t\n\r ,:[]{}"'.includes(source[index + 1])) index++;
    }
  }
  try { return JSON.parse(source); } catch { fail('evidence-json'); }
}
function limitSnapshot(value) {
  shape(value, Object.keys(HARD_LIMITS));
  const result = {};
  for (const [name, maximum] of Object.entries(HARD_LIMITS)) result[name] = integer(value[name], maximum, 1);
  return result;
}
function canonicalBase64(value, size) {
  if (typeof value !== 'string' || value.length !== 4 * Math.ceil(size / 3)) fail('evidence-file');
  const padding = size % 3 === 0 ? 0 : 3 - size % 3;
  for (let index = 0; index < value.length; index++) {
    const char = value.charCodeAt(index);
    const allowed = index >= value.length - padding ? char === 61
      : (char >= 65 && char <= 90) || (char >= 97 && char <= 122) || (char >= 48 && char <= 57) || char === 43 || char === 47;
    if (!allowed) fail('evidence-file');
  }
  const decoded = Buffer.from(value, 'base64');
  try {
    if (decoded.byteLength !== size || decoded.toString('base64') !== value) fail('evidence-file');
    return digest(decoded);
  } finally { decoded.fill(0); }
}

/** Validate hashes supplied by an independently reviewed manifest, never a native identity signature. */
export function validateCaptureBytes(input, evidence) {
  try {
    shape(evidence, ['captureSha256', 'fixtureSha256', 'fixtureId', 'origin']);
    hash(evidence.captureSha256); hash(evidence.fixtureSha256); text(evidence.fixtureId);
    if (!['synthetic', 'claimed-native'].includes(evidence.origin)) fail('evidence-provenance');
    bytes(input, HARD_LIMITS.maxJSONBytes);
    if (digest(input) !== evidence.captureSha256) fail('evidence-checksum');
    const bundle = parseJSON(input, HARD_LIMITS.maxJSONBytes);
    shape(bundle, ['schemaVersion', 'harnessVersion', 'capturedAt', 'status', 'qualification', 'scope', 'provenance', 'operator', 'limits', 'diagnostics', 'payload']);
    if (bundle.schemaVersion !== 1 || bundle.harnessVersion !== 'native-office-capture-v1'
      || bundle.scope !== 'allowlisted-formats-and-exposed-files') fail('evidence-schema');
    if (bundle.qualification !== false) fail('evidence-provenance');
    if (bundle.status !== 'complete' || !Array.isArray(bundle.diagnostics) || bundle.diagnostics.length !== 0) fail('evidence-incomplete');
    if (typeof bundle.capturedAt !== 'string' || bundle.capturedAt.length !== 24
      || new Date(bundle.capturedAt).toISOString() !== bundle.capturedAt) fail('evidence-schema');
    const limits = limitSnapshot(bundle.limits);
    integer(input.byteLength, limits.maxJSONBytes);
    shape(bundle.provenance, ['eventKind', 'nativeClipboardCaptured', 'sourceApplicationVerified']);
    if (bundle.provenance.sourceApplicationVerified !== false) fail('evidence-provenance');
    if (evidence.origin === 'synthetic'
      ? bundle.provenance.eventKind !== 'synthetic-event' || bundle.provenance.nativeClipboardCaptured !== false
      : bundle.provenance.eventKind !== 'native-event' || bundle.provenance.nativeClipboardCaptured !== true) fail('evidence-provenance');
    shape(bundle.operator, ['os', 'application', 'browser', 'scenario', 'fixtureId', 'fixtureSha256', 'copyMethod', 'syntheticSourceConfirmed']);
    for (const field of ['os', 'application', 'browser', 'scenario', 'fixtureId', 'fixtureSha256', 'copyMethod']) text(bundle.operator[field], limits.maxMetadataLength);
    if (bundle.operator.syntheticSourceConfirmed !== true || bundle.operator.fixtureId !== evidence.fixtureId
      || normalize(bundle.operator.fixtureSha256) !== evidence.fixtureSha256) fail('evidence-provenance');
    const payload = shape(bundle.payload, ['availableFormats', 'omittedFormats', 'text', 'items', 'files', 'totals']);
    const formats = list(payload.availableFormats, limits.maxFormats);
    const seenFormats = new Set();
    for (const format of formats) {
      text(format, limits.maxMetadataLength);
      if (seenFormats.has(format)) fail('evidence-schema'); seenFormats.add(format);
    }
    const omitted = list(payload.omittedFormats, limits.maxFormats);
    if (JSON.stringify(omitted) !== JSON.stringify(formats.filter(format => !TEXT_FORMATS.includes(format)))) fail('evidence-schema');
    const allowed = formats.filter(format => TEXT_FORMATS.includes(format));
    shape(payload.text, allowed);
    let textBytes = 0; let textUnits = 0;
    for (const format of allowed) {
      const value = text(payload.text[format], limits.maxFormatBytes, true);
      textBytes += utf8Size(value, limits.maxFormatBytes); textUnits += value.length;
      integer(textBytes, limits.maxTextBytes);
    }
    const items = list(payload.items, limits.maxItems); const files = list(payload.files, limits.maxItems);
    const expectedFiles = new Map(); let fileBytes = 0; let base64Units = 0;
    for (let index = 0; index < items.length; index++) {
      const item = shape(items[index], ['itemIndex', 'kind', 'type', 'file']);
      if (item.itemIndex !== index || !['string', 'file'].includes(item.kind)) fail('evidence-schema');
      text(item.type, limits.maxMetadataLength, true);
      if (item.kind === 'string') { if (item.file !== null) fail('evidence-schema'); continue; }
      shape(item.file, ['name', 'type', 'size', 'lastModified']);
      text(item.file.name, limits.maxMetadataLength, true); text(item.file.type, limits.maxMetadataLength, true);
      const size = integer(item.file.size, limits.maxFileBytes);
      if (!Number.isSafeInteger(item.file.lastModified)) fail('evidence-schema');
      fileBytes += size; integer(fileBytes, limits.maxTotalFileBytes);
      base64Units += 4 * Math.ceil(size / 3); expectedFiles.set(index, size);
    }
    integer(textBytes + fileBytes, limits.maxClipboardBytes);
    const reserve = 16_384 + (items.length * 4 + formats.length * 2 + 7) * limits.maxMetadataLength * 6;
    integer(textUnits * 6 + base64Units + reserve, limits.maxJSONBytes);
    shape(payload.totals, ['textBytes', 'fileBytes']);
    if (payload.totals.textBytes !== textBytes || payload.totals.fileBytes !== fileBytes || files.length !== expectedFiles.size) fail('evidence-total');
    let priorIndex = -1;
    for (const file of files) {
      shape(file, ['itemIndex', 'byteLength', 'sha256', 'base64']);
      const size = expectedFiles.get(file.itemIndex);
      if (size === undefined || file.itemIndex <= priorIndex || file.byteLength !== size) fail('evidence-file');
      priorIndex = file.itemIndex; expectedFiles.delete(file.itemIndex);
      if (canonicalBase64(file.base64, size) !== hash(file.sha256)) fail('evidence-checksum');
    }
    const handle = Object.freeze({});
    const report = freeze({ kind: 'offline-capture-integrity', schemaVersion: 1, qualification: false,
      sourceApplicationVerified: false, nativeEvidenceAuthenticated: false, origin: evidence.origin,
      claimedEventKind: bundle.provenance.eventKind, fixtureId: evidence.fixtureId,
      fixtureSha256: evidence.fixtureSha256, captureSha256: evidence.captureSha256,
      textBytes, fileBytes, itemCount: items.length, fileCount: files.length });
    stored.set(handle, { html: payload.text['text/html'], report });
    return Object.freeze({ handle, report });
  } catch (error) { if (error instanceof CaptureEvidenceError) throw error; fail('evidence-schema'); }
}
export function disposeCaptureEvidence(handle) { stored.delete(handle); }

/** HTML-only replay. It never creates Files, applies editor content or matches image references. */
export function replayCaptureEvidence(handle, expected) {
  const state = stored.get(handle);
  if (!state) fail('evidence-handle');
  if (typeof state.html !== 'string') fail('evidence-no-html');
  shape(expected, ['preserve', 'adapt']);
  const { normalizePasteHTML } = cleanupRequire('@domternal/extension-paste-cleanup/html');
  const outcomes = [];
  for (const formatting of ['preserve', 'adapt']) {
    const oracle = shape(expected[formatting], ['status', 'html', 'source', 'diagnostics', 'diagnosticsTruncated']);
    text(oracle.html, MAX_EXPECTED_UNITS, true); list(oracle.diagnostics, 100);
    if (!['cleaned', 'rejected'].includes(oracle.status) || !['word', 'google-docs', 'libreoffice', 'html'].includes(oracle.source)
      || typeof oracle.diagnosticsTruncated !== 'boolean') fail('evidence-schema');
    for (const code of oracle.diagnostics) text(code, 64);
    const result = normalizePasteHTML(state.html, { formatting, allowRemoteImages: false, allowDataImages: true });
    if (result.status !== oracle.status || result.html !== oracle.html || result.source !== oracle.source
      || result.diagnosticsTruncated !== oracle.diagnosticsTruncated
      || JSON.stringify(result.diagnostics.map(item => item.code)) !== JSON.stringify(oracle.diagnostics)) fail('evidence-replay-mismatch');
    outcomes.push({ formatting, status: result.status, source: result.source, htmlSha256: digest(result.html),
      htmlUnits: result.html.length, diagnostics: result.diagnostics.map(item => item.code), diagnosticsTruncated: result.diagnosticsTruncated });
  }
  return freeze({ kind: 'offline-html-replay', qualification: false, nativeEvidenceAuthenticated: false,
    editorInsertionVerified: false, imageAssociationVerified: false, fixtureId: state.report.fixtureId, outcomes });
}

function artifactPath(value) {
  text(value, 512);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/u.test(value) || isAbsolute(value)
    || value.split('/').some(part => !part || part === '.' || part === '..')) fail('evidence-path');
  return value;
}
async function readContained(root, name, maximum) {
  const file = await realpath(resolve(root, artifactPath(name)));
  const inside = relative(root, file);
  if (inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) fail('evidence-path');
  const stream = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  let buffer; let failure;
  try {
    const stat = await stream.stat();
    if (!stat.isFile()) fail('evidence-path'); integer(stat.size, maximum);
    buffer = Buffer.alloc(stat.size); let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await stream.read(buffer, offset, buffer.length - offset, offset);
      if (bytesRead === 0) fail('evidence-truncated'); offset += bytesRead;
    }
    const extra = await stream.read(Buffer.alloc(1), 0, 1, offset);
    if (extra.bytesRead !== 0 || (await stream.stat()).size !== stat.size) fail('evidence-limit');
  } catch (error) { failure = error; }
  try { await stream.close(); } catch (error) { failure ??= error; }
  if (failure) { buffer?.fill(0); throw failure; }
  return buffer;
}
/** The directory is explicitly selected by the operator. Payload names and URLs are never file paths. */
export async function verifyCaptureFixture(directory) {
  let manifestBytes; let source; let capture; let handle;
  try {
    const root = await realpath(directory);
    manifestBytes = await readContained(root, 'manifest.json', MAX_MANIFEST_BYTES);
    const manifest = parseJSON(manifestBytes, MAX_MANIFEST_BYTES);
    shape(manifest, ['schemaVersion', 'id', 'origin', 'license', 'source', 'capture', 'expected']);
    if (manifest.schemaVersion !== 1) fail('evidence-schema'); text(manifest.id); text(manifest.license);
    shape(manifest.source, ['path', 'sha256']); shape(manifest.capture, ['path', 'sha256']);
    hash(manifest.source.sha256); hash(manifest.capture.sha256);
    source = await readContained(root, manifest.source.path, MAX_SOURCE_BYTES);
    if (digest(source) !== manifest.source.sha256) fail('evidence-checksum');
    capture = await readContained(root, manifest.capture.path, HARD_LIMITS.maxJSONBytes);
    const evidence = validateCaptureBytes(capture, { captureSha256: manifest.capture.sha256,
      fixtureSha256: manifest.source.sha256, fixtureId: manifest.id, origin: manifest.origin });
    handle = evidence.handle;
    const replay = replayCaptureEvidence(handle, manifest.expected);
    return freeze({ integrity: evidence.report, replay });
  } catch (error) { if (error instanceof CaptureEvidenceError) throw error; fail('evidence-read'); }
  finally { manifestBytes?.fill(0); source?.fill(0); capture?.fill(0); if (handle) disposeCaptureEvidence(handle); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) fail('evidence-arguments');
    const report = await verifyCaptureFixture(resolve(process.argv[2]));
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } catch (error) {
    process.stderr.write((error instanceof CaptureEvidenceError ? error.code : 'evidence-failed') + '\n'); process.exitCode = 1;
  }
}
