/**
 * Link security through the four demo apps and their wrappers, with the
 * default Link configuration: a stored href the URL policy refuses renders as
 * text and opens nothing, and an allowed link opens its own href in a new tab
 * without an opener. The fixture suite (e2e/link-security.browser.ts) covers
 * the full matrix against the core build.
 */
import { expect, type Page } from '@playwright/test';
import { test } from './fixtures.js';
import { demoTargets, type DemoTarget } from './targets.js';

const LANDING = 'https://landing.test/';
const FLAG = 'void((window.opener||window).__pwned=document.domain,alert(1))';

interface DemoEditor {
  commands: { setContent: (content: unknown, options?: { emitUpdate?: boolean }) => boolean };
  getHTML: () => string;
}

async function goNotion(page: Page, target: DemoTarget): Promise<void> {
  await page.goto(target.baseURL + '/');
  await page.waitForSelector(target.notionToggle);
  await page.click(target.notionToggle);
  await page.waitForSelector(target.editorSelector);
  await page.waitForFunction(() => Boolean((window as unknown as Record<string, unknown>)['__DEMO_EDITOR__']), { timeout: 3000 });
}

async function setJSON(page: Page, content: unknown): Promise<string> {
  return page.evaluate((json) => {
    const editor = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as DemoEditor;
    editor.commands.setContent(json);
    return editor.getHTML();
  }, content);
}

const link = (text: string, href: unknown): Record<string, unknown> =>
  ({ type: 'text', text, marks: [{ type: 'link', attrs: { href } }] });

for (const target of demoTargets) {
  test.describe(`link security (${target.name})`, () => {
    test.beforeEach(async ({ context }) => {
      await context.route(`${LANDING}**`, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><p>landing</p>' }));
    });

    test('renders stored refused hrefs as text and opens nothing for them', async ({ page }) => {
      const dialogs: string[] = [];
      page.on('dialog', dialog => { dialogs.push(dialog.message()); void dialog.dismiss(); });
      await goNotion(page, target);
      const html = await setJSON(page, { type: 'doc', content: [{ type: 'paragraph', content: [
        link('ARRAY', [`javascript:${FLAG}`]),
        { type: 'text', text: ' ' },
        link('SCRIPT', ` java\tscript:${FLAG}`),
        { type: 'text', text: ' ' },
        link('CREDENTIALS', 'https://google.com@evil.example/'),
      ] }] });
      expect(html).not.toContain('href');
      const editor = page.locator(target.editorSelector);
      await expect(editor.locator('a')).toHaveCount(0);
      for (const text of ['ARRAY', 'SCRIPT', 'CREDENTIALS']) {
        const popup = page.context().waitForEvent('page', { timeout: 500 }).catch(() => null);
        await editor.getByText(text, { exact: true }).last().click();
        expect(await popup, text).toBeNull();
      }
      await page.waitForTimeout(150);
      expect(dialogs).toEqual([]);
      expect(await page.evaluate(() => (window as unknown as Record<string, unknown>)['__pwned'] ?? null)).toBeNull();
      expect(page.url().startsWith(target.baseURL)).toBe(true);
    });

    test('opens the clicked link\'s own href in a new tab without an opener', async ({ page }) => {
      await goNotion(page, target);
      await setJSON(page, { type: 'doc', content: [{ type: 'paragraph', content: [
        link('BAD', `javascript:${FLAG}`),
        link('GOOD', `${LANDING}${target.name}`),
      ] }] });
      const popup = page.context().waitForEvent('page', { timeout: 10000 });
      await page.locator(target.editorSelector).getByText('GOOD', { exact: true }).last().click();
      const opened = await popup;
      await opened.waitForLoadState();
      expect(opened.url()).toBe(`${LANDING}${target.name}`);
      expect(await opened.evaluate(() => ({ opener: window.opener === null, referrer: document.referrer })))
        .toEqual({ opener: true, referrer: '' });
    });
  });
}
