/**
 * Markdown extension across all four demos: markdown-looking plain-text
 * pastes convert to rich content, plain prose stays untouched, and the
 * insertMarkdown / setMarkdownContent commands build rich structures.
 */
import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';
import { demoTargets, type DemoTarget } from './targets.js';

async function goNotion(page: Page, target: DemoTarget): Promise<void> {
  await page.goto(target.baseURL + '/');
  await page.waitForSelector(target.notionToggle);
  await page.click(target.notionToggle);
  await page.waitForSelector(target.editorSelector);
  await page.waitForFunction(
    () => Boolean((window as unknown as Record<string, unknown>)['__DEMO_EDITOR__']),
    { timeout: 3000 },
  );
}

async function setContent(page: Page, html: string): Promise<void> {
  await page.evaluate((h) => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | { setContent: (h: string, emit: boolean) => void; commands: { focus: () => void } }
      | undefined;
    ed?.setContent(h, false);
    ed?.commands.focus();
  }, html);
}

async function pastePlainText(page: Page, target: DemoTarget, text: string): Promise<void> {
  await page.click(target.editorSelector);
  await page.evaluate(
    ({ selector, value }) => {
      const el = document.querySelector(selector);
      if (!el) throw new Error('editor not found');
      const data = new DataTransfer();
      data.setData('text/plain', value);
      el.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
      );
    },
    { selector: target.editorSelector, value: text },
  );
  await page.waitForTimeout(150);
}

function runCommand(page: Page, name: string, markdown: string): Promise<boolean> {
  return page.evaluate(
    ({ command, value }) => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { commands: Record<string, (md: string) => boolean> }
        | undefined;
      return ed ? ed.commands[command]?.(value) === true : false;
    },
    { command: name, value: markdown },
  );
}

for (const target of demoTargets) {
  test.describe(`${target.name} - markdown extension`, () => {
    test.beforeEach(async ({ page }) => {
      await goNotion(page, target);
      await setContent(page, '<p></p>');
    });

    test('pasting markdown converts it to rich content', async ({ page }) => {
      await pastePlainText(page, target, '# Pasted title\n\n- alpha\n- beta\n\n> quoted');
      const editor = page.locator(target.editorSelector);
      await expect(editor.locator('h1')).toHaveText('Pasted title');
      await expect(editor.locator('ul li')).toHaveCount(2);
      await expect(editor.locator('blockquote')).toContainText('quoted');
    });

    test('pasting plain prose stays plain', async ({ page }) => {
      await pastePlainText(page, target, 'just a plain sentence.');
      const editor = page.locator(target.editorSelector);
      await expect(editor.locator('p').first()).toContainText('just a plain sentence.');
      await expect(editor.locator('h1, ul, blockquote')).toHaveCount(0);
    });

    test('insertMarkdown builds rich structures including tables and task lists', async ({ page }) => {
      const ok = await runCommand(
        page,
        'insertMarkdown',
        '## From command\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n- [x] done',
      );
      expect(ok).toBe(true);
      const editor = page.locator(target.editorSelector);
      await expect(editor.locator('h2')).toHaveText('From command');
      await expect(editor.locator('table th, table td')).toHaveCount(4);
      await expect(editor.locator('ul[data-type="taskList"] li')).toHaveCount(1);
    });

    test('setMarkdownContent replaces the document', async ({ page }) => {
      const ok = await runCommand(page, 'setMarkdownContent', '1. first\n2. second');
      expect(ok).toBe(true);
      await expect(page.locator(target.editorSelector).locator('ol li')).toHaveCount(2);
    });
  });
}
