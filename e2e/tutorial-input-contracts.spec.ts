import { expect, type Page } from '@playwright/test';
import { test } from './fixtures.js';
import type {} from './fixtures/tutorial-menus/main.js';

const FIXTURE = 'http://127.0.0.1:5793/tutorial-menus/';

async function open(page: Page): Promise<void> {
  await page.goto(FIXTURE);
  await page.waitForFunction(() => Boolean(window.__TUTORIAL_MENUS__));
}

test('lowercase explicit Shift bindings execute while toolbar hints remain display only', async ({ page }) => {
  await open(page);
  await page.evaluate(() => { window.__TUTORIAL_MENUS__.seed('<p>unchanged</p>'); });
  const editable = page.locator('#editor .ProseMirror');
  await expect(editable).toBeFocused();
  await page.keyboard.press('ControlOrMeta+Shift+d');
  await expect(page.locator('#shortcut-result')).toHaveText('1');
  await page.keyboard.press('F9');
  await expect(editable).toHaveText('unchanged');
  const button = page.getByRole('button', { name: 'Display only shortcut', exact: true });
  await expect(button).toHaveAttribute('title', 'Display only shortcut (F9)');
  await button.click();
  await expect(editable).toHaveText('buttonunchanged');
});

test('literal insertion replaces inline text while parsed insertion preserves block semantics', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const { editor, seed } = window.__TUTORIAL_MENUS__;
    seed('<p><strong>aReplaceb</strong></p>', 2, 9);
    editor.chain().focus().insertText('<b>&amp;\nnext</b>').run();
  });
  const editable = page.locator('#editor .ProseMirror');
  await expect(editable.locator(':scope > p')).toHaveCount(1);
  await expect(editable.locator('strong')).toHaveText('a<b>&amp;\nnext</b>b');
  await expect(editable.locator('b')).toHaveCount(0);
  await page.keyboard.type('!');
  await expect(editable.locator('strong')).toHaveText('a<b>&amp;\nnext</b>!b');

  await page.evaluate(() => {
    const { editor, seed } = window.__TUTORIAL_MENUS__;
    seed('<p>ab</p>', 2);
    editor.chain().focus().insertContent('<strong>X &amp; Y</strong>').run();
  });
  await expect(editable.locator(':scope > p')).toHaveText(['a', 'X & Y', 'b']);
  await expect(editable.locator('strong')).toHaveText('X & Y');
});

test('mention and math HTML round trips preserve identity and escaping across attribute order', async ({ page }) => {
  await open(page);
  const result = await page.evaluate(() => {
    const { editor, seed } = window.__TUTORIAL_MENUS__;
    const attributes = {
      'data-id': 'user"&<42>', 'data-label': 'A & <B> "C"',
      'data-type': 'mention', 'data-mention-type': 'user',
    };
    const mention = document.createElement('span');
    for (const [name, value] of Object.entries(attributes)) mention.setAttribute(name, value);
    mention.textContent = '@A & <B> "C"';
    const inline = document.createElement('span');
    inline.setAttribute('data-latex', 'x < y & z > "q"');
    inline.setAttribute('data-type', 'math-inline');
    const block = document.createElement('div');
    block.setAttribute('data-latex', 'a & b < c');
    block.setAttribute('data-type', 'math-block');
    seed(`<p>${mention.outerHTML}${inline.outerHTML}</p>${block.outerHTML}`);
    const before = editor.getJSON();
    const serialized = document.createElement('div');
    serialized.innerHTML = editor.getHTML();
    const outputMention = serialized.querySelector('[data-type="mention"]');
    const outputInline = serialized.querySelector('[data-type="math-inline"]');
    const outputBlock = serialized.querySelector('[data-type="math-block"]');
    const semantic = {
      mention: Object.fromEntries(Object.keys(attributes).map(name => [name, outputMention?.getAttribute(name)])),
      inlineLatex: outputInline?.getAttribute('data-latex'),
      blockLatex: outputBlock?.getAttribute('data-latex'),
      injectedElements: serialized.querySelectorAll('script, img, b').length,
    };
    for (const element of serialized.querySelectorAll('*')) {
      const attrs = Array.from(element.attributes).reverse().map(attr => [attr.name, attr.value] as const);
      for (const [name] of attrs) element.removeAttribute(name);
      for (const [name, value] of attrs) element.setAttribute(name, value);
    }
    editor.setContent(serialized.innerHTML, false);
    return { before, after: editor.getJSON(), semantic, expectedAttributes: attributes };
  });
  expect(result.after).toEqual(result.before);
  expect(result.semantic).toEqual({
    mention: result.expectedAttributes,
    inlineLatex: 'x < y & z > "q"',
    blockLatex: 'a & b < c',
    injectedElements: 0,
  });
});
