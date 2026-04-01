import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';

const editorSelector = 'domternal-editor .ProseMirror';
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
const mentionNodeSelector = `${editorSelector} span[data-type="mention"]`;
const suggestionSelector = '.dm-mention-suggestion';
const suggestionItemSelector = `${suggestionSelector} .dm-mention-suggestion-item`;
const suggestionEmptySelector = `${suggestionSelector} .dm-mention-suggestion-empty`;
const decorationSelector = `${editorSelector} span.mention-suggestion`;

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

async function clearAndType(page: Page, text: string) {
  const editor = page.locator(editorSelector);
  await editor.click();
  await page.keyboard.press(`${modifier}+a`);
  await page.keyboard.press('Backspace');
  await page.keyboard.type(text);
}

async function getEditorJSON(page: Page): Promise<any> {
  return page.evaluate(() => {
    const el = document.querySelector('domternal-editor');
    const ng = (window as any).ng;
    const comp = ng?.getComponent?.(el);
    return comp?.editor?.getJSON();
  });
}

async function getEditorText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.querySelector('domternal-editor');
    const ng = (window as any).ng;
    const comp = ng?.getComponent?.(el);
    return comp?.editor?.getText() ?? '';
  });
}

async function runCommand(page: Page, command: string): Promise<boolean> {
  return page.evaluate((cmd) => {
    const el = document.querySelector('domternal-editor');
    const ng = (window as any).ng;
    const comp = ng?.getComponent?.(el);
    if (!comp?.editor) return false;
    const fn = new Function('editor', `return editor.commands.${cmd}`);
    return fn(comp.editor) as boolean;
  }, command);
}

async function runChain(page: Page, chain: string): Promise<void> {
  await page.evaluate((cmd) => {
    const el = document.querySelector('domternal-editor');
    const ng = (window as any).ng;
    const comp = ng?.getComponent?.(el);
    if (comp?.editor) {
      const fn = new Function('editor', `return editor.chain().focus().${cmd}.run()`);
      fn(comp.editor);
    }
  }, chain);
}

async function canCommand(page: Page, chain: string): Promise<boolean> {
  return page.evaluate((cmd) => {
    const el = document.querySelector('domternal-editor');
    const ng = (window as any).ng;
    const comp = ng?.getComponent?.(el);
    if (!comp?.editor) return false;
    const fn = new Function('editor', `return editor.can().chain().focus().${cmd}.run()`);
    return fn(comp.editor) as boolean;
  }, chain);
}

async function findMentions(page: Page): Promise<any[]> {
  return page.evaluate(() => {
    const el = document.querySelector('domternal-editor');
    const ng = (window as any).ng;
    const comp = ng?.getComponent?.(el);
    return comp?.editor?.storage.mention.findMentions() ?? [];
  });
}

async function focusEditor(page: Page) {
  await page.locator(editorSelector).click();
  await page.waitForTimeout(50);
}

// ─── HTML Fixtures ───────────────────────────────────────────────────────────

const MENTION_HTML = '<p>Hello <span data-type="mention" data-id="1" data-label="Alice Johnson" data-mention-type="user" class="mention">@Alice Johnson</span> world</p>';
const TWO_MENTIONS = '<p>Talk to <span data-type="mention" data-id="1" data-label="Alice Johnson" data-mention-type="user" class="mention">@Alice Johnson</span> and <span data-type="mention" data-id="7" data-label="Grace Hopper" data-mention-type="user" class="mention">@Grace Hopper</span></p>';
const MENTION_IN_LIST = '<ul><li>Ask <span data-type="mention" data-id="2" data-label="Bob Smith" data-mention-type="user" class="mention">@Bob Smith</span></li></ul>';
const MENTION_IN_BLOCKQUOTE = '<blockquote><p>Quoted by <span data-type="mention" data-id="3" data-label="Charlie Brown" data-mention-type="user" class="mention">@Charlie Brown</span></p></blockquote>';
const MENTION_AT_START = '<p><span data-type="mention" data-id="1" data-label="Alice Johnson" data-mention-type="user" class="mention">@Alice Johnson</span> said hello</p>';
const MENTION_AT_END = '<p>Greetings <span data-type="mention" data-id="1" data-label="Alice Johnson" data-mention-type="user" class="mention">@Alice Johnson</span></p>';
const ADJACENT_MENTIONS = '<p><span data-type="mention" data-id="1" data-label="Alice Johnson" data-mention-type="user" class="mention">@Alice Johnson</span><span data-type="mention" data-id="2" data-label="Bob Smith" data-mention-type="user" class="mention">@Bob Smith</span></p>';
const LEGACY_MENTION = '<p>Hi <span data-mention data-id="5" data-label="Eve Adams" data-mention-type="user">@Eve Adams</span></p>';

