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

async function paste(
  page: Page,
  target: DemoTarget,
  flavors: { text: string; html?: string },
  options: { click?: boolean } = {},
): Promise<void> {
  if (options.click !== false) await page.click(target.editorSelector);
  await page.evaluate(
    ({ selector, text, html }) => {
      const el = document.querySelector(selector);
      if (!el) throw new Error('editor not found');
      const data = new DataTransfer();
      data.setData('text/plain', text);
      if (html !== undefined) data.setData('text/html', html);
      el.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
      );
    },
    { selector: target.editorSelector, text: flavors.text, html: flavors.html },
  );
  await page.waitForTimeout(150);
}

async function pastePlainText(page: Page, target: DemoTarget, text: string): Promise<void> {
  await paste(page, target, { text });
}

/** Collapse the selection to the very end of the document. */
async function cursorToEnd(page: Page): Promise<void> {
  await page.evaluate(() => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | { commands: { focus: (position?: string) => void } }
      | undefined;
    ed?.commands.focus('end');
  });
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

    test('pasting a code fence keeps the language', async ({ page }) => {
      await pastePlainText(page, target, '```ts\nconst a = 1;\n```');
      const editor = page.locator(target.editorSelector);
      await expect(editor.locator('pre code')).toContainText('const a = 1;');
      await expect(editor.locator('pre code.language-ts')).toHaveCount(1);
    });

    test('pasting inside a code block stays literal', async ({ page }) => {
      await setContent(page, '<pre><code>start</code></pre>');
      await page.click(`${target.editorSelector} pre code`);
      await paste(page, target, { text: '# not converted' }, { click: false });
      const editor = page.locator(target.editorSelector);
      await expect(editor.locator('pre code')).toContainText('# not converted');
      await expect(editor.locator('h1')).toHaveCount(0);
    });

    test('pasting a bare URL still becomes a link, not markdown', async ({ page }) => {
      await pastePlainText(page, target, 'https://example.com/x');
      const editor = page.locator(target.editorSelector);
      await expect(editor.locator('a[href="https://example.com/x"]')).toHaveCount(1);
    });

    test('pastes with an HTML flavor are left to the default handling', async ({ page }) => {
      await paste(page, target, {
        text: '# md text',
        html: '<p><em>html wins</em></p>',
      });
      const editor = page.locator(target.editorSelector);
      await expect(editor.locator('em')).toContainText('html wins');
      await expect(editor.locator('h1')).toHaveCount(0);
    });

    test('single-paragraph markdown pastes merge inline into existing text', async ({ page }) => {
      await setContent(page, '<p>keep:</p>');
      await cursorToEnd(page);
      await paste(page, target, { text: 'has **bold** inline' }, { click: false });
      const editor = page.locator(target.editorSelector);
      await expect(editor.locator('p')).toHaveCount(1);
      await expect(editor.locator('p strong')).toHaveText('bold');
      await expect(editor.locator('p')).toContainText('keep:has bold inline');
    });

    test('undo after a markdown paste restores the document in one step', async ({ page }) => {
      await pastePlainText(page, target, '# Undo me\n\n- a\n- b');
      const editor = page.locator(target.editorSelector);
      await expect(editor.locator('h1')).toHaveCount(1);
      await page.keyboard.press('ControlOrMeta+z');
      await expect(editor.locator('h1')).toHaveCount(0);
      await expect(editor.locator('ul li')).toHaveCount(0);
    });

    test('task items inserted from markdown are interactive', async ({ page }) => {
      const ok = await runCommand(page, 'insertMarkdown', '- [ ] todo item');
      expect(ok).toBe(true);
      const editor = page.locator(target.editorSelector);
      const item = editor.locator('li[data-type="taskItem"]');
      await expect(item).toHaveAttribute('data-checked', 'false');
      await item.locator('input[type="checkbox"]').click();
      await expect(item).toHaveAttribute('data-checked', 'true');
    });

    test('pasting math renders math nodes', async ({ page }) => {
      await pastePlainText(page, target, '$$\nx = 1\n$$\n\nInline $a^2$ too');
      const editor = page.locator(target.editorSelector);
      await expect(editor.locator('.dm-math-block')).toHaveCount(1);
      await expect(editor.locator('.dm-math-inline')).toHaveCount(1);
    });

    test('pasting a markdown list into an existing list keeps every item', async ({ page }) => {
      await setContent(page, '<ul><li><p>one</p></li></ul>');
      await cursorToEnd(page);
      await paste(page, target, { text: '- two\n- three' }, { click: false });
      const editor = page.locator(target.editorSelector);
      await expect(editor.locator('li')).toHaveCount(3);
      await expect(editor).toContainText('one');
      await expect(editor).toContainText('two');
      await expect(editor).toContainText('three');
    });

    test('the shared storage serializer round-trips the document', async ({ page }) => {
      const ok = await runCommand(page, 'setMarkdownContent', '## Title\n\n- [x] done\n- [ ] open');
      expect(ok).toBe(true);
      const markdown = await page.evaluate(() => {
        const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
          | {
              state: { doc: unknown };
              storage: Record<string, { serializer: { serialize: (doc: unknown) => { markdown: string } } }>;
            }
          | undefined;
        if (!ed) throw new Error('editor missing');
        const storage = ed.storage['markdown'];
        if (!storage?.serializer) throw new Error('markdown storage missing');
        return storage.serializer.serialize(ed.state.doc).markdown;
      });
      expect(markdown).toBe('## Title\n\n- [x] done\n- [ ] open');
    });
  });
}
