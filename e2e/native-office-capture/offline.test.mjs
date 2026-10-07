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

/** Authored semantic controls use the existing synthetic fixture as a baseline, never a real native capture. */
async function semanticFixture(t, { origin = 'synthetic', bundle: changeBundle, manifest: changeManifest } = {}) {
  const { fixture } = await scratch(t);
  const source = Buffer.from('<p class="MsoNormal">B01 <strong>Alpha</strong> <em>Beta</em><img src="cid:2" alt=" diagram"></p>');
  const bundle = structuredClone(original);
  bundle.capturedAt = '2026-10-07T18:00:00.000Z';
  bundle.operator.fixtureSha256 = digest(source);
  bundle.operator.copyMethod = 'Authored English semantic control; no native copy';
  bundle.payload.text['text/html'] = source.toString('utf8');
  bundle.payload.text['text/plain'] = 'B01 Alpha Beta diagram';
  bundle.payload.totals.textBytes = Object.values(bundle.payload.text).reduce((sum, value) => sum + Buffer.byteLength(value), 0);
  if (origin === 'claimed-native') {
    bundle.provenance.eventKind = 'native-event';
    bundle.provenance.nativeClipboardCaptured = true;
  }
  changeBundle?.(bundle);
  const capture = Buffer.from(JSON.stringify(bundle));
  const oracle = { status: 'cleaned', source: 'word', warnings: ['image-removed'],
    editor: { schema: 'default', notice: 'visible', warnings: ['image-removed'] } };
  const value = {
    schemaVersion: 2, id: manifest.id, origin, license: 'MIT; authored semantic fixture control',
    source: { path: 'source.html', sha256: digest(source) },
    capture: { path: 'capture.json', sha256: digest(capture) }, redactions: [],
    expected: { specification: 'english-control', scenario: 'english-control',
      blocks: [{ id: 'B01', type: 'paragraph', text: 'B01 Alpha Beta diagram',
        marks: [{ text: 'Alpha', marks: ['bold'] }, { text: 'Beta', marks: ['italic'] }] }],
      preserve: structuredClone(oracle), adapt: structuredClone(oracle) },
    ...(origin === 'synthetic' ? { derivation: { kind: 'english-text-variant', sourceSha256: manifest.source.sha256,
      captureSha256: manifest.capture.sha256, manifestSha256: digest(await readFile(join(directory, 'manifest.json'))) } } : {}),
  };
  changeManifest?.(value);
  await writeFile(join(fixture, 'source.html'), source);
  await writeFile(join(fixture, 'capture.json'), capture);
  await writeFile(join(fixture, 'manifest.json'), JSON.stringify(value));
  return { fixture, manifest: value };
}

test('semantic English variants retain archived hashes without becoming native or qualified evidence', async t => {
  const { fixture, manifest: value } = await semanticFixture(t);
  const report = await verifyCaptureFixture(fixture);
  assert.deepEqual(report.integrity.derivation, value.derivation);
  assert.ok(Object.isFrozen(report.integrity.derivation));
  assert.equal(report.integrity.origin, 'synthetic');
  assert.equal(report.integrity.claimedEventKind, 'synthetic-event');
  assert.equal(report.integrity.qualification, false);
  assert.equal(report.integrity.nativeEvidenceAuthenticated, false);
  assert.equal(report.integrity.sourceSha256, value.source.sha256);
  assert.notEqual(report.integrity.sourceSha256, value.derivation.sourceSha256);
  assert.equal(report.integrity.captureSha256, value.capture.sha256);
  assert.notEqual(report.integrity.captureSha256, value.derivation.captureSha256);
  assert.deepEqual(report.integrity.redactions, []);
  assert.equal(report.replay.kind, 'offline-semantic-replay');
  assert.deepEqual(report.replay.outcomes.map(outcome => outcome.warnings), [['image-removed'], ['image-removed']]);
  assert.equal(report.replay.qualification, false);
});

for (const [name, mutate, code] of [
  ['missing derivation', value => { delete value.derivation; }, 'evidence-schema'],
  ['null derivation', value => { value.derivation = null; }, 'evidence-schema'],
  ['unknown derivation field', value => { value.derivation.native = true; }, 'evidence-schema'],
  ['unknown derivation kind', value => { value.derivation.kind = 'native-recapture'; }, 'evidence-provenance'],
  ...['sourceSha256', 'captureSha256', 'manifestSha256'].flatMap(field => [
    [`missing ${field}`, value => { Reflect.deleteProperty(value.derivation, field); }, 'evidence-schema'],
    [`invalid ${field}`, value => { value.derivation[field] = 'not-a-hash'; }, 'evidence-schema'],
  ]),
  ['redaction on a synthetic variant', value => { value.redactions = [{}]; }, 'evidence-provenance'],
  ['non-array redactions', value => { value.redactions = null; }, 'evidence-provenance'],
  ['native upgrade with derivation', value => { value.origin = 'claimed-native'; }, 'evidence-schema'],
  ['native upgrade without derivation', value => { value.origin = 'claimed-native'; delete value.derivation; }, 'evidence-provenance'],
  ['wrong actual source hash', value => { value.source.sha256 = '0'.repeat(64); }, 'evidence-checksum'],
  ['wrong actual capture hash', value => { value.capture.sha256 = '0'.repeat(64); }, 'evidence-checksum'],
  ['wrong semantic text', value => { value.expected.blocks[0].text = 'B01 Different text'; }, 'evidence-replay-mismatch'],
]) test(`semantic English variants refuse ${name}`, async t => {
  const { fixture } = await semanticFixture(t, { manifest: mutate });
  await assert.rejects(verifyCaptureFixture(fixture), failure(code));
});

test('synthetic semantic variants reject native event claims even with a complete derivation', async t => {
  const { fixture } = await semanticFixture(t, { bundle: value => {
    value.provenance.eventKind = 'native-event'; value.provenance.nativeClipboardCaptured = true;
  } });
  await assert.rejects(verifyCaptureFixture(fixture), failure('evidence-provenance'));
});

test('native semantic fixtures keep their existing contract and reject synthetic provenance or derivation', async t => {
  const { fixture } = await semanticFixture(t, { origin: 'claimed-native' });
  const report = await verifyCaptureFixture(fixture);
  assert.equal(report.integrity.origin, 'claimed-native');
  assert.equal(report.integrity.claimedEventKind, 'native-event');
  assert.equal(report.integrity.derivation, undefined);
  assert.equal(report.integrity.qualification, false);
  const { fixture: synthetic } = await semanticFixture(t, { origin: 'claimed-native', bundle: value => {
    value.provenance.eventKind = 'synthetic-event'; value.provenance.nativeClipboardCaptured = false;
  } });
  await assert.rejects(verifyCaptureFixture(synthetic), failure('evidence-provenance'));
  const { fixture: derived } = await semanticFixture(t, { origin: 'claimed-native', manifest: value => {
    value.derivation = { kind: 'english-text-variant', sourceSha256: '1'.repeat(64), captureSha256: '2'.repeat(64), manifestSha256: '3'.repeat(64) };
  } });
  await assert.rejects(verifyCaptureFixture(derived), failure('evidence-schema'));
});
