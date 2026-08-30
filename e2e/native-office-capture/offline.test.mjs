import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HARD_LIMITS } from './capture.mjs';
import { CaptureEvidenceError, disposeCaptureEvidence, replayCaptureEvidence, validateCaptureBytes, verifyCaptureFixture } from './offline.mjs';

const directory = fileURLToPath(new URL('./fixtures/synthetic-v1/', import.meta.url));
const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
const original = JSON.parse(await readFile(join(directory, 'capture.json'), 'utf8'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const metadata = (bytes, origin = 'synthetic') => ({ captureSha256: digest(bytes), fixtureSha256: manifest.source.sha256, fixtureId: manifest.id, origin });
const check = (bundle = structuredClone(original), origin = 'synthetic') => {
  const bytes = Buffer.from(JSON.stringify(bundle)); return validateCaptureBytes(bytes, metadata(bytes, origin));
};
const failure = code => error => error instanceof CaptureEvidenceError && error.code === code && error.message === code;
const alter = mutation => { const bundle = structuredClone(original); mutation(bundle); return bundle; };
async function scratch(t) {
  const base = await mkdtemp(join(tmpdir(), 'domternal-capture-offline-'));
  const fixture = join(base, 'fixture'); await cp(directory, fixture, { recursive: true });
  t.after(() => rm(base, { recursive: true, force: true })); return { base, fixture };
}
async function editManifest(fixture, mutate) {
  const value = structuredClone(manifest); mutate(value); await writeFile(join(fixture, 'manifest.json'), JSON.stringify(value));
}

test('checks the committed synthetic artifact hashes and replays actual public Free HTML cleanup', async () => {
  const report = await verifyCaptureFixture(directory);
  assert.equal(report.integrity.qualification, false);
  assert.equal(report.integrity.nativeEvidenceAuthenticated, false);
  assert.equal(report.integrity.origin, 'synthetic');
  assert.equal(report.integrity.claimedEventKind, 'synthetic-event');
  assert.deepEqual([report.integrity.itemCount, report.integrity.fileCount, report.integrity.fileBytes], [3, 1, 4]);
  assert.equal(report.replay.editorInsertionVerified, false); assert.equal(report.replay.imageAssociationVerified, false);
  for (const result of report.replay.outcomes) {
    assert.equal(result.htmlSha256, digest('<p><span><strong>Alpha</strong></span> <span><em>Beta</em></span> diagram</p>'));
    assert.deepEqual(result.diagnostics, ['image-removed']); assert.equal(result.source, 'word');
  }
  assert.ok(Object.isFrozen(report)); assert.ok(Object.isFrozen(report.replay.outcomes[0]));
  const serialized = JSON.stringify(report);
  for (const privateValue of ['Alpha', 'Beta', 'diagram', 'cid:2', 'evidence.bin', 'application/octet-stream']) assert.ok(!serialized.includes(privateValue));
});

test('does not promote manually edited native-event claims into authenticated or qualified evidence', () => {
  const bundle = alter(value => { value.provenance.eventKind = 'native-event'; value.provenance.nativeClipboardCaptured = true; });
  const { handle, report } = check(bundle, 'claimed-native');
  assert.equal(report.claimedEventKind, 'native-event');
  assert.equal(report.nativeEvidenceAuthenticated, false); assert.equal(report.qualification, false);
  assert.equal(report.sourceApplicationVerified, false); disposeCaptureEvidence(handle);
});

test('detaches the retained HTML and never turns payload filenames or image URLs into filesystem reads', () => {
  const bundle = alter(value => { value.payload.items[2].file.name = '../../PRIVATE-SOURCE.png'; });
  const { handle } = check(bundle);
  bundle.payload.text['text/html'] = '<p>MODIFIED PRIVATE SOURCE</p>';
  assert.equal(replayCaptureEvidence(handle, manifest.expected).qualification, false);
  disposeCaptureEvidence(handle); assert.throws(() => replayCaptureEvidence(handle, manifest.expected), failure('evidence-handle'));
});

test('does not fetch source resources during replay', t => {
  t.mock.method(globalThis, 'fetch', () => { assert.fail('Offline replay attempted network access'); });
  const bundle = alter(value => {
    value.payload.text['text/html'] = '<p class="MsoNormal"><strong>Alpha</strong> <em>Beta</em><img src="https://example.invalid/private" alt=" diagram"></p>';
    value.payload.totals.textBytes = Object.values(value.payload.text).reduce((sum, value) => sum + Buffer.byteLength(value), 0);
  });
  const { handle } = check(bundle); replayCaptureEvidence(handle, manifest.expected); disposeCaptureEvidence(handle);
});

for (const [name, mutate, code] of [
  ['schema version', value => { value.schemaVersion = 2; }, 'evidence-schema'],
  ['unknown key', value => { value.unreviewed = true; }, 'evidence-schema'],
  ['qualified claim', value => { value.qualification = true; }, 'evidence-provenance'],
  ['source verified claim', value => { value.provenance.sourceApplicationVerified = true; }, 'evidence-provenance'],
  ['native claim in synthetic fixture', value => { value.provenance.eventKind = 'native-event'; value.provenance.nativeClipboardCaptured = true; }, 'evidence-provenance'],
  ['unverified event', value => { value.provenance.eventKind = 'unverified-event'; }, 'evidence-provenance'],
  ['incomplete', value => { value.status = 'incomplete'; value.payload = null; value.diagnostics = ['deadline']; }, 'evidence-incomplete'],
  ['diagnostic in complete bundle', value => { value.diagnostics = ['read-error']; }, 'evidence-incomplete'],
  ['missing operator', value => { value.operator = null; }, 'evidence-schema'],
  ['source ID', value => { value.operator.fixtureId = 'different-source'; }, 'evidence-provenance'],
  ['source hash', value => { value.operator.fixtureSha256 = '0'.repeat(64); }, 'evidence-provenance'],
  ['customer source', value => { value.operator.syntheticSourceConfirmed = false; }, 'evidence-provenance'],
  ['date', value => { value.capturedAt = 'not-a-date'; }, 'evidence-schema'],
  ['omitted format lie', value => { value.payload.omittedFormats = ['text/html']; }, 'evidence-schema'],
  ['duplicate format', value => { value.payload.availableFormats.push('text/html'); }, 'evidence-schema'],
  ['unobserved text', value => { value.payload.text['application/secret'] = 'PRIVATE SOURCE'; }, 'evidence-schema'],
  ['missing text', value => { delete value.payload.text['text/plain']; }, 'evidence-schema'],
  ['index discontinuity', value => { value.payload.items[2].itemIndex = 3; }, 'evidence-schema'],
  ['file metadata on string', value => { value.payload.items[0].file = value.payload.items[2].file; }, 'evidence-schema'],
  ['file length mismatch', value => { value.payload.files[0].byteLength = 3; }, 'evidence-file'],
  ['missing file', value => { value.payload.files = []; }, 'evidence-total'],
  ['file wrong index', value => { value.payload.files[0].itemIndex = 0; }, 'evidence-file'],
  ['text total', value => { value.payload.totals.textBytes++; }, 'evidence-total'],
  ['file total', value => { value.payload.totals.fileBytes++; }, 'evidence-total'],
  ['base64 character', value => { value.payload.files[0].base64 = '*AE C/8='; }, 'evidence-file'],
  ['base64 length', value => { value.payload.files[0].base64 += 'AAAA'; }, 'evidence-file'],
  ['base64 padding bits', value => { value.payload.files[0].base64 = 'AAEC/9=='; }, 'evidence-file'],
  ['file digest', value => { value.payload.files[0].sha256 = '0'.repeat(64); }, 'evidence-checksum'],
  ['raised limit', value => { value.limits.maxFileBytes++; }, 'evidence-limit'],
  ['zero limit', value => { value.limits.maxItems = 0; }, 'evidence-limit'],
  ['metadata limit', value => { value.operator.application = 'x'.repeat(513); }, 'evidence-schema'],
  ['file limit', value => { value.limits.maxFileBytes = 3; }, 'evidence-limit'],
  ['aggregate limit', value => { value.limits.maxClipboardBytes = value.payload.totals.textBytes + 3; }, 'evidence-limit'],
  ['producer JSON preflight', value => { value.limits.maxJSONBytes = 5000; }, 'evidence-limit'],
]) test(`refuses ${name} with a source-free error`, () => {
  assert.throws(() => check(alter(mutate)), failure(code));
});

test('hash-pins the exact capture bytes before trusting edited JSON', () => {
  const bytes = Buffer.from(JSON.stringify(original)); const expected = metadata(bytes); bytes[0] = 91;
  assert.throws(() => validateCaptureBytes(bytes, expected), failure('evidence-checksum'));
});
test('bounds JSON before parsing and refuses malformed UTF-8, truncation, depth and duplicate keys', () => {
  for (const [input, code] of [
    [Buffer.from([0xff]), 'evidence-json'],
    [Buffer.from(JSON.stringify(original).slice(0, -1)), 'evidence-json'],
    [Buffer.from('['.repeat(13) + ']'.repeat(13)), 'evidence-limit'],
    [Buffer.from('[' + Array.from({ length: 8193 }, () => '0').join(',') + ']'), 'evidence-limit'],
    [Buffer.from('{"schemaVersion":1,"schemaVersion":1}'), 'evidence-duplicate-key'],
    [Buffer.from('{"schemaVersion":1,"schema\\u0056ersion":1}'), 'evidence-duplicate-key'],
  ]) assert.throws(() => validateCaptureBytes(input, metadata(input)), failure(code));
  const tooLarge = Buffer.alloc(HARD_LIMITS.maxJSONBytes + 1);
  assert.throws(() => validateCaptureBytes(tooLarge, metadata(tooLarge)), failure('evidence-limit'));
});
test('accepts exact byte allowances and treats strings containing JSON punctuation as strings', () => {
  const bundle = alter(value => {
    value.payload.text['text/plain'] = '{"[\\" not structural ]"}'.repeat(32);
    value.payload.totals.textBytes = Object.values(value.payload.text).reduce((sum, value) => sum + Buffer.byteLength(value), 0);
    value.limits.maxFileBytes = 4; value.limits.maxTotalFileBytes = 4;
    value.limits.maxTextBytes = value.payload.totals.textBytes;
    value.limits.maxClipboardBytes = value.payload.totals.textBytes + 4;
  });
  const { handle } = check(bundle); disposeCaptureEvidence(handle);
});
test('keeps mismatched item MIME and file MIME as evidence rather than inventing a binding', () => {
  const { handle, report } = check(alter(value => { value.payload.items[2].type = 'image/jpeg'; }));
  assert.equal(report.fileCount, 1); assert.equal(replayCaptureEvidence(handle, manifest.expected).imageAssociationVerified, false);
  disposeCaptureEvidence(handle);
});
test('refuses absent HTML replay and forged handles', () => {
  const bundle = alter(value => {
    delete value.payload.text['text/html']; value.payload.availableFormats = ['text/plain'];
    value.payload.totals.textBytes = Buffer.byteLength(value.payload.text['text/plain']);
  });
  const { handle } = check(bundle);
  assert.throws(() => replayCaptureEvidence(handle, manifest.expected), failure('evidence-no-html'));
  disposeCaptureEvidence(handle); assert.throws(() => replayCaptureEvidence({}, manifest.expected), failure('evidence-handle'));
});
test('refuses independent wrong text, mark, diagnostic and truncation oracles', () => {
  const { handle } = check();
  for (const mutate of [
    value => { value.preserve.html = value.preserve.html.replace('Alpha', 'Beta'); },
    value => { value.preserve.html = value.preserve.html.replaceAll('strong', 'em'); },
    value => { value.preserve.diagnostics = []; },
    value => { value.preserve.diagnosticsTruncated = true; },
  ]) {
    const expected = structuredClone(manifest.expected); mutate(expected);
    assert.throws(() => replayCaptureEvidence(handle, expected), failure('evidence-replay-mismatch'));
  }
  disposeCaptureEvidence(handle);
});

for (const unsafe of ['../outside.html', '/etc/passwd', 'nested/../../outside', 'nested\\outside', '%2e%2e/outside', 'file:///private/source', 'nested//source']) {
  test(`refuses manifest artifact path ${unsafe}`, async t => {
    const { fixture } = await scratch(t);
    await editManifest(fixture, value => { value.source.path = unsafe; });
    await assert.rejects(verifyCaptureFixture(fixture), failure('evidence-path'));
  });
}
test('refuses a symlink that escapes the explicitly selected fixture root', async t => {
  const { base, fixture } = await scratch(t); const outside = join(base, 'outside.html');
  await writeFile(outside, await readFile(join(fixture, 'source.html'))); await symlink(outside, join(fixture, 'linked.html'));
  await editManifest(fixture, value => { value.source.path = 'linked.html'; });
  await assert.rejects(verifyCaptureFixture(fixture), failure('evidence-path'));
});
test('refuses changed source bytes before capture replay and hides missing-path errors', async t => {
  const { fixture } = await scratch(t); await writeFile(join(fixture, 'source.html'), 'PRIVATE SOURCE');
  await assert.rejects(verifyCaptureFixture(fixture), failure('evidence-checksum'));
  await editManifest(fixture, value => { value.source.path = 'PRIVATE-MISSING-SOURCE'; });
  await assert.rejects(verifyCaptureFixture(fixture), failure('evidence-read'));
});