// =============================================================================
// Schema
// =============================================================================

test.describe('Mention — Schema', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('mention node type is registered', async ({ page }) => {
    const has = await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      return !!comp?.editor?.state.schema.nodes['mention'];
    });
    expect(has).toBe(true);
  });

  test('mention is inline', async ({ page }) => {
    const spec = await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      const nodeType = comp?.editor?.state.schema.nodes['mention'];
      return { inline: nodeType?.spec.inline, atom: nodeType?.spec.atom, selectable: nodeType?.spec.selectable, draggable: nodeType?.spec.draggable };
    });
    expect(spec.inline).toBe(true);
    expect(spec.atom).toBe(true);
    expect(spec.selectable).toBe(false);
    expect(spec.draggable).toBe(false);
  });

  test('mention has correct attributes', async ({ page }) => {
    const attrs = await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      const nodeType = comp?.editor?.state.schema.nodes['mention'];
      return Object.keys(nodeType?.spec.attrs ?? {});
    });
    expect(attrs).toContain('id');
    expect(attrs).toContain('label');
    expect(attrs).toContain('type');
  });
});

// =============================================================================
// HTML Parsing
// =============================================================================

test.describe('Mention — HTML Parsing', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('parses span[data-type="mention"]', async ({ page }) => {
    await setEditorContent(page, MENTION_HTML);
    const mentions = page.locator(mentionNodeSelector);
    await expect(mentions).toHaveCount(1);
    await expect(mentions.first()).toContainText('Alice Johnson');
  });

  test('parses legacy span[data-mention] format', async ({ page }) => {
    await setEditorContent(page, LEGACY_MENTION);
    const mentions = page.locator(mentionNodeSelector);
    await expect(mentions).toHaveCount(1);
    await expect(mentions.first()).toContainText('Eve Adams');
  });

  test('preserves data attributes after parse', async ({ page }) => {
    await setEditorContent(page, MENTION_HTML);
    const mention = page.locator(mentionNodeSelector).first();
    await expect(mention).toHaveAttribute('data-id', '1');
    await expect(mention).toHaveAttribute('data-label', 'Alice Johnson');
    await expect(mention).toHaveAttribute('data-mention-type', 'user');
  });

  test('parses multiple mentions in same paragraph', async ({ page }) => {
    await setEditorContent(page, TWO_MENTIONS);
    const mentions = page.locator(mentionNodeSelector);
    await expect(mentions).toHaveCount(2);
    await expect(mentions.nth(0)).toContainText('Alice Johnson');
    await expect(mentions.nth(1)).toContainText('Grace Hopper');
  });

  test('HTML roundtrip preserves mention nodes', async ({ page }) => {
    await setEditorContent(page, MENTION_HTML);
    const html = await getEditorHTML(page);
    expect(html).toContain('data-type="mention"');
    expect(html).toContain('data-id="1"');
    expect(html).toContain('data-label="Alice Johnson"');
  });
});

// =============================================================================
// HTML Rendering
// =============================================================================

test.describe('Mention — HTML Rendering', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('renders mention with .mention class', async ({ page }) => {
    await setEditorContent(page, MENTION_HTML);
    const mention = page.locator(mentionNodeSelector).first();
    await expect(mention).toHaveClass(/mention/);
  });

  test('renders trigger char prefix in text', async ({ page }) => {
    await setEditorContent(page, MENTION_HTML);
    const mention = page.locator(mentionNodeSelector).first();
    const text = await mention.textContent();
    expect(text).toBe('@Alice Johnson');
  });

  test('mention is visually styled', async ({ page }) => {
    await setEditorContent(page, MENTION_HTML);
    const mention = page.locator(mentionNodeSelector).first();
    const bg = await mention.evaluate((el) => getComputedStyle(el).backgroundColor);
    // Should have some non-transparent background from theme
    expect(bg).not.toBe('rgba(0, 0, 0, 0)');
  });
});

// =============================================================================
// Commands
// =============================================================================

