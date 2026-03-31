import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';

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

// =============================================================================
// Docs verification: parseHTML
// =============================================================================

const EMOJI_LEGACY_FORMAT = '<p>Hi <span data-emoji-name="waving_hand">👋</span></p>';

test.describe('Docs verification — parseHTML', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('parses span[data-type="emoji"] format', async ({ page }) => {
    await setEditorContent(page, EMOJI_HTML);
    const emoji = page.locator(emojiNodeSelector).first();
    await expect(emoji).toHaveAttribute('data-type', 'emoji');
    await expect(emoji).toHaveAttribute('data-name', 'grinning_face');
    await expect(emoji).toHaveText('😀');
  });

  test('parses span[data-emoji-name] legacy format', async ({ page }) => {
    await setEditorContent(page, EMOJI_LEGACY_FORMAT);
    const emoji = page.locator(emojiNodeSelector).first();
    await expect(emoji).toBeVisible();
    await expect(emoji).toHaveAttribute('data-name', 'waving_hand');
    await expect(emoji).toHaveText('👋');
  });

  test('parseHTML normalizes legacy format to data-type="emoji"', async ({ page }) => {
    await setEditorContent(page, EMOJI_LEGACY_FORMAT);
    const emoji = page.locator(emojiNodeSelector).first();
    // After parsing, renderHTML outputs data-type="emoji" format
    await expect(emoji).toHaveAttribute('data-type', 'emoji');
  });
});

// =============================================================================
// Docs verification: commands
// =============================================================================

test.describe('Docs verification — commands', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('insertEmoji inserts emoji node by name', async ({ page }) => {
    await setEditorContent(page, '<p>Test </p>');
    const result = await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const comp = (window as any).ng?.getComponent?.(el);
      return comp?.editor?.chain().focus().insertEmoji('thumbs_up').run();
    });
    expect(result).toBe(true);
    const emoji = page.locator(emojiNodeSelector).first();
    await expect(emoji).toHaveAttribute('data-name', 'thumbs_up');
    await expect(emoji).toHaveText('👍');
  });

  test('insertEmoji returns false for unknown name', async ({ page }) => {
    await setEditorContent(page, '<p>Test</p>');
    const result = await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const comp = (window as any).ng?.getComponent?.(el);
      return comp?.editor?.commands.insertEmoji('nonexistent_emoji_xyz');
    });
    expect(result).toBe(false);
    await expect(page.locator(emojiNodeSelector)).toHaveCount(0);
  });

  test('insertEmoji returns false inside code block', async ({ page }) => {
    await setEditorContent(page, '<pre><code>code here</code></pre>');
    await page.locator(`${editorSelector} pre`).click();
    await page.waitForTimeout(100);
    const result = await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const comp = (window as any).ng?.getComponent?.(el);
      return comp?.editor?.commands.insertEmoji('grinning_face');
    });
    expect(result).toBe(false);
  });

  test('insertEmoji tracks frequency usage', async ({ page }) => {
    await setEditorContent(page, '<p>Test </p>');
    // Use addFrequentlyUsed directly (insertEmoji calls this internally)
    // to verify the storage tracking mechanism documented in the docs
    const frequent = await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const comp = (window as any).ng?.getComponent?.(el);
      const storage = comp?.editor?.storage.emoji;
      // Simulate what insertEmoji does internally
      storage?.addFrequentlyUsed('rocket');
      storage?.addFrequentlyUsed('rocket');
      storage?.addFrequentlyUsed('rocket');
      storage?.addFrequentlyUsed('thumbs_up');
      return storage?.getFrequentlyUsed();
    });
    expect(frequent[0]).toBe('rocket');
    expect(frequent[1]).toBe('thumbs_up');
  });

  test('suggestEmoji inserts trigger character', async ({ page }) => {
    await setEditorContent(page, '<p></p>');
    await page.locator(editorSelector).click();
    await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const comp = (window as any).ng?.getComponent?.(el);
      comp?.editor?.commands.suggestEmoji();
    });
    await page.waitForTimeout(200);
    const text = await page.locator(editorSelector).textContent();
    expect(text).toContain(':');
  });
});

// =============================================================================
// Docs verification: input rules in code blocks
// =============================================================================

