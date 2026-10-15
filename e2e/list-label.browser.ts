import { expect, test, type Page } from '@playwright/test';
import type { JSONContent } from '@domternal/core';
import type { ListLabelProbe } from './list-label-fixture/main.js';
interface ProbeWindow { __listLabels: ListLabelProbe }
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
    items.forEach((item, index) => { item.style.listStyleType = `dm-oracle-${String(index)}`; });
  }, { labels, shadow });
}
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