test.describe('Mention — Commands', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('insertMention inserts a mention node', async ({ page }) => {
    await clearAndType(page, 'Hello ');
    const result = await runCommand(page, `insertMention({ id: '1', label: 'Alice Johnson' })`);
    expect(result).toBe(true);
    const mentions = page.locator(mentionNodeSelector);
    await expect(mentions).toHaveCount(1);
    await expect(mentions.first()).toContainText('Alice Johnson');
  });

  test('insertMention with custom type', async ({ page }) => {
    await clearAndType(page, 'Tag: ');
    await runCommand(page, `insertMention({ id: 'tag-1', label: 'urgent', type: 'tag' })`);
    const mention = page.locator(mentionNodeSelector).first();
    await expect(mention).toHaveAttribute('data-mention-type', 'tag');
  });

  test('insertMention requires id and label', async ({ page }) => {
    await clearAndType(page, 'Test ');
    const r1 = await runCommand(page, `insertMention({ id: '', label: 'test' })`);
    expect(r1).toBe(false);
    const r2 = await runCommand(page, `insertMention({ id: '1', label: '' })`);
    expect(r2).toBe(false);
  });

  test('insertMention replaces selected text', async ({ page }) => {
    await clearAndType(page, 'Replace me');
    await page.keyboard.press(`${modifier}+a`);
    await runCommand(page, `insertMention({ id: '1', label: 'Alice Johnson' })`);
    const text = await getEditorText(page);
    expect(text).toContain('Alice Johnson');
    expect(text).not.toContain('Replace me');
  });

  test('deleteMention removes mention at cursor', async ({ page }) => {
    await setEditorContent(page, MENTION_AT_END);
    // Place cursor at end (after mention)
    await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      if (comp?.editor) {
        const { doc } = comp.editor.state;
        comp.editor.commands.setTextSelection(doc.content.size - 1);
      }
    });
    await page.waitForTimeout(50);
    const result = await runCommand(page, 'deleteMention()');
    expect(result).toBe(true);
    await expect(page.locator(mentionNodeSelector)).toHaveCount(0);
  });

  test('deleteMention by id finds and removes specific mention', async ({ page }) => {
    await setEditorContent(page, TWO_MENTIONS);
    await expect(page.locator(mentionNodeSelector)).toHaveCount(2);
    const result = await runCommand(page, `deleteMention('7')`);
    expect(result).toBe(true);
    await expect(page.locator(mentionNodeSelector)).toHaveCount(1);
    await expect(page.locator(mentionNodeSelector).first()).toContainText('Alice Johnson');
  });

  test('deleteMention returns false for non-existent id', async ({ page }) => {
    await setEditorContent(page, MENTION_HTML);
    const result = await runCommand(page, `deleteMention('999')`);
    expect(result).toBe(false);
    await expect(page.locator(mentionNodeSelector)).toHaveCount(1);
  });

  test('can() dry-run check for insertMention', async ({ page }) => {
    await clearAndType(page, 'Test ');
    const can = await canCommand(page, `insertMention({ id: '1', label: 'Test' })`);
    expect(can).toBe(true);
  });

  test('multiple sequential insertMention calls', async ({ page }) => {
    await clearAndType(page, '');
    await runChain(page, `insertMention({ id: '1', label: 'Alice Johnson' })`);
    await page.keyboard.type(' and ');
    await runChain(page, `insertMention({ id: '2', label: 'Bob Smith' })`);
    await expect(page.locator(mentionNodeSelector)).toHaveCount(2);
  });
});

// =============================================================================
// Storage
// =============================================================================

test.describe('Mention — Storage', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('findMentions returns all mention nodes', async ({ page }) => {
    await setEditorContent(page, TWO_MENTIONS);
    const mentions = await findMentions(page);
    expect(mentions).toHaveLength(2);
    expect(mentions[0].id).toBe('1');
    expect(mentions[0].label).toBe('Alice Johnson');
    expect(mentions[1].id).toBe('7');
    expect(mentions[1].label).toBe('Grace Hopper');
  });

  test('findMentions includes position and type', async ({ page }) => {
    await setEditorContent(page, MENTION_HTML);
    const mentions = await findMentions(page);
    expect(mentions).toHaveLength(1);
    expect(mentions[0].type).toBe('user');
    expect(typeof mentions[0].pos).toBe('number');
    expect(mentions[0].pos).toBeGreaterThan(0);
  });

  test('findMentions updates after insertMention', async ({ page }) => {
    await clearAndType(page, 'Hello ');
    let mentions = await findMentions(page);
    expect(mentions).toHaveLength(0);
    await runChain(page, `insertMention({ id: '1', label: 'Alice Johnson' })`);
    mentions = await findMentions(page);
    expect(mentions).toHaveLength(1);
  });

  test('findMentions returns empty for no mentions', async ({ page }) => {
    await clearAndType(page, 'No mentions here');
    const mentions = await findMentions(page);
    expect(mentions).toHaveLength(0);
  });
});

// =============================================================================
// leafText / Plain Text
// =============================================================================

test.describe('Mention — Plain Text', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('getText includes trigger char + label', async ({ page }) => {
    await setEditorContent(page, MENTION_HTML);
    const text = await getEditorText(page);
    expect(text).toContain('@Alice Johnson');
  });

  test('getText preserves surrounding text', async ({ page }) => {
    await setEditorContent(page, MENTION_HTML);
    const text = await getEditorText(page);
    expect(text).toContain('Hello');
    expect(text).toContain('world');
  });
});

