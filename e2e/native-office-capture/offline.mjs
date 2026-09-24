/** Offline evidence integrity checks. No saved JSON can authenticate a native paste. */
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, inflateRawSync } from 'node:zlib';
import { HARD_LIMITS, TEXT_FORMATS } from './capture.mjs';
import { blocksFromHTML, compareBlocks } from './semantics.mjs';

const MAX_SOURCE_BYTES = 16 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 128 * 1024;
const MAX_EXPECTED_UNITS = 32 * 1024;
const HASH = /^[a-f0-9]{64}$/u;
// A redaction replaces a span by this token, padded with hyphens to the span's length. The token is reserved:
// a capture of a version 2 manifest may hold it only inside a declared replacement.
export const REDACTION_TOKEN = 'redacted';
const PACKAGE_LIMITS = Object.freeze({ entries: 256, partBytes: 16 * 1024 * 1024, totalBytes: 64 * 1024 * 1024, nameLength: 256 });
const PART_ELEMENT = /^[A-Za-z][A-Za-z0-9]{0,31}:[A-Za-z][A-Za-z0-9]{0,63}$/u;
const SEMANTIC_BLOCK_TYPES = new Set(['heading', 'paragraph', 'listItem', 'literalItem', 'tableCell', 'empty', 'alphabet', 'image', 'imageRun', 'textOnly']);
const NOTICES = new Set(['quiet', 'visible']);
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

/** The distinct codes of the findings that can show the notice, sorted: warnings and errors, never infos. */
export function noticeCodes(diagnostics) {
  return [...new Set(diagnostics.filter(item => item.severity !== 'info').map(item => item.code))].sort();
}
function sortedCodes(value) {
  list(value, 32);
  for (const code of value) text(code, 64);
  if (JSON.stringify(value) !== JSON.stringify([...new Set(value)].sort())) fail('evidence-schema');
  return value;
}

/**
 * Check a reviewed semantic oracle: the blocks a content specification authors for one selection and,
 * for each policy, the replay's status, source and notice codes, plus the notice and codes the fixture
 * editor is expected to show. Nothing in it is normalizer output.
 */
export function readSemanticExpected(expected) {
  if (!expected || typeof expected !== 'object' || Array.isArray(expected)) fail('evidence-schema');
  const required = ['specification', 'scenario', 'blocks', 'preserve', 'adapt'];
  const keys = Object.keys(expected);
  if (required.some(key => !keys.includes(key)) || keys.some(key => !required.includes(key) && key !== 'partial')) fail('evidence-schema');
  text(expected.specification, 64); text(expected.scenario, 128);
  if (expected.partial !== undefined) {
    shape(expected.partial, ['first', 'last']); text(expected.partial.first, 256); text(expected.partial.last, 256);
  }
  list(expected.blocks, 512);
  if (expected.blocks.length === 0) fail('evidence-schema');
  const ids = new Set();
  for (const block of expected.blocks) {
    if (!block || typeof block !== 'object' || Array.isArray(block) || typeof block.id !== 'string'
      || !/^[A-Z][A-Za-z0-9]{0,15}$/u.test(block.id) || ids.has(block.id) || !SEMANTIC_BLOCK_TYPES.has(block.type)) fail('evidence-schema');
    ids.add(block.id);
  }
  for (const formatting of ['preserve', 'adapt']) {
    const oracle = shape(expected[formatting], ['status', 'source', 'warnings', 'editor']);
    if (!['cleaned', 'rejected'].includes(oracle.status) || !['word', 'google-docs', 'libreoffice', 'html'].includes(oracle.source)) fail('evidence-schema');
    sortedCodes(oracle.warnings);
    const editor = shape(oracle.editor, ['notice', 'warnings']);
    if (!NOTICES.has(editor.notice)) fail('evidence-schema');
    sortedCodes(editor.warnings);
  }
  return expected;
}

