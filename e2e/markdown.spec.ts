/**
 * Markdown extension across all four demos: plain-text and highlighted-source
 * pastes convert to rich content, rich HTML stays untouched, and the
 * insertMarkdown / setMarkdownContent commands build rich structures.
 */
import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';
import { demoTargets, type DemoTarget } from './targets.js';

const README_MARKDOWN = [
  '# Clipboard README',
  '',
  'Install **Domternal** and follow the [guide](https://example.com/guide).',
  '',
  '## Features',
  '',
  '- Rich text editing',
  '- Markdown source paste',
  '',
  '| Package | Status |',
  '| --- | --- |',
  '| core | ready |',
  '',
  '```ts',
  'const ready = true;',
  'if (ready) {',
  '\tconsole.log("ready");',
  '}',
  '```',
  '',
].join('\n');

function escapeHTML(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/** VS Code expands tabs and alternates regular/nonbreaking spaces in copied HTML. */
function sourceEditorLine(line: string): string {
  let column = 0;
  let nonbreaking = true;
  return Array.from(line, (character) => {
    const width = character === '\t' ? 4 - column % 4 : 1;
    column += width;
    if (character !== ' ' && character !== '\t') {
      nonbreaking = false;
      return character;
    }
    let spaces = '';
    for (let index = 0; index < width; index++) {
      spaces += nonbreaking ? '\u00a0' : ' ';
      nonbreaking = !nonbreaking;
    }
    return spaces;
  }).join('');
}

/** Model source-editor clipboard markup without adding semantic rich-text tags. */
function sourceHTML(text: string, lines: 'newlines' | 'divs' | 'br' = 'newlines'): string {
  const highlighted = text.split('\n').map((line) =>
    (lines === 'divs' ? sourceEditorLine(line) : line).split(/(\s+)/).filter(Boolean).map((token, index) =>
      `<span style="color: ${index % 2 === 0 ? '#569cd6' : '#d4d4d4'};">${escapeHTML(token)}</span>`,
    ).join(''),
  );
  const content = lines === 'divs'
    ? highlighted.map((line) => line ? `<div>${line}</div>` : '<br>').join('')
    : highlighted.join(lines === 'br' ? '<br>' : '\n');
  return '<meta charset="utf-8"><div style="color: #d4d4d4; background-color: #1e1e1e; '
    + `font-family: Consolas, monospace; white-space: pre;">${content}</div>`;
}

async function expectREADME(page: Page, target: DemoTarget): Promise<void> {
  const editor = page.locator(target.editorSelector);
  await expect(editor.locator('h1')).toHaveText('Clipboard README');
  await expect(editor.locator('h2')).toHaveText('Features');
  await expect(editor.locator('strong')).toHaveText('Domternal');
  await expect(editor.locator('a[href="https://example.com/guide"]')).toHaveText('guide');
  await expect(editor.locator('ul li')).toHaveText(['Rich text editing', 'Markdown source paste']);
  await expect(editor.locator('table th, table td')).toHaveText(['Package', 'Status', 'core', 'ready']);
  await expect.poll(() => editor.locator('pre code.language-ts').textContent()).toBe(
    'const ready = true;\nif (ready) {\n\tconsole.log("ready");\n}',
  );
}

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
      const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
      // Firefox replaces constructor-supplied data with an empty clipboard object.
      if (event.clipboardData !== data) Object.defineProperty(event, 'clipboardData', { value: data });
      el.dispatchEvent(event);
    },
    { selector: target.editorSelector, text: flavors.text, html: flavors.html },
  );
  await page.waitForTimeout(150);
}

async function pastePlainText(page: Page, target: DemoTarget, text: string): Promise<void> {
  await paste(page, target, { text });
}

async function writeClipboard(page: Page, flavors: { text: string; html: string }): Promise<void> {
  await page.evaluate(async ({ text, html }) => {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/plain': new Blob([text], { type: 'text/plain' }),
        'text/html': new Blob([html], { type: 'text/html' }),
      }),
    ]);
  }, flavors);
}