// =============================================================================
// JSON Serialization
// =============================================================================

test.describe('Mention — JSON', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('getJSON includes mention node with correct structure', async ({ page }) => {
    await setEditorContent(page, MENTION_HTML);
    const json = await getEditorJSON(page);
    const paragraph = json.content[0];
    const mentionNode = paragraph.content.find((n: any) => n.type === 'mention');
    expect(mentionNode).toBeDefined();
    expect(mentionNode.attrs.id).toBe('1');
    expect(mentionNode.attrs.label).toBe('Alice Johnson');
    expect(mentionNode.attrs.type).toBe('user');
  });

  test('JSON roundtrip preserves mention', async ({ page }) => {
    await setEditorContent(page, MENTION_HTML);
    const json = await getEditorJSON(page);

    // Set content from JSON
    await page.evaluate((j) => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      comp?.editor?.commands.setContent(j, false);
    }, json);
    await page.waitForTimeout(100);

    await expect(page.locator(mentionNodeSelector)).toHaveCount(1);
    await expect(page.locator(mentionNodeSelector).first()).toContainText('Alice Johnson');
  });
});

// =============================================================================
// Keyboard — Backspace
// =============================================================================

test.describe('Mention — Backspace', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('Backspace at cursor after mention deletes mention', async ({ page }) => {
    await setEditorContent(page, MENTION_AT_END);
    await expect(page.locator(mentionNodeSelector)).toHaveCount(1);

    // Place cursor at end
    await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      if (comp?.editor) {
        const { doc } = comp.editor.state;
        comp.editor.commands.setTextSelection(doc.content.size - 1);
      }
    });
    await page.waitForTimeout(50);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(100);
    await expect(page.locator(mentionNodeSelector)).toHaveCount(0);
    const text = await getEditorText(page);
    expect(text).toContain('Greetings');
  });

  test('Backspace preserves surrounding text', async ({ page }) => {
    // Insert mention between text via commands (cursor ends right after mention)
    await clearAndType(page, 'Before ');
    await runChain(page, `insertMention({ id: '1', label: 'Alice Johnson' })`);
    // Cursor is right after the mention now - press backspace to delete it
    await page.waitForTimeout(50);
    await expect(page.locator(mentionNodeSelector)).toHaveCount(1);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(100);
    await expect(page.locator(mentionNodeSelector)).toHaveCount(0);
    const text = await getEditorText(page);
    expect(text).toContain('Before');
  });

  test('Backspace on normal text does not trigger mention delete', async ({ page }) => {
    await clearAndType(page, 'Hello world');
    await page.keyboard.press('Backspace');
    const text = await getEditorText(page);
    expect(text).toBe('Hello worl');
  });
});

// =============================================================================
// Suggestion — Activation & Dropdown
// =============================================================================