/** The content specification a semantic oracle stands for: its blocks and one scenario that selects them in order. */
export function semanticSpecification(expected) {
  return {
    documents: [{ blocks: expected.blocks }],
    scenarios: [{ id: expected.scenario, blocks: expected.blocks.map(block => block.id),
      ...(expected.partial === undefined ? {} : { partial: expected.partial }), outcome: { notice: 'observe' } }],
  };
}

/** HTML-only replay against a reviewed semantic oracle: exact notice codes and the authored blocks, never exact HTML. */
export function replaySemanticEvidence(handle, expected) {
  const state = stored.get(handle);
  if (!state) fail('evidence-handle');
  if (typeof state.html !== 'string') fail('evidence-no-html');
  readSemanticExpected(expected);
  const specification = semanticSpecification(expected);
  const { normalizePasteHTML } = cleanupRequire('@domternal/extension-paste-cleanup/html');
  const outcomes = [];
  for (const formatting of ['preserve', 'adapt']) {
    const oracle = expected[formatting];
    const result = normalizePasteHTML(state.html, { formatting, allowRemoteImages: false, allowDataImages: true });
    const warnings = noticeCodes(result.diagnostics);
    if (result.status !== oracle.status || result.source !== oracle.source || JSON.stringify(warnings) !== JSON.stringify(oracle.warnings)) fail('evidence-replay-mismatch');
    let problems;
    try { problems = compareBlocks(specification, expected.scenario, blocksFromHTML(result.html), { formatting }); } catch { fail('evidence-schema'); }
    if (problems.length > 0) fail('evidence-replay-mismatch');
    outcomes.push({ formatting, status: result.status, source: result.source, htmlSha256: digest(result.html), htmlUnits: result.html.length,
      warnings, diagnostics: result.diagnostics.length, diagnosticsTruncated: result.diagnosticsTruncated });
  }
  return freeze({ kind: 'offline-semantic-replay', qualification: false, nativeEvidenceAuthenticated: false,
    editorInsertionVerified: false, imageAssociationVerified: false, fixtureId: state.report.fixtureId,
    specification: expected.specification, scenario: expected.scenario, blocks: expected.blocks.length, outcomes });
}

/**
 * The parts of a ZIP package, such as a Word document, read within fixed bounds: one disk, no ZIP64,
 * no encryption, stored or deflated parts only, plain relative names, each part's size and CRC checked.
 */
export function readPackageParts(input) {
  const view = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  const u16 = at => { if (at < 0 || at + 2 > view.length) fail('evidence-package'); return view.readUInt16LE(at); };
  const u32 = at => { if (at < 0 || at + 4 > view.length) fail('evidence-package'); return view.readUInt32LE(at); };
  let end = -1;
  for (let at = view.length - 22; at >= 0 && at >= view.length - 22 - 0xffff; at--) {
    if (u32(at) === 0x06054b50 && at + 22 + u16(at + 20) === view.length) { end = at; break; }
  }
  if (end < 0) fail('evidence-package');
  const count = u16(end + 10);
  const directory = u32(end + 16);
  if (u16(end + 4) !== 0 || u16(end + 6) !== 0 || u16(end + 8) !== count || count === 0 || count > PACKAGE_LIMITS.entries
    || directory + u32(end + 12) !== end) fail('evidence-package');
  const parts = new Map();
  let total = 0;
  let offset = directory;
  try {
    for (let index = 0; index < count; index++) {
      if (u32(offset) !== 0x02014b50) fail('evidence-package');
      const flags = u16(offset + 8); const method = u16(offset + 10); const crc = u32(offset + 16);
      const compressed = u32(offset + 20); const size = u32(offset + 24);
      const nameLength = u16(offset + 28); const extraLength = u16(offset + 30); const commentLength = u16(offset + 32);
      const local = u32(offset + 42);
      total += size;
      if ((flags & 1) !== 0 || (method !== 0 && method !== 8) || nameLength === 0 || nameLength > PACKAGE_LIMITS.nameLength
        || size > PACKAGE_LIMITS.partBytes || total > PACKAGE_LIMITS.totalBytes) fail('evidence-package');
      const name = view.subarray(offset + 46, offset + 46 + nameLength).toString('latin1');
      if (!/^[A-Za-z0-9[\]_.-]+(?:\/[A-Za-z0-9[\]_.-]+)*$/u.test(name) || name.split('/').some(part => part === '.' || part === '..') || parts.has(name)) fail('evidence-package');
      offset += 46 + nameLength + extraLength + commentLength;
      if (offset > end || u32(local) !== 0x04034b50) fail('evidence-package');
      const start = local + 30 + u16(local + 26) + u16(local + 28);
      if (start + compressed > directory) fail('evidence-package');
      const data = view.subarray(start, start + compressed);
      let content;
      try { content = method === 0 ? Buffer.from(data) : inflateRawSync(data, { maxOutputLength: Math.max(size, 1) }); } catch { fail('evidence-package'); }
      if (content.length !== size || crc32(content) !== crc) { content.fill(0); fail('evidence-package'); }
      parts.set(name, content);
    }
    if (offset !== end) fail('evidence-package');
  } catch (error) { for (const content of parts.values()) content.fill(0); throw error; }
  return parts;
}

