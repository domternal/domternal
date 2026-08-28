/** Local evidence tooling only. A complete capture never qualifies a source profile. */
export const HARD_LIMITS = Object.freeze({
  maxItems: 64, maxFormats: 32, maxMetadataLength: 512,
  maxFormatBytes: 2 * 1024 * 1024, maxTextBytes: 4 * 1024 * 1024,
  maxFileBytes: 5 * 1024 * 1024, maxTotalFileBytes: 10 * 1024 * 1024,
  maxClipboardBytes: 12 * 1024 * 1024, maxJSONBytes: 24 * 1024 * 1024,
  maxDurationMs: 15_000,
});
export const TEXT_FORMATS = Object.freeze([
  'text/html', 'text/plain', 'text/rtf', 'application/rtf', 'text/uri-list', 'Text',
]);
const eventType = Object.getOwnPropertyDescriptor(Event.prototype, 'type').get;
const eventTrust = Object.getOwnPropertyDescriptor(Event.prototype, 'isTrusted')?.get;
const clipboardGetter = typeof ClipboardEvent === 'function'
  ? Object.getOwnPropertyDescriptor(ClipboardEvent.prototype, 'clipboardData')?.get : undefined;
const blobSize = Object.getOwnPropertyDescriptor(Blob.prototype, 'size').get;
const blobType = Object.getOwnPropertyDescriptor(Blob.prototype, 'type').get;
const fileName = Object.getOwnPropertyDescriptor(File.prototype, 'name').get;
const fileModified = Object.getOwnPropertyDescriptor(File.prototype, 'lastModified').get;
const bufferLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get;
let outstandingJobs = 0;
let outstandingBytes = 0;