test.describe('Mention — Suggestion Dropdown', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('typing @ shows suggestion dropdown', async ({ page }) => {
    await clearAndType(page, 'Hello ');
    await page.keyboard.type('@');
    await page.waitForTimeout(200);
    await expect(page.locator(suggestionSelector)).toBeVisible();
  });

  test('dropdown shows all users when query is empty', async ({ page }) => {
    await clearAndType(page, 'Hi ');
    await page.keyboard.type('@');
    await page.waitForTimeout(200);
    const items = page.locator(suggestionItemSelector);
    await expect(items).toHaveCount(8);
  });

  test('dropdown filters by query', async ({ page }) => {
    await clearAndType(page, '');
    await page.keyboard.type('@ali');
    await page.waitForTimeout(200);
    const items = page.locator(suggestionItemSelector);
    await expect(items).toHaveCount(1);
    await expect(items.first()).toContainText('Alice Johnson');
  });

  test('dropdown shows "No results" for unmatched query', async ({ page }) => {
    await clearAndType(page, '');
    await page.keyboard.type('@zzzzz');
    await page.waitForTimeout(200);
    await expect(page.locator(suggestionEmptySelector)).toBeVisible();
    await expect(page.locator(suggestionEmptySelector)).toContainText('No results');
  });

  test('first item is selected by default', async ({ page }) => {
    await clearAndType(page, '');
    await page.keyboard.type('@');
    await page.waitForTimeout(200);
    const firstItem = page.locator(suggestionItemSelector).first();
    await expect(firstItem).toHaveClass(/dm-mention-suggestion-item--selected/);
  });

  test('dropdown has listbox role', async ({ page }) => {
    await clearAndType(page, '');
    await page.keyboard.type('@');
    await page.waitForTimeout(200);
    await expect(page.locator(suggestionSelector)).toHaveAttribute('role', 'listbox');
  });

  test('suggestion items have option role', async ({ page }) => {
    await clearAndType(page, '');
    await page.keyboard.type('@');
    await page.waitForTimeout(200);
    const firstItem = page.locator(suggestionItemSelector).first();
    await expect(firstItem).toHaveAttribute('role', 'option');
  });

  test('@ mid-word does not trigger suggestion', async ({ page }) => {
    await clearAndType(page, 'email@');
    await page.waitForTimeout(200);
    await expect(page.locator(suggestionSelector)).not.toBeVisible();
  });

  test('@ at start of line triggers suggestion', async ({ page }) => {
    await clearAndType(page, '');
    await page.keyboard.type('@');
    await page.waitForTimeout(200);
    await expect(page.locator(suggestionSelector)).toBeVisible();
  });

  test('space then @ triggers suggestion', async ({ page }) => {
    await clearAndType(page, 'Hello ');
    await page.keyboard.type('@');
    await page.waitForTimeout(200);
    await expect(page.locator(suggestionSelector)).toBeVisible();
  });

  test('@ inside code block does not trigger suggestion', async ({ page }) => {
    // Set a code block and place cursor inside it
    await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      if (comp?.editor) {
        comp.editor.commands.setContent('<pre><code>x</code></pre>', false);
        // Place cursor inside the code block (pos 2 = after the "x")
        comp.editor.commands.setTextSelection(2);
        comp.editor.commands.focus();
      }
    });
    await page.waitForTimeout(150);
    await page.keyboard.press('End');
    await page.keyboard.type(' @');
    await page.waitForTimeout(200);
    await expect(page.locator(suggestionSelector)).not.toBeVisible();
  });

  test('@ inside inline code mark does not trigger suggestion', async ({ page }) => {
    await clearAndType(page, 'Some text ');
    // Apply inline code mark then type @
    await page.keyboard.press(`${modifier}+e`);
    await page.keyboard.type('@test');
    await page.waitForTimeout(200);
    await expect(page.locator(suggestionSelector)).not.toBeVisible();
  });
});

// =============================================================================
// Suggestion — Keyboard Navigation
// =============================================================================