function partText(content) {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(content); } catch { fail('evidence-package'); }
}
const elementPattern = (element, flags) => new RegExp(`(<${element}(?:[\\t\\n\\r ][^<>]*)?>)[^<]*(</${element}>)`, flags);

/** A part's text with the content of each named element removed, the form its redaction leaves. */
export function maskedPart(content, elements) {
  let value = partText(content);
  for (const element of elements) value = value.replace(elementPattern(element, 'gu'), '$1$2');
  return value;
}
/** Whether a part holds each named element, every occurrence of it empty. */
function clearedPart(content, elements) {
  const value = partText(content);
  return elements.every(element => {
    const opening = new RegExp(`<${element}(?=[\\t\\n\\r />])[^<>]*>`, 'gu');
    let found = 0;
    for (const match of value.matchAll(opening)) {
      found++;
      if (!match[0].endsWith('/>') && !value.startsWith(`</${element}>`, match.index + match[0].length)) return false;
    }
    return found > 0;
  });
}

/** The capture with every declared replacement masked. It is equal for an original and its redaction when nothing else changed. */
export function maskedCaptureDigest(bundle, replacements) {
  const masked = structuredClone(bundle);
  for (const { flavor, offset, length } of replacements) {
    const value = masked.payload.text[flavor];
    masked.payload.text[flavor] = `${value.slice(0, offset)}${'\u0000'.repeat(length)}${value.slice(offset + length)}`;
  }
  return digest(JSON.stringify(masked));
}

/** The reserved token of a replaced span of the given length. */
export function redactionToken(length) {
  return REDACTION_TOKEN.padEnd(length, '-');
}

/**
 * Declared redactions of a version 2 manifest: at most one for the source document and one for the
 * capture. Each records the original and redacted hashes, whether the original is retained, whether
 * its fingerprints were taken from the original or from an already redacted copy, and what changed.
 */
