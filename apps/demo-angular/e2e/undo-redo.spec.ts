import { test, expect, type Page } from '@playwright/test';

const editorSelector = 'domternal-editor .ProseMirror';
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

const btn = {
  undo: 'button[aria-label="Undo"]',
  redo: 'button[aria-label="Redo"]',
  bold: 'button[aria-label="Bold"]',
  italic: 'button[aria-label="Italic"]',
  blockquote: 'button[aria-label="Blockquote"]',
} as const;

async function getEditorHTML(page: Page): Promise<string> {
  return page.locator(editorSelector).innerHTML();
}

async function getEditorText(page: Page): Promise<string> {
  return (await page.locator(editorSelector).textContent()) ?? '';
}

/** Replace all editor content via ProseMirror (tracked in history). */
async function replaceContent(page: Page, text: string) {
  await page.locator(editorSelector).click();
  await page.keyboard.press(`${modifier}+a`);
  await page.keyboard.type(text);
  await page.waitForTimeout(600); // exceed newGroupDelay so this is a separate undo group
}

// ─── Toolbar buttons ──────────────────────────────────────────────────

test.describe('Undo/Redo — toolbar buttons', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('undo and redo buttons are visible', async ({ page }) => {
    await expect(page.locator(btn.undo)).toBeVisible();
    await expect(page.locator(btn.redo)).toBeVisible();
  });

  test('undo is disabled on fresh editor (nothing to undo)', async ({
    page,
  }) => {
    await expect(page.locator(btn.undo)).toBeDisabled();
  });

  test('redo is disabled on fresh editor (nothing to redo)', async ({
    page,
  }) => {
    await expect(page.locator(btn.redo)).toBeDisabled();
  });

  test('undo becomes enabled after typing', async ({ page }) => {
    await page.locator(editorSelector).click();
    await page.keyboard.press('End');
    await page.keyboard.type(' extra');

    await expect(page.locator(btn.undo)).toBeEnabled();
  });

  test('redo becomes enabled after undo', async ({ page }) => {
    await page.locator(editorSelector).click();
    await page.keyboard.press('End');
    await page.keyboard.type(' extra');

    await page.locator(btn.undo).click();
    await expect(page.locator(btn.redo)).toBeEnabled();
  });
});

// ─── Undo typing ──────────────────────────────────────────────────────

test.describe('Undo/Redo — typing', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('undo reverts typed text via toolbar button', async ({ page }) => {
    await replaceContent(page, 'original');
    await page.keyboard.press('End');
    await page.keyboard.type(' added');

    expect(await getEditorText(page)).toContain('original added');

    await page.locator(btn.undo).click();

    const text = await getEditorText(page);
    expect(text).toContain('original');
    expect(text).not.toContain('added');
  });

  test('Mod-Z undoes typed text', async ({ page }) => {
    await replaceContent(page, 'base');
    await page.keyboard.press('End');
    await page.keyboard.type(' new');

    expect(await getEditorText(page)).toContain('base new');

    await page.keyboard.press(`${modifier}+z`);

    const text = await getEditorText(page);
    expect(text).toContain('base');
    expect(text).not.toContain('new');
  });

  test('redo restores undone text via toolbar button', async ({ page }) => {
    await replaceContent(page, 'start');
    await page.keyboard.press('End');
    await page.keyboard.type(' added');

    await page.locator(btn.undo).click();
    expect(await getEditorText(page)).not.toContain('added');

    await page.locator(btn.redo).click();
    expect(await getEditorText(page)).toContain('start added');
  });

  test('Mod-Shift-Z redoes undone text', async ({ page }) => {
    await replaceContent(page, 'start');
    await page.keyboard.press('End');
    await page.keyboard.type(' added');

    await page.keyboard.press(`${modifier}+z`);
    expect(await getEditorText(page)).not.toContain('added');

    await page.keyboard.press(`${modifier}+Shift+z`);
    expect(await getEditorText(page)).toContain('start added');
  });

  test('Mod-Y also redoes (alternative shortcut)', async ({ page }) => {
    await replaceContent(page, 'start');
    await page.keyboard.press('End');
    await page.keyboard.type(' added');

    await page.keyboard.press(`${modifier}+z`);
    expect(await getEditorText(page)).not.toContain('added');

    await page.keyboard.press(`${modifier}+y`);
    expect(await getEditorText(page)).toContain('start added');
  });
});