test.describe('Mention — Suggestion Keyboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('ArrowDown moves selection down', async ({ page }) => {
    await clearAndType(page, '');
    await page.keyboard.type('@');
    await page.waitForTimeout(200);
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(50);
    const secondItem = page.locator(suggestionItemSelector).nth(1);
    await expect(secondItem).toHaveClass(/dm-mention-suggestion-item--selected/);
  });

  test('ArrowUp moves selection up', async ({ page }) => {
    await clearAndType(page, '');
    await page.keyboard.type('@');
    await page.waitForTimeout(200);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(50);
    const secondItem = page.locator(suggestionItemSelector).nth(1);
    await expect(secondItem).toHaveClass(/dm-mention-suggestion-item--selected/);
  });

  test('ArrowDown does not go past last item', async ({ page }) => {
    await clearAndType(page, '');
    await page.keyboard.type('@ali');
    await page.waitForTimeout(200);
    // Only 1 item (Alice Johnson)
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(50);
    const firstItem = page.locator(suggestionItemSelector).first();
    await expect(firstItem).toHaveClass(/dm-mention-suggestion-item--selected/);
  });

  test('Enter inserts selected mention', async ({ page }) => {
    await clearAndType(page, 'Hey ');
    await page.keyboard.type('@ali');
    await page.waitForTimeout(300);
    // Verify dropdown is visible with items before pressing Enter
    await expect(page.locator(suggestionItemSelector).first()).toBeVisible();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    await expect(page.locator(mentionNodeSelector)).toHaveCount(1);
    await expect(page.locator(mentionNodeSelector).first()).toContainText('Alice Johnson');
  });

  test('Enter on second item inserts correct mention', async ({ page }) => {
    await clearAndType(page, '');
    await page.keyboard.type('@');
    await page.waitForTimeout(300);
    await expect(page.locator(suggestionItemSelector).first()).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(100);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    const mention = page.locator(mentionNodeSelector).first();
    await expect(mention).toContainText('Bob Smith');
  });

  test('Enter on third item inserts correct mention', async ({ page }) => {
    await clearAndType(page, '');
    await page.keyboard.type('@');
    await page.waitForTimeout(300);
    await expect(page.locator(suggestionItemSelector).first()).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(100);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    const mention = page.locator(mentionNodeSelector).first();
    await expect(mention).toHaveAttribute('data-id', '3');
    await expect(mention).toContainText('Charlie Brown');
  });

  test('Enter on last item inserts correct mention', async ({ page }) => {
    await clearAndType(page, '');
    await page.keyboard.type('@');
    await page.waitForTimeout(300);
    await expect(page.locator(suggestionItemSelector).first()).toBeVisible();
    // Navigate to last item (8th, index 7)
    for (let i = 0; i < 7; i++) {
      await page.keyboard.press('ArrowDown');
    }
    await page.waitForTimeout(100);
    const lastItem = page.locator(suggestionItemSelector).nth(7);
    await expect(lastItem).toHaveClass(/dm-mention-suggestion-item--selected/);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    const mention = page.locator(mentionNodeSelector).first();
    await expect(mention).toHaveAttribute('data-id', '8');
    await expect(mention).toContainText('Henry Ford');
  });

  test('ArrowUp from first item stays on first', async ({ page }) => {
    await clearAndType(page, '');
    await page.keyboard.type('@');
    await page.waitForTimeout(200);
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(50);
    const firstItem = page.locator(suggestionItemSelector).first();
    await expect(firstItem).toHaveClass(/dm-mention-suggestion-item--selected/);
  });

  test('navigate down then back up to first and Enter', async ({ page }) => {
    await clearAndType(page, '');
    await page.keyboard.type('@');
    await page.waitForTimeout(300);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(100);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    const mention = page.locator(mentionNodeSelector).first();
    await expect(mention).toContainText('Alice Johnson');
  });

  test('navigate to middle item in filtered results', async ({ page }) => {
    await clearAndType(page, '');
    // "cha" matches Charlie Brown
    // "a" matches Alice Johnson, Charlie Brown, Diana Prince, Frank Castle, Grace Hopper, Eve Adams
    await page.keyboard.type('@a');
    await page.waitForTimeout(300);
    const items = page.locator(suggestionItemSelector);
    const count = await items.count();
    expect(count).toBeGreaterThan(1);
    // Remember first item label before selecting second
    const firstLabel = await items.first().textContent();
    // Select second match
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(100);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    await expect(page.locator(mentionNodeSelector)).toHaveCount(1);
    // Verify it's NOT the first match
    const mentionLabel = await page.locator(mentionNodeSelector).first().textContent();
    expect(mentionLabel).not.toBe(`@${firstLabel}`);
  });

  test('Escape dismisses suggestion', async ({ page }) => {
    await clearAndType(page, '');
    await page.keyboard.type('@');
    await page.waitForTimeout(200);
    await expect(page.locator(suggestionSelector)).toBeVisible();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    await expect(page.locator(suggestionSelector)).not.toBeVisible();
  });

  test('Escape leaves @ text in editor', async ({ page }) => {
    await clearAndType(page, '');
    await page.keyboard.type('@ali');
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    const text = await getEditorText(page);
    expect(text).toContain('@ali');
  });
});

// =============================================================================
// Suggestion — Click Selection
// =============================================================================

test.describe('Mention — Suggestion Click', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('clicking item inserts mention', async ({ page }) => {
    await clearAndType(page, 'Notify ');
    await page.keyboard.type('@');
    await page.waitForTimeout(200);
    const thirdItem = page.locator(suggestionItemSelector).nth(2);
    await thirdItem.click();
    await page.waitForTimeout(200);
    await expect(page.locator(suggestionSelector)).not.toBeVisible();
    await expect(page.locator(mentionNodeSelector)).toHaveCount(1);
    await expect(page.locator(mentionNodeSelector).first()).toContainText('Charlie Brown');
  });

  test('hovering item updates selection highlight', async ({ page }) => {
    await clearAndType(page, '');
    await page.keyboard.type('@');
    await page.waitForTimeout(200);
    const thirdItem = page.locator(suggestionItemSelector).nth(2);
    await thirdItem.hover();
    await page.waitForTimeout(50);
    await expect(thirdItem).toHaveClass(/dm-mention-suggestion-item--selected/);
  });

  test('clicking second item inserts correct mention', async ({ page }) => {
    await clearAndType(page, '');
    await page.keyboard.type('@');
    await page.waitForTimeout(200);
    await page.locator(suggestionItemSelector).nth(1).click();
    await page.waitForTimeout(200);
    const mention = page.locator(mentionNodeSelector).first();
    await expect(mention).toHaveAttribute('data-id', '2');
    await expect(mention).toContainText('Bob Smith');
  });

  test('clicking last item inserts correct mention', async ({ page }) => {
    await clearAndType(page, '');
    await page.keyboard.type('@');
    await page.waitForTimeout(200);
    await page.locator(suggestionItemSelector).nth(7).click();
    await page.waitForTimeout(200);
    const mention = page.locator(mentionNodeSelector).first();
    await expect(mention).toHaveAttribute('data-id', '8');
    await expect(mention).toContainText('Henry Ford');
  });

  test('clicking fifth item inserts correct mention', async ({ page }) => {
    await clearAndType(page, '');
    await page.keyboard.type('@');
    await page.waitForTimeout(200);
    await page.locator(suggestionItemSelector).nth(4).click();
    await page.waitForTimeout(200);
    const mention = page.locator(mentionNodeSelector).first();
    await expect(mention).toHaveAttribute('data-id', '5');
    await expect(mention).toContainText('Eve Adams');
  });

  test('hover changes highlight then Enter inserts hovered item', async ({ page }) => {
    await clearAndType(page, '');
    await page.keyboard.type('@');
    await page.waitForTimeout(300);
    // Hover over 4th item (Diana Prince)
    const fourthItem = page.locator(suggestionItemSelector).nth(3);
    await fourthItem.hover();
    await page.waitForTimeout(100);
    await expect(fourthItem).toHaveClass(/dm-mention-suggestion-item--selected/);
    // First item should no longer be selected
    await expect(page.locator(suggestionItemSelector).first()).not.toHaveClass(/dm-mention-suggestion-item--selected/);
    // Now press Enter - should insert the hovered (4th) item
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    const mention = page.locator(mentionNodeSelector).first();
    await expect(mention).toContainText('Diana Prince');
  });

  test('clicking filtered result inserts correct mention', async ({ page }) => {
    await clearAndType(page, '');
    await page.keyboard.type('@gr');
    await page.waitForTimeout(200);
    // Should show Grace Hopper
    const items = page.locator(suggestionItemSelector);
    await expect(items.first()).toContainText('Grace Hopper');
    await items.first().click();
    await page.waitForTimeout(200);
    const mention = page.locator(mentionNodeSelector).first();
    await expect(mention).toHaveAttribute('data-id', '7');
    await expect(mention).toContainText('Grace Hopper');
  });
});

