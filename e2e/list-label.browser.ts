import { expect, test, type Page } from '@playwright/test';
import type { JSONContent } from '@domternal/core';
import type { ListLabelProbe } from './list-label-fixture/main.js';
interface ProbeWindow { __listLabels: ListLabelProbe }
// Authored Office clipboard metadata, not a native application qualification record.
const wordLabelRules = '<style>@list l0:level1 {mso-level-number-format:alpha-upper;mso-level-text:"Section %1)";}'
  + '@list l0:level2 {mso-level-number-format:bullet;mso-level-text:"✓";}'
  + '@list l1:level1 {mso-level-text:"(%1)";}</style>';
const wordLabelItem = (marker: string, text: string, list = 0, level = 1): string =>
  `<p style="mso-list:l${String(list)} level${String(level)} lfo1"><span style="mso-list:Ignore">${marker}<span>&nbsp;</span></span>${text}</p>`;
const item = (text: string, nested?: JSONContent): JSONContent => ({ type: 'listItem', content: [
  { type: 'paragraph', content: [{ type: 'text', text }] }, ...(nested ? [nested] : []),
] });
const list = (start: number, format: string, prefix: string, suffix: string, count = 3): JSONContent => ({
  type: 'orderedList', attrs: { start, listLabel: { kind: 'counter', format, prefix, suffix } },
  content: Array.from({ length: count }, (_, index) => item(`Item ${String(index + 1)}`)),
});
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content });
const cases = [
  { name: 'zero start and explicit restart', content: doc(list(0, 'decimal', 'Section ', ') ', 2), list(7, 'decimal', 'Section ', ') ', 2)), labels: ['Section 0) ', 'Section 1) ', 'Section 7) ', 'Section 8) '] },
  { name: 'alphabetic counters after z', content: doc(list(26, 'lower-alpha', '(', ') ')), labels: ['(z) ', '(aa) ', '(ab) '] },
  { name: 'Roman range and decimal fallback', content: doc(list(3999, 'upper-roman', '[', '] ', 2)), labels: ['[MMMCMXCIX] ', '[4000] '] },
  { name: 'escaped affixes', content: doc(list(1, 'decimal', '"\\ <&> ', '\'); } ', 2)), labels: ['"\\ <&> 1\'); } ', '"\\ <&> 2\'); } '] },
  { name: 'independent nested counters and literal bullets', content: doc({ ...list(4, 'decimal', 'Part ', ': ', 2), content: [
    item('Outer', list(26, 'lower-alpha', '(', ') ', 2)),
    item('Second', { type: 'bulletList', attrs: { listLabel: { kind: 'text', text: '✓' } }, content: [item('Task')] }),
  ] }), labels: ['Part 4: ', '(z) ', '(aa) ', 'Part 5: ', '✓ '] },
];
async function open(page: Page, content: JSONContent, query = ''): Promise<void> {
  await page.goto(`http://127.0.0.1:5896/${query}`);
  await page.waitForFunction(() => Boolean((window as unknown as Partial<ProbeWindow>).__listLabels));
  await page.evaluate(json => { (window as unknown as ProbeWindow).__listLabels.set(json); }, JSON.stringify(content));
}
async function snapshot(page: Page): Promise<{ json: string; html: string; text: string }> {
  return page.evaluate(() => (window as unknown as ProbeWindow).__listLabels.snapshot());
}
/** The oracle spells each marker literally and never calculates a counter. */
async function oracle(page: Page, labels: readonly string[], shadow = false): Promise<void> {
  await page.evaluate(({ labels, shadow }) => {
    const root = shadow ? document.querySelector('#shadow')?.shadowRoot : document;
    if (!root) throw new Error('Missing marker root');
    const sample = root.querySelector(shadow ? '#shadow-sample' : '#sample');
    if (!sample) throw new Error('Missing marker sample');
    const items = Array.from(sample.querySelectorAll('li'));
    if (items.length !== labels.length) throw new Error('Wrong marker count');
    const sheet = document.createElement('style'); sheet.setAttribute('nonce', 'list-label-test');
    sheet.textContent = labels.map((label, index) => {
      const quoted = Array.from(label, character => `\\${(character.codePointAt(0) ?? 0).toString(16)} `).join('');
      return `@counter-style dm-oracle-${String(index)} {system:cyclic;symbols:"${quoted}";suffix:"";}`;
    }).join('\n');
    (root instanceof Document ? root.head : root).append(sheet);
    items.forEach((item, index) => { item.removeAttribute('data-dm-compound-marker'); item.style.listStyleType = `dm-oracle-${String(index)}`; });
  }, { labels, shadow });
}

