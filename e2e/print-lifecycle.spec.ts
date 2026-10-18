import { test, expect, type Page } from '@playwright/test';
import type { Editor, PrintOptions } from '@domternal/core';
import { inflateSync } from 'node:zlib';

interface PrintProbe {
  ready: boolean;
  mount(id: string, options?: Partial<PrintOptions>, shadow?: boolean): void;
  html(id: string, html: string): void;
  json(id: string, value: string): void;
  snapshot(id: string): { json: string; html: string; selection: unknown };
  editor(id: string): Editor;
  root(id: string): HTMLElement;
  print(id: string): Promise<{ accepted: boolean; status: string; error?: string }>;
  request(id: string): boolean;
  cancel(id: string): boolean;
  destroy(id: string): void;
  failPrint(value: boolean): void;
  state(): { prints: { roots: string[]; images: boolean; headers: number }[]; events: string[]; markers: number; printing: boolean };
}
interface PrintWindow { __print: PrintProbe }
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
async function open(page: Page): Promise<void> {
  await page.goto('http://127.0.0.1:5793/print-lifecycle/');
  await page.waitForFunction(() => (window as unknown as Partial<PrintWindow>).__print?.ready);
}
async function snapshot(page: Page, id = 'one'): Promise<ReturnType<PrintProbe['snapshot']>> { return page.evaluate(id => (window as unknown as PrintWindow).__print.snapshot(id), id); }
async function state(page: Page): Promise<ReturnType<PrintProbe['state']>> { return page.evaluate(() => (window as unknown as PrintWindow).__print.state()); }
function grid(count = 5, joined = false): string {
  const heading = joined
    ? '<tr><th rowspan="2"><p>Region heading</p></th><th colspan="2"><p>Quarter heading</p></th></tr><tr><th><p>First period</p></th><th><p>Second period</p></th></tr>'
    : '<tr><th><p>Primary header</p></th><th><p>Primary value</p></th></tr><tr><th><p>Secondary header</p></th><th><p>Secondary value</p></th></tr>';
  return '<table><tbody>' + heading + Array.from({ length: count }, (_, i) => `<tr><td><p>Record ${String(i + 1)}</p></td><td><p>Value ${String(i + 1)}</p></td>${joined ? '<td><p>Extra</p></td>' : ''}</tr>`).join('') + '</tbody></table>';
}

for (const shadow of [false, true]) {
  test(`command and native lifecycle preserve the document in ${shadow ? 'Shadow DOM' : 'light DOM'}`, async ({ page }) => {
    await open(page);
    await page.evaluate(({ shadow, html }) => {
      const probe = (window as unknown as PrintWindow).__print;
      probe.mount('one', { isolateNativePrint: true }, shadow); probe.html('one', html);
    }, { shadow, html: grid(8, true) });
    const before = await snapshot(page);
    const printed = await page.evaluate(() => (window as unknown as PrintWindow).__print.print('one'));
    expect(printed).toMatchObject({ accepted: true, status: 'synchronous' });
    expect((await state(page)).prints).toEqual([{ roots: ['one'], images: true, headers: 2 }]);
    expect((await state(page)).events).toEqual(['one:beforePrint', 'one:afterPrint']);
    expect(await snapshot(page)).toEqual(before);
    expect((await state(page)).markers).toBe(0);
    await page.evaluate(() => { window.dispatchEvent(new Event('beforeprint')); });
    await page.emulateMedia({ media: 'print' });
    const during = await page.evaluate(() => {
      const root = (window as unknown as PrintWindow).__print.root('one');
      return { head: getComputedStyle(root.querySelector('thead')!).display,
        source: getComputedStyle(root.querySelector('tbody > tr')!).display,
        chrome: getComputedStyle(document.getElementById('host-chrome')!).display,
        rows: root.querySelectorAll('tbody tr').length };
    });
    expect(during).toEqual({ head: 'table-header-group', source: 'none', chrome: 'none', rows: 10 });
    if (shadow) {
      await expect(page.locator('.shadow-chrome')).toHaveCSS('display', 'none');
      await expect(page.locator('.shadow-shell')).toHaveCSS('max-height', 'none');
      await expect(page.locator('.shadow-shell')).toHaveCSS('overflow', 'visible');
    }
    await page.evaluate(() => { window.dispatchEvent(new Event('afterprint')); });
    await page.emulateMedia({ media: 'screen' });
    expect(await snapshot(page)).toEqual(before);
    expect((await state(page)).markers).toBe(0);
  });
}

