import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CaptureEvidenceError, verifyCaptureFixture } from './offline.mjs';
import { prepareFixture } from './prepare-fixture.mjs';
import { blocksFromEditorJSON, blocksFromHTML, checkScenario, compareBlocks, compareOutcome, expectedBlocks } from './semantics.mjs';
import { largeSourceDocument } from './content/large-source.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const spec = JSON.parse(await readFile(join(here, 'content/word-mac-v1.json'), 'utf8'));
const cleanupRequire = createRequire(new URL('../../packages/extension-paste-cleanup/package.json', import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

test('the Word for Mac content specification is complete, unique and addressable', async () => {
  assert.equal(spec.status, 'authored-English-regression-variant');
  assert.deepEqual(spec.captures, []);
  assert.equal(spec.editedRegressionProvenance.nativeCapturePerformed, false);
  const ids = new Set();
  for (const document of spec.documents) for (const block of document.blocks) {
    assert.ok(!ids.has(block.id), block.id); ids.add(block.id);
    if (typeof block.text === 'string') assert.ok(block.text.startsWith(block.id), block.id);
    if (block.list) {
      const markers = block.list.kind === 'bullet' ? ['disc', 'circle', 'square'] : ['decimal', 'lower-alpha', 'upper-alpha', 'lower-roman', 'upper-roman'];
      assert.ok(markers.includes(block.list.marker), block.id);
    }
  }
  const page = await readFile(join(here, 'index.html'), 'utf8');
  for (const scenario of spec.scenarios) {
    assert.doesNotThrow(() => expectedBlocks(spec, scenario.id));
    assert.ok(page.includes(`<option>${scenario.id}</option>`), scenario.id);
    assert.ok(['quiet', 'visible', 'observe'].includes(scenario.outcome.notice), scenario.id);
  }
  assert.doesNotMatch(JSON.stringify(spec), /\u2014/u);
});

test('the large Word source is deterministic, about ten thousand words, and pinned', () => {
  const first = largeSourceDocument();
  assert.equal(first.html, largeSourceDocument().html);
  assert.equal(first.words, 10_000);
  assert.deepEqual(first.counts, { heading: 128, paragraph: 384, listItem: 640, tableCell: 48 });
  assert.equal(new Set(first.tokens).size, first.tokens.length);
  assert.doesNotMatch(first.html, /<script|<img|\b(?:src|href)=|url\(/iu);
  assert.equal(digest(first.html), LARGE_SOURCE_SHA256);
  assert.match(first.html, /<html lang="en">/u);
  assert.match(first.html, /čćšžđ/u);
  assert.match(first.html, /ČĆŠŽĐ/u);
  assert.throws(() => largeSourceDocument(0));
  assert.equal(spec.documents.find(document => document.file === 'word-mac-v1-large.docx')?.blocks[0]?.tokens, first.tokens.length);
});

test('a generated large document is checked by consecutive tokens from its start', () => {
  const doc = count => ({ type: 'doc', content: Array.from({ length: count }, (_, index) => paragraph(text(`G${String(index + 1).padStart(5, '0')} text`))) });
  assert.deepEqual(compareBlocks(spec, 'word-large-document', blocksFromEditorJSON(doc(300))), []);
  const gap = doc(4); gap.content.splice(1, 1);
  assert.match(compareBlocks(spec, 'word-large-document', blocksFromEditorJSON(gap)).join('\n'), /block 2 is G00003/u);
  assert.match(compareBlocks(spec, 'word-large-document', blocksFromEditorJSON({ type: 'doc', content: [] })).join('\n'), /no generated block/u);
});

// An authored editor result in the shape the fixture editor saves, not a capture.
const text = (value, marks = []) => ({ type: 'text', text: value, ...(marks.length ? { marks: marks.map(type => ({ type })) } : {}) });
const paragraph = (...content) => ({ type: 'paragraph', attrs: { textAlign: 'left' }, content });
const item = (...content) => ({ type: 'listItem', content });
const bullets = (marker, ...content) => ({ type: 'bulletList', attrs: { listStyleType: marker }, content });
const bulletsDoc = () => ({ type: 'doc', content: [bullets('disc',
  item(paragraph(text('L02 First level')), bullets('circle', item(paragraph(text('L03 Second level')), bullets('square', item(paragraph(text('L04 Third level'))))))),
  item(paragraph(text('L05 First level again'))))] });

test('an editor result that matches the authored list structure passes', () => {
  const report = checkScenario(spec, 'word-default-bullets', { doc: bulletsDoc(), results: [{ diagnostics: [] }] });
  assert.deepEqual(report.problems, []);
  assert.equal(report.matches, true); assert.equal(report.qualification, false);
});

test('marker, depth, order, loss, duplication and literal markers are reported', () => {
  const wrongMarker = bulletsDoc(); wrongMarker.content[0].content[0].content[1].attrs.listStyleType = 'disc';
  assert.match(compareBlocks(spec, 'word-default-bullets', blocksFromEditorJSON(wrongMarker)).join('\n'), /L03: list marker is disc, expected circle/u);
  const flat = { type: 'doc', content: [bullets('disc', ...['L02 First level', 'L03 Second level', 'L04 Third level', 'L05 First level again']
    .map(value => item(paragraph(text(value)))))] };
  assert.match(compareBlocks(spec, 'word-default-bullets', blocksFromEditorJSON(flat)).join('\n'), /L03: list depth is 1, expected 2/u);
  const missing = { type: 'doc', content: [bullets('disc', item(paragraph(text('L02 First level'))), item(paragraph(text('L05 First level again'))))] };
  assert.match(compareBlocks(spec, 'word-default-bullets', blocksFromEditorJSON(missing)).join('\n'), /L03: missing/u);
  const reordered = { type: 'doc', content: [paragraph(text('L05 First level again')), ...bulletsDoc().content] };
  const problems = compareBlocks(spec, 'word-default-bullets', blocksFromEditorJSON(reordered)).join('\n');
  assert.match(problems, /L05: appears more than once/u);
  const literal = { type: 'doc', content: [paragraph(text('• L02 First level')), paragraph(text('o L03 Second level')),
    paragraph(text('▪ L04 Third level')), paragraph(text('• L05 First level again'))] };
  assert.match(compareBlocks(spec, 'word-default-bullets', blocksFromEditorJSON(literal)).join('\n'), /L02: type is paragraph, expected listItem/u);
});

test('outcomes require the authored warnings and keep a quiet scenario quiet', () => {
  assert.deepEqual(compareOutcome(spec, 'word-default-bullets', [{ code: 'formatting-adapted', severity: 'info' }]), []);
  assert.match(compareOutcome(spec, 'word-default-bullets', [{ code: 'office-list-unsupported', severity: 'warning' }]).join('\n'), /unexpected office-list-unsupported/u);
  assert.match(compareOutcome(spec, 'word-alpha-beyond-z', []).join('\n'), /office-list-unsupported is required/u);
  assert.deepEqual(compareOutcome(spec, 'word-hidden-text', [{ code: 'unsupported-formatting', severity: 'warning' }]), []);
});

test('marks, alignment and hidden text follow the content specification', () => {
  const result = { type: 'doc', content: [paragraph(text('B07 '), text('bold', ['bold']), text(' '), text('italic', ['italic']), text(' '),
    text('underlined', ['underline']), text(' '), text('strikethrough', ['strike']), text(' H'), text('2', ['subscript']), text('O x'),
    text('2', ['superscript']), text(' Georgia red highlighted'))] };
  const problems = compareBlocks(spec, 'word-inline-formatting', blocksFromEditorJSON(result), { formatting: 'adapt' }).join('\n');
  assert.match(problems, /"highlighted" lacks highlight/u);
  assert.doesNotMatch(problems, /bold|italic|subscript|superscript|Georgia/u);
  const hidden = { type: 'doc', content: [paragraph(text('B15 Visible part end.'))] };
  assert.deepEqual(compareBlocks(spec, 'word-hidden-text', blocksFromEditorJSON(hidden)), []);
});

// Authored Word shaped HTML through the actual public normalizer, then the HTML block model.
const wordStyle = '<style>@list l0:level1 {mso-level-number-format:alpha-lower}</style>';
const wordItem = (label, body) => `<p style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">${label}<span>&nbsp; </span></span>${body}</p>`;

test('replayed HTML is checked with the same block model, including per item alphabet fallback', () => {
  const { normalizePasteHTML } = cleanupRequire('@domternal/extension-paste-cleanup/html');
  const letters = Array.from({ length: 26 }, (_, index) => String.fromCharCode(97 + index)).concat(['aa', 'bb']);
  const html = wordStyle + letters.map((letter, index) => wordItem(`${letter}.`, `L${String(34 + index)} Item ${String(index + 1)}`)).join('');
  const result = normalizePasteHTML(html);
  assert.equal(result.status, 'cleaned');
  const report = checkScenario(spec, 'word-alpha-beyond-z', { html: result.html, diagnostics: result.diagnostics });
  assert.deepEqual(report.problems, []);
  const broken = normalizePasteHTML(html.replace('l0 level1 lfo1', 'l9 level1 lfo1'));
  assert.match(checkScenario(spec, 'word-alpha-beyond-z', { html: broken.html, diagnostics: broken.diagnostics }).problems.join('\n'), /L34: type is paragraph/u);
  assert.equal(blocksFromHTML('<ul><li><p>x</p><p>y</p></li></ul>')[1].insideListItem, true);
});

async function claimedFixture(t) {
  const base = await mkdtemp(join(tmpdir(), 'domternal-prepare-fixture-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const synthetic = join(here, 'fixtures/synthetic-v1');
  await cp(join(synthetic, 'source.html'), join(base, 'source.html'));
  const bundle = JSON.parse(await readFile(join(synthetic, 'capture.json'), 'utf8'));
  // A manually edited native claim, which the offline tools can never authenticate.
  bundle.provenance.eventKind = 'native-event'; bundle.provenance.nativeClipboardCaptured = true;
  bundle.operator.fixtureId = 'word-mac-v1-test';
  await writeFile(join(base, 'capture.json'), JSON.stringify(bundle));
  return base;
}

test('prepare-fixture writes a review skeleton that the offline verifier refuses until expected outputs are authored', async t => {
  const base = await claimedFixture(t);
  const { manifest, summary } = await prepareFixture(base, { id: 'word-mac-v1-test', source: 'source.html', capture: 'capture.json' });
  assert.equal(manifest.expected, null); assert.equal(manifest.origin, 'claimed-native');
  assert.equal(summary.qualification, false); assert.equal(summary.reviewed, false);
  assert.equal(summary.formatUnits['text/html'], JSON.parse(await readFile(join(base, 'capture.json'), 'utf8')).payload.text['text/html'].length);
  await assert.rejects(verifyCaptureFixture(base), error => error instanceof CaptureEvidenceError && error.code === 'evidence-schema');
  await assert.rejects(prepareFixture(base, { id: 'word-mac-v1-test', source: 'source.html', capture: 'capture.json' }), /EEXIST/u);
});

test('prepare-fixture refuses paths outside the fixture, other ids and synthetic bundles', async t => {
  const base = await claimedFixture(t);
  await assert.rejects(prepareFixture(base, { id: 'word-mac-v1-test', source: '../source.html', capture: 'capture.json' }), /plain file names/u);
  await assert.rejects(prepareFixture(base, { id: 'Word Mac', source: 'source.html', capture: 'capture.json' }), /Fixture id/u);
  await assert.rejects(prepareFixture(base, { id: 'another-id', source: 'source.html', capture: 'capture.json' }), error => error.code === 'evidence-provenance');
  const bundle = JSON.parse(await readFile(join(base, 'capture.json'), 'utf8'));
  bundle.provenance.eventKind = 'synthetic-event'; bundle.provenance.nativeClipboardCaptured = false;
  await writeFile(join(base, 'capture.json'), JSON.stringify(bundle));
  await assert.rejects(prepareFixture(base, { id: 'word-mac-v1-test', source: 'source.html', capture: 'capture.json' }), error => error.code === 'evidence-provenance');
});

const LARGE_SOURCE_SHA256 = '65961f471b3cc61546725eb60db6be7578eb3d0aeb8bf05bcddc442d6dbfed9d';