// ─── Undo mark operations ────────────────────────────────────────────

test.describe('Undo/Redo — mark operations', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('undo reverts bold applied via toolbar', async ({ page }) => {
    await replaceContent(page, 'plain text');
    await page.keyboard.press(`${modifier}+a`);
    await page.locator(btn.bold).click();

    expect(await getEditorHTML(page)).toContain('<strong>plain text</strong>');

    await page.keyboard.press(`${modifier}+z`);

    expect(await getEditorHTML(page)).not.toContain('<strong>');
    expect(await getEditorText(page)).toContain('plain text');
  });

  test('undo reverts italic applied via keyboard shortcut', async ({
    page,
  }) => {
    await replaceContent(page, 'plain text');
    await page.keyboard.press(`${modifier}+a`);
    await page.keyboard.press(`${modifier}+i`);

    expect(await getEditorHTML(page)).toContain('<em>');

    await page.keyboard.press(`${modifier}+z`);

    expect(await getEditorHTML(page)).not.toContain('<em>');
  });

  test('redo re-applies bold after undo', async ({ page }) => {
    await replaceContent(page, 'text');
    await page.keyboard.press(`${modifier}+a`);
    await page.locator(btn.bold).click();

    await page.keyboard.press(`${modifier}+z`);
    expect(await getEditorHTML(page)).not.toContain('<strong>');

    await page.keyboard.press(`${modifier}+Shift+z`);
    expect(await getEditorHTML(page)).toContain('<strong>');
  });
});

// ─── Undo block operations ───────────────────────────────────────────

test.describe('Undo/Redo — block operations', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('undo reverts blockquote toggle', async ({ page }) => {
    await replaceContent(page, 'quote me');
    await page.locator(btn.blockquote).click();

    expect(await getEditorHTML(page)).toContain('<blockquote>');

    await page.keyboard.press(`${modifier}+z`);

    const html = await getEditorHTML(page);
    expect(html).not.toContain('<blockquote>');
    expect(html).toContain('quote me');
  });

  test('undo reverts heading created via input rule', async ({ page }) => {
    // Click last paragraph, press End, then Enter to create a new empty paragraph
    await page.locator(`${editorSelector} p`).last().click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(600);

    await page.keyboard.type('## Title');

    expect(await getEditorHTML(page)).toContain('<h2>');

    // Undo reverts the input rule conversion
    await page.keyboard.press(`${modifier}+z`);
    const html = await getEditorHTML(page);
    expect(html).not.toContain('<h2>');
  });

  test('redo re-applies blockquote after undo', async ({ page }) => {
    await replaceContent(page, 'quote me');
    await page.locator(btn.blockquote).click();

    await page.keyboard.press(`${modifier}+z`);
    expect(await getEditorHTML(page)).not.toContain('<blockquote>');

    await page.keyboard.press(`${modifier}+Shift+z`);
    expect(await getEditorHTML(page)).toContain('<blockquote>');
  });
});

// ─── Multiple undo steps ─────────────────────────────────────────────

