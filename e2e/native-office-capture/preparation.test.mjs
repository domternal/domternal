import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HARD_LIMITS } from './capture.mjs';
import { CaptureEvidenceError, semanticSpecification, verifyCaptureFixture } from './offline.mjs';
import { prepareFixture, specifiedExpectation } from './prepare-fixture.mjs';
import { inflateSync } from 'node:zlib';
import { blocksFromEditorJSON, blocksFromHTML, checkScenario, compareBlocks, compareOutcome, dryRun, expectedBlocks, imageInventory,
  printSpecification, syntheticEditorResult } from './semantics.mjs';
import { largeSourceDocument } from './content/large-source.mjs';
import { GOOGLE_DOCS_IMAGES, renderImage, writeGoogleDocsImages } from './content/google-docs-images.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const spec = JSON.parse(await readFile(join(here, 'content/word-mac-v1.json'), 'utf8'));
const docs = JSON.parse(await readFile(join(here, 'content/google-docs-v1.json'), 'utf8'));
const cleanupRequire = createRequire(new URL('../../packages/extension-paste-cleanup/package.json', import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

test('the Word for Mac content specification is complete, unique and addressable', async () => {
  assert.equal(spec.status, 'authored-English-regression-variant');
  assert.deepEqual(spec.captures, []);
  assert.equal(spec.editedRegressionProvenance.nativeCapturePerformed, false);
  // A baseline selection captured under another scenario's name retains that relationship.
  for (const scenario of spec.scenarios.filter(entry => entry.capturedAs !== undefined)) {
    assert.ok(spec.scenarios.some(entry => entry.id === scenario.capturedAs && entry.capturedAs === undefined), scenario.id);
  }
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

test('a destination without a mark or text style the source used expects it absent and checks everything else', async () => {
  const manifest = JSON.parse(await readFile(join(here, 'fixtures/word-inline-formatting-safari/manifest.json'), 'utf8'));
  const specification = semanticSpecification(manifest.expected);
  const scenario = manifest.expected.scenario;
  const without = (doc, names) => JSON.parse(JSON.stringify(doc), (key, value) => (key === 'marks' && Array.isArray(value)
    ? value.filter(mark => !names.includes(mark.type)) : value));
  // The fixture editor's default schema: no subscript or superscript, every text style.
  const destination = { marks: ['bold', 'italic', 'underline', 'strike', 'link', 'code', 'textStyle'], textStyle: ['color', 'backgroundColor', 'fontFamily', 'fontSize'] };
  for (const formatting of ['preserve', 'adapt']) {
    const full = syntheticEditorResult(specification, scenario, formatting).doc;
    assert.deepEqual(compareBlocks(specification, scenario, blocksFromEditorJSON(full), { formatting }), [], formatting);
    const lacking = without(full, ['subscript', 'superscript']);
    // Without a destination profile the missing marks are findings, which a default schema paste could never pass.
    assert.match(compareBlocks(specification, scenario, blocksFromEditorJSON(lacking), { formatting }).join('\n'), /lacks subscript/u);
    assert.deepEqual(compareBlocks(specification, scenario, blocksFromEditorJSON(lacking), { formatting, destination }), [], formatting);
    // A run that keeps a mark the destination lacks is a finding, and a mark it holds is still required.
    assert.match(compareBlocks(specification, scenario, blocksFromEditorJSON(full), { formatting, destination }).join('\n'), /"2" is subscript, which the destination lacks/u);
    assert.match(compareBlocks(specification, scenario, blocksFromEditorJSON(without(lacking, ['bold'])), { formatting, destination }).join('\n'), /lacks bold/u);
  }
  // A destination without a text style attribute expects that style absent, and a kept one is a finding.
  const noFonts = { ...destination, marks: [...destination.marks, 'subscript', 'superscript'], textStyle: ['color', 'backgroundColor'] };
  const preserved = syntheticEditorResult(specification, scenario, 'preserve').doc;
  const findings = compareBlocks(specification, scenario, blocksFromEditorJSON(preserved), { formatting: 'preserve', destination: noFonts });
  assert.ok(findings.length > 0 && findings.every(problem => /fontFamily|fontSize/u.test(problem)), findings.join('\n'));
  const unstyled = JSON.parse(JSON.stringify(preserved), (key, value) => (value && typeof value === 'object' && value.type === 'textStyle'
    ? { ...value, attrs: Object.fromEntries(Object.entries(value.attrs ?? {}).filter(([name]) => !['fontFamily', 'fontSize'].includes(name))) } : value));
  assert.deepEqual(compareBlocks(specification, scenario, blocksFromEditorJSON(unstyled), { formatting: 'preserve', destination: noFonts }), []);
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
  const problems = compareBlocks(spec, 'word-inline-formatting', blocksFromEditorJSON(result), { formatting: 'preserve' }).join('\n');
  assert.match(problems, /"highlighted" lacks highlight/u);
  assert.doesNotMatch(problems, /bold|italic|subscript|superscript/u);
  // Adapt removes highlights, as every text style: the specification expects the mark in preserve only.
  assert.deepEqual(compareBlocks(spec, 'word-inline-formatting', blocksFromEditorJSON(result), { formatting: 'adapt' }), []);
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

test('the HTML model reads white space as the editor parses it, so a line Word wraps inside an item keeps its marker run apart', () => {
  const { normalizePasteHTML } = cleanupRequire('@domternal/extension-paste-cleanup/html');
  // English authored variant of the raw Word Chrome/Firefox shape (word-unsupported-list-profiles, L66), with a
  // wrapped source line inside the item text. The picture's local temporary path is left out of the excerpt.
  const html = '<style>@list l0:level1 {mso-level-number-format:image;mso-level-text:;font-family:Symbol;color:windowtext;}</style>'
    + "<p class=MsoListParagraphCxSpMiddle style='text-indent:-18.0pt;mso-list:l0 level1 lfo4'><![if !supportLists]><span\r\n"
    + "style='font-family:Symbol;mso-fareast-font-family:Symbol;mso-bidi-font-family:\r\nSymbol'><span style='mso-list:Ignore'><img width=10 height=10\r\n"
    + 'src="clip_image001.png"\r\nalt="*"><span style=\'font:7.0pt "Times New Roman"\'>&nbsp;&nbsp;&nbsp; </span></span></span><![endif]>L66\r\n'
    + 'Picture bullet<o:p></o:p></p>';
  const specification = { documents: [{ textStyle: { fontFamily: 'Aptos', fontSize: '12pt' },
    blocks: [{ id: 'L66', type: 'literalItem', wordLabel: 'picture', text: 'L66 Picture bullet' }] }],
  scenarios: [{ id: 'picture-bullet', blocks: ['L66'], outcome: { notice: 'observe' } }] };
  const result = normalizePasteHTML(html, { formatting: 'preserve', allowRemoteImages: false, allowDataImages: true });
  const [block] = blocksFromHTML(result.html);
  assert.match(block.text, /L66 Picture bullet$/u);
  // The marker run keeps the font of its list level; only the item's own text is checked for formatting.
  assert.deepEqual(compareBlocks(specification, 'picture-bullet', blocksFromHTML(result.html)), []);
  // Runs of HTML white space read as one space, none at the start or end of a block or after a space, as ProseMirror parses them.
  assert.equal(blocksFromHTML('<p>\n  B03 <b> Lowercase</b>\r\n\tletters  </p>')[0].text, 'B03 Lowercase letters');
  assert.equal(blocksFromHTML('<p>a<br>\n b</p>')[0].text, 'a\nb');
  // A no-break space is no HTML white space: it stays.
  assert.equal(blocksFromHTML('<p>10  kg</p>')[0].text, '10  kg');
});

test('a capture of a separate selection may record its own scenario or the one it was captured as', async () => {
  const bundle = JSON.parse(await readFile(join(here, 'fixtures/word-headings-styles-b06-safari/capture.json'), 'utf8'));
  assert.equal(bundle.operator.scenario, 'word-headings-styles');
  assert.deepEqual(checkScenario(spec, 'word-headings-styles-b06', bundle).problems, []);
  // Chrome and Firefox record the selection's own scenario.
  const own = { ...bundle, operator: { ...bundle.operator, scenario: 'word-headings-styles-b06' } };
  assert.deepEqual(checkScenario(spec, 'word-headings-styles-b06', own).problems, []);
  const other = { ...bundle, operator: { ...bundle.operator, scenario: 'word-headings-styles-b08' } };
  assert.match(checkScenario(spec, 'word-headings-styles-b06', other).problems.join('\n'), /capture: recorded scenario is word-headings-styles-b08, expected word-headings-styles-b06 or word-headings-styles/u);
});

test('a stored line height must be a ratio the destination renders, not a percentage or a length it keeps unrendered', () => {
  const doc = lineHeight => {
    const result = syntheticEditorResult(spec, 'word-alignment-spacing', 'preserve').doc;
    for (const block of result.content) block.attrs = { ...block.attrs, lineHeight: /^B12/u.test(block.content?.[0]?.text ?? '') ? lineHeight : null };
    return result;
  };
  assert.deepEqual(compareBlocks(spec, 'word-alignment-spacing', blocksFromEditorJSON(doc('1.5'))), []);
  // LineHeight renders only its listed ratios: 150 % is stored and never drawn, so B12 shows the editor's default spacing.
  assert.match(compareBlocks(spec, 'word-alignment-spacing', blocksFromEditorJSON(doc('150%'))).join('\n'), /B12: line height is 150%, which the destination does not render; expected 1\.5/u);
  assert.match(compareBlocks(spec, 'word-alignment-spacing', blocksFromEditorJSON(doc('24px'))).join('\n'), /B12: line height is 24px, which the destination does not render/u);
  // Replayed HTML is what the editor parses and stores, so the same holds there.
  const html = '<h3>B08 Alignment and spacing</h3><p style="text-align:center">B09 Centered paragraph.</p><p style="text-align:right">B10 Right-aligned paragraph.</p>'
    + `<p style="text-align:justify">${blocksById(spec).get('B11').text}</p><p style="line-height:150%">B12 Paragraph with 1.5 line spacing.</p>`;
  const styled = (source, value) => source.replace('line-height:150%', `line-height:${value}`);
  assert.match(compareBlocks(spec, 'word-alignment-spacing', blocksFromHTML(html)).join('\n'), /B12: line height is 150%, which the destination does not render/u);
  assert.doesNotMatch(compareBlocks(spec, 'word-alignment-spacing', blocksFromHTML(styled(html, '1.5'))).join('\n'), /B12/u);
  assert.match(compareBlocks(spec, 'word-alignment-spacing', blocksFromHTML(styled(html, '2'))).join('\n'), /B12: line height is 2, expected 1\.5/u);
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
  assert.deepEqual(summary.htmlImages, { count: 1, withAlt: 1, schemes: { cid: 1 } });
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

test('the Google Docs content specification is complete, addressable and consistent with its images', async () => {
  assert.equal(docs.status, 'authored-English-regression-variant');
  assert.deepEqual(docs.captures, []);
  assert.equal(docs.editedRegressionProvenance.nativeCapturePerformed, false);
  assert.deepEqual(docs.source.destinations, ['Chrome', 'Safari', 'Firefox']);
  const page = await readFile(join(here, 'index.html'), 'utf8');
  const titles = new Set(docs.documents.map(document => document.title));
  const files = new Set(GOOGLE_DOCS_IMAGES.map(image => image.name));
  const blocks = new Map();
  for (const document of docs.documents) for (const block of document.blocks) {
    assert.ok(!blocks.has(block.id), block.id); blocks.set(block.id, block);
    if (typeof block.text === 'string') assert.ok(block.text.startsWith(block.id), block.id);
    if (block.type === 'image') { assert.ok(files.has(block.file), block.id); assert.ok(block.alt.startsWith(block.id), block.id); }
    if (block.type === 'imageRun') assert.equal(GOOGLE_DOCS_IMAGES.filter(image => image.name.startsWith('gdocs-v1-limit-')).length, block.count);
    if (block.list) {
      const markers = block.list.kind === 'bullet' ? ['disc', 'circle', 'square'] : ['decimal', 'lower-alpha', 'upper-alpha', 'lower-roman', 'upper-roman'];
      assert.ok(markers.includes(block.list.marker), block.id);
    }
  }
  for (const scenario of docs.scenarios) {
    assert.match(scenario.id, /^gdocs-/u);
    assert.ok(titles.has(scenario.document), scenario.id);
    assert.ok(page.includes(`<option>${scenario.id}</option>`), scenario.id);
    assert.ok(['quiet', 'visible', 'observe'].includes(scenario.outcome.notice), scenario.id);
    assert.equal(typeof scenario.expected.preserve, 'string', scenario.id); assert.equal(typeof scenario.expected.adapt, 'string', scenario.id);
    assert.ok([undefined, 'removed', 'observe'].includes(scenario.images), scenario.id);
    assert.ok([undefined, 'schema=capability-full'].includes(scenario.editorQuery), scenario.id);
    for (const id of scenario.excluded ?? []) { assert.ok(blocks.has(id), id); assert.ok(!scenario.blocks.includes(id), id); }
  }
  // Both specifications: a partial selection starts inside its first block and ends inside its last.
  for (const specification of [spec, docs]) for (const scenario of specification.scenarios.filter(entry => entry.partial)) {
    const { expected } = expectedBlocks(specification, scenario.id);
    assert.ok(expected[0].text.endsWith(scenario.partial.first), scenario.id);
    assert.ok(expected.at(-1).text.startsWith(scenario.partial.last), scenario.id);
  }
  const source = JSON.stringify(docs);
  assert.doesNotMatch(source, /\u2014/u); assert.doesNotMatch(source, / - /u);
});

test('the Google Docs images are deterministic PNG files, pinned and written only outside the repository', async t => {
  const digests = GOOGLE_DOCS_IMAGES.map(image => {
    const png = renderImage(image);
    assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [image.width, image.height]);
    const idat = png.subarray(41, 41 + png.readUInt32BE(33));
    const raw = inflateSync(idat);
    assert.equal(raw.length, (image.width * 3 + 1) * image.height, image.name);
    if (image.rgb) assert.deepEqual([...raw.subarray(1, 4)], image.rgb, image.name);
    return `${image.name} ${digest(png)}`;
  });
  assert.equal(digests.length, 57);
  assert.equal(digest(digests.join('\n')), GOOGLE_DOCS_IMAGES_SHA256);
  assert.equal(new Set(GOOGLE_DOCS_IMAGES.filter(image => image.rgb).map(image => image.rgb.join())).size, 56);
  await assert.rejects(writeGoogleDocsImages(join(here, 'images')), /outside the repository/u);
  const target = await mkdtemp(join(tmpdir(), 'domternal-gdocs-images-'));
  t.after(() => rm(target, { recursive: true, force: true }));
  const written = await writeGoogleDocsImages(target);
  assert.deepEqual((await readdir(target)).sort(), GOOGLE_DOCS_IMAGES.map(image => image.name).sort());
  const large = written.find(entry => entry.file === 'gdocs-v1-large-1600x1200.png');
  assert.equal(large.bytes, 5_761_703);
  // Large for the capture as a file and as a data URL, yet its document's export stays a valid fixture source.
  assert.ok(large.bytes > HARD_LIMITS.maxFileBytes && Math.ceil(large.bytes / 3) * 4 > HARD_LIMITS.maxFormatBytes);
  assert.ok(large.bytes < FIXTURE_SOURCE_LIMIT / 2);
  assert.deepEqual(written.filter(entry => entry.bytes > 1024 * 1024).map(entry => entry.file), [large.file]);
  // Only the captures of the large image document carry the large image in their fixture source.
  const holders = docs.documents.filter(document => document.blocks.some(block => block.file === large.file));
  assert.deepEqual(holders.map(document => document.title), ['gdocs-v1-large-image']);
  assert.deepEqual(holders[0].blocks.filter(block => block.type === 'image' || block.type === 'imageRun').map(block => block.file), [large.file]);
});

test('every Word and Google Docs scenario passes a synthetic dry run under both policies', () => {
  for (const specification of [spec, docs]) {
    const report = dryRun(specification);
    assert.deepEqual(report.results.filter(result => !result.matches), []);
    assert.equal(report.results.length, specification.scenarios.length * 2);
    assert.equal(report.synthetic, true); assert.equal(report.qualification, false);
  }
});

test('the dry run result catches markers, spans, links, excluded blocks, kept images and adapted styles', () => {
  const check = (scenario, mutate, formatting = 'preserve') => {
    const result = syntheticEditorResult(docs, scenario, formatting); mutate(result.doc);
    return checkScenario(docs, scenario, result, { formatting }).problems.join('\n');
  };
  assert.match(check('gdocs-default-bullets', doc => { doc.content[0].content[0].content[1].attrs.listStyleType = null; }), /GL03: list marker is null, expected circle/u);
  assert.match(check('gdocs-merged-cells', doc => { doc.content[1].content[0].content[0].attrs.rowspan = 1; }), /GT11: rowspan is 1, expected 2/u);
  assert.match(check('gdocs-links', doc => { doc.content[1].content[1].marks[0].attrs.href = 'https://example.com/'; }), /is not a link to https:\/\/example\.com\/domternal\/gdocs-v1/u);
  assert.match(check('gdocs-image-partial-selection', doc => { doc.content.push({ type: 'paragraph', content: [{ type: 'text', text: 'GI09 Green square again' }] }); }), /GI09: outside the selection but pasted/u);
  assert.match(check('gdocs-mixed-one-image', doc => { doc.content[1] = { type: 'image', attrs: { src: 'data:image/png;base64,AAAA', alt: 'GI03 Blue rectangle' } }; }), /images: 1 kept \(data\), expected removal/u);
  assert.deepEqual(check('gdocs-mixed-one-image', doc => { doc.content.splice(1, 1); }), '');
  assert.match(check('gdocs-plain-paragraph', doc => { doc.content[0].content[0].marks = [{ type: 'textStyle', attrs: { fontFamily: 'Arial, sans-serif', fontSize: null } }]; }, 'adapt'), /GB04: adapt kept fontFamily/u);
  assert.match(check('gdocs-alignment-spacing', doc => { doc.content[1].attrs.textAlign = 'center'; }, 'adapt'), /GB16: adapt kept alignment center/u);
  const styled = syntheticEditorResult(docs, 'gdocs-plain-paragraph', 'preserve');
  styled.doc.content[0].content[1].marks[0].attrs = { fontFamily: 'Arial, sans-serif', fontSize: '11pt' };
  assert.deepEqual(checkScenario(docs, 'gdocs-plain-paragraph', styled).problems, []);
  styled.doc.content[0].content[1].marks[0].attrs.fontFamily = 'Georgia';
  assert.match(checkScenario(docs, 'gdocs-plain-paragraph', styled).problems.join('\n'), /fontFamily is Georgia, expected Arial/u);
  // The editor keeps a highlight as a text style background, which adapt removes with the other colors.
  assert.match(check('gdocs-inline-formatting', doc => { doc.content[0].content.at(-1).marks = [{ type: 'textStyle', attrs: { backgroundColor: '#ffff00' } }]; }, 'adapt'),
    /GB10: adapt kept backgroundColor/u);
});

test('an empty paragraph that does not arrive is reported once and does not move the blocks after it', () => {
  // Google Docs can copy both empty paragraphs as line breaks, which the editor keeps in one paragraph.
  const result = syntheticEditorResult(docs, 'gdocs-empty-paragraphs', 'preserve');
  result.doc.content.splice(1, 2, { type: 'paragraph', attrs: { textAlign: null }, content: [{ type: 'hardBreak' }, { type: 'hardBreak' }] });
  assert.deepEqual(checkScenario(docs, 'gdocs-empty-paragraphs', result).problems, ['GB22b: expected an empty paragraph']);
});

test('a transparent background in replayed HTML is neither a highlight nor a text style', () => {
  const [block] = blocksFromHTML('<p><span style="background-color:transparent">GB10 </span><span style="background-color:transparent;color:#ff0000">highlighted</span></p>');
  assert.deepEqual(block.runs.map(run => run.marks), [[], [{ type: 'textStyle', attrs: { color: '#ff0000' } }]]);
  assert.match(compareBlocks(docs, 'gdocs-inline-formatting', [{ ...block, text: 'GB10 strikethrough H2O x2 Georgia red highlighted',
    runs: [{ text: 'GB10 strikethrough H2O x2 Georgia red ', marks: [] }, block.runs[1]] }]).join('\n'), /"highlighted" lacks highlight/u);
});

test('outcomes differ by policy and colors compare across notations', () => {
  const unconfirmed = [{ code: 'destination-formatting-unconfirmed', severity: 'warning' }];
  assert.deepEqual(compareOutcome(docs, 'gdocs-headings-plain', unconfirmed, { formatting: 'preserve' }), []);
  assert.match(compareOutcome(docs, 'gdocs-headings-plain', unconfirmed, { formatting: 'adapt' }).join('\n'), /unexpected destination-formatting-unconfirmed/u);
  assert.match(compareOutcome(docs, 'gdocs-mixed-document', [], { formatting: 'adapt' }).join('\n'), /image-removed is required/u);
  const result = syntheticEditorResult(docs, 'gdocs-inline-formatting', 'preserve');
  const color = result.doc.content[0].content.find(node => node.text === 'red').marks[0];
  color.attrs.color = 'rgb(255, 0, 0)';
  assert.deepEqual(checkScenario(docs, 'gdocs-inline-formatting', result).problems, []);
  // Word writes a basic color by name, as color:red for #FF0000.
  color.attrs.color = 'red';
  assert.deepEqual(checkScenario(docs, 'gdocs-inline-formatting', result).problems, []);
  color.attrs.color = 'maroon';
  assert.match(checkScenario(docs, 'gdocs-inline-formatting', result).problems.join('\n'), /color is maroon/u);
});

test('the HTML model opens a paragraph for inline content outside blocks, as the editor parses it', () => {
  // A partly selected last paragraph that Safari writes as bare spans after a list.
  const partial = blocksFromHTML('<ol><li><p>L10 Roman ii</p></li></ol><span><span style="font-size:12pt">L11 Letter</span></span><span></span>');
  assert.deepEqual(partial.map(block => [block.type, block.text]), [['listItem', 'L10 Roman ii'], ['paragraph', 'L11 Letter']]);
  assert.deepEqual(partial[1].runs[0].marks, [{ type: 'textStyle', attrs: { fontSize: '12pt' } }]);
  assert.deepEqual(blocksFromHTML('<table><tr><td>Directly <b>in</b> a cell</td></tr></table>').map(block => [block.type, block.text]), [['tableCell', 'Directly in a cell']]);
  // White space between blocks is no block; an inline wrapper that holds blocks is read through.
  assert.deepEqual(blocksFromHTML('<p>A</p>\n <p>B</p>').map(block => block.text), ['A', 'B']);
  assert.deepEqual(blocksFromHTML('<b id="docs-internal-guid-1"><p>A</p>tail</b>').map(block => [block.type, block.text]), [['paragraph', 'A'], ['paragraph', 'tail']]);
});

test('the HTML model reads Google Docs list nesting, cell spans, links, text styles and images', () => {
  const blocks = blocksFromHTML('<ul><li><p>GL02 a</p></li><ul><li><p>GL03 b</p></li><ul><li><p>GL04 c</p></li></ul></ul><li><p>GL05 d</p></li></ul>'
    + '<table><tr><td colspan="2"><p>GT08 x</p></td><td rowspan="2"><p>GT09 y</p></td></tr></table>'
    + '<p><a href="mailto:pisi@example.com"><span style="font-family:Arial,sans-serif;color:#1155cc"><u>GB14 z</u></span></a></p>'
    + '<p>GI02 <img src="https://docs-images.example.invalid/a" alt="GI03 alt"></p>');
  assert.deepEqual(blocks.slice(0, 4).map(block => block.list.depth), [1, 2, 3, 1]);
  assert.deepEqual(blocks.slice(4, 6).map(block => [block.cell.colspan, block.cell.rowspan]), [[2, 1], [1, 2]]);
  assert.deepEqual(blocks[6].runs[0].marks.map(mark => mark.type), ['link', 'textStyle', 'underline']);
  assert.equal(blocks[6].runs[0].marks[1].attrs.fontFamily, 'Arial,sans-serif');
  // The space before the image ends the paragraph's text, which the editor's parse drops, as it drops any at a block's end.
  assert.deepEqual(blocks.slice(7).map(block => [block.type, block.text]), [['paragraph', 'GI02'], ['image', 'GI03 alt']]);
  assert.equal(blocks[8].src, 'https');
  assert.deepEqual(imageInventory('<img src="https://a.invalid/x" alt=""><p><img src="data:image/png;base64,AA" alt="b"><img></p>'),
    { count: 3, withAlt: 1, schemes: { https: 1, data: 1, none: 1 } });
});

test('the Google Docs dry run fixture passes the offline verifier, and its replay matches the scenario', async () => {
  const directory = join(here, 'fixtures/google-docs-dry-run-v1');
  const report = await verifyCaptureFixture(directory);
  assert.equal(report.integrity.origin, 'synthetic'); assert.equal(report.integrity.claimedEventKind, 'synthetic-event');
  assert.equal(report.integrity.qualification, false); assert.equal(report.integrity.fileCount, 0);
  assert.deepEqual(report.replay.outcomes.map(outcome => [outcome.formatting, outcome.source, outcome.diagnostics.includes('image-removed')]),
    [['preserve', 'google-docs', true], ['adapt', 'google-docs', true]]);
  // The removed image is the only loss: the image box around it is routine.
  assert.deepEqual(report.replay.outcomes.map(outcome => outcome.diagnostics.filter(code => code !== 'formatting-adapted')), [['image-removed'], ['image-removed']]);
  const bundle = JSON.parse(await readFile(join(directory, 'capture.json'), 'utf8'));
  assert.deepEqual(bundle.payload.omittedFormats, ['application/x-vnd.google-docs-document-slice-clip+wrapped']);
  for (const formatting of ['preserve', 'adapt']) {
    const replay = checkScenario(docs, 'gdocs-mixed-document', bundle, { formatting });
    assert.deepEqual(replay.problems, []);
    assert.deepEqual(replay.capture.images, { count: 1, withAlt: 1, schemes: { https: 1 } });
  }
  assert.match(checkScenario(docs, 'gdocs-mixed-one-image', bundle).problems.join('\n'), /capture: recorded scenario is gdocs-mixed-document/u);
  assert.throws(() => checkScenario(docs, 'gdocs-mixed-document', { ...bundle, status: 'incomplete' }), /incomplete/u);
});

test('every committed English regression variant passes the offline verifier and holds its authored scenario blocks', async () => {
  const directories = (await readdir(join(here, 'fixtures'), { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => join(here, 'fixtures', entry.name));
  const variants = [];
  for (const directory of directories) {
    const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
    if (manifest.schemaVersion !== 2) continue;
    variants.push(manifest.id);
    const report = await verifyCaptureFixture(directory);
    assert.equal(report.integrity.qualification, false); assert.equal(report.integrity.nativeEvidenceAuthenticated, false);
    assert.equal(report.integrity.claimedEventKind, manifest.origin === 'synthetic' ? 'synthetic-event' : 'native-event');
    const scenario = spec.scenarios.find(entry => entry.id === manifest.expected.scenario);
    assert.ok(scenario, manifest.id);
    assert.equal(manifest.expected.specification, spec.id);
    assert.match(manifest.id, new RegExp(`^${scenario.id}-(?:safari|chrome|firefox)$`, 'u'));
    // The oracle's blocks are the specification's own, so a correction reaches every fixture of the scenario.
    assert.deepEqual(manifest.expected.blocks, specifiedExpectation(spec, scenario.id).blocks, manifest.id);
    assert.deepEqual(manifest.expected.partial, scenario.partial, manifest.id);
    const bundle = JSON.parse(await readFile(join(directory, manifest.capture.path), 'utf8'));
    assert.equal(bundle.operator.scenario, scenario.capturedAs ?? scenario.id);
    assert.equal(bundle.operator.fixtureId, manifest.id);
    // The replay also meets the scenario's own outcome: its required warnings, nothing it does not allow.
    for (const formatting of ['preserve', 'adapt']) assert.deepEqual(checkScenario(spec, scenario.id, bundle, { formatting }).problems, [], `${manifest.id} ${formatting}`);
    const summary = JSON.parse(await readFile(join(directory, 'capture-summary.json'), 'utf8'));
    assert.equal(summary.reviewed, true); assert.equal(summary.qualification, false); assert.equal(summary.fixtureId, manifest.id);
  }
  // Every Word for Mac to Safari selection the owner captured on 2026-10-02.
  assert.deepEqual(variants.filter(id => id.endsWith('-safari')).sort(), spec.scenarios
    .filter(entry => entry.document.startsWith('word-mac-v1-') && entry.id !== 'word-large-document').map(entry => `${entry.id}-safari`).sort());
});

test('the printed specification lists every text an operator enters', () => {
  const printed = printSpecification(docs);
  for (const document of docs.documents) assert.ok(printed.includes(`# ${document.title} (export ${document.export})`));
  for (const line of ['GL32 Item 1', 'GL59 Item 28', blocksById(docs).get('GB07').text, '  bold: Bold (Cmd+B)',
    'GI03  Image gdocs-v1-blue-320x200.png, alt text: GI03 Blue rectangle.']) assert.ok(printed.split('\n').some(entry => entry.startsWith(line)), line);
  assert.match(printSpecification(spec), /^L60 Item 27$/mu);
});

const blocksById = specification => new Map(specification.documents.flatMap(document => document.blocks.map(block => [block.id, block])));

const LARGE_SOURCE_SHA256 = '65961f471b3cc61546725eb60db6be7578eb3d0aeb8bf05bcddc442d6dbfed9d';
const GOOGLE_DOCS_IMAGES_SHA256 = 'f8078173e395786a68c6fc4d74a3acf2a165bc716edf3c52ee466bb851f502f0';
// The source size limit of prepare-fixture.mjs and offline.mjs.
const FIXTURE_SOURCE_LIMIT = 16 * 1024 * 1024;

/** The committed semantic variants, each with its stored HTML. */
async function semanticFixtures() {
  const fixtures = [];
  for (const entry of await readdir(join(here, 'fixtures'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = join(here, 'fixtures', entry.name);
    const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
    if (manifest.schemaVersion !== 2) continue;
    const bundle = JSON.parse(await readFile(join(directory, manifest.capture.path), 'utf8'));
    fixtures.push({ manifest, html: bundle.payload.text['text/html'] });
  }
  return fixtures;
}
const wrapText = (html, open, close) => html.replace(/(<(?:p|h[1-6])(?:\s[^>]*)?>)/gu, `$1${open}`).replace(/(<\/(?:p|h[1-6])>)/gu, `${close}$1`);

test('the semantic oracle reports what a broken paste adds: blocks, empty paragraphs, marks, styles, alignment, spacing and shading', async () => {
  const { normalizePasteHTML } = cleanupRequire('@domternal/extension-paste-cleanup/html');
  const mutations = [
    ['an appended paragraph', html => `${html}<p>Junk paragraph</p>`],
    ['a stylesheet leaking as text', html => `<p>@list l0:level1 {mso-level-number-format:bullet}</p>${html}`],
    ['an extra empty paragraph', html => `${html}<p></p>`],
    ['a paragraph holding a no-break space', html => `${html}<p>\u00a0</p>`],
    ['bold on every run', html => wrapText(html, '<strong>', '</strong>')],
    ['every paragraph centered', html => html.replace(/<(p|h[1-6])(?=[\s>])/gu, '<$1 style="text-align:center"')],
  ];
  // Around every text, so no style of the paste's own is closer to the text than the mutation.
  const preserveOnly = [['gray Comic Sans text', html => html.replace(/>([^<>]*[^\s<>][^<>]*)</gu, '><span style="color:#777777;font-family:Comic Sans MS;font-size:20pt">$1</span><')]];
  const missed = [];
  for (const { manifest, html } of await semanticFixtures()) {
    const specification = semanticSpecification(manifest.expected);
    for (const formatting of ['preserve', 'adapt']) {
      const result = normalizePasteHTML(html, { formatting, allowRemoteImages: false, allowDataImages: true });
      const check = output => compareBlocks(specification, manifest.expected.scenario, blocksFromHTML(output), { formatting });
      assert.deepEqual(check(result.html), [], `${manifest.id} ${formatting}`);
      for (const [name, mutate] of [...mutations, ...(formatting === 'preserve' ? preserveOnly : [])]) {
        if (check(mutate(result.html)).length === 0) missed.push(`${manifest.id} ${formatting}: ${name}`);
      }
    }
  }
  assert.deepEqual(missed, []);
});

test('the semantic oracle pins the line spacing, the cell shading and the empty paragraphs the captures show', async () => {
  const { normalizePasteHTML } = cleanupRequire('@domternal/extension-paste-cleanup/html');
  const fixtures = new Map((await semanticFixtures()).map(fixture => [fixture.manifest.id, fixture]));
  const check = (id, output, formatting = 'preserve') => {
    const { manifest } = fixtures.get(id);
    return compareBlocks(semanticSpecification(manifest.expected), manifest.expected.scenario, blocksFromHTML(output), { formatting }).join('\n');
  };
  const spacing = normalizePasteHTML(fixtures.get('word-alignment-spacing-safari').html).html;
  assert.match(spacing, /line-height:1\.5/u);
  assert.match(check('word-alignment-spacing-safari', spacing.replace('line-height:1.5', '')), /B12: line height is none, expected 1\.5/u);
  assert.match(check('word-alignment-spacing-safari', spacing.replace('<h3', '<h3 style="line-height:1.15"')), /B08: line height is 1\.15, expected none/u);
  const table = normalizePasteHTML(fixtures.get('word-table-text-safari').html).html;
  assert.match(check('word-table-text-safari', table.replace(/ data-background="[^"]*"/u, '').replace(/background-color:rgb\(217, 217, 217\)/u, '')), /T05: cell background is none, expected #D9D9D9/u);
  assert.equal(check('word-table-text-safari', table), '');
  // A cell in another row or table than Word shows is a structural loss.
  assert.match(check('word-table-text-safari', table.replace(/<\/tr>\s*<tr>/u, '')), /row is 1, expected 2/u);
  const empties = normalizePasteHTML(fixtures.get('word-empty-paragraphs-safari').html).html;
  assert.match(check('word-empty-paragraphs-safari', empties.replace('<p></p>', '<p>\u00a0</p>')), /no-break space|unexpected/u);
});

test('the semantic oracle reads the fixture editor result the same way: added blocks and formatting are reported', () => {
  const result = syntheticEditorResult(spec, 'word-routine-envelope', 'preserve');
  assert.deepEqual(compareBlocks(spec, 'word-routine-envelope', blocksFromEditorJSON(result.doc)), []);
  const padded = structuredClone(result.doc);
  padded.content.push(paragraph(), paragraph(), paragraph(), paragraph(text('Junk one')), paragraph(text('Junk two')));
  const problems = compareBlocks(spec, 'word-routine-envelope', blocksFromEditorJSON(padded)).join('\n');
  assert.match(problems, /unexpected empty paragraph/u);
  assert.match(problems, /unexpected text "Junk one"/u);
  const styled = structuredClone(result.doc);
  for (const block of styled.content) for (const run of block.content ?? []) {
    run.marks = [{ type: 'bold' }, { type: 'italic' }, { type: 'textStyle', attrs: { color: '#777777', fontFamily: 'Comic Sans MS', fontSize: '30pt' } }];
  }
  const formatted = compareBlocks(spec, 'word-routine-envelope', blocksFromEditorJSON(styled)).join('\n');
  assert.match(formatted, /B03: "B03 Lowercase.*" is bold, which the source is not/u);
  assert.match(formatted, /B03: .*color is #777777, expected none/u);
  assert.match(formatted, /B01: .*fontFamily is Comic Sans MS, expected Aptos Display/u);
});
