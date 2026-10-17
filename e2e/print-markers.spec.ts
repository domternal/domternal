import { expect, test, type Page } from '@playwright/test';
import type { JSONContent } from '@domternal/core';

interface MarkerProbe {
  ready: boolean;
  mount(id: string, options: { isolateNativePrint: boolean }, shadow: boolean): void;
  json(id: string, json: string): void;
  snapshot(id: string): { json: string; html: string; selection: unknown };
  root(id: string): HTMLElement;
}
interface MarkerWindow { __print: MarkerProbe }
const item = (text: string, nested?: JSONContent): JSONContent => ({ type: 'listItem', content: [
  { type: 'paragraph', content: [{ type: 'text', text }] }, ...(nested ? [nested] : []),
] });
const ordered = (start: number, format: string, prefix: string, suffix: string, count = 2): JSONContent => ({
  type: 'orderedList', attrs: { start, listLabel: { kind: 'counter', format, prefix, suffix } },
  content: Array.from({ length: count }, (_, index) => item(`Record ${String(index + 1)}`)),
});
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content });
const compound = { kind: 'compound', parts: [{ ancestor: 1, format: 'inherit' }, '.', { ancestor: 0, format: 'inherit' }, ') '], fallback: 'decimal' };
const scenarios: { name: string; content: JSONContent; labels: string[] }[] = [
  { name: 'zero starts and restarts', content: doc(ordered(0, 'decimal', 'Section ', ') '), ordered(8, 'decimal', 'Section ', ') ')), labels: ['Section 0) ', 'Section 1) ', 'Section 8) ', 'Section 9) '] },
  { name: 'alphabetic counters across z', content: doc(ordered(26, 'lower-alpha', '(', ') ', 3)), labels: ['(z) ', '(aa) ', '(ab) '] },
  { name: 'Roman endpoint and decimal fallback', content: doc(ordered(3999, 'upper-roman', '[', '] ')), labels: ['[MMMCMXCIX] ', '[4000] '] },
  { name: 'nested compound counters', content: doc({ ...ordered(27, 'upper-alpha', 'Part ', ': ', 1), content: [item('Parent', {
    type: 'orderedList', attrs: { start: 0, listLabel: compound }, content: [item('First child'), item('Second child')],
  })] }), labels: ['Part AA: ', 'AA.0) ', 'AA.1) '] },
  { name: 'literal bullets and escaped prefixes', content: doc(ordered(2, 'decimal', '"\\ <&> ', ') '), {
    type: 'bulletList', attrs: { listLabel: { kind: 'text', text: '✓' } }, content: [item('Task')],
  }), labels: ['"\\ <&> 2) ', '"\\ <&> 3) ', '✓ '] },
];

/** Render literal labels independently of the native numeric counter calculation. */
async function literalOracle(page: Page, labels: string[]): Promise<void> {
  await page.evaluate(labels => {
    const root = (window as unknown as MarkerWindow).__print.root('one');
    const tree = root.getRootNode();
    const sheet = document.createElement('style');
    sheet.textContent = labels.map((label, index) => {
      const quoted = Array.from(label, character => `\\${(character.codePointAt(0) ?? 0).toString(16)} `).join('');
      return `@counter-style dm-print-oracle-${String(index)} { system:cyclic; symbols:"${quoted}"; suffix:""; }`;
    }).join('\n');
    (tree instanceof ShadowRoot ? tree : document.head).appendChild(sheet);
    Array.from(root.querySelectorAll('li')).forEach((li, index) => {
      li.removeAttribute('data-dm-compound-marker');
      li.style.listStyleType = `dm-print-oracle-${String(index)}`;
    });
  }, labels);
}

for (const shadow of [false, true]) for (const scenario of scenarios) {
  test(`print markers match literal labels: ${scenario.name}, shadow=${String(shadow)}`, async ({ page }) => {
    await page.goto('http://127.0.0.1:5793/print-lifecycle/');
    await page.waitForFunction(() => (window as unknown as Partial<MarkerWindow>).__print?.ready);
    await page.evaluate(({ shadow, json }) => {
      const probe = (window as unknown as MarkerWindow).__print;
      probe.mount('one', { isolateNativePrint: true }, shadow); probe.json('one', json);
      probe.root('one').style.width = '700px';
      probe.root('one').style.padding = '48px';
      probe.root('one').querySelector<HTMLElement>('.ProseMirror')?.blur();
      window.dispatchEvent(new Event('beforeprint'));
    }, { shadow, json: JSON.stringify(scenario.content) });
    await page.emulateMedia({ media: 'print' });
    const before = await page.evaluate(() => (window as unknown as MarkerWindow).__print.snapshot('one'));
    const sample = page.locator('#one');
    const printed = await sample.screenshot();
    await literalOracle(page, scenario.labels);
    expect((await sample.screenshot({ path: test.info().outputPath('literal-print-markers.png') })).equals(printed)).toBe(true);
    await page.evaluate(() => { window.dispatchEvent(new Event('afterprint')); });
    await page.emulateMedia({ media: 'screen' });
    // The oracle changes only presentation attributes on the live node view.
    expect(await page.evaluate(() => (window as unknown as MarkerWindow).__print.snapshot('one'))).toEqual(before);
  });
}