export function readRedactions(value) {
  list(value, 2);
  const declared = {};
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail('evidence-schema');
    if (entry.artifact === 'source') {
      shape(entry, ['artifact', 'format', 'reason', 'originalSha256', 'redactedSha256', 'originalRetained', 'basis', 'clearedElements', 'parts']);
      if (entry.format !== 'ooxml-package') fail('evidence-schema');
      list(entry.clearedElements, 16);
      if (entry.clearedElements.length === 0) fail('evidence-schema');
      const named = new Set();
      for (const cleared of entry.clearedElements) {
        shape(cleared, ['part', 'elements']); text(cleared.part, PACKAGE_LIMITS.nameLength); list(cleared.elements, 16);
        if (named.has(cleared.part) || cleared.elements.length === 0 || cleared.elements.some(element => typeof element !== 'string' || !PART_ELEMENT.test(element))) fail('evidence-schema');
        named.add(cleared.part);
      }
      if (!entry.parts || typeof entry.parts !== 'object' || Array.isArray(entry.parts)) fail('evidence-schema');
      integer(Object.keys(entry.parts).length, PACKAGE_LIMITS.entries, 1);
      for (const part of Object.values(entry.parts)) hash(part);
    } else if (entry.artifact === 'capture') {
      shape(entry, ['artifact', 'format', 'reason', 'originalSha256', 'redactedSha256', 'originalRetained', 'basis', 'replacements', 'maskedSha256']);
      if (entry.format !== 'capture-text') fail('evidence-schema');
      list(entry.replacements, 64);
      if (entry.replacements.length === 0) fail('evidence-schema');
      for (const replacement of entry.replacements) {
        shape(replacement, ['flavor', 'offset', 'length', 'token']);
        if (!TEXT_FORMATS.includes(replacement.flavor)) fail('evidence-schema');
        integer(replacement.offset, HARD_LIMITS.maxFormatBytes); integer(replacement.length, 512, REDACTION_TOKEN.length);
        if (replacement.token !== redactionToken(replacement.length)) fail('evidence-schema');
      }
      hash(entry.maskedSha256);
    } else fail('evidence-schema');
    if (Object.hasOwn(declared, entry.artifact)) fail('evidence-schema');
    text(entry.reason, 1024); hash(entry.originalSha256); hash(entry.redactedSha256);
    if (typeof entry.originalRetained !== 'boolean' || !['original', 'redacted-copy'].includes(entry.basis)) fail('evidence-schema');
    if (entry.originalSha256 === entry.redactedSha256) fail('evidence-redaction');
    declared[entry.artifact] = entry;
  }
  return declared;
}

/** The committed package equals its original outside the cleared elements, which are empty. */
export function verifyPackageRedaction(source, declaration) {
  if (digest(source) !== declaration.redactedSha256) fail('evidence-redaction');
  const parts = readPackageParts(source);
  try {
    const names = Object.keys(declaration.parts);
    if (names.length !== parts.size || names.some(name => !parts.has(name))) fail('evidence-redaction');
    const cleared = new Map(declaration.clearedElements.map(entry => [entry.part, entry.elements]));
    for (const part of cleared.keys()) if (!parts.has(part)) fail('evidence-redaction');
    for (const [name, content] of parts) {
      const elements = cleared.get(name);
      const fingerprint = elements === undefined ? digest(content) : digest(Buffer.from(maskedPart(content, elements), 'utf8'));
      if (fingerprint !== declaration.parts[name] || (elements !== undefined && !clearedPart(content, elements))) fail('evidence-redaction');
    }
  } finally { for (const content of parts.values()) content.fill(0); }
}

/**
 * The capture equals its original outside the declared replacements, each of which holds its token, and
 * the reserved token appears nowhere else: a redaction without a declaration cannot pass as captured text.
 */
export function verifyCaptureRedaction(bundle, declaration) {
  const flavors = bundle.payload.text;
  const spans = new Map();
  if (declaration !== undefined) {
    let previous;
    for (const replacement of declaration.replacements) {
      const value = flavors[replacement.flavor];
      const order = TEXT_FORMATS.indexOf(replacement.flavor);
      if (typeof value !== 'string' || replacement.offset + replacement.length > value.length
        || value.slice(replacement.offset, replacement.offset + replacement.length) !== replacement.token
        || (previous !== undefined && (order < previous.order || (order === previous.order && replacement.offset < previous.end)))) fail('evidence-redaction');
      previous = { order, end: replacement.offset + replacement.length };
      spans.set(replacement.flavor, [...(spans.get(replacement.flavor) ?? []), [replacement.offset, previous.end]]);
    }
    if (maskedCaptureDigest(bundle, declaration.replacements) !== declaration.maskedSha256) fail('evidence-redaction');
  }
  for (const [flavor, value] of Object.entries(flavors)) {
    for (let at = value.indexOf(REDACTION_TOKEN); at >= 0; at = value.indexOf(REDACTION_TOKEN, at + 1)) {
      if (!(spans.get(flavor) ?? []).some(([start, stop]) => at >= start && at + REDACTION_TOKEN.length <= stop)) fail('evidence-redaction');
    }
  }
  if (JSON.stringify({ ...bundle, payload: { ...bundle.payload, text: {} } }).includes(REDACTION_TOKEN)) fail('evidence-redaction');
}