class CaptureFailure extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = code => { throw new CaptureFailure(code); };
const freeze = value => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
function limitsFor(overrides = {}) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) fail('invalid-limits');
  const limits = { ...HARD_LIMITS };
  for (const key of Reflect.ownKeys(overrides)) {
    if (typeof key !== 'string' || !Object.hasOwn(limits, key)) fail('invalid-limits');
    const value = overrides[key];
    if (!Number.isSafeInteger(value) || value <= 0 || value > limits[key]) fail('invalid-limits');
    limits[key] = value;
  }
  return Object.freeze(limits);
}
function metadata(value, limit, allowEmpty = false) {
  if (typeof value !== 'string' || value.length > limit || (!allowEmpty && !value.trim())) fail('invalid-metadata');
  return value;
}
function operatorFor(input, limit) {
  if (!input || input.syntheticSourceConfirmed !== true) fail('synthetic-source-required');
  const result = {};
  for (const key of ['os', 'application', 'browser', 'scenario', 'fixtureId', 'fixtureSha256', 'copyMethod']) {
    result[key] = metadata(input[key], limit);
  }
  if (!/^[a-f0-9]{64}$/iu.test(result.fixtureSha256)) fail('invalid-fixture-hash');
  result.syntheticSourceConfirmed = true;
  return Object.freeze(result);
}
/** Counts replacement UTF-8 without allocating an encoded copy or scanning beyond the cap. */
function utf8Bytes(value, limit) {
  let count = 0;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 0x80) count++;
    else if (code < 0x800) count += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length
      && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
      count += 4; index++;
    } else count += 3;
    if (count > limit) fail('text-limit');
  }
  return count;
}
function listLength(value, maximum) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) fail('list-limit');
  return value;
}
function eventData(event) {
  // Intrinsic getters reject duck objects. Node test events can never claim native evidence.
  if (eventType.call(event) !== 'paste') fail('invalid-event');
  let genuineClipboardEvent = false;
  let data;
  if (clipboardGetter) {
    try { data = clipboardGetter.call(event); genuineClipboardEvent = true; } catch { /* Synthetic Event fixture. */ }
  }
  if (!genuineClipboardEvent) data = event.clipboardData;
  let trusted = false;
  if (genuineClipboardEvent) {
    const own = Object.getOwnPropertyDescriptor(event, 'isTrusted');
    const getter = eventTrust ?? (own?.configurable === false ? own.get : undefined);
    trusted = getter ? getter.call(event) === true : own?.configurable === false && own.writable === false && own.value === true;
  }
  if (!data) fail('clipboard-unavailable');
  return { data, trusted };
}
function snapshotPaste(event, operator, limits) {
  const provenance = operatorFor(operator, limits.maxMetadataLength);
  const { data, trusted } = eventData(event);
  const availableFormats = [];
  const types = data.types;
  const typeCount = listLength(types.length, limits.maxFormats);
  for (let index = 0; index < typeCount; index++) availableFormats.push(metadata(types[index], limits.maxMetadataLength));
  const text = {};
  let textBytes = 0;
  let textUnits = 0;
  for (const format of TEXT_FORMATS) {
    if (!availableFormats.includes(format)) continue;
    const value = data.getData(format);
    if (typeof value !== 'string') fail('text-unavailable');
    const bytes = utf8Bytes(value, Math.min(limits.maxFormatBytes, limits.maxTextBytes - textBytes));
    textBytes += bytes;
    textUnits += value.length;
    text[format] = value;
  }
  const items = [];
  const pending = [];
  const nativeItems = data.items;
  const count = listLength(nativeItems.length, limits.maxItems);
  let fileBytes = 0;
  let base64Units = 0;
  for (let itemIndex = 0; itemIndex < count; itemIndex++) {
    const item = nativeItems[itemIndex];
    const kind = metadata(item.kind, limits.maxMetadataLength);
    const type = metadata(item.type, limits.maxMetadataLength, true);
    if (kind !== 'file' && kind !== 'string') fail('invalid-item-kind');
    let file = null;
    if (kind === 'file') {
      const source = item.getAsFile();
      if (!source) fail('file-unavailable');
      const size = blobSize.call(source);
      const mime = metadata(blobType.call(source), limits.maxMetadataLength, true);
      const name = metadata(fileName.call(source), limits.maxMetadataLength, true);
      const lastModified = fileModified.call(source);
      if (!Number.isSafeInteger(lastModified) || !Number.isSafeInteger(size) || size < 0) fail('invalid-file-metadata');
      if (size > limits.maxFileBytes || size > limits.maxTotalFileBytes - fileBytes) fail('file-limit');
      const read = source.arrayBuffer;
      if (typeof read !== 'function') fail('file-unavailable');
      fileBytes += size;
      base64Units += 4 * Math.ceil(size / 3);
      file = Object.freeze({ name, type: mime, size, lastModified });
      pending.push({ itemIndex, source, read, size });
    }
    items.push(Object.freeze({ itemIndex, kind, type, file }));
  }
  if (textBytes + fileBytes > limits.maxClipboardBytes) fail('clipboard-limit');
  // Six bytes per UTF-16 unit covers JSON escapes and UTF-8. Metadata reserve covers
  // all bounded operator, type, name, hash and structural fields before serialization.
  const metadataReserve = 16_384 + (count * 4 + typeCount * 2 + 7) * limits.maxMetadataLength * 6;
  if (textUnits * 6 + base64Units + metadataReserve > limits.maxJSONBytes) fail('json-limit');
  return {
    operator: provenance, trusted, availableFormats, text, items, pending, textBytes, fileBytes,
    omittedFormats: availableFormats.filter(format => !TEXT_FORMATS.includes(format)), limits,
  };
}
function aborted(signal) { if (signal.aborted) fail(signal.reason === 'deadline' ? 'deadline' : 'cancelled'); }
function base64(bytes) {
  // Each chunk is divisible by three, so concatenating encoded chunks adds no interior padding.
  const parts = [];
  for (let start = 0; start < bytes.length; start += 12_288) {
    let binary = '';
    const end = Math.min(start + 12_288, bytes.length);
    for (let index = start; index < end; index++) binary += String.fromCharCode(bytes[index]);
    parts.push(btoa(binary));
  }
  return parts.join('');
}
async function readEncoded(entry, signal) {
  // Cancelled native reads/digests still count until their actual settlement. Repeated
  // Cancel/Retry cannot create an unlimited backlog of browser-owned binary work.
  if (outstandingJobs >= 2 || entry.size > HARD_LIMITS.maxTotalFileBytes - outstandingBytes) fail('read-capacity');
  outstandingJobs++;
  outstandingBytes += entry.size;
  try {
    aborted(signal);
    const buffer = await entry.read.call(entry.source);
    aborted(signal);
    if (bufferLength.call(buffer) !== entry.size) fail('file-size-mismatch');
    const bytes = new Uint8Array(buffer);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    aborted(signal);
    const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    return Object.freeze({ itemIndex: entry.itemIndex, byteLength: entry.size, sha256, base64: base64(bytes) });
  } finally {
    outstandingJobs--;
    outstandingBytes -= entry.size;
  }
}
function bundle(snapshot, capturedAt, payload, diagnostic) {
  return freeze({
    schemaVersion: 1, harnessVersion: 'native-office-capture-v1', capturedAt,
    status: diagnostic ? 'incomplete' : 'complete', qualification: false,
    scope: 'allowlisted-formats-and-exposed-files',
    provenance: {
      eventKind: snapshot ? (snapshot.trusted ? 'native-event' : 'synthetic-event') : 'unverified-event',
      nativeClipboardCaptured: Boolean(snapshot?.trusted && !diagnostic),
      sourceApplicationVerified: false,
    },
    operator: snapshot?.operator ?? null, limits: snapshot?.limits ?? HARD_LIMITS,
    diagnostics: diagnostic ? [diagnostic] : [], payload,
  });
}
/**
 * Snapshot event-only data synchronously, then read retained Files. No event or
 * DataTransferItem crosses the asynchronous boundary. Abort/deadline returns an
 * incomplete diagnostic bundle; late binary work never modifies that result.
 */
