import { test, expect, type Page } from '@playwright/test';

const editorSelector = 'domternal-editor .ProseMirror';
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
const emojiNodeSelector = `${editorSelector} span[data-type="emoji"]`;

/**
 * Sets editor content via the Editor API (Angular component).
 * Direct innerHTML doesn't trigger ProseMirror node creation properly.
 */
async function setEditorContent(page: Page, html: string) {
  await page.evaluate((h) => {
    const el = document.querySelector('domternal-editor');
    const ng = (window as any).ng;
    const comp = ng?.getComponent?.(el);
    if (comp?.editor) {
      comp.editor.setContent(h, false);
      comp.editor.commands.focus();
    }
  }, html);
  await page.waitForTimeout(150);
}

async function getEditorHTML(page: Page): Promise<string> {
  return page.locator(editorSelector).innerHTML();
}

/** Clears editor and types text. */
async function clearAndType(page: Page, text: string) {
  const editor = page.locator(editorSelector);
  await editor.click();
  await page.keyboard.press(`${modifier}+a`);
  await page.keyboard.press('Backspace');
  await page.keyboard.type(text);
}

/** Checks if the current ProseMirror selection is a NodeSelection on an emoji node. */
async function isEmojiNodeSelected(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const el = document.querySelector('domternal-editor');
    const ng = (window as any).ng;
    const comp = ng?.getComponent?.(el);
    if (!comp?.editor) return false;
    const sel = comp.editor.state.selection;
    // NodeSelection has a `node` property
    return !!sel.node && sel.node.type.name === 'emoji';
  });
}

/** Gets the name attribute of the currently selected emoji node (if any). */
async function getSelectedEmojiName(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const el = document.querySelector('domternal-editor');
    const ng = (window as any).ng;
    const comp = ng?.getComponent?.(el);
    if (!comp?.editor) return null;
    const sel = comp.editor.state.selection;
    if (!sel.node || sel.node.type.name !== 'emoji') return null;
    return sel.node.attrs.name as string;
  });
}

// Emoji HTML fixture: use full `name` (not shortcode) to match the dataset.
// The shortcode "grinning" maps to name "grinning_face", "heart" → "red_heart", etc.
const EMOJI_HTML = '<p>Hello <span data-type="emoji" data-name="grinning_face">😀</span> world</p>';
const TWO_EMOJIS = '<p>A <span data-type="emoji" data-name="grinning_face">😀</span> B <span data-type="emoji" data-name="red_heart">❤️</span> C</p>';
const EMOJI_ONLY = '<p><span data-type="emoji" data-name="grinning_face_with_smiling_eyes">😄</span></p>';
const EMOJI_START = '<p><span data-type="emoji" data-name="waving_hand">👋</span> Hello</p>';
const EMOJI_END = '<p>Bye <span data-type="emoji" data-name="waving_hand">👋</span></p>';

// =============================================================================
// Click to select
// =============================================================================

test.describe('Inline Emoji — click to select', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('clicking an inline emoji creates a NodeSelection', async ({ page }) => {
    await setEditorContent(page, EMOJI_HTML);
    const emojiSpan = page.locator(emojiNodeSelector).first();
    await expect(emojiSpan).toBeVisible();

    await emojiSpan.click();
    await page.waitForTimeout(100);

    const selected = await isEmojiNodeSelected(page);
    expect(selected).toBe(true);
  });

  test('clicking selects the correct emoji by name', async ({ page }) => {
    await setEditorContent(page, TWO_EMOJIS);
    const emojis = page.locator(emojiNodeSelector);
    await expect(emojis).toHaveCount(2);

    // Click first emoji
    await emojis.first().click();
    await page.waitForTimeout(100);
    expect(await getSelectedEmojiName(page)).toBe('grinning_face');

    // Click second emoji
    await emojis.nth(1).click();
    await page.waitForTimeout(100);
    expect(await getSelectedEmojiName(page)).toBe('red_heart');
  });

  test('clicking text after emoji deselects the emoji', async ({ page }) => {
    await setEditorContent(page, EMOJI_HTML);
    const emojiSpan = page.locator(emojiNodeSelector).first();
    await emojiSpan.click();
    await page.waitForTimeout(100);
    expect(await isEmojiNodeSelected(page)).toBe(true);

    // Click on text area
    await page.locator(`${editorSelector} p`).first().click({ position: { x: 5, y: 5 } });
    await page.waitForTimeout(100);
    expect(await isEmojiNodeSelected(page)).toBe(false);
  });

  test('emoji inserted via input rule can be clicked', async ({ page }) => {
    await clearAndType(page, 'Hello ');
    await page.keyboard.type(':grinning:');
    await page.waitForTimeout(200);

    const emojiSpan = page.locator(emojiNodeSelector).first();
    await expect(emojiSpan).toBeVisible();

    await emojiSpan.click();
    await page.waitForTimeout(100);
    expect(await isEmojiNodeSelected(page)).toBe(true);
  });
});

