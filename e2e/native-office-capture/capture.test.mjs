import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { readFile } from 'node:fs/promises';
import { capturePaste, HARD_LIMITS, serializeCaptureBundle } from './capture.mjs';

const operator = () => ({
  os: 'Test OS 1.2 build 3', application: 'Test Writer 4.5 build 6',
  browser: 'Test Browser 7.8 build 9', scenario: 'mixed-two-images',
  fixtureId: 'synthetic-fixture-v1', fixtureSha256: 'a'.repeat(64),
  copyMethod: 'Keyboard copy, paragraphs 1 through 3', syntheticSourceConfirmed: true,
});
function event({ strings = { 'text/html': '<p>Example</p>' }, items = [], trusted = false } = {}) {
  const value = new Event('paste', { cancelable: true });
  Object.defineProperty(value, 'clipboardData', { value: {
    types: Object.keys(strings), items,
    getData(format) { return strings[format]; },
  } });
  if (trusted) return { type: 'paste', isTrusted: true, clipboardData: value.clipboardData };
  return value;
}
const fileItem = file => ({ kind: 'file', type: file.type, getAsFile: () => file });
const file = (bytes = [1, 2, 3], name = 'fixture.png') => new File([new Uint8Array(bytes)], name, {
  type: 'image/png', lastModified: 123,
});
const incomplete = result => {
  assert.equal(result.status, 'incomplete');
  assert.equal(result.qualification, false);
  assert.equal(result.provenance.nativeClipboardCaptured, false);
  assert.equal(result.payload, null);
};

test('captures allowlisted strings and every original index, without native qualification', async () => {
  const bytes = [1, 2, 3];
  const result = await capturePaste(event({
    strings: { 'text/html': '<img src="cid:2">', 'text/plain': 'Example', 'application/custom': 'SECRET' },
    items: [{ kind: 'string', type: 'text/html' }, { kind: 'string', type: 'application/custom' }, fileItem(file(bytes))],
  }), operator());
  assert.equal(result.status, 'complete');
  assert.equal(result.qualification, false);
  assert.equal(result.provenance.eventKind, 'synthetic-event');
  assert.equal(result.provenance.nativeClipboardCaptured, false);
  assert.deepEqual(result.payload.items.map(item => item.itemIndex), [0, 1, 2]);
  assert.deepEqual(result.payload.omittedFormats, ['application/custom']);
  assert.equal(result.payload.files[0].itemIndex, 2);
  assert.equal(result.payload.files[0].base64, 'AQID');
  assert.equal(result.payload.files[0].sha256, createHash('sha256').update(new Uint8Array(bytes)).digest('hex'));
  assert.ok(!serializeCaptureBundle(result).includes('SECRET'));
  assert.ok(Object.isFrozen(result.payload.items[2].file));
});

test('never trusts a duck event claiming isTrusted', async () => {
  incomplete(await capturePaste(event({ trusted: true }), operator()));
});

test('snapshots strings, operator, items and read method before asynchronous file work', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const source = file();
  const read = source.arrayBuffer.bind(source);
  Object.defineProperty(source, 'arrayBuffer', { configurable: true, value: async () => { await gate; return read(); } });
  const strings = { 'text/html': '<p>Original</p>' };
  const items = [fileItem(source)];
  const metadata = operator();
  const pending = capturePaste(event({ strings, items }), metadata);
  strings['text/html'] = '<p>Changed</p>';
  items.length = 0;
  metadata.application = 'Changed';
  Object.defineProperty(source, 'arrayBuffer', { value: () => { throw new Error('Late read'); } });
  release();
  const result = await pending;
  assert.equal(result.status, 'complete');
  assert.equal(result.payload.text['text/html'], '<p>Original</p>');
  assert.equal(result.operator.application, 'Test Writer 4.5 build 6');
  assert.equal(result.payload.files.length, 1);
});

test('does not call non-allowlisted getData or item getAsString', async () => {
  const value = event({ strings: { 'text/html': 'x', 'application/private': 'hidden' }, items: [{
    kind: 'string', type: 'application/private', getAsString() { assert.fail('Unexpected string callback'); },
  }] });
  value.clipboardData.getData = format => { assert.equal(format, 'text/html'); return 'x'; };
  assert.equal((await capturePaste(value, operator())).status, 'complete');
});

test('captures empty exposed text and legacy Text separately from absent formats', async () => {
  const result = await capturePaste(event({ strings: { 'text/html': '', Text: 'plain', 'text/rtf': '{\\rtf1}' } }), operator());
  assert.deepEqual(result.payload.text, { 'text/html': '', Text: 'plain', 'text/rtf': '{\\rtf1}' });
});

test('counts UTF-8 including replacement of lone surrogates before reads', async () => {
  assert.equal((await capturePaste(event({ strings: { 'text/plain': 'α🙂\ud800' } }), operator(), { limits: { maxTextBytes: 9 } })).status, 'complete');
  incomplete(await capturePaste(event({ strings: { 'text/plain': 'α🙂\ud800' } }), operator(), { limits: { maxTextBytes: 8 } }));
});