const compoundLabel = { kind: 'compound', parts: [{ ancestor: 1, format: 'inherit' }, '.', { ancestor: 0, format: 'inherit' }, ') '], fallback: 'decimal' };
const pictureSource = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAwAAAAMCAYAAABWdVznAAAAFklEQVR4nGO4o2zznxTMMKphVAN2DAArDECw1uKo8wAAAABJRU5ErkJggg==';
const pictureDoc = (): JSONContent => doc({ type: 'bulletList', attrs: { listLabel: { kind: 'image', src: pictureSource, text: '◆' } }, content: [
  item('Picture parent', { type: 'bulletList', content: [item('Ordinary child')] }), item('Picture sibling'),
] });

for (const cleanup of [false, true]) test(`picture markers keep local pixels, nested fallback and clipboard data, cleanup=${String(cleanup)}`, async ({ page }) => {
  const external: string[] = []; page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:5896/') && !request.url().startsWith('data:')) external.push(request.url()); });
  await open(page, pictureDoc(), cleanup ? '?cleanup=1&controls=1' : '');
  const before = await snapshot(page);
  expect(await page.locator('#sample ul').first().evaluate(node => getComputedStyle(node).listStyleImage)).toContain(pictureSource);
  expect(await page.locator('#sample ul ul').evaluate(node => getComputedStyle(node).listStyleImage)).toBe('none');
  const copied = await page.evaluate(() => (window as unknown as ProbeWindow).__listLabels.pasteCopy());
  expect(copied.text).not.toContain('◆'); expect((await snapshot(page)).json).toBe(before.json);
  expect((await page.evaluate(() => (window as unknown as ProbeWindow).__listLabels.roundtrip())).json).toBe(before.json);
  const rendered = await page.locator('#sample').screenshot();
  await page.evaluate(source => { const style = document.createElement('style'); style.id = 'picture-oracle';
    style.setAttribute('nonce', 'list-label-test'); style.textContent = `#sample ul[data-dm-list-label] { list-style-image:url("${source}")!important; }`; document.head.append(style); }, pictureSource);
  expect((await page.locator('#sample').screenshot()).equals(rendered)).toBe(true);
  await page.evaluate(() => { const oracle = document.querySelector('#picture-oracle');
    if (!oracle) throw new Error('The picture oracle style is missing');
    oracle.textContent = '#sample ul[data-dm-list-label] { list-style-image:none!important; }'; });
  expect((await page.locator('#sample').screenshot()).equals(rendered)).toBe(false);
  expect(external).toEqual([]); expect((await snapshot(page)).text).toBe(before.text);
});
const compoundDoc = (): JSONContent => doc({ ...list(27, 'decimal', 'Part ', ': ', 1), content: [item('Parent', {
  type: 'orderedList', attrs: { start: 0, listLabel: compoundLabel }, content: [item('First nested'), item('Second nested')],
})] });