export function capturePaste(event, operator, options = {}) {
  const capturedAt = new Date().toISOString();
  let snapshot;
  let external;
  try {
    snapshot = snapshotPaste(event, operator, limitsFor(options.limits));
    external = options.signal;
  } catch (error) {
    return Promise.resolve(bundle(undefined, capturedAt, null, error instanceof CaptureFailure ? error.code : 'capture-error'));
  }
  const controller = new AbortController();
  let timer;
  let unlink = () => { /* No external signal was attached. */ };
  const files = [];
  let completed = false;
  const completion = (async () => {
    let rejectAbort;
    const abortPromise = new Promise((_resolve, reject) => { rejectAbort = reject; });
    const abort = () => rejectAbort(new CaptureFailure(controller.signal.reason === 'deadline' ? 'deadline' : 'cancelled'));
    controller.signal.addEventListener('abort', abort, { once: true });
    try {
      if (external) {
        const forward = () => controller.abort('cancelled');
        external.addEventListener('abort', forward, { once: true });
        unlink = () => external.removeEventListener('abort', forward);
        if (external.aborted) forward();
      }
      timer = setTimeout(() => controller.abort('deadline'), snapshot.limits.maxDurationMs);
      const work = (async () => {
        while (snapshot.pending.length) {
          aborted(controller.signal);
          const entry = snapshot.pending.shift();
          files.push(await readEncoded(entry, controller.signal));
        }
        aborted(controller.signal);
        return {
          availableFormats: snapshot.availableFormats, omittedFormats: snapshot.omittedFormats,
          text: snapshot.text, items: snapshot.items, files,
          totals: { textBytes: snapshot.textBytes, fileBytes: snapshot.fileBytes },
        };
      })();
      const payload = await Promise.race([work, abortPromise]);
      completed = true;
      return bundle(snapshot, capturedAt, payload);
    } catch (error) {
      return bundle(snapshot, capturedAt, null, error instanceof CaptureFailure ? error.code : 'read-error');
    } finally {
      clearTimeout(timer);
      unlink();
      controller.signal.removeEventListener('abort', abort);
      snapshot.pending.length = 0;
      snapshot.text = null;
      snapshot.items = null;
      snapshot.availableFormats = null;
      snapshot.omittedFormats = null;
      if (!completed) files.length = 0;
    }
  })();
  return completion;
}

/** Serialize only a completed tooling result. The input payload already passed preflight. */
export function serializeCaptureBundle(value) {
  const json = JSON.stringify(value);
  if (utf8Bytes(json, value.limits.maxJSONBytes) > value.limits.maxJSONBytes) fail('json-limit');
  return json;
}