// =============================================================================
// Suggestion — Insertion Behavior
// =============================================================================

test.describe('Mention — Insertion Behavior', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('inserted mention replaces trigger + query text', async ({ page }) => {
    await clearAndType(page, 'Talk to ');
    await page.keyboard.type('@ali');
    await page.waitForTimeout(300);
    await expect(page.locator(suggestionItemSelector).first()).toBeVisible();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    const html = await getEditorHTML(page);
    expect(html).not.toContain('@ali');
    expect(html).toContain('data-label="Alice Johnson"');
  });

  test('space is appended after insertion', async ({ page }) => {
    await clearAndType(page, '');
    await page.keyboard.type('@ali');
    await page.waitForTimeout(300);
    await expect(page.locator(suggestionItemSelector).first()).toBeVisible();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    // Type more text - should be after mention with a space
    await page.keyboard.type('is great');
    const text = await getEditorText(page);
    expect(text).toContain('is great');
  });

  test('inserted mention has correct data attributes', async ({ page }) => {
    await clearAndType(page, '');
    await page.keyboard.type('@bob');
    await page.waitForTimeout(300);
    await expect(page.locator(suggestionItemSelector).first()).toBeVisible();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    const mention = page.locator(mentionNodeSelector).first();
    await expect(mention).toHaveAttribute('data-id', '2');
    await expect(mention).toHaveAttribute('data-label', 'Bob Smith');
    await expect(mention).toHaveAttribute('data-mention-type', 'user');
  });

  test('dropdown closes after insertion', async ({ page }) => {
    await clearAndType(page, '');
    await page.keyboard.type('@');
    await page.waitForTimeout(300);
    await expect(page.locator(suggestionSelector)).toBeVisible();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    await expect(page.locator(suggestionSelector)).not.toBeVisible();
  });
});

// =============================================================================
// Decoration
// =============================================================================