for (const cleanup of [false, true]) test(`compound markers follow edited parents and native clipboard, cleanup=${String(cleanup)}`, async ({ page }) => {
  await open(page, compoundDoc(), cleanup ? '?cleanup=1&controls=1' : '');
  const before = await snapshot(page);
  expect(await page.locator('#sample li[data-dm-compound-marker]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-dm-compound-marker'))))
    .toEqual(['27.0) ', '27.1) ']);
  const roundtrip = await page.evaluate(() => (window as unknown as ProbeWindow).__listLabels.roundtrip());
  expect(roundtrip.json).toBe(before.json); expect(roundtrip.html).toContain('data-dm-compound-marker="27.0) "');
  const copied = await page.evaluate(() => (window as unknown as ProbeWindow).__listLabels.pasteCopy());
  expect(copied.text).not.toContain('27.0'); expect(copied.html).toContain('data-dm-compound-marker="27.0) "');
  expect((await snapshot(page)).json).toBe(before.json);
  await page.evaluate(() => { (window as unknown as ProbeWindow).__listLabels.changeParentCounter(); });
  expect(await page.locator('#sample li[data-dm-compound-marker]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-dm-compound-marker'))))
    .toEqual(['AA.0) ', 'AA.1) ']);
  expect(await page.evaluate(() => (window as unknown as ProbeWindow).__listLabels.editor.commands.undo())).toBe(true);
  expect((await snapshot(page)).json).toBe(before.json);
  const rendered = await page.locator('#sample').screenshot();
  await oracle(page, ['Part 27: ', '27.0) ', '27.1) ']);
  expect((await page.locator('#sample').screenshot({ path: test.info().outputPath('compound.png') })).equals(rendered)).toBe(true);
});

test('compound markers render in a shadow root without inserting label text into the document', async ({ page }) => {
  const content = compoundDoc(); await open(page, content);
  await page.evaluate(json => (window as unknown as ProbeWindow).__listLabels.shadow(json), JSON.stringify(content));
  const rendered = await page.locator('#shadow-sample').screenshot();
  await oracle(page, ['Part 27: ', '27.0) ', '27.1) '], true);
  expect((await page.locator('#shadow-sample').screenshot()).equals(rendered)).toBe(true);
  expect((await snapshot(page)).text).toBe('Parent\n\nFirst nested\n\nSecond nested');
});

test('compound labels retain structural parents across a table cell with a fresh marker cycle', async ({ page }) => {
  const deep = { ...compoundLabel, parts: [{ ancestor: 2, format: 'inherit' }, '.', ...compoundLabel.parts] };
  const content = doc({ type: 'orderedList', attrs: { start: 4 }, content: [item('Outer', { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [
    { type: 'orderedList', attrs: { start: 7 }, content: [item('Cell parent', { type: 'orderedList', attrs: { start: 0, listLabel: deep }, content: [item('Deep child')] })] },
  ] }] }] })] });
  await open(page, content, '?tables=1');
  expect(await page.locator('#sample li[data-dm-compound-marker]').getAttribute('data-dm-compound-marker')).toBe('4.7.0) ');
  expect((await snapshot(page)).html).toContain('data-dm-compound-marker="4.7.0) "');
  const rendered = await page.locator('#sample').screenshot();
  await oracle(page, ['4. ', '7. ', '4.7.0) ']);
  expect((await page.locator('#sample').screenshot()).equals(rendered)).toBe(true);
});