test('Ctrl or Cmd P prints the focused editor and native isolation chooses that same editor', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const probe = (window as unknown as PrintWindow).__print;
    probe.mount('one', { isolateNativePrint: true }); probe.mount('two', { isolateNativePrint: true });
    probe.editor('two').view.focus();
  });
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+p' : 'Control+p');
  expect((await state(page)).prints.map(value => value.roots)).toEqual([['two']]);
  await page.evaluate(() => { window.dispatchEvent(new Event('beforeprint')); });
  expect(await page.evaluate(() => Array.from(document.querySelectorAll('.dm-print-root')).map(el => el.id))).toEqual(['two']);
  await page.evaluate(() => { window.dispatchEvent(new Event('afterprint')); });
  expect((await state(page)).events).toEqual(['two:beforePrint', 'two:afterPrint', 'two:beforePrint', 'two:afterPrint']);
});

test('native page printing prepares all editors without isolating the host by default', async ({ page }) => {
  await open(page);
  await page.evaluate(html => {
    const probe = (window as unknown as PrintWindow).__print;
    probe.mount('one'); probe.mount('two'); probe.html('one', html); probe.html('two', html);
    window.dispatchEvent(new Event('beforeprint'));
  }, grid());
  expect(await page.locator('.dm-print-table-head').count()).toBe(2);
  expect((await state(page)).printing).toBe(false);
  await page.evaluate(() => { window.dispatchEvent(new Event('afterprint')); });
  expect((await state(page)).markers).toBe(0);
});

test('a real image request and decode finish before printing, including a lazy off-screen image', async ({ page }) => {
  await open(page);
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/slow-print.png', async route => { await ready; await route.fulfill({ contentType: 'image/png', body: PNG }); });
  await page.evaluate(() => {
    const probe = (window as unknown as PrintWindow).__print;
    probe.mount('one', { prepareResources: { timeoutMs: 10000 } });
    const img = document.createElement('img'); img.src = '/slow-print.png'; img.loading = 'lazy'; img.style.marginTop = '9000px';
    probe.root('one').append(img); probe.request('one');
  });
  await expect(page.locator('#one > img')).toHaveAttribute('loading', 'eager');
  expect((await state(page)).prints).toHaveLength(0);
  expect(await page.evaluate(() => (window as unknown as PrintWindow).__print.request('one'))).toBe(false);
  release();
  await expect.poll(async () => (await state(page)).prints.length).toBe(1);
  expect((await state(page)).prints[0]?.images).toBe(true);
  await expect(page.locator('#one > img')).toHaveAttribute('loading', 'lazy');
});

test('header cells after body rows remain ordinary visible rows', async ({ page }) => {
  await open(page);
  const html = grid(2).replace('</tbody>', '<tr><th><p>Body annotation</p></th><th><p>Body value</p></th></tr></tbody>');
  await page.evaluate(html => {
    const probe = (window as unknown as PrintWindow).__print;
    probe.mount('one'); probe.html('one', html); window.dispatchEvent(new Event('beforeprint'));
  }, html);
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('#one tbody tr').nth(4)).toHaveCSS('display', 'table-row');
  await expect(page.locator('#one thead tr')).toHaveCount(2);
  await page.evaluate(() => { window.dispatchEvent(new Event('afterprint')); });
  await page.emulateMedia({ media: 'screen' });
  await expect(page.locator('#one tbody tr')).toHaveCount(5);
});

test('font loading settles before the opt-in print opens', async ({ page }) => {
  await open(page);
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/print-font.woff2', async route => {
    await ready;
    await route.fulfill({ status: 404, body: 'The browser will use its fallback after the font request settles' });
  });
  await page.evaluate(() => {
    const probe = (window as unknown as PrintWindow).__print;
    probe.mount('one', { prepareResources: true });
    const face = new FontFace('Print readiness', 'url(/print-font.woff2)');
    document.fonts.add(face);
    void face.load().catch(() => undefined);
    probe.root('one').style.fontFamily = '"Print readiness", sans-serif';
    probe.request('one');
  });
  expect((await state(page)).prints).toHaveLength(0);
  expect(await page.evaluate(() => document.fonts.status)).toBe('loading');
  release();
  await expect.poll(async () => (await state(page)).prints.length).toBe(1);
  expect(await page.evaluate(() => document.fonts.status)).toBe('loaded');
});