// =============================================================================
// Keyboard navigation
// =============================================================================

test.describe('Inline Emoji — keyboard navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('ArrowRight from before emoji selects the emoji', async ({ page }) => {
    await setEditorContent(page, EMOJI_HTML);
    // Place cursor after "Hello "
    await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      if (comp?.editor) {
        // "Hello " = 6 chars, node starts at offset 7 (after paragraph open)
        const { tr } = comp.editor.state;
        const pos = 7; // right before the emoji node
        tr.setSelection(comp.editor.state.selection.constructor.near(comp.editor.state.doc.resolve(pos), 1));
        comp.editor.view.dispatch(tr);
      }
    });
    await page.waitForTimeout(100);

    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(100);
    expect(await isEmojiNodeSelected(page)).toBe(true);
  });

  test('ArrowLeft from after emoji selects the emoji', async ({ page }) => {
    await setEditorContent(page, EMOJI_HTML);
    // Place cursor after the emoji node
    await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      if (comp?.editor) {
        const { tr } = comp.editor.state;
        const pos = 8; // right after the emoji node
        tr.setSelection(comp.editor.state.selection.constructor.near(comp.editor.state.doc.resolve(pos), 1));
        comp.editor.view.dispatch(tr);
      }
    });
    await page.waitForTimeout(100);

    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(100);
    expect(await isEmojiNodeSelected(page)).toBe(true);
  });

  test('ArrowRight past selected emoji moves cursor after it', async ({ page }) => {
    await setEditorContent(page, EMOJI_HTML);
    const emojiSpan = page.locator(emojiNodeSelector).first();
    await emojiSpan.click();
    await page.waitForTimeout(100);
    expect(await isEmojiNodeSelected(page)).toBe(true);

    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(100);
    expect(await isEmojiNodeSelected(page)).toBe(false);
  });

  test('ArrowLeft past selected emoji moves cursor before it', async ({ page }) => {
    await setEditorContent(page, EMOJI_HTML);
    const emojiSpan = page.locator(emojiNodeSelector).first();
    await emojiSpan.click();
    await page.waitForTimeout(100);
    expect(await isEmojiNodeSelected(page)).toBe(true);

    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(100);
    expect(await isEmojiNodeSelected(page)).toBe(false);
  });
});

// =============================================================================
// Delete / Backspace
// =============================================================================