test('Word custom labels preserve visible numbering, nested bullets, restarts and editing', async ({ page }) => {
  await open(page, doc({ type: 'paragraph', content: [{ type: 'text', text: 'Before' }] }), '?cleanup=1&controls=1');
  const before = await snapshot(page);
  const html = wordLabelRules + wordLabelItem('Section AA)', 'Outer') + wordLabelItem('✓', 'Inner', 0, 2)
    + wordLabelItem('Section AB)', 'Next') + wordLabelItem('(0)', 'Zero', 1) + wordLabelItem('(1)', 'One', 1)
    + wordLabelItem('(4)', 'Restart', 1);
  await page.evaluate(html => { const probe = (window as unknown as ProbeWindow).__listLabels; probe.editor.commands.selectAll(); probe.pasteHTML(html); }, html);
  const pasted = await snapshot(page);
  const ordered = (start: number, content: JSONContent[], prefix: string, suffix: string, format: string): JSONContent => ({ type: 'orderedList', attrs: {
    start, listStyleType: format, listLabel: { kind: 'counter', format, prefix, suffix },
  }, content });
  expect(JSON.parse(pasted.json)).toEqual(doc(
    ordered(27, [item('Outer', { type: 'bulletList', attrs: { listStyleType: 'disc', listLabel: { kind: 'text', text: '✓' } }, content: [item('Inner')] }), item('Next')], 'Section ', ') ', 'upper-alpha'),
    ordered(0, [item('Zero'), item('One')], '(', ') ', 'decimal'), ordered(4, [item('Restart')], '(', ') ', 'decimal'),
  ));
  expect(await page.evaluate(() => (window as unknown as ProbeWindow).__listLabels.pasteResults.map(result => result.diagnostics))).toEqual([[]]);
  expect(pasted.text).not.toMatch(/Section|✓/u);
  const rendered = await page.locator('#sample').screenshot();
  await oracle(page, ['Section AA) ', '✓ ', 'Section AB) ', '(0) ', '(1) ', '(4) ']);
  expect((await page.locator('#sample').screenshot({ path: test.info().outputPath('word-labels.png') })).equals(rendered)).toBe(true);
  expect(await page.evaluate(() => (window as unknown as ProbeWindow).__listLabels.editor.commands.undo())).toBe(true);
  expect((await snapshot(page)).json).toBe(before.json);
  expect(await page.evaluate(() => (window as unknown as ProbeWindow).__listLabels.editor.commands.redo())).toBe(true);
  expect((await snapshot(page)).json).toBe(pasted.json);
  await page.evaluate(() => { (window as unknown as ProbeWindow).__listLabels.pasteCopy(); });
  expect((await snapshot(page)).json).toBe(pasted.json);
  expect(await page.evaluate(() => (window as unknown as ProbeWindow).__listLabels.pasteResults.at(-1)?.diagnostics)).toEqual([]);
});

for (const picture of [false, true]) test(`Word custom labels survive image preparation, picture=${String(picture)}`, async ({ page }) => {
  await open(page, doc({ type: 'paragraph', content: [{ type: 'text', text: 'Before' }] }), '?cleanup=1&controls=1&assets=1');
  const before = await snapshot(page);
  const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC';
  await page.evaluate(html => { const probe = (window as unknown as ProbeWindow).__listLabels; probe.editor.commands.selectAll(); probe.pasteHTML(html); },
    wordLabelRules + wordLabelItem('Section A)', 'Outer') + wordLabelItem('✓', 'Inner', 0, 2)
      + (picture ? `<p><img src="${image}" alt="Chart"></p>` : ''));
  await expect(page.locator('#sample .ProseMirror ol')).toHaveCount(1);
  await expect(page.locator('#sample .ProseMirror img')).toHaveCount(picture ? 1 : 0);
  const pasted = await snapshot(page);
  expect((JSON.parse(pasted.json) as JSONContent).content?.[0]).toEqual({ type: 'orderedList', attrs: {
    start: 1, listStyleType: 'upper-alpha', listLabel: { kind: 'counter', format: 'upper-alpha', prefix: 'Section ', suffix: ') ' },
  }, content: [item('Outer', { type: 'bulletList', attrs: { listStyleType: 'disc', listLabel: { kind: 'text', text: '✓' } }, content: [item('Inner')] })] });
  expect(await page.evaluate(() => (window as unknown as ProbeWindow).__listLabels.pasteResults.map(result => result.diagnostics))).toEqual([[]]);
  for (const list of await page.locator('#sample .ProseMirror ol,#sample .ProseMirror ul').all()) await expect(list).toHaveCSS('list-style-type', /^dm-ll-/u);
  expect(await page.evaluate(() => (window as unknown as ProbeWindow).__listLabels.editor.commands.undo())).toBe(true);
  expect((await snapshot(page)).json).toBe(before.json);
  expect(await page.evaluate(() => (window as unknown as ProbeWindow).__listLabels.editor.commands.redo())).toBe(true);
  expect((await snapshot(page)).json).toBe(pasted.json);
});