for (const [name, settings] of Object.entries({
  'item count': { maxItems: 1 }, 'format count': { maxFormats: 1 },
  'per-format bytes': { maxFormatBytes: 1 }, 'total text bytes': { maxTextBytes: 2 },
  'per-file bytes': { maxFileBytes: 2 }, 'total file bytes': { maxTotalFileBytes: 5 },
  'clipboard bytes': { maxClipboardBytes: 5 }, 'generated JSON allowance': { maxJSONBytes: 1 },
})) test(`rejects ${name} before any binary read and exports no partial evidence`, async () => {
  const source = file();
  Object.defineProperty(source, 'arrayBuffer', { value() { assert.fail('Preflight must reject before reading'); } });
  incomplete(await capturePaste(event({ strings: { 'text/html': 'abc', 'text/plain': 'def' }, items: [fileItem(source), fileItem(source)] }), operator(), { limits: settings }));
});

test('accepts exact input limits without deduplicating different item indices', async () => {
  const source = file();
  const result = await capturePaste(event({ strings: { 'text/plain': 'abc' }, items: [fileItem(source), fileItem(source)] }), operator(), {
    limits: { maxItems: 2, maxFormats: 1, maxFormatBytes: 3, maxTextBytes: 3, maxFileBytes: 3, maxTotalFileBytes: 6, maxClipboardBytes: 9 },
  });
  assert.equal(result.status, 'complete');
  assert.deepEqual(result.payload.files.map(entry => entry.itemIndex), [0, 1]);
});

for (const bad of [null, [], { extra: 1 }, { maxItems: 0 }, { maxItems: Infinity }, { maxItems: 1.5 }, { maxItems: HARD_LIMITS.maxItems + 1 }]) {
  test(`rejects invalid limit configuration ${JSON.stringify(bad)}`, async () => {
    incomplete(await capturePaste(event(), operator(), { limits: bad }));
  });
}

test('refuses missing provenance or unconfirmed synthetic source', async () => {
  for (const key of Object.keys(operator())) {
    const input = Object.fromEntries(Object.entries(operator()).filter(([name]) => name !== key));
    incomplete(await capturePaste(event(), input));
  }
  incomplete(await capturePaste(event(), { ...operator(), syntheticSourceConfirmed: false }));
  incomplete(await capturePaste(event(), { ...operator(), fixtureSha256: 'not-a-hash' }));
});

test('fails closed for null files, fake File metadata, and throwing getters', async () => {
  incomplete(await capturePaste(event({ items: [{ kind: 'file', type: 'image/png', getAsFile: () => null }] }), operator()));
  incomplete(await capturePaste(event({ items: [fileItem({ type: 'image/png', name: 'fake', size: 3 })] }), operator()));
  const value = event();
  Object.defineProperty(value.clipboardData, 'types', { get() { throw new Error('SECRET'); } });
  const result = await capturePaste(value, operator());
  incomplete(result);
  assert.ok(!serializeCaptureBundle(result).includes('SECRET'));
});

test('bounds type and filename metadata', async () => {
  incomplete(await capturePaste(event({ items: [fileItem(file([1], 'a'.repeat(513)))] }), operator()));
  incomplete(await capturePaste(event({ items: [{ kind: 'string', type: 'a'.repeat(513) }] }), operator()));
});

test('records declared item MIME and native File MIME faithfully even when they differ', async () => {
  const result = await capturePaste(event({ items: [{ ...fileItem(file()), type: 'image/jpeg' }] }), operator());
  assert.equal(result.status, 'complete');
  assert.equal(result.payload.items[0].type, 'image/jpeg');
  assert.equal(result.payload.items[0].file.type, 'image/png');
  assert.equal(result.qualification, false);
});

test('fails closed on read rejection, non-buffer, shared buffer or byte-length mismatch', async () => {
  for (const read of [() => Promise.reject(new Error('SECRET')), () => new Uint8Array(3), () => new SharedArrayBuffer(3), () => new ArrayBuffer(2)]) {
    const source = file();
    Object.defineProperty(source, 'arrayBuffer', { value: read });
    const result = await capturePaste(event({ items: [fileItem(source)] }), operator());
    incomplete(result);
    assert.ok(!serializeCaptureBundle(result).includes('SECRET'));
  }
});

test('accepts a cross-realm ArrayBuffer through intrinsic brand checking', async () => {
  const source = file();
  Object.defineProperty(source, 'arrayBuffer', { value: () => runInNewContext('new Uint8Array([1,2,3]).buffer') });
  assert.equal((await capturePaste(event({ items: [fileItem(source)] }), operator())).status, 'complete');
});

test('does not discard repeated files or reinterpret source IDs as bindings', async () => {
  const result = await capturePaste(event({ strings: { 'text/html': '<img src="cid:1"><img src="cid:1">' }, items: [fileItem(file()), fileItem(file())] }), operator());
  assert.equal(result.payload.items.length, 2);
  assert.equal(result.payload.files.length, 2);
  assert.equal(result.qualification, false);
  assert.equal(Object.hasOwn(result, 'bindings'), false);
});