/** Focus a known document position, the document end, or the entire document. */
async function focusEditor(page: Page, position: string | number = 'end'): Promise<void> {
  await page.evaluate((position) => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | { commands: { focus: (position: string | number) => void } }
      | undefined;
    ed?.commands.focus(position);
  }, position);
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

    for (const lines of ['divs', 'br'] as const) {
      test(`pasting highlighted Markdown source with ${lines} converts the README`, async ({ page }) => {
        await paste(page, target, { text: README_MARKDOWN, html: sourceHTML(README_MARKDOWN, lines) });
        await expectREADME(page, target);
      });
    }

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

    test('pasting highlighted Markdown source inside a code block stays literal', async ({ page }) => {
      await setContent(page, '<pre><code>start\n</code></pre>');
      await focusEditor(page, 7);
      await paste(page, target, { text: README_MARKDOWN, html: sourceHTML(README_MARKDOWN, 'divs') }, { click: false });
      const editor = page.locator(target.editorSelector);
      await expect.poll(() => editor.locator('pre code').textContent()).toBe('start\n' + README_MARKDOWN);
      await expect(editor.locator('h1, h2, ul, table')).toHaveCount(0);
    });

    test('pasting a bare URL still becomes a link, not markdown', async ({ page }) => {
      await pastePlainText(page, target, 'https://example.com/x');
      const editor = page.locator(target.editorSelector);
      await expect(editor.locator('a[href="https://example.com/x"]')).toHaveCount(1);
    });

    test('pastes with a rich HTML flavor are left to the default handling', async ({ page }) => {
      await paste(page, target, {
        text: '# md text',
        html: '<p><em>html wins</em></p>',
      });
      const editor = page.locator(target.editorSelector);
      await expect(editor.locator('em')).toContainText('html wins');
      await expect(editor.locator('h1')).toHaveCount(0);
    });

    test('rich HTML matching Markdown-looking plain text keeps its formatting', async ({ page }) => {
      await paste(page, target, {
        text: '# Keep this literal',
        html: '<p><strong># Keep</strong> <em>this literal</em></p>',
      });
      const editor = page.locator(target.editorSelector);
      await expect(editor.locator('p')).toHaveText('# Keep this literal');
      await expect(editor.locator('strong')).toHaveText('# Keep');
      await expect(editor.locator('em')).toHaveText('this literal');
      await expect(editor.locator('h1')).toHaveCount(0);
    });

    test('single-paragraph markdown pastes merge inline into existing text', async ({ page }) => {
      await setContent(page, '<p>keep:</p>');
      await focusEditor(page);
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
      await focusEditor(page);
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

test.describe('native Markdown clipboard', () => {
  // Browser clipboard contents are shared, so native copy/paste tests run serially.
  test.describe.configure({ mode: 'default' });

  for (const target of demoTargets) {
    test.describe(`${target.name} - markdown clipboard`, () => {
      test.beforeEach(async ({ page, context, browserName }) => {
        test.skip(browserName !== 'chromium', 'Native ClipboardItem permissions are Chromium-only.');
        await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: target.baseURL });
        await goNotion(page, target);
        await setContent(page, '<p></p>');
      });

      test('pasting a source-editor README through the browser clipboard converts and undoes in one step', async ({ page }) => {
        await writeClipboard(page, { text: README_MARKDOWN, html: sourceHTML(README_MARKDOWN, 'divs') });
        await focusEditor(page);
        await page.keyboard.press('ControlOrMeta+v');
        await expectREADME(page, target);

        await page.keyboard.press('ControlOrMeta+z');
        const editor = page.locator(target.editorSelector);
        await expect(editor.locator('h1, h2, ul, table, pre')).toHaveCount(0);
        await expect(editor).toHaveText('');
      });

      test('a code block copied from the editor is not reparsed as Markdown', async ({ page }) => {
        const code = '# Keep as code\n\n- literal list';
        await setContent(page, `<pre><code class="language-markdown">${escapeHTML(code)}</code></pre>`);
        await focusEditor(page, 'all');
        await page.keyboard.press('ControlOrMeta+c');
        const copiedHTML = await page.evaluate(async () => {
          for (const item of await navigator.clipboard.read()) {
            if (item.types.includes('text/html')) return (await item.getType('text/html')).text();
          }
          throw new Error('The editor copy did not put HTML on the clipboard');
        });
        expect(copiedHTML).toContain('data-pm-slice');
        expect(copiedHTML).toContain('<pre');

        await setContent(page, '<p></p>');
        await focusEditor(page);
        await page.keyboard.press('ControlOrMeta+v');
        const editor = page.locator(target.editorSelector);
        await expect(editor.locator('pre code.language-markdown')).toHaveText(code);
        await expect(editor.locator('h1, ul')).toHaveCount(0);
      });
    });
  }
});