test('Word custom labels retain their literal marker when the destination has no ListLabels', async ({ page }) => {
  await open(page, doc({ type: 'paragraph', content: [{ type: 'text', text: 'Before' }] }), '?cleanup=1&legacy=1');
  await page.evaluate(html => { const probe = (window as unknown as ProbeWindow).__listLabels; probe.editor.commands.selectAll(); probe.pasteHTML(html); },
    wordLabelRules + wordLabelItem('Section AA)', 'Outer') + wordLabelItem('✓', 'Inner', 0, 2));
  const pasted = await snapshot(page);
  expect(pasted.json).not.toContain('listLabel'); expect(pasted.text).toContain('Section AA)'); expect(pasted.text).toContain('✓');
  expect(await page.locator('#sample .ProseMirror ol,#sample .ProseMirror ul').count()).toBe(0);
  expect(await page.evaluate(() => (window as unknown as ProbeWindow).__listLabels.pasteResults[0]?.diagnostics.map(item => item.code))).toContain('office-list-unsupported');
});
for (const scenario of cases) test(`native markers render ${scenario.name} without adding document text`, async ({ page }) => {
  await open(page, scenario.content);
  const before = await snapshot(page);
  const image = await page.locator('#sample').screenshot();
  const roundtrip = await page.evaluate(() => (window as unknown as ProbeWindow).__listLabels.roundtrip());
  expect(roundtrip.json).toBe(before.json); expect(roundtrip.css).toContain('@counter-style');
  expect(roundtrip.html).not.toContain('<style');
  expect(await page.evaluate(() => { const { editor } = (window as unknown as ProbeWindow).__listLabels; return editor.view.dom.textContent === editor.state.doc.textContent; })).toBe(true);
  await oracle(page, scenario.labels);
  expect((await page.locator('#sample').screenshot({ path: test.info().outputPath('light.png') })).equals(image)).toBe(true);
  const fallback = await page.evaluate(html => (window as unknown as ProbeWindow).__listLabels.fallback(html), before.html);
  expect(fallback.text).toBe(before.text); expect(fallback.html).not.toContain('data-dm-list-label');
});

test('native clipboard, splitting and undo preserve labels without copied marker text', async ({ page }) => {
  await open(page, doc(list(4, 'decimal', 'Part ', ': ')));
  const before = await snapshot(page);
  const copied = await page.evaluate(() => (window as unknown as ProbeWindow).__listLabels.pasteCopy());
  expect(copied.text).toBe(before.text); expect(copied.text).not.toContain('Part');
  expect((await snapshot(page)).json).toBe(before.json);
  expect(await page.evaluate(() => (window as unknown as ProbeWindow).__listLabels.editor.commands.undo())).toBe(true);
  expect((await snapshot(page)).text).toBe('Before');
  expect(await page.evaluate(() => (window as unknown as ProbeWindow).__listLabels.editor.commands.redo())).toBe(true);
  expect((await snapshot(page)).json).toBe(before.json);
  expect(await page.evaluate(() => (window as unknown as ProbeWindow).__listLabels.split())).toBe(true);
  const image = await page.locator('#sample').screenshot();
  await oracle(page, ['Part 4: ', 'Part 5: ', 'Part 6: ', 'Part 7: ']);
  expect((await page.locator('#sample').screenshot({ path: test.info().outputPath('light.png') })).equals(image)).toBe(true);
});