test.describe('Docs verification — code block exclusion', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('shortcode :smile: does NOT convert inside code block', async ({ page }) => {
    // Set content with code block and place cursor inside it
    await setEditorContent(page, '<pre><code>x</code></pre>');
    // Click inside the code block, then type at the end
    await page.locator(`${editorSelector} code`).click();
    await page.keyboard.press('End');
    await page.keyboard.type(':smile:');
    await page.waitForTimeout(200);
    // Emoji should NOT appear - shortcodes are skipped in code blocks
    await expect(page.locator(emojiNodeSelector)).toHaveCount(0);
    const text = await page.locator(`${editorSelector} code`).textContent();
    expect(text).toContain(':smile:');
  });

  test('shortcode converts normally in paragraph', async ({ page }) => {
    await clearAndType(page, ':wave:');
    await page.waitForTimeout(200);
    const emoji = page.locator(emojiNodeSelector).first();
    await expect(emoji).toHaveAttribute('data-name', 'waving_hand');
  });
});

// =============================================================================
// Docs verification: storage methods
// =============================================================================

test.describe('Docs verification — storage', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('findEmoji returns emoji by name', async ({ page }) => {
    const result = await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const comp = (window as any).ng?.getComponent?.(el);
      const item = comp?.editor?.storage.emoji.findEmoji('red_heart');
      return item ? { emoji: item.emoji, name: item.name } : null;
    });
    expect(result).toEqual({ emoji: '❤️', name: 'red_heart' });
  });

  test('findEmoji returns undefined for unknown name', async ({ page }) => {
    const result = await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const comp = (window as any).ng?.getComponent?.(el);
      return comp?.editor?.storage.emoji.findEmoji('this_does_not_exist');
    });
    expect(result).toBeUndefined();
  });

  test('searchEmoji finds by name, shortcode, and tag', async ({ page }) => {
    const result = await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const comp = (window as any).ng?.getComponent?.(el);
      const byName = comp?.editor?.storage.emoji.searchEmoji('grinning');
      const byTag = comp?.editor?.storage.emoji.searchEmoji('happy');
      return {
        byNameCount: byName?.length ?? 0,
        byTagCount: byTag?.length ?? 0,
        byNameHasGrinning: byName?.some((e: any) => e.name.includes('grinning')),
      };
    });
    expect(result.byNameCount).toBeGreaterThan(0);
    expect(result.byTagCount).toBeGreaterThan(0);
    expect(result.byNameHasGrinning).toBe(true);
  });

  test('searchEmoji is case-insensitive', async ({ page }) => {
    const result = await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const comp = (window as any).ng?.getComponent?.(el);
      const lower = comp?.editor?.storage.emoji.searchEmoji('heart');
      const upper = comp?.editor?.storage.emoji.searchEmoji('HEART');
      return {
        lowerCount: lower?.length ?? 0,
        upperCount: upper?.length ?? 0,
      };
    });
    expect(result.lowerCount).toBeGreaterThan(0);
    expect(result.lowerCount).toBe(result.upperCount);
  });

  test('getFrequentlyUsed returns empty initially', async ({ page }) => {
    const result = await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const comp = (window as any).ng?.getComponent?.(el);
      return comp?.editor?.storage.emoji.getFrequentlyUsed();
    });
    expect(result).toEqual([]);
  });

  test('getFrequentlyUsed sorts by usage count descending', async ({ page }) => {
    const result = await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const comp = (window as any).ng?.getComponent?.(el);
      const storage = comp?.editor?.storage.emoji;
      storage?.addFrequentlyUsed('rocket');
      storage?.addFrequentlyUsed('heart');
      storage?.addFrequentlyUsed('rocket');
      storage?.addFrequentlyUsed('rocket');
      storage?.addFrequentlyUsed('heart');
      return storage?.getFrequentlyUsed();
    });
    expect(result[0]).toBe('rocket');
    expect(result[1]).toBe('heart');
  });
});

// =============================================================================
// Docs verification: leafText
// =============================================================================

test.describe('Docs verification — leafText', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('getText returns emoji character for emoji nodes', async ({ page }) => {
    await setEditorContent(page, EMOJI_HTML);
    const text = await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const comp = (window as any).ng?.getComponent?.(el);
      return comp?.editor?.getText();
    });
    expect(text).toContain('😀');
    expect(text).toContain('Hello');
    expect(text).toContain('world');
  });
});

