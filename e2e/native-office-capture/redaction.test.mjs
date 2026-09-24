import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HARD_LIMITS } from './capture.mjs';
import { CaptureEvidenceError, maskedCaptureDigest, readPackageParts, verifyCaptureFixture } from './offline.mjs';
import { prepareFixture } from './prepare-fixture.mjs';
import { scanFiles, scanText } from './privacy.mjs';
import { redactCaptureBytes, redactPackageBytes, writePackage } from './redact.mjs';

// Authored stand-ins for personal data. They are not anybody's data; the tests only need them to be removed.
const AUTHOR = 'Synthetic Author Name';
const ACCOUNT = 'SyntheticAccount';
const ID = 'word-redaction-test-safari';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const failure = code => error => error instanceof CaptureEvidenceError && error.code === code;
const REASON = 'Authored test: personal data removed before commit';

const corePart = author => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="urn:cp" xmlns:dc="urn:dc"><dc:title></dc:title><dc:creator>${author}</dc:creator><cp:lastModifiedBy>${author}</cp:lastModifiedBy><cp:revision>1</cp:revision></cp:coreProperties>`;
function originalPackage(author = AUTHOR, body = 'B01 Test document') {
  return writePackage(new Map([
    ['[Content_Types].xml', Buffer.from('<?xml version="1.0"?><Types xmlns="urn:types"/>')],
    ['docProps/core.xml', Buffer.from(corePart(author))],
    ['word/document.xml', Buffer.from(`<w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>${body}</w:t></w:r></w:p></w:body></w:document>`)],
    ['word/media/image1.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3])],
  ]));
}
const HTML = `<p class="MsoNormal">B01 Test document<img src="blob:x" alt="*"></p><style>@list l0:level1 {list-style-image:url("/home/${ACCOUNT}/clip_image001.png")}</style>`;
function originalBundle(sourceSha256, html = HTML) {
  const text = { 'text/html': html, 'text/plain': 'B01 Test document' };
  return {
    schemaVersion: 1, harnessVersion: 'native-office-capture-v1', capturedAt: '2026-10-02T20:15:28.420Z', status: 'complete', qualification: false,
    scope: 'allowlisted-formats-and-exposed-files', provenance: { eventKind: 'native-event', nativeClipboardCaptured: true, sourceApplicationVerified: false },
    operator: { os: 'Authored test OS', application: 'Authored test application', browser: 'Authored test browser', scenario: 'word-redaction-test',
      fixtureId: ID, fixtureSha256: sourceSha256, copyMethod: 'Authored test, no native copy', syntheticSourceConfirmed: true },
    limits: { ...HARD_LIMITS }, diagnostics: [],
    payload: { availableFormats: ['text/html', 'text/plain'], omittedFormats: [], text,
      items: [{ itemIndex: 0, kind: 'string', type: 'text/html', file: null }, { itemIndex: 1, kind: 'string', type: 'text/plain', file: null }],
      files: [], totals: { textBytes: Object.values(text).reduce((sum, value) => sum + Buffer.byteLength(value), 0), fileBytes: 0 } },
  };
}
const expected = () => ({
  specification: 'redaction-test', scenario: 'word-redaction-test',
  blocks: [{ id: 'B01', type: 'paragraph', text: 'B01 Test document*' }],
  preserve: { status: 'cleaned', source: 'word', warnings: ['image-removed'], editor: { schema: 'default', notice: 'visible', warnings: ['image-removed'] } },
  adapt: { status: 'cleaned', source: 'word', warnings: ['image-removed'], editor: { schema: 'default', notice: 'visible', warnings: ['image-removed'] } },
});

/** A fixture directory whose source and capture were redacted with redact.mjs from originals that the test holds. */
async function fixture(t, { source = true, capture = true } = {}) {
  const base = await mkdtemp(join(tmpdir(), 'domternal-redaction-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const sourceOriginal = originalPackage();
  const captureOriginal = Buffer.from(JSON.stringify(originalBundle(digest(sourceOriginal)), null, 2));
  const redactions = [];
  let sourceBytes = sourceOriginal;
  let captureBytes = captureOriginal;
  if (source) {
    const result = redactPackageBytes(sourceOriginal, [{ part: 'docProps/core.xml', elements: ['dc:creator', 'cp:lastModifiedBy'] }], { reason: REASON });
    sourceBytes = result.bytes; redactions.push(result.declaration);
  }
  if (capture || source) {
    // A redacted source's original hash is withheld from the capture that names it.
    const result = redactCaptureBytes(captureOriginal, capture ? [`/home/${ACCOUNT}`] : [], { reason: REASON, withholdFixtureHash: source });
    captureBytes = result.bytes; redactions.push(result.declaration);
  }
  await writeFile(join(base, 'source.docx'), sourceBytes);
  await writeFile(join(base, 'capture.json'), captureBytes);
  const manifest = { schemaVersion: 2, id: ID, origin: 'claimed-native', license: 'MIT; authored test fixture',
    source: { path: 'source.docx', sha256: digest(sourceBytes) }, capture: { path: 'capture.json', sha256: digest(captureBytes) },
    redactions, expected: expected() };
  await writeFile(join(base, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return { base, manifest, sourceOriginal, captureOriginal, sourceBytes, captureBytes };
}
async function rewrite(base, mutate) {
  const manifest = JSON.parse(await readFile(join(base, 'manifest.json'), 'utf8'));
  mutate(manifest);
  await writeFile(join(base, 'manifest.json'), JSON.stringify(manifest, null, 2));
}
/** Replace a committed artifact and update every hash that names it, as a careless edit would. */
async function replaceArtifact(base, name, bytes) {
  await writeFile(join(base, name), bytes);
  await rewrite(base, manifest => {
    const key = name === 'source.docx' ? 'source' : 'capture';
    manifest[key].sha256 = digest(bytes);
    for (const declaration of manifest.redactions) if (declaration.artifact === key) declaration.redactedSha256 = digest(bytes);
  });
}

test('a declared source and capture redaction passes, and nothing committed or reported holds a hash of what was removed', async t => {
  const { base, manifest, sourceOriginal, captureOriginal, sourceBytes, captureBytes } = await fixture(t);
  const report = await verifyCaptureFixture(base);
  // The source hash the capture names is withheld: a hash of a document that held personal data confirms a guess of it.
  assert.equal(report.integrity.fixtureSha256, null);
  assert.equal(JSON.parse(captureBytes.toString('utf8')).operator.fixtureSha256, `redacted${'-'.repeat(56)}`);
  assert.equal(report.integrity.sourceSha256, digest(sourceBytes));
  assert.deepEqual(report.integrity.redactions.map(entry => [entry.artifact, entry.basis, entry.originalRetained, entry.withheld]),
    [['source', 'original', false, []], ['capture', 'original', false, ['fixtureSha256']]]);
  assert.equal(report.integrity.redactions[1].redactedSha256, digest(captureBytes));
  assert.equal(report.replay.kind, 'offline-semantic-replay');
  assert.deepEqual(report.replay.outcomes.map(outcome => outcome.warnings), [['image-removed'], ['image-removed']]);
  assert.equal(report.integrity.qualification, false); assert.equal(report.integrity.nativeEvidenceAuthenticated, false);
  // Neither the report, the manifest nor the committed artifacts hold the removed values or a hash of an original.
  const committed = [JSON.stringify(report), JSON.stringify(manifest), captureBytes.toString('utf8')];
  for (const value of [AUTHOR, ACCOUNT, digest(sourceOriginal), digest(captureOriginal)]) for (const text of committed) assert.ok(!text.includes(value));
  for (const content of readPackageParts(sourceBytes).values()) assert.ok(!content.toString('latin1').includes(AUTHOR));
});

test('a declaration that records a hash of the original is refused', async t => {
  for (const artifact of ['source', 'capture']) {
    const { base, sourceOriginal } = await fixture(t);
    await rewrite(base, manifest => {
      const declaration = manifest.redactions.find(entry => entry.artifact === artifact);
      declaration.originalSha256 = digest(sourceOriginal);
    });
    await assert.rejects(verifyCaptureFixture(base), failure('evidence-schema'));
  }
});

test('the redactions keep every length, total and part except the declared ones', async t => {
  const { captureOriginal, captureBytes, sourceOriginal, sourceBytes, manifest } = await fixture(t);
  assert.equal(captureBytes.byteLength, captureOriginal.byteLength);
  const before = JSON.parse(captureOriginal.toString('utf8'));
  const after = JSON.parse(captureBytes.toString('utf8'));
  assert.deepEqual(after.payload.totals, before.payload.totals);
  assert.equal(after.payload.text['text/html'].length, before.payload.text['text/html'].length);
  const span = `/home/${ACCOUNT}`;
  const token = `redacted${'-'.repeat(span.length - 8)}`;
  assert.ok(after.payload.text['text/html'].includes(`url("${token}/clip_image001.png")`));
  const capture = manifest.redactions.find(entry => entry.artifact === 'capture');
  assert.deepEqual(capture.replacements, [{ flavor: 'text/html', offset: HTML.indexOf(span), length: span.length, token }]);
  assert.equal(maskedCaptureDigest(before, capture.replacements, capture.withheld), capture.maskedSha256);
  const original = readPackageParts(sourceOriginal);
  const redacted = readPackageParts(sourceBytes);
  assert.deepEqual([...redacted.keys()], [...original.keys()]);
  for (const name of ['[Content_Types].xml', 'word/document.xml', 'word/media/image1.png']) assert.ok(redacted.get(name).equals(original.get(name)), name);
  assert.equal(redacted.get('docProps/core.xml').toString('utf8'), corePart(''));
});

test('an unredacted version 2 fixture keeps the exact source claim of version 1', async t => {
  const { base } = await fixture(t, { source: false, capture: false });
  await rewrite(base, manifest => { manifest.expected.blocks[0].text = 'B01 Test document*'; });
  // The test capture names a local path, which is evidence when nothing claims to have redacted it.
  const report = await verifyCaptureFixture(base);
  assert.deepEqual(report.integrity.redactions, []);
  assert.equal(report.integrity.fixtureSha256, report.integrity.sourceSha256);
});

test('a redacted source and a withheld source hash need each other', async t => {
  // A redacted source without its declaration: the capture's withheld claim names no redaction.
  const { base } = await fixture(t);
  await rewrite(base, manifest => { manifest.redactions = manifest.redactions.filter(entry => entry.artifact !== 'source'); });
  await assert.rejects(verifyCaptureFixture(base), failure('evidence-provenance'));
  // A capture that withholds nothing for a redacted source: its claim cannot name the committed document.
  const second = await fixture(t, { source: true, capture: true });
  const restored = JSON.parse(second.captureBytes.toString('utf8'));
  restored.operator.fixtureSha256 = digest(second.sourceBytes);
  await replaceArtifact(second.base, 'capture.json', Buffer.from(JSON.stringify(restored, null, 2)));
  await rewrite(second.base, manifest => {
    const capture = manifest.redactions.find(entry => entry.artifact === 'capture');
    capture.withheld = [];
  });
  await assert.rejects(verifyCaptureFixture(second.base), error => error instanceof CaptureEvidenceError && ['evidence-provenance', 'evidence-redaction'].includes(error.code));
  // A withheld hash for a source that was not redacted hides provenance for nothing.
  const third = await fixture(t, { source: false, capture: false });
  const withheld = redactCaptureBytes(third.captureBytes, [], { reason: REASON, withholdFixtureHash: true });
  await replaceArtifact(third.base, 'capture.json', withheld.bytes);
  await rewrite(third.base, manifest => { manifest.redactions = [withheld.declaration]; });
  await assert.rejects(verifyCaptureFixture(third.base), failure('evidence-provenance'));
});

test('a withheld source hash holds its token, and the declaration says so', async t => {
  const { base, captureBytes } = await fixture(t);
  const bundle = JSON.parse(captureBytes.toString('utf8'));
  bundle.operator.fixtureSha256 = '0'.repeat(64);
  await replaceArtifact(base, 'capture.json', Buffer.from(JSON.stringify(bundle, null, 2)));
  await assert.rejects(verifyCaptureFixture(base), error => error instanceof CaptureEvidenceError && ['evidence-provenance', 'evidence-redaction'].includes(error.code));
  for (const mutate of [
    manifest => { manifest.redactions[1].withheld = ['copyMethod']; },
    manifest => { manifest.redactions[1].withheld = ['fixtureSha256', 'fixtureSha256']; },
    manifest => { delete manifest.redactions[1].withheld; },
  ]) {
    const next = await fixture(t);
    await rewrite(next.base, mutate);
    await assert.rejects(verifyCaptureFixture(next.base), failure('evidence-schema'));
  }
});

test('a source change the declaration does not name is refused, in another part or inside a cleared element', async t => {
  const { base } = await fixture(t);
  const changedBody = redactPackageBytes(originalPackage(AUTHOR, 'B01 Changed document'),
    [{ part: 'docProps/core.xml', elements: ['dc:creator', 'cp:lastModifiedBy'] }], { reason: REASON }).bytes;
  await replaceArtifact(base, 'source.docx', changedBody);
  await assert.rejects(verifyCaptureFixture(base), failure('evidence-redaction'));
  const second = await fixture(t);
  const parts = readPackageParts(second.sourceBytes);
  parts.set('docProps/core.xml', Buffer.from(corePart('').replace('<dc:creator></dc:creator>', '<dc:creator>Other Name</dc:creator>')));
  await replaceArtifact(second.base, 'source.docx', writePackage(parts));
  await assert.rejects(verifyCaptureFixture(second.base), failure('evidence-redaction'));
  const third = await fixture(t);
  const added = readPackageParts(third.sourceBytes); added.set('docProps/custom.xml', Buffer.from('<Properties/>'));
  await replaceArtifact(third.base, 'source.docx', writePackage(added));
  await assert.rejects(verifyCaptureFixture(third.base), failure('evidence-redaction'));
});

test('a redacted capture without a declaration is refused by its reserved token', async t => {
  const { base } = await fixture(t, { source: false, capture: true });
  await rewrite(base, manifest => { manifest.redactions = manifest.redactions.filter(entry => entry.artifact !== 'capture'); });
  await assert.rejects(verifyCaptureFixture(base), failure('evidence-redaction'));
});

test('the reserved token in another letter case is refused like the token itself', async t => {
  for (const variant of ['REDACTED', 'Redacted', 'rEdAcTeD']) {
    const { base, captureBytes } = await fixture(t, { source: false, capture: true });
    // An undeclared redaction written in capitals: the declaration is removed and the hashes are updated, as a careless edit would.
    const token = `redacted${'-'.repeat(`/home/${ACCOUNT}`.length - 8)}`;
    await replaceArtifact(base, 'capture.json', Buffer.from(captureBytes.toString('utf8').replace(token, `${variant}${token.slice(8)}`)));
    await rewrite(base, manifest => { manifest.redactions = []; });
    await assert.rejects(verifyCaptureFixture(base), failure('evidence-redaction'));
  }
});

test('a capture change outside the declared replacements is refused', async t => {
  const { base, captureBytes } = await fixture(t);
  const tampered = Buffer.from(captureBytes.toString('utf8').replace('B01 Test document<img', 'B01 Test documenx<img'));
  assert.equal(tampered.length, captureBytes.length);
  await replaceArtifact(base, 'capture.json', tampered);
  await assert.rejects(verifyCaptureFixture(base), failure('evidence-redaction'));
  const second = await fixture(t);
  await replaceArtifact(second.base, 'capture.json', Buffer.from(second.captureBytes.toString('utf8').replace('"Authored test browser"', '"Authored test browsex"')));
  await assert.rejects(verifyCaptureFixture(second.base), failure('evidence-redaction'));
  const third = await fixture(t);
  await rewrite(third.base, manifest => { manifest.redactions[1].replacements[0].offset += 1; });
  await assert.rejects(verifyCaptureFixture(third.base), failure('evidence-redaction'));
  const fourth = await fixture(t);
  await rewrite(fourth.base, manifest => { manifest.redactions[1].redactedSha256 = manifest.redactions[1].maskedSha256; });
  await assert.rejects(verifyCaptureFixture(fourth.base), failure('evidence-redaction'));
});

test('the reserved token outside a declared replacement or outside the text flavors is refused', async t => {
  const { base, captureBytes } = await fixture(t);
  const bundle = JSON.parse(captureBytes.toString('utf8'));
  bundle.operator.copyMethod = 'redacted copy method';
  await replaceArtifact(base, 'capture.json', Buffer.from(JSON.stringify(bundle, null, 2)));
  await assert.rejects(verifyCaptureFixture(base), failure('evidence-redaction'));
});

test('declarations are exact: unknown fields, duplicates, tokens and bases are schema errors', async t => {
  for (const mutate of [
    manifest => { manifest.redactions[0].extra = true; },
    manifest => { manifest.redactions[1] = structuredClone(manifest.redactions[0]); },
    manifest => { manifest.redactions[1].replacements[0].token = 'removed---------'; },
    manifest => { manifest.redactions[0].basis = 'unknown'; },
    manifest => { manifest.redactions[0].clearedElements[0].elements = ['creator']; },
    manifest => { manifest.redactions = {}; },
    manifest => { manifest.origin = 'synthetic'; },
  ]) {
    const { base } = await fixture(t);
    await rewrite(base, mutate);
    await assert.rejects(verifyCaptureFixture(base), error => error instanceof CaptureEvidenceError && ['evidence-schema', 'evidence-provenance'].includes(error.code));
  }
});

test('the semantic oracle refuses wrong notice codes, blocks, policies and incomplete authoring', async t => {
  for (const mutate of [
    manifest => { manifest.expected.preserve.warnings = []; },
    manifest => { manifest.expected.adapt.status = 'rejected'; },
    manifest => { manifest.expected.blocks[0].type = 'heading'; manifest.expected.blocks[0].level = 1; },
    manifest => { manifest.expected.blocks[0].text = 'B01 Other text'; },
    manifest => { manifest.expected.blocks.push({ id: 'B02', type: 'paragraph', text: 'B02 Missing' }); },
  ]) {
    const { base } = await fixture(t);
    await rewrite(base, mutate);
    await assert.rejects(verifyCaptureFixture(base), failure('evidence-replay-mismatch'));
  }
  for (const mutate of [
    manifest => { manifest.expected.preserve = null; },
    manifest => { manifest.expected.preserve.warnings = ['z', 'a']; },
    manifest => { manifest.expected.adapt.editor.notice = 'observe'; },
    manifest => { manifest.expected.adapt.editor.schema = 'capability-minimal'; },
    manifest => { manifest.expected.blocks = []; },
    manifest => { manifest.expected.blocks[0].type = 'unknown'; },
  ]) {
    const { base } = await fixture(t);
    await rewrite(base, mutate);
    await assert.rejects(verifyCaptureFixture(base), failure('evidence-schema'));
  }
});

test('a package must be a plain bounded ZIP: truncation and a CRC mismatch are refused', () => {
  const bytes = originalPackage();
  assert.throws(() => readPackageParts(bytes.subarray(0, bytes.length - 5)), failure('evidence-package'));
  const corrupt = Buffer.from(bytes); corrupt.writeUInt32LE((corrupt.readUInt32LE(14) + 1) >>> 0, 14);
  const directory = corrupt.readUInt32LE(corrupt.length - 6);
  corrupt.writeUInt32LE((corrupt.readUInt32LE(directory + 16) + 1) >>> 0, directory + 16);
  assert.throws(() => readPackageParts(corrupt), failure('evidence-package'));
});

test('redact.mjs refuses short, quoted or absent texts and texts outside the flavors, and a package without changes', () => {
  const captureOriginal = Buffer.from(JSON.stringify(originalBundle('0'.repeat(64))));
  assert.throws(() => redactCaptureBytes(captureOriginal, ['short'], { reason: REASON }), /extend a shorter one/u);
  assert.throws(() => redactCaptureBytes(captureOriginal, ['with "quote" inside'], { reason: REASON }), /without quotes/u);
  assert.throws(() => redactCaptureBytes(captureOriginal, ['NotPresentAnywhere'], { reason: REASON }), /None of the texts/u);
  assert.throws(() => redactCaptureBytes(captureOriginal, [], { reason: REASON }), /Name at least one text/u);
  assert.throws(() => redactCaptureBytes(captureOriginal, ['Authored test OS'], { reason: REASON }), /outside the text flavors/u);
  assert.throws(() => redactCaptureBytes(captureOriginal, [`/home/${ACCOUNT}`], { reason: '' }), /reason/u);
  const clean = originalPackage('');
  assert.throws(() => redactPackageBytes(clean, [{ part: 'docProps/core.xml', elements: ['dc:creator'] }], { reason: REASON }), /nothing to clear/u);
  assert.throws(() => redactPackageBytes(clean, [{ part: 'docProps/app.xml', elements: ['dc:creator'] }], { reason: REASON }), /no part/u);
});

test('a copy redacted before its original was deleted is declared as such, with an unchanged hash and no original hash', () => {
  const scrubbed = redactPackageBytes(originalPackage(), [{ part: 'docProps/core.xml', elements: ['dc:creator', 'cp:lastModifiedBy'] }], { reason: REASON }).bytes;
  const { bytes, declaration } = redactPackageBytes(scrubbed, [{ part: 'docProps/core.xml', elements: ['dc:creator', 'cp:lastModifiedBy'] }],
    { reason: REASON, basis: 'redacted-copy' });
  assert.ok(bytes.equals(scrubbed));
  assert.deepEqual([declaration.basis, declaration.originalRetained, declaration.redactedSha256], ['redacted-copy', false, digest(scrubbed)]);
  assert.ok(!Object.hasOwn(declaration, 'originalSha256'));
  assert.throws(() => redactPackageBytes(scrubbed, [{ part: 'docProps/core.xml', elements: ['dc:creator'] }], { reason: REASON, basis: 'claimed' }), /basis/u);
  assert.throws(() => redactPackageBytes(scrubbed, [{ part: 'docProps/core.xml', elements: ['dc:creator'] }], { reason: REASON, basis: 'redacted-copy', originalRetained: true }), /retained/u);
  // A capture copy whose text was redacted earlier keeps its spans; its source hash is withheld now.
  const html = HTML.replace(`/home/${ACCOUNT}`, `/home/${'r'.repeat(ACCOUNT.length)}`);
  const copy = Buffer.from(JSON.stringify(originalBundle(digest(originalPackage()), html), null, 2));
  const capture = redactCaptureBytes(copy, [`/home/${'r'.repeat(ACCOUNT.length)}`], { reason: REASON, basis: 'redacted-copy', withholdFixtureHash: true });
  assert.deepEqual([capture.declaration.basis, capture.declaration.withheld], ['redacted-copy', ['fixtureSha256']]);
  assert.ok(!capture.bytes.toString('utf8').includes(digest(originalPackage())));
  assert.equal(capture.bytes.byteLength, copy.byteLength);
});

test('prepare-fixture writes a version 2 skeleton with the declared redactions, the authored blocks and no removed value', async t => {
  const { base, manifest } = await fixture(t);
  await rm(join(base, 'manifest.json'));
  await writeFile(join(base, 'redactions.json'), JSON.stringify(manifest.redactions));
  const specification = { id: 'redaction-test', documents: [{ blocks: [{ id: 'B01', type: 'paragraph', text: 'B01 Test document*' }] }],
    scenarios: [{ id: 'word-redaction-test', blocks: ['B01'], outcome: { notice: 'visible' } }] };
  const prepared = await prepareFixture(base, { id: ID, source: 'source.docx', capture: 'capture.json', redactions: 'redactions.json', specification, scenario: 'word-redaction-test' });
  assert.equal(prepared.manifest.schemaVersion, 2);
  assert.deepEqual(prepared.manifest.redactions, manifest.redactions);
  assert.deepEqual(prepared.manifest.expected, { specification: 'redaction-test', scenario: 'word-redaction-test',
    blocks: specification.documents[0].blocks, preserve: null, adapt: null });
  assert.deepEqual(prepared.summary.redactions.map(entry => entry.artifact), ['source', 'capture']);
  assert.deepEqual(prepared.summary.redactions[1].changes, [{ flavor: 'text/html', offset: HTML.indexOf('/home/'), length: `/home/${ACCOUNT}`.length }]);
  assert.deepEqual(prepared.summary.redactions[1].withheld, ['fixtureSha256']);
  assert.equal(prepared.summary.operator.fixtureSha256, `redacted${'-'.repeat(56)}`);
  const written = await readFile(join(base, 'capture-summary.json'), 'utf8');
  for (const value of [AUTHOR, ACCOUNT, digest(originalPackage())]) assert.ok(!written.includes(value));
  // The skeleton stays unreviewed until both outcomes are authored.
  await assert.rejects(verifyCaptureFixture(base), failure('evidence-schema'));
  await writeFile(join(base, 'redactions.json'), JSON.stringify(manifest.redactions.slice(1)));
  await rm(join(base, 'manifest.json')); await rm(join(base, 'capture-summary.json'));
  await assert.rejects(prepareFixture(base, { id: ID, source: 'source.docx', capture: 'capture.json', redactions: 'redactions.json' }),
    error => error.code === 'evidence-provenance');
});

test('the privacy scan names categories and offsets only, in parts, flavors and fields, including names of this machine', async t => {
  const names = [['login name', 'syntheticlogin'], ['host name', 'synthetic-host']];
  // Assembled at run time, so this file itself holds no address, home path or file URL.
  const sample = ['mail: a.b', 'example.invalid, path "/ho', 'me/x/y", C:\\Us', 'ers\\x, fi', 'le:///tmp/a, <dc:creator>X</dc:creator> w:author="X" SyntheticLogin'];
  const findings = scanText('sample', `${sample[0]}@${sample.slice(1).join('')}`, names);
  assert.deepEqual(findings.map(entry => entry.category).sort(), ['author attribute', 'author property', 'drive path', 'e-mail address', 'file URL', 'home folder path', 'login name']);
  assert.ok(findings.every(entry => Object.keys(entry).join() === 'location,category,offset'));
  assert.deepEqual(scanText('clean', '<dc:creator></dc:creator> profile: url("redacted------/Library/clip.png")', names), []);
  const { base } = await fixture(t, { source: false, capture: false });
  const report = await scanFiles([join(base, 'source.docx'), join(base, 'capture.json')], names);
  assert.deepEqual([...new Set(report.map(entry => `${entry.location.slice(base.length + 1)} ${entry.category}`))].sort(),
    ['capture.json:text/html home folder path', 'source.docx:docProps/core.xml author property']);
  assert.ok(!JSON.stringify(report).includes(ACCOUNT) && !JSON.stringify(report).includes(AUTHOR));
});

test('prepare-fixture refuses artifacts that still hold personal data', async t => {
  const { base } = await fixture(t, { source: false, capture: false });
  await rm(join(base, 'manifest.json'));
  await assert.rejects(prepareFixture(base, { id: ID, source: 'source.docx', capture: 'capture.json' }),
    error => /Personal data found/u.test(error.message) && /author property in source\.docx:docProps\/core\.xml/u.test(error.message)
      && /home folder path in capture\.json:text\/html/u.test(error.message) && !error.message.includes(ACCOUNT));
});