function redactionSummary(declaration) {
  return { artifact: declaration.artifact, basis: declaration.basis, originalRetained: declaration.originalRetained,
    originalSha256: declaration.originalSha256, redactedSha256: declaration.redactedSha256, originalVerified: false,
    changes: declaration.artifact === 'source' ? declaration.clearedElements.reduce((sum, entry) => sum + entry.elements.length, 0) : declaration.replacements.length };
}

/** Archived baseline references identify an authored variant, not a new native capture. */
function readDerivation(value) {
  shape(value, ['kind', 'sourceSha256', 'captureSha256', 'manifestSha256']);
  if (value.kind !== 'english-text-variant') fail('evidence-provenance');
  for (const field of ['sourceSha256', 'captureSha256', 'manifestSha256']) hash(value[field]);
  return value;
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
    if (manifest?.schemaVersion === 2) {
      // Historical compatibility for explicitly authored English variants; native claims keep their exact schema.
      const synthetic = manifest.origin === 'synthetic';
      shape(manifest, ['schemaVersion', 'id', 'origin', 'license', 'source', 'capture', 'redactions', 'expected',
        ...(synthetic ? ['derivation'] : [])]);
      if (!synthetic && manifest.origin !== 'claimed-native') fail('evidence-provenance');
      const derivation = synthetic ? readDerivation(manifest.derivation) : undefined;
      if (synthetic && (!Array.isArray(manifest.redactions) || manifest.redactions.length !== 0)) fail('evidence-provenance');
      text(manifest.id); text(manifest.license);
      shape(manifest.source, ['path', 'sha256']); shape(manifest.capture, ['path', 'sha256']);
      hash(manifest.source.sha256); hash(manifest.capture.sha256);
      const redactions = readRedactions(manifest.redactions);
      readSemanticExpected(manifest.expected);
      source = await readContained(root, manifest.source.path, MAX_SOURCE_BYTES);
      if (digest(source) !== manifest.source.sha256) fail('evidence-checksum');
      capture = await readContained(root, manifest.capture.path, HARD_LIMITS.maxJSONBytes);
      if ((redactions.source !== undefined && redactions.source.redactedSha256 !== manifest.source.sha256)
        || (redactions.capture !== undefined && redactions.capture.redactedSha256 !== manifest.capture.sha256)) fail('evidence-redaction');
      // The bundle claims the document it was copied from: the original, when the committed one is its redaction.
      const evidence = validateCaptureBytes(capture, { captureSha256: manifest.capture.sha256,
        fixtureSha256: redactions.source?.originalSha256 ?? manifest.source.sha256, fixtureId: manifest.id, origin: manifest.origin });
      handle = evidence.handle;
      if (redactions.source !== undefined) verifyPackageRedaction(source, redactions.source);
      verifyCaptureRedaction(parseJSON(capture, HARD_LIMITS.maxJSONBytes), redactions.capture);
      const replay = replaySemanticEvidence(handle, manifest.expected);
      return freeze({ integrity: { ...evidence.report, sourceSha256: manifest.source.sha256,
        redactions: Object.values(redactions).map(redactionSummary), ...(derivation === undefined ? {} : { derivation }) }, replay });
    }
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