test('a Node Event with an own forged trust value still remains synthetic', async () => {
  const value = event();
  Object.defineProperty(value, 'isTrusted', { value: true, configurable: false, writable: false });
  const result = await capturePaste(value, operator());
  assert.equal(result.status, 'complete');
  assert.equal(result.provenance.nativeClipboardCaptured, false);
  assert.equal(result.provenance.eventKind, 'synthetic-event');
});

test('already cancelled capture performs no binary read', async () => {
  const source = file();
  Object.defineProperty(source, 'arrayBuffer', { value() { assert.fail('Cancelled read'); } });
  const controller = new AbortController();
  controller.abort();
  const result = await capturePaste(event({ items: [fileItem(source)] }), operator(), { signal: controller.signal });
  incomplete(result);
  assert.deepEqual(result.diagnostics, ['cancelled']);
});

test('Cancel settles without a hung native read and ignores its eventual bytes', async () => {
  let release;
  const source = file();
  Object.defineProperty(source, 'arrayBuffer', { value: () => new Promise(resolve => { release = resolve; }) });
  const controller = new AbortController();
  const pending = capturePaste(event({ items: [fileItem(source)] }), operator(), { signal: controller.signal });
  controller.abort();
  const result = await pending;
  incomplete(result);
  assert.deepEqual(result.diagnostics, ['cancelled']);
  const originalJSON = serializeCaptureBundle(result);
  release(new Uint8Array([1, 2, 3]).buffer);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(serializeCaptureBundle(result), originalJSON);
});

test('deadline makes a hung extraction incomplete and allows bounded retry', async () => {
  let release;
  const source = file();
  Object.defineProperty(source, 'arrayBuffer', { value: () => new Promise(resolve => { release = resolve; }) });
  const result = await capturePaste(event({ items: [fileItem(source)] }), operator(), { limits: { maxDurationMs: 5 } });
  incomplete(result);
  assert.deepEqual(result.diagnostics, ['deadline']);
  assert.equal((await capturePaste(event({ items: [fileItem(file())] }), operator())).status, 'complete');
  release(new Uint8Array([1, 2, 3]).buffer);
  await new Promise(resolve => setImmediate(resolve));
});

test('repeated Cancel cannot create unlimited outstanding read work', async () => {
  const releases = [];
  for (let index = 0; index < 2; index++) {
    const source = file();
    Object.defineProperty(source, 'arrayBuffer', { value: () => new Promise(resolve => { releases.push(resolve); }) });
    const controller = new AbortController();
    const pending = capturePaste(event({ items: [fileItem(source)] }), operator(), { signal: controller.signal });
    controller.abort();
    incomplete(await pending);
  }
  const source = file();
  Object.defineProperty(source, 'arrayBuffer', { value() { assert.fail('Outstanding job cap must precede read'); } });
  const blocked = await capturePaste(event({ items: [fileItem(source)] }), operator());
  incomplete(blocked);
  assert.deepEqual(blocked.diagnostics, ['read-capacity']);
  assert.equal((await capturePaste(event(), operator())).status, 'complete');
  for (const release of releases) release(new Uint8Array([1, 2, 3]).buffer);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await capturePaste(event({ items: [fileItem(file())] }), operator())).status, 'complete');
});

test('keeps a late digest inside the outstanding-work ledger and discards it after Cancel', async () => {
  const original = crypto.subtle.digest;
  let release;
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  crypto.subtle.digest = () => { started(); return new Promise(resolve => { release = resolve; }); };
  try {
    const controller = new AbortController();
    const pending = capturePaste(event({ items: [fileItem(file())] }), operator(), { signal: controller.signal });
    await ready;
    controller.abort();
    const result = await pending;
    incomplete(result);
    release(new ArrayBuffer(32));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(result.payload, null);
  } finally { crypto.subtle.digest = original; }
});

test('encodes multiple complete chunks and final padding without changing bytes', async () => {
  const bytes = Uint8Array.from({ length: 25_001 }, (_, index) => index % 251);
  const result = await capturePaste(event({ items: [fileItem(new File([bytes], 'fixture.bin', { type: 'application/octet-stream' }))] }), operator());
  assert.equal(result.status, 'complete');
  assert.deepEqual(Buffer.from(result.payload.files[0].base64, 'base64'), Buffer.from(bytes));
  assert.equal(result.payload.files[0].sha256, createHash('sha256').update(bytes).digest('hex'));
});

test('static harness denies network destinations, source HTML rendering and automatic clipboard reads', async () => {
  const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('./app.mjs', import.meta.url), 'utf8');
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /img-src 'none'/);
  assert.match(html, /id="download"[^>]*disabled/);
  assert.doesNotMatch(app, /innerHTML|outerHTML|insertAdjacentHTML|navigator\.clipboard|\bfetch\s*\(/);
  assert.match(app, /revokeObjectURL/);
  assert.match(app, /preventDefault/);
});