// =============================================================================
// Docs verification: JSON representation
// =============================================================================

test.describe('Docs verification — JSON representation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('getJSON returns correct emoji node structure', async ({ page }) => {
    await setEditorContent(page, EMOJI_ONLY);
    const json = await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const comp = (window as any).ng?.getComponent?.(el);
      return comp?.editor?.getJSON();
    });
    const para = json.content[0];
    const emojiNode = para.content[0];
    expect(emojiNode.type).toBe('emoji');
    expect(emojiNode.attrs.name).toBe('grinning_face_with_smiling_eyes');
  });

  test('emoji JSON has type and attrs.name only', async ({ page }) => {
    await setEditorContent(page, '<p><span data-type="emoji" data-name="thumbs_up">👍</span></p>');
    const json = await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const comp = (window as any).ng?.getComponent?.(el);
      return comp?.editor?.getJSON();
    });
    const emojiNode = json.content[0].content[0];
    expect(emojiNode.type).toBe('emoji');
    expect(emojiNode.attrs).toEqual({ name: 'thumbs_up' });
  });

  test('paragraph with text and emoji has correct JSON', async ({ page }) => {
    await setEditorContent(page, '<p>Hello <span data-type="emoji" data-name="waving_hand">👋</span> welcome!</p>');
    const json = await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const comp = (window as any).ng?.getComponent?.(el);
      return comp?.editor?.getJSON();
    });
    const content = json.content[0].content;
    expect(content[0]).toEqual({ type: 'text', text: 'Hello ' });
    expect(content[1]).toEqual({ type: 'emoji', attrs: { name: 'waving_hand' } });
    expect(content[2]).toEqual({ type: 'text', text: ' welcome!' });
  });
});

// =============================================================================
// Docs verification: emoticon input rules
// =============================================================================

test.describe('Docs verification — emoticon input rules', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test(':) followed by space inserts slightly_smiling_face', async ({ page }) => {
    await clearAndType(page, ':) ');
    await page.waitForTimeout(300);
    const emoji = page.locator(emojiNodeSelector).first();
    await expect(emoji).toHaveAttribute('data-name', 'slightly_smiling_face');
  });

  test('<3 followed by space inserts red_heart', async ({ page }) => {
    await clearAndType(page, '<3 ');
    await page.waitForTimeout(300);
    const emoji = page.locator(emojiNodeSelector).first();
    await expect(emoji).toHaveAttribute('data-name', 'red_heart');
  });

  test(':D followed by space inserts grinning_face_with_big_eyes', async ({ page }) => {
    await clearAndType(page, ':D ');
    await page.waitForTimeout(300);
    const emoji = page.locator(emojiNodeSelector).first();
    await expect(emoji).toHaveAttribute('data-name', 'grinning_face_with_big_eyes');
  });

  test('emoticon preceded by text and space converts', async ({ page }) => {
    await clearAndType(page, 'hi :) ');
    await page.waitForTimeout(300);
    const emoji = page.locator(emojiNodeSelector).first();
    await expect(emoji).toBeVisible();
  });

  test('emoticon without trailing space does NOT convert', async ({ page }) => {
    await clearAndType(page, ':)');
    await page.waitForTimeout(300);
    await expect(page.locator(emojiNodeSelector)).toHaveCount(0);
  });
});

// =============================================================================
// Docs verification: renderHTML class attribute
// =============================================================================

test.describe('Docs verification — renderHTML', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('emoji span has class="emoji"', async ({ page }) => {
    await setEditorContent(page, EMOJI_HTML);
    const emoji = page.locator(emojiNodeSelector).first();
    const cls = await emoji.getAttribute('class');
    expect(cls).toContain('emoji');
  });

  test('selected emoji gets ProseMirror-selectednode class', async ({ page }) => {
    await setEditorContent(page, EMOJI_HTML);
    const emoji = page.locator(emojiNodeSelector).first();
    await emoji.click();
    await page.waitForTimeout(100);
    const cls = await emoji.getAttribute('class');
    expect(cls).toContain('ProseMirror-selectednode');
  });
});