test('companion styles work inside a shadow root and retain its own counter scope', async ({ page }) => {
  await open(page, doc(list(1, 'decimal', 'Outer ', ') ', 1)));
  const content = doc(list(26, 'lower-alpha', 'Shadow ', ') ', 2));
  const result = await page.evaluate(json => (window as unknown as ProbeWindow).__listLabels.shadow(json), JSON.stringify(content));
  expect(result.css).toContain(':host');
  const image = await page.locator('#shadow-sample').screenshot({ path: test.info().outputPath('shadow.png') });
  await page.evaluate(json => { (window as unknown as ProbeWindow).__listLabels.set(json); }, JSON.stringify(content));
  expect((await page.locator('#sample').screenshot({ path: test.info().outputPath('light.png') })).equals(image)).toBe(true);
  await oracle(page, ['Shadow z) ', 'Shadow aa) '], true);
  expect((await page.locator('#shadow-sample').screenshot()).equals(image)).toBe(true);
  expect(await page.locator('#sample ol').evaluate(element => (element as HTMLOListElement).start)).toBe(26);
  expect((await snapshot(page)).text).toBe('Item 1\n\nItem 2');
});

test('adopting the same shadow root into another document moves its counter definitions', async ({ page }) => {
  await open(page, doc(list(1, 'decimal', 'Outer ', ') ', 1)));
  const content = doc(list(26, 'lower-alpha', 'Shadow ', ') ', 2));
  const initial = await page.evaluate(json => (window as unknown as ProbeWindow).__listLabels.shadow(json), JSON.stringify(content));
  const before = await page.locator('#shadow-sample').screenshot();
  const adopted = await page.evaluate(() => (window as unknown as ProbeWindow).__listLabels.adoptShadow());
  expect(adopted.json).toBe(initial.json);
  expect(adopted.oldCSS).not.toContain('prefix: "Shadow ";');
  expect(adopted.newCSS).toContain('prefix: "Shadow ";'); expect(adopted.shadowCSS).toContain('prefix: "Shadow ";');
  const after = await page.frameLocator('#adopted').locator('#shadow-sample').screenshot();
  expect(after.equals(before)).toBe(true);
  expect(await page.evaluate(() => (window as unknown as ProbeWindow).__listLabels.destroyShadow())).toEqual({ documentStyles: 0, shadowStyles: 0 });
});

test('a nonce permits companion CSS under the host style policy', async ({ page }) => {
  await page.route('**/?csp=1', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': "style-src-elem 'nonce-list-label-test'; style-src-attr 'unsafe-inline'" } });
  });
  await open(page, doc(list(0, 'decimal', 'Allowed ', ') ', 2)), '?csp=1');
  const rule = page.locator('style[data-domternal-list-labels]');
  expect(await rule.evaluate(element => (element as HTMLStyleElement).nonce)).toBe('list-label-test');
  expect(await page.locator('#sample ol').evaluate(element => getComputedStyle(element).listStyleType)).toMatch(/^dm-ll-/);
  const image = await page.locator('#sample').screenshot();
  await oracle(page, ['Allowed 0) ', 'Allowed 1) ']);
  expect((await page.locator('#sample').screenshot({ path: test.info().outputPath('light.png') })).equals(image)).toBe(true);
});

for (const same of [false, true]) test(`SmartPaste keeps list label boundaries, matching=${String(same)}`, async ({ page }) => {
  await open(page, doc({ ...list(4, 'decimal', 'Section ', ') ', 1), content: [item('BeforeAfter')] }), '?controls=1');
  const before = await snapshot(page);
  await page.evaluate(() => { (window as unknown as ProbeWindow).__listLabels.select('BeforeAfter', 6); });
  const pasted = { ...list(7, 'decimal', same ? 'Section ' : 'Article ', ') ', 1), content: [item('Imported')] };
  expect(await page.evaluate(json => (window as unknown as ProbeWindow).__listLabels.paste(json), JSON.stringify(doc(pasted)))).toBe(true);
  const result = await snapshot(page);
  const tree = JSON.parse(result.json) as JSONContent;
  expect(tree.content?.length).toBe(same ? 1 : 3);
  const prefixes = tree.content?.map(node => (node.attrs?.['listLabel'] as { prefix: string }).prefix);
  expect(prefixes).toEqual(same ? ['Section '] : ['Section ', 'Article ', 'Section ']);
  expect(result.text).toBe('Before\n\nImported\n\nAfter');
  const image = await page.locator('#sample').screenshot();
  await oracle(page, same ? ['Section 4) ', 'Section 5) ', 'Section 6) '] : ['Section 4) ', 'Article 7) ', 'Section 4) ']);
  expect((await page.locator('#sample').screenshot()).equals(image)).toBe(true);
  expect(await page.evaluate(() => (window as unknown as ProbeWindow).__listLabels.editor.commands.undo())).toBe(true);
  expect((await snapshot(page)).json).toBe(before.json);
  expect(await page.evaluate(() => (window as unknown as ProbeWindow).__listLabels.editor.commands.redo())).toBe(true);
  expect((await snapshot(page)).json).toBe(result.json);
});