for (const outcome of ['cancel', 'destroy', 'timeout', 'error'] as const) {
  test(`pending image ${outcome} leaves no dialog or print mutations`, async ({ page }) => {
    await open(page);
    await page.route('**/pending-print.png', async route => {
      if (outcome === 'error') await route.fulfill({ status: 404, body: 'Missing image' });
      else await new Promise(() => { /* Keep the network resource pending until the page closes. */ });
    });
    await page.evaluate(outcome => {
      const probe = (window as unknown as PrintWindow).__print;
      probe.mount('one', { prepareResources: { timeoutMs: 100 } });
      const img = document.createElement('img'); img.src = '/pending-print.png'; probe.root('one').append(img);
      probe.request('one');
      if (outcome === 'cancel') probe.cancel('one');
      if (outcome === 'destroy') probe.destroy('one');
    }, outcome);
    if (outcome === 'timeout' || outcome === 'error') await expect.poll(async () => (await state(page)).events).toContain('one:printPreparationError');
    expect((await state(page)).prints).toHaveLength(0);
    expect((await state(page)).printing).toBe(false);
    expect((await state(page)).markers).toBe(0);
  });
}

test('a failed print call restores live table nodes and leaves editing usable', async ({ page }) => {
  await open(page);
  await page.evaluate(html => {
    const probe = (window as unknown as PrintWindow).__print;
    probe.mount('one', { prepareResources: true }); probe.html('one', html); probe.failPrint(true);
  }, grid());
  const before = await snapshot(page);
  expect(await page.evaluate(() => (window as unknown as PrintWindow).__print.print('one'))).toMatchObject({ status: 'failed' });
  expect(await snapshot(page)).toEqual(before);
  expect((await state(page)).markers).toBe(0);
  await page.evaluate(() => { const probe = (window as unknown as PrintWindow).__print; probe.editor('one').commands.insertContent('Still editable'); });
  expect((await snapshot(page)).json).toContain('Still editable');
});

test('large tables restore their original DOM identities without transactions', async ({ page }) => {
  await open(page);
  const result = await page.evaluate(async html => {
    const probe = (window as unknown as PrintWindow).__print;
    probe.mount('one'); probe.html('one', html);
    const root = probe.root('one'); const body = root.querySelector('tbody'); const last = body?.lastElementChild;
    let transactions = 0; probe.editor('one').on('transaction', () => { transactions++; });
    const before = probe.snapshot('one'); await probe.print('one');
    await new Promise<void>(resolve => requestAnimationFrame(() => { resolve(); }));
    return { unchanged: JSON.stringify(probe.snapshot('one')) === JSON.stringify(before), sameBody: root.querySelector('tbody') === body,
      sameLast: body?.lastElementChild === last, transactions };
  }, grid(1001));
  expect(result).toEqual({ unchanged: true, sameBody: true, sameLast: true, transactions: 0 });
});

for (const joined of [false, true]) test(`Chromium repeats header groups on later sheets, merged=${String(joined)}`, async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Only Chromium exposes native PDF output in Playwright; other engines cover print CSS and lifecycle.');
  await open(page);
  await page.evaluate(html => { const probe = (window as unknown as PrintWindow).__print; probe.mount('one', { isolateNativePrint: true }); probe.html('one', html); }, grid(100, joined));
  const raw = (await page.pdf({ printBackground: true })).toString('latin1');
  const pages: string[][] = [];
  for (const match of raw.matchAll(/stream\r?\n/g)) {
    const start = match.index + match[0].length; const end = raw.indexOf('endstream', start);
    if (end < 0) continue;
    try {
      const stream = inflateSync(Buffer.from(raw.slice(start, end), 'latin1')).toString('latin1');
      const runs = [...stream.matchAll(/(\[[^\]]*\]|[<(][^>)]*[>)])\s*T[jJ]/g)].map(value => value[1] ?? '');
      if (runs.length) pages.push(runs);
    } catch { /* Non-content streams are not necessarily compressed. */ }
  }
  expect(pages.length).toBeGreaterThan(1);
  const heading = pages[0]!.slice(0, 4);
  expect(new Set(heading).size).toBeGreaterThan(1);
  for (const sheet of pages.slice(1)) expect(sheet.slice(0, 4)).toEqual(heading);
  expect((await state(page)).markers).toBe(0);
});
