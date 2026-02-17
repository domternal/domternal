import { test, expect } from '@playwright/test';

const editorSelector = 'domternal-editor .ProseMirror';
const boldButton = 'button:has(strong)';
const htmlOutput = 'pre.output';
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

test.describe('Domternal Angular Editor', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('renders editor with initial content', async ({ page }) => {
    const editor = page.locator(editorSelector);
    await expect(editor).toBeVisible();
    await expect(editor).toHaveAttribute('contenteditable', 'true');
    await expect(editor).toContainText('Hello World');
  });

  test('renders toolbar with Bold button', async ({ page }) => {
    const bold = page.locator(boldButton);
    await expect(bold).toBeVisible();
    await expect(bold).toContainText('B');
  });

  test('initial content has bold "World"', async ({ page }) => {
    const strong = page.locator(`${editorSelector} strong`);
    await expect(strong).toHaveText('World');
  });

  test('shows HTML output', async ({ page }) => {
    const output = page.locator(htmlOutput);
    await expect(output).toContainText('<strong>World</strong>');
  });

  test('can type text in editor', async ({ page }) => {
    const editor = page.locator(editorSelector);
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' Testing input.');

    await expect(editor).toContainText('Testing input.');
    const output = page.locator(htmlOutput);
    await expect(output).toContainText('Testing input.');
  });

  test('Bold button toggles bold on selected text', async ({ page }) => {
    const editor = page.locator(editorSelector);
    await editor.click();

    // Type new text
    await page.keyboard.press('End');
    await page.keyboard.type(' new text');

    // Select "new text" (shift+home would select too much, use shift+left x8)
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Shift+ArrowLeft');
    }

    // Click Bold button
    await page.locator(boldButton).click();

    // Verify bold was applied
    const output = page.locator(htmlOutput);
    await expect(output).toContainText('<strong>new text</strong>');
  });

  test('Bold button shows active state when cursor is in bold text', async ({ page }) => {
    const bold = page.locator(boldButton);

    // Click inside "World" (which is bold)
    const strongEl = page.locator(`${editorSelector} strong`);
    await strongEl.click();

    await expect(bold).toHaveClass(/active/);
  });

  test('Bold button loses active state when cursor is in normal text', async ({ page }) => {
    const editor = page.locator(editorSelector);
    const bold = page.locator(boldButton);

    // Click at the start of editor (before "Hello" — not bold)
    await editor.click();
    await page.keyboard.press('Home');

    await expect(bold).not.toHaveClass(/active/);
  });

  test('Cmd+B keyboard shortcut toggles bold', async ({ page }) => {
    const editor = page.locator(editorSelector);

    // Select all text with Cmd+A, then type replacement
    await editor.click();
    await page.keyboard.press(`${modifier}+a`);
    await page.keyboard.type('plain text');

    // Select all again and apply bold with keyboard shortcut
    await page.keyboard.press(`${modifier}+a`);
    await page.keyboard.press(`${modifier}+b`);

    const output = page.locator(htmlOutput);
    await expect(output).toContainText('<strong>plain text</strong>');
  });

  test('Cmd+B removes bold from bold text', async ({ page }) => {
    const editor = page.locator(editorSelector);

    // Replace content with plain text, then make it all bold
    await editor.click();
    await page.keyboard.press(`${modifier}+a`);
    await page.keyboard.type('all bold');
    await page.keyboard.press(`${modifier}+a`);
    await page.keyboard.press(`${modifier}+b`);

    const output = page.locator(htmlOutput);
    await expect(output).toContainText('<strong>all bold</strong>');

    // Select all again and remove bold
    await page.keyboard.press(`${modifier}+a`);
    await page.keyboard.press(`${modifier}+b`);

    // Should no longer contain <strong>
    await expect(output).not.toContainText('<strong>');
  });
});