test.describe('Inline Emoji — delete', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('Backspace removes a selected emoji', async ({ page }) => {
    await setEditorContent(page, EMOJI_HTML);
    const emojiSpan = page.locator(emojiNodeSelector).first();
    await emojiSpan.click();
    await page.waitForTimeout(100);
    expect(await isEmojiNodeSelected(page)).toBe(true);

    await page.keyboard.press('Backspace');
    await page.waitForTimeout(100);

    await expect(page.locator(emojiNodeSelector)).toHaveCount(0);
    const html = await getEditorHTML(page);
    expect(html).toContain('Hello');
    expect(html).toContain('world');
  });

  test('Delete removes a selected emoji', async ({ page }) => {
    await setEditorContent(page, EMOJI_HTML);
    const emojiSpan = page.locator(emojiNodeSelector).first();
    await emojiSpan.click();
    await page.waitForTimeout(100);

    await page.keyboard.press('Delete');
    await page.waitForTimeout(100);

    await expect(page.locator(emojiNodeSelector)).toHaveCount(0);
  });

  test('typing replaces a selected emoji', async ({ page }) => {
    await setEditorContent(page, EMOJI_HTML);
    const emojiSpan = page.locator(emojiNodeSelector).first();
    await emojiSpan.click();
    await page.waitForTimeout(100);

    await page.keyboard.type('X');
    await page.waitForTimeout(100);

    await expect(page.locator(emojiNodeSelector)).toHaveCount(0);
    const text = (await page.locator(editorSelector).textContent()) ?? '';
    expect(text).toContain('Hello');
    expect(text).toContain('X');
    expect(text).toContain('world');
  });

  test('undo after deleting emoji restores it', async ({ page }) => {
    await setEditorContent(page, EMOJI_HTML);
    const emojiSpan = page.locator(emojiNodeSelector).first();
    await emojiSpan.click();
    await page.waitForTimeout(100);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(100);
    await expect(page.locator(emojiNodeSelector)).toHaveCount(0);

    await page.keyboard.press(`${modifier}+z`);
    await page.waitForTimeout(200);

    await expect(page.locator(emojiNodeSelector)).toHaveCount(1);
  });
});

// =============================================================================
// Rendering
// =============================================================================

test.describe('Inline Emoji — rendering', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('emoji renders with data-type="emoji" attribute', async ({ page }) => {
    await setEditorContent(page, EMOJI_HTML);
    const emojiSpan = page.locator(emojiNodeSelector).first();
    await expect(emojiSpan).toHaveAttribute('data-type', 'emoji');
  });

  test('emoji renders with data-name attribute', async ({ page }) => {
    await setEditorContent(page, EMOJI_HTML);
    const emojiSpan = page.locator(emojiNodeSelector).first();
    await expect(emojiSpan).toHaveAttribute('data-name', 'grinning_face');
  });

  test('emoji renders the correct character', async ({ page }) => {
    await setEditorContent(page, EMOJI_HTML);
    const emojiSpan = page.locator(emojiNodeSelector).first();
    const text = await emojiSpan.textContent();
    expect(text).toBe('😀');
  });

  test('emoji is rendered inline within text', async ({ page }) => {
    await setEditorContent(page, EMOJI_HTML);
    const text = (await page.locator(`${editorSelector} p`).first().textContent()) ?? '';
    expect(text).toContain('Hello');
    expect(text).toContain('😀');
    expect(text).toContain('world');
  });

  test('multiple emojis render correctly', async ({ page }) => {
    await setEditorContent(page, TWO_EMOJIS);
    const emojis = page.locator(emojiNodeSelector);
    await expect(emojis).toHaveCount(2);
    await expect(emojis.first()).toHaveAttribute('data-name', 'grinning_face');
    await expect(emojis.nth(1)).toHaveAttribute('data-name', 'red_heart');
  });

  test('emoji at start of paragraph renders correctly', async ({ page }) => {
    await setEditorContent(page, EMOJI_START);
    const emojiSpan = page.locator(emojiNodeSelector).first();
    await expect(emojiSpan).toBeVisible();
    const text = (await page.locator(`${editorSelector} p`).first().textContent()) ?? '';
    expect(text).toContain('Hello');
  });

  test('emoji at end of paragraph renders correctly', async ({ page }) => {
    await setEditorContent(page, EMOJI_END);
    const emojiSpan = page.locator(emojiNodeSelector).first();
    await expect(emojiSpan).toBeVisible();
    const text = (await page.locator(`${editorSelector} p`).first().textContent()) ?? '';
    expect(text).toContain('Bye');
  });
});

// =============================================================================
// HTML output
// =============================================================================