test('keyboard block movement does not join adjacent lists with different labels', async ({ page }) => {
  const content = doc({ ...list(4, 'decimal', 'Section ', ') ', 1), content: [item('First')] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Gap' }] },
    { ...list(7, 'decimal', 'Article ', ') ', 1), content: [item('Second')] });
  await open(page, content, '?controls=1'); const before = await snapshot(page);
  await page.evaluate(() => { (window as unknown as ProbeWindow).__listLabels.select('Gap', 0); });
  await page.keyboard.press('ControlOrMeta+Shift+ArrowDown');
  const moved = await snapshot(page); const tree = JSON.parse(moved.json) as JSONContent;
  expect(tree.content?.map(node => node.type)).toEqual(['orderedList', 'orderedList', 'paragraph']);
  expect(tree.content?.slice(0, 2).map(node => (node.attrs?.['listLabel'] as { prefix: string }).prefix)).toEqual(['Section ', 'Article ']);
  expect(moved.text).toBe('First\n\nSecond\n\nGap');
  expect(await page.evaluate(() => (window as unknown as ProbeWindow).__listLabels.editor.commands.undo())).toBe(true);
  expect((await snapshot(page)).json).toBe(before.json);
});

for (const own of [false, true]) test(`PasteCleanup preserves nested list labels and history, own copy=${String(own)}`, async ({ page }) => {
  const content = doc({ ...list(27, 'upper-alpha', 'Section ', ') ', 1), content: [item('Outer', {
    type: 'bulletList', attrs: { listLabel: { kind: 'text', text: '✓' } }, content: [item('Inner')],
  })] });
  await open(page, content, '?controls=1&cleanup=1');
  const expected = await snapshot(page);
  if (own) {
    const copied = await page.evaluate(() => (window as unknown as ProbeWindow).__listLabels.pasteCopy());
    expect(copied.text).not.toContain('Section');
  } else {
    await page.evaluate(() => {
      const { editor } = (window as unknown as ProbeWindow).__listLabels;
      editor.setContent('<p>Before</p>', false); editor.commands.selectAll();
    });
    expect(await page.evaluate(json => (window as unknown as ProbeWindow).__listLabels.paste(json), JSON.stringify(content))).toBe(true);
  }
  expect((await snapshot(page)).json).toBe(expected.json);
  const reports = await page.evaluate(() => (window as unknown as ProbeWindow).__listLabels.pasteResults.map(result => result.diagnostics));
  expect(reports).toEqual([[]]);
  const rendered = await page.locator('#sample').screenshot();
  await oracle(page, ['Section AA) ', '✓ ']);
  expect((await page.locator('#sample').screenshot()).equals(rendered)).toBe(true);
  expect(await page.evaluate(() => (window as unknown as ProbeWindow).__listLabels.editor.commands.undo())).toBe(true);
  expect((await snapshot(page)).text).toBe('Before');
  expect(await page.evaluate(() => (window as unknown as ProbeWindow).__listLabels.editor.commands.redo())).toBe(true);
  expect((await snapshot(page)).json).toBe(expected.json);
});