test.describe('Mention — Decoration', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('active trigger gets mention-suggestion decoration', async ({ page }) => {
    await clearAndType(page, '');
    await page.keyboard.type('@ali');
    await page.waitForTimeout(200);
    await expect(page.locator(decorationSelector)).toBeVisible();
  });

  test('decoration removed after insertion', async ({ page }) => {
    await clearAndType(page, '');
    await page.keyboard.type('@ali');
    await page.waitForTimeout(200);
    await expect(page.locator(decorationSelector)).toBeVisible();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    await expect(page.locator(decorationSelector)).not.toBeVisible();
  });

  test('decoration removed after Escape', async ({ page }) => {
    await clearAndType(page, '');
    await page.keyboard.type('@');
    await page.waitForTimeout(200);
    await expect(page.locator(decorationSelector)).toBeVisible();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    await expect(page.locator(decorationSelector)).not.toBeVisible();
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

test.describe('Mention — Edge Cases', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('mention at document start', async ({ page }) => {
    await setEditorContent(page, MENTION_AT_START);
    const mention = page.locator(mentionNodeSelector).first();
    await expect(mention).toBeVisible();
    await expect(mention).toContainText('Alice Johnson');
  });

  test('adjacent mentions (no text between)', async ({ page }) => {
    await setEditorContent(page, ADJACENT_MENTIONS);
    await expect(page.locator(mentionNodeSelector)).toHaveCount(2);
  });

  test('mention in list item', async ({ page }) => {
    await setEditorContent(page, MENTION_IN_LIST);
    const mention = page.locator(mentionNodeSelector).first();
    await expect(mention).toBeVisible();
    await expect(mention).toContainText('Bob Smith');
  });

  test('mention in blockquote', async ({ page }) => {
    await setEditorContent(page, MENTION_IN_BLOCKQUOTE);
    const mention = page.locator(mentionNodeSelector).first();
    await expect(mention).toBeVisible();
    await expect(mention).toContainText('Charlie Brown');
  });

  test('select all + delete removes mentions', async ({ page }) => {
    await setEditorContent(page, TWO_MENTIONS);
    await expect(page.locator(mentionNodeSelector)).toHaveCount(2);
    await focusEditor(page);
    await page.keyboard.press(`${modifier}+a`);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(100);
    await expect(page.locator(mentionNodeSelector)).toHaveCount(0);
  });

  test('undo restores deleted mention', async ({ page }) => {
    await setEditorContent(page, MENTION_HTML);
    await expect(page.locator(mentionNodeSelector)).toHaveCount(1);
    await focusEditor(page);
    await page.keyboard.press(`${modifier}+a`);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(100);
    await expect(page.locator(mentionNodeSelector)).toHaveCount(0);
    await page.keyboard.press(`${modifier}+z`);
    await page.waitForTimeout(100);
    await expect(page.locator(mentionNodeSelector)).toHaveCount(1);
  });

  test('mention alongside emoji nodes', async ({ page }) => {
    const html = '<p><span data-type="emoji" data-name="waving_hand" class="emoji">\ud83d\udc4b</span> <span data-type="mention" data-id="1" data-label="Alice Johnson" data-mention-type="user" class="mention">@Alice Johnson</span></p>';
    await setEditorContent(page, html);
    await expect(page.locator(mentionNodeSelector)).toHaveCount(1);
    await expect(page.locator(`${editorSelector} span[data-type="emoji"]`)).toHaveCount(1);
  });

  test('mention in task list', async ({ page }) => {
    const html = '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div>Ask <span data-type="mention" data-id="4" data-label="Diana Prince" data-mention-type="user" class="mention">@Diana Prince</span></div></li></ul>';
    await setEditorContent(page, html);
    const mention = page.locator(mentionNodeSelector).first();
    await expect(mention).toBeVisible();
    await expect(mention).toContainText('Diana Prince');
  });

  test('typing text after inserting mention via command', async ({ page }) => {
    await clearAndType(page, 'Ping ');
    await runChain(page, `insertMention({ id: '1', label: 'Alice Johnson' })`);
    await page.keyboard.type(' done');
    const text = await getEditorText(page);
    expect(text).toContain('@Alice Johnson');
    expect(text).toContain('done');
  });

  test('multiple suggestion sessions in same paragraph', async ({ page }) => {
    await clearAndType(page, '');
    // First mention
    await page.keyboard.type('@ali');
    await page.waitForTimeout(300);
    await expect(page.locator(suggestionItemSelector).first()).toBeVisible();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    await expect(page.locator(mentionNodeSelector)).toHaveCount(1);
    // Type text between
    await page.keyboard.type('and ');
    // Second mention
    await page.keyboard.type('@bob');
    await page.waitForTimeout(300);
    await expect(page.locator(suggestionItemSelector).first()).toBeVisible();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    await expect(page.locator(mentionNodeSelector)).toHaveCount(2);
  });
});

// =============================================================================
// Initial Demo Content
// =============================================================================

test.describe('Mention — Demo Content', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('demo content loads with mention nodes', async ({ page }) => {
    const mentions = page.locator(mentionNodeSelector);
    // Demo content has Alice Johnson and Grace Hopper
    await expect(mentions).toHaveCount(2);
  });

  test('demo mentions are visually rendered', async ({ page }) => {
    const mentions = page.locator(mentionNodeSelector);
    await expect(mentions.first()).toBeVisible();
    await expect(mentions.nth(1)).toBeVisible();
  });

  test('demo mentions have correct labels', async ({ page }) => {
    const mentions = page.locator(mentionNodeSelector);
    await expect(mentions.first()).toContainText('Alice Johnson');
    await expect(mentions.nth(1)).toContainText('Grace Hopper');
  });
});
