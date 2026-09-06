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
  getText: () => string;
  schema: { marks: Record<string, { create: (attrs: Record<string, unknown>) => unknown }> };
  state: { doc: { content: { size: number } }; tr: { addMark: (from: number, to: number, mark: unknown) => unknown } };
  view: { dispatch: (tr: unknown) => void };
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

    test('removes refused hrefs from loaded JSON and keeps the text', async ({ page }) => {
      await goNotion(page, target);
      const html = await setJSON(page, { type: 'doc', content: [{ type: 'paragraph', content: [
        link('ARRAY', [`javascript:${FLAG}`]),
        { type: 'text', text: ' ' },
        link('SCRIPT', ` java\tscript:${FLAG}`),
      ] }] });
      expect(html).not.toContain('href');
      expect(html).not.toContain('<span');
      await expect(page.locator(target.editorSelector).locator('a')).toHaveCount(0);
      expect(await page.evaluate(() => ((window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as DemoEditor).getText()))
        .toBe('ARRAY SCRIPT');
    });

    test('renders stored refused hrefs as text and opens nothing for them', async ({ page }) => {
      const dialogs: string[] = [];
      page.on('dialog', dialog => { dialogs.push(dialog.message()); void dialog.dismiss(); });
      await goNotion(page, target);
      await setJSON(page, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ARRAY SCRIPT CREDENTIALS' }] }] });
      // As a collaborator's document binds: marks created without validation or loading.
      const html = await page.evaluate((hrefs) => {
        const editor = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as DemoEditor;
        const tr = editor.state.tr;
        let from = 1;
        for (const [word, href] of hrefs) {
          tr.addMark(from, from + word.length, editor.schema.marks['link']?.create({ href }));
          from += word.length + 1;
        }
        editor.view.dispatch(tr);
        return editor.getHTML();
      }, [['ARRAY', [`javascript:${FLAG}`]], ['SCRIPT', ` java\tscript:${FLAG}`], ['CREDENTIALS', 'https://google.com@evil.example/']] as [string, unknown][]);
      expect(html).not.toContain('href');
      expect(html).toContain('<span>ARRAY</span>');
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

    test('keeps a refused address out of the link popover with a reason, and stores a fragment as typed', async ({ page }) => {
      await goNotion(page, target);
      await setJSON(page, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] }] });
      const editor = page.locator(target.editorSelector);
      // Select the first word as a user would, then open the popover with its shortcut.
      await page.evaluate((selector) => {
        const text = document.querySelector(`${selector} p`)?.firstChild;
        if (!text) return;
        const range = document.createRange();
        range.setStart(text, 0);
        range.setEnd(text, 5);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        document.querySelector<HTMLElement>(selector)?.focus();
      }, target.editorSelector);
      await page.keyboard.press('ControlOrMeta+k');
      const popover = page.locator('.dm-link-popover[data-show]');
      await expect(popover).toBeVisible();
      const input = popover.locator('.dm-link-popover-input');
      await input.fill(`javascript:${FLAG}`);
      await page.keyboard.press('Enter');
      await expect(popover).toBeVisible();
      await expect(input).toHaveAttribute('aria-invalid', 'true');
      expect(await input.evaluate(element => (element as HTMLInputElement).validationMessage)).toBe('This address cannot be used as a link.');
      await expect(editor.locator('a')).toHaveCount(0);
      await input.fill('#section');
      await expect(input).not.toHaveAttribute('aria-invalid', /.*/);
      await page.keyboard.press('Enter');
      await expect(popover).toBeHidden();
      await expect(editor.locator('a')).toHaveAttribute('href', '#section');
      expect(await page.evaluate(() => (window as unknown as Record<string, unknown>)['__pwned'] ?? null)).toBeNull();
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