test.describe('Undo/Redo — multiple steps', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('multiple undos revert multiple changes', async ({ page }) => {
    // Use the initial demo content — first paragraph ends with text
    const firstP = page.locator(`${editorSelector} p`).first();
    await firstP.click();
    await page.keyboard.press('End');

    // Step 1: type text
    await page.keyboard.type(' AAA');
    await page.waitForTimeout(600);

    // Step 2: type more text
    await page.keyboard.type(' BBB');
    await page.waitForTimeout(600);

    expect(await getEditorText(page)).toContain('AAA BBB');

    // Undo step 2
    await page.keyboard.press(`${modifier}+z`);
    const after1 = await getEditorText(page);
    expect(after1).toContain('AAA');
    expect(after1).not.toContain('BBB');

    // Undo step 1
    await page.keyboard.press(`${modifier}+z`);
    const after2 = await getEditorText(page);
    expect(after2).not.toContain('AAA');
  });

  test('multiple redos restore multiple undone changes', async ({ page }) => {
    const firstP = page.locator(`${editorSelector} p`).first();
    await firstP.click();
    await page.keyboard.press('End');

    await page.keyboard.type(' AAA');
    await page.waitForTimeout(600);
    await page.keyboard.type(' BBB');
    await page.waitForTimeout(600);

    // Undo both
    await page.keyboard.press(`${modifier}+z`);
    await page.keyboard.press(`${modifier}+z`);
    expect(await getEditorText(page)).not.toContain('AAA');

    // Redo step 1
    await page.keyboard.press(`${modifier}+Shift+z`);
    const after1 = await getEditorText(page);
    expect(after1).toContain('AAA');
    expect(after1).not.toContain('BBB');

    // Redo step 2
    await page.keyboard.press(`${modifier}+Shift+z`);
    expect(await getEditorText(page)).toContain('AAA BBB');
  });

  test('typing after undo clears redo stack', async ({ page }) => {
    await replaceContent(page, 'base');
    await page.keyboard.press('End');

    await page.keyboard.type(' original');
    await page.waitForTimeout(600);

    // Undo
    await page.keyboard.press(`${modifier}+z`);
    expect(await getEditorText(page)).not.toContain('original');

    // Type something new (should clear redo stack)
    await page.keyboard.type(' replaced');
    await page.waitForTimeout(100);

    // Redo should not bring back "original"
    await page.keyboard.press(`${modifier}+Shift+z`);
    const text = await getEditorText(page);
    expect(text).toContain('replaced');
    expect(text).not.toContain('original');
  });
});

// ─── Edge cases ───────────────────────────────────────────────────────

test.describe('Undo/Redo — edge cases', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('undo on fresh editor does nothing', async ({ page }) => {
    await page.locator(editorSelector).click();

    // Should not throw or crash
    await page.keyboard.press(`${modifier}+z`);

    // Editor still works
    await expect(page.locator(editorSelector)).toBeVisible();
  });

  test('undo reverts Enter (paragraph split)', async ({ page }) => {
    const firstP = page.locator(`${editorSelector} p`).first();
    await firstP.click();
    await page.keyboard.press('End');

    const textBefore = await firstP.textContent();
    await page.keyboard.press('Enter');

    await page.keyboard.press(`${modifier}+z`);

    const textAfter = await firstP.textContent();
    expect(textAfter).toBe(textBefore);
  });

  test('undo reverts Backspace deletion', async ({ page }) => {
    await replaceContent(page, 'hello');

    await page.keyboard.press('End');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');

    expect(await getEditorText(page)).toBe('hel');

    await page.keyboard.press(`${modifier}+z`);

    expect(await getEditorText(page)).toContain('hello');
  });

  test('undo reverts select-all + delete', async ({ page }) => {
    await replaceContent(page, 'important text');

    await page.keyboard.press(`${modifier}+a`);
    await page.keyboard.press('Backspace');

    expect(await getEditorText(page)).toBe('');

    await page.keyboard.press(`${modifier}+z`);

    expect(await getEditorText(page)).toContain('important text');
  });

  test('undo reverts text replacement', async ({ page }) => {
    await replaceContent(page, 'old content');

    await page.keyboard.press(`${modifier}+a`);
    await page.keyboard.type('new content');

    expect(await getEditorText(page)).toContain('new content');

    await page.keyboard.press(`${modifier}+z`);

    expect(await getEditorText(page)).toContain('old content');
  });

  test('undo reverts mark input rule (**text**)', async ({ page }) => {
    await replaceContent(page, '');
    await page.keyboard.type('**bold**');

    expect(await getEditorHTML(page)).toContain('<strong>bold</strong>');

    // Undo reverts the input rule (bold mark removed)
    await page.keyboard.press(`${modifier}+z`);

    const html = await getEditorHTML(page);
    expect(html).not.toContain('<strong>bold</strong>');
  });

  test('undo button disables after undoing all changes', async ({ page }) => {
    await page.locator(editorSelector).click();
    await page.keyboard.press('End');
    await page.keyboard.type(' x');

    await page.locator(btn.undo).click();

    await expect(page.locator(btn.undo)).toBeDisabled();
  });

  test('redo button disables after redoing all changes', async ({ page }) => {
    await page.locator(editorSelector).click();
    await page.keyboard.press('End');
    await page.keyboard.type(' x');

    await page.locator(btn.undo).click();
    await page.locator(btn.redo).click();

    await expect(page.locator(btn.redo)).toBeDisabled();
  });
});