test.describe('Inline Emoji — HTML output', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('emoji output contains data-type and data-name', async ({ page }) => {
    await setEditorContent(page, EMOJI_HTML);
    const output = page.locator('pre.output');
    const html = (await output.textContent()) ?? '';
    expect(html).toContain('data-type="emoji"');
    expect(html).toContain('data-name="grinning_face"');
  });

  test('emoji output contains the emoji character', async ({ page }) => {
    await setEditorContent(page, EMOJI_HTML);
    const output = page.locator('pre.output');
    const html = (await output.textContent()) ?? '';
    expect(html).toContain('😀');
  });

  test('output preserves surrounding text', async ({ page }) => {
    await setEditorContent(page, EMOJI_HTML);
    const output = page.locator('pre.output');
    const html = (await output.textContent()) ?? '';
    expect(html).toContain('Hello');
    expect(html).toContain('world');
  });
});

// =============================================================================
// Input rule
// =============================================================================

test.describe('Inline Emoji — input rules', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test(':grinning: input rule inserts emoji node', async ({ page }) => {
    await clearAndType(page, ':grinning:');
    await page.waitForTimeout(200);

    const emojiSpan = page.locator(emojiNodeSelector);
    await expect(emojiSpan).toHaveCount(1);
    await expect(emojiSpan.first()).toHaveAttribute('data-name', 'grinning_face');
  });

  test(':heart: input rule inserts heart emoji', async ({ page }) => {
    await clearAndType(page, ':heart:');
    await page.waitForTimeout(200);

    const emojiSpan = page.locator(emojiNodeSelector);
    await expect(emojiSpan).toHaveCount(1);
    await expect(emojiSpan.first()).toHaveAttribute('data-name', 'red_heart');
  });

  test('typing text then :emoji: inserts correctly inline', async ({ page }) => {
    await clearAndType(page, 'Hello :smile:');
    await page.waitForTimeout(200);

    const text = (await page.locator(`${editorSelector} p`).first().textContent()) ?? '';
    expect(text).toContain('Hello');
    const emojiSpan = page.locator(emojiNodeSelector);
    await expect(emojiSpan).toHaveCount(1);
  });

  test('multiple shortcodes in sequence create multiple emojis', async ({ page }) => {
    await clearAndType(page, ':grinning: :heart:');
    await page.waitForTimeout(200);

    const emojis = page.locator(emojiNodeSelector);
    await expect(emojis).toHaveCount(2);
  });
});

// =============================================================================
// Edge cases
// =============================================================================

test.describe('Inline Emoji — edge cases', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('solo emoji in paragraph can be selected', async ({ page }) => {
    await setEditorContent(page, EMOJI_ONLY);
    const emojiSpan = page.locator(emojiNodeSelector).first();
    await expect(emojiSpan).toBeVisible();

    await emojiSpan.click();
    await page.waitForTimeout(100);
    expect(await isEmojiNodeSelected(page)).toBe(true);
  });

  test('emoji at start of paragraph can be selected', async ({ page }) => {
    await setEditorContent(page, EMOJI_START);
    const emojiSpan = page.locator(emojiNodeSelector).first();
    await emojiSpan.click();
    await page.waitForTimeout(100);
    expect(await isEmojiNodeSelected(page)).toBe(true);
  });

  test('emoji at end of paragraph can be selected', async ({ page }) => {
    await setEditorContent(page, EMOJI_END);
    const emojiSpan = page.locator(emojiNodeSelector).first();
    await emojiSpan.click();
    await page.waitForTimeout(100);
    expect(await isEmojiNodeSelected(page)).toBe(true);
  });

  test('select-all includes emoji nodes', async ({ page }) => {
    await setEditorContent(page, EMOJI_HTML);
    await page.locator(editorSelector).click();
    await page.keyboard.press(`${modifier}+a`);
    await page.waitForTimeout(100);

    const html = await getEditorHTML(page);
    expect(html).toContain('data-type="emoji"');
  });

  test('copy-paste preserves emoji', async ({ page }) => {
    await setEditorContent(page, EMOJI_HTML);
    await page.locator(editorSelector).click();
    await page.keyboard.press(`${modifier}+a`);
    await page.keyboard.press(`${modifier}+c`);

    // Clear and paste
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(100);
    await page.keyboard.press(`${modifier}+v`);
    await page.waitForTimeout(200);

    const html = await getEditorHTML(page);
    expect(html).toContain('data-type="emoji"');
    expect(html).toContain('data-name="grinning_face"');
  });
});
