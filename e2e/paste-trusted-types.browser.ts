import { expect } from '@playwright/test';
import type { Editor } from '@domternal/core';
import type { NormalizePasteHTMLResult } from '@domternal/extension-paste-cleanup';
import { test } from './fixtures.js';

interface ProbeWindow {
  __pasteCleanup: { ready: boolean; editor: Editor; results: NormalizePasteHTMLResult[] };
}

for (const framework of ['vanilla', 'react', 'vue', 'angular']) {
for (const formatting of ['preserve', 'adapt']) {
test(`${framework}: ${formatting} paste under strict Trusted Types without a default policy`, async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'This check requires Chromium Trusted Types enforcement.');
  const runtimeErrors: string[] = [];
  page.on('pageerror', error => { runtimeErrors.push(error.message); });
  await page.goto(`http://127.0.0.1:5895/?framework=${framework}&formatting=${formatting}&schema=capability-full&list-markers=1`);
  await page.waitForFunction(() => (window as unknown as Partial<ProbeWindow>).__pasteCleanup?.ready);
  const policy = await page.evaluate(() => {
    const probe = (window as unknown as ProbeWindow).__pasteCleanup;
    probe.editor.setContent('<p>Original</p>', false);
    probe.editor.commands.selectAll();
    const meta = document.createElement('meta');
    meta.httpEquiv = 'Content-Security-Policy';
    meta.content = "require-trusted-types-for 'script'; trusted-types ProseMirrorClipboard";
    document.head.appendChild(meta);
    let blocked = false;
    try { document.createElement('div').innerHTML = '<p>Raw HTML</p>'; }
    catch { blocked = true; }
    return blocked;
  });
  expect(policy).toBe(true);
  await page.evaluate(() => {
    const probe = (window as unknown as ProbeWindow).__pasteCleanup;
    const data = new DataTransfer();
    data.setData('text/html', '<h2>Heading</h2><p><strong>Bold</strong> <a href="https://example.com/">Link</a></p>'
      + '<ol start="7" style="list-style-type:upper-roman"><li><p>Outer</p><ul><li><p>Inner</p></li></ul></li></ol>'
      + '<table><tr><th>A</th><th>B</th></tr><tr><td>C</td><td>D</td></tr></table>');
    data.setData('text/plain', 'Heading Bold Link Outer Inner A B C D');
    probe.editor.view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  expect(runtimeErrors).toEqual([]);
  const results = await page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.results);
  expect(results.map(result => result.status)).toEqual(['cleaned']);
  const editor = page.locator('.ProseMirror');
  await expect(editor.locator('h2')).toHaveText('Heading');
  await expect(editor.locator('strong')).toHaveText('Bold');
  await expect(editor.locator('a')).toHaveAttribute('href', 'https://example.com/');
  await expect(editor.locator('ol')).toHaveAttribute('start', '7');
  await expect(editor.locator('ol ul li')).toHaveText('Inner');
  await expect(editor.locator('table th')).toHaveCount(2);
  await expect(editor.locator('table td')).toHaveCount(2);
  const observed = await page.evaluate(() => {
    const probe = (window as unknown as ProbeWindow).__pasteCleanup;
    const diagnostics = probe.results.flatMap(result => result.diagnostics.map(diagnostic => diagnostic.code));
    const statuses = probe.results.map(result => result.status);
    return { diagnostics, statuses, undo: probe.editor.commands.undo() };
  });
  expect(observed.statuses).toEqual(['cleaned']);
  expect(observed.diagnostics).not.toContain('destination-formatting-unconfirmed');
  expect(observed.diagnostics).not.toContain('destination-table-unsupported');
  expect(observed.diagnostics).not.toContain('office-list-unsupported');
  expect(observed.diagnostics).not.toContain('link-removed');
  expect(observed.undo).toBe(true);
  await expect(editor).toHaveText('Original');
});
}
}
