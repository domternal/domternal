import { test } from './fixtures.js';
import { expect } from '@playwright/test';

const editorSelector = 'domternal-editor .ProseMirror';
const boldButton = '.dm-toolbar button[aria-label="Bold"]';
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

test.describe('SelectionDecoration', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test.describe('selection collapse on blur', () => {
    test('blur collapses selection - typing after refocus appends instead of replacing', async ({ page }) => {
      const selectionWarnings: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'warning' && message.text().includes('TextSelection endpoint')) {
          selectionWarnings.push(message.text());
        }
      });

      const editor = page.locator(editorSelector);
      await editor.click();

      // Replace content, select all
      await page.keyboard.press(`${modifier}+a`);
      await page.keyboard.type('original');
      await page.keyboard.press(`${modifier}+a`);

      // Blur → selection collapses to cursor
      await page.locator('h1').click();

      // A collapsed selection must point into a textblock, including after select-all.
      const selection = await page.evaluate(() => {
        const editor = (window as unknown as {
          __DEMO_EDITOR__: {
            state: {
              selection: {
                from: number;
                to: number;
                $from: { parent: { inlineContent: boolean } };
              };
              doc: { textContent: string };
            };
          };
        }).__DEMO_EDITOR__;
        return {
          from: editor.state.selection.from,
          to: editor.state.selection.to,
          inline: editor.state.selection.$from.parent.inlineContent,
          content: editor.state.doc.textContent,
        };
      });
      expect(selection).toEqual({ from: 1, to: 1, inline: true, content: 'original' });
      expect(selectionWarnings).toEqual([]);

      // Focus again and type - if selection was collapsed, text appends
      await editor.click();
      await page.keyboard.press('End');
      await page.keyboard.type(' added');

      await expect(editor).toContainText('original added');
    });

    test('Bold via toolbar works (no blur, selection preserved)', async ({ page }) => {
      const editor = page.locator(editorSelector);
      const output = page.locator('pre.output');
      await editor.click();

      await page.keyboard.press(`${modifier}+a`);
      await page.keyboard.type('make bold');
      await page.keyboard.press(`${modifier}+a`);
      await page.locator(boldButton).click();

      await expect(output).toContainText('<strong>make bold</strong>');
    });

    test('toolbar button keeps editor focused (mousedown preventDefault)', async ({ page }) => {
      const editor = page.locator(editorSelector);
      await editor.click();
      await page.keyboard.press(`${modifier}+a`);

      await page.locator(boldButton).click();

      const focused = await editor.evaluate((el) =>
        el === document.activeElement || el.contains(document.activeElement)
      );
      expect(focused).toBe(true);
    });
  });

  test.describe('data-dm-editor-ui exception', () => {
    test('link popover preserves selection - link applies to full text', async ({ page }) => {
      const editor = page.locator(editorSelector);
      const output = page.locator('pre.output');
      await editor.click();

      await page.keyboard.press(`${modifier}+a`);
      await page.keyboard.type('link text');
      await page.keyboard.press(`${modifier}+a`);

      // Open link popover (focus moves to input → editor blurs)
      await page.locator('.dm-toolbar button[aria-label="Link"]').click();
      await page.waitForSelector('.dm-link-popover[data-show]');
      await page.waitForTimeout(100);

      // Type URL and submit
      await page.locator('.dm-link-popover-input').fill('https://example.com');
      await page.keyboard.press('Enter');

      // Link should wrap the entire selected text - proves selection was NOT collapsed
      await expect(output).toContainText('href="https://example.com"');
      await expect(output).toContainText('>link text</a>');
    });

    test('dm-link-pending decoration appears while popover is open', async ({ page }) => {
      const editor = page.locator(editorSelector);
      await editor.click();

      await page.keyboard.press(`${modifier}+a`);
      await page.keyboard.type('decorate me');
      await page.keyboard.press(`${modifier}+a`);

      await page.locator('.dm-toolbar button[aria-label="Link"]').click();
      await page.waitForSelector('.dm-link-popover[data-show]');
      await page.waitForTimeout(100);

      const pending = editor.locator('.dm-link-pending');
      await expect(pending.first()).toBeVisible();
    });

    test('dm-link-pending decoration disappears when popover closes', async ({ page }) => {
      const editor = page.locator(editorSelector);
      await editor.click();

      await page.keyboard.press(`${modifier}+a`);
      await page.keyboard.type('temp');
      await page.keyboard.press(`${modifier}+a`);

      await page.locator('.dm-toolbar button[aria-label="Link"]').click();
      await page.waitForSelector('.dm-link-popover[data-show]');
      await page.waitForTimeout(100);

      // Close with Escape - verify popover closes first
      await page.locator('.dm-link-popover-input').press('Escape');
      await expect(page.locator('.dm-link-popover[data-show]')).toHaveCount(0);
      await expect(editor.locator('.dm-link-pending')).toHaveCount(0);
    });

    test('popover input has data-dm-editor-ui on container', async ({ page }) => {
      // Verify the attribute exists on the popover element
      const popover = page.locator('.dm-link-popover');
      await expect(popover).toHaveAttribute('data-dm-editor-ui', '');
    });
  });

  test.describe('blur prevents formatting the previous range', () => {
    test('blur collapses selection - typing after refocus appends text', async ({ page }) => {
      const editor = page.locator(editorSelector);
      await editor.click();

      await page.keyboard.press(`${modifier}+a`);
      await page.keyboard.type('check selection');
      await page.keyboard.press(`${modifier}+a`);

      // Blur
      await page.locator('h1').click();

      // Refocus and type - if selection was collapsed, text appends instead of replacing
      await editor.click();
      await page.keyboard.press('End');
      await page.keyboard.type(' ok');

      await expect(editor).toContainText('check selection ok');
    });

    for (const { label, tag } of [
      { label: 'Bold', tag: 'strong' },
      { label: 'Italic', tag: 'em' },
    ]) {
      test(`${label} after blur formats new input without changing the previous range`, async ({ page }) => {
        const editor = page.locator(editorSelector);
        const button = page.locator(`.dm-toolbar button[aria-label="${label}"]`);
        await editor.click();
        await page.keyboard.press(`${modifier}+a`);
        await page.keyboard.type('some text');
        await page.keyboard.press(`${modifier}+a`);
        await expect(button).toBeEnabled();

        await page.locator('h1').click();

        // A valid cursor supports stored marks without formatting the old range.
        await expect(button).toBeEnabled();
        await button.click();
        await expect(editor).toBeFocused();
        await expect(editor).toHaveText('some text');
        await expect(editor.locator(tag)).toHaveCount(0);

        await page.keyboard.type('new ');

        await expect(editor).toHaveText('new some text');
        await expect(editor.locator(tag)).toHaveText('new ');
      });
    }

    test('direct toolbar click (no blur) still bolds text', async ({ page }) => {
      const editor = page.locator(editorSelector);
      const output = page.locator('pre.output');
      await editor.click();

      await page.keyboard.press(`${modifier}+a`);
      await page.keyboard.type('should bold');
      await page.keyboard.press(`${modifier}+a`);

      // Click Bold WITHOUT blurring first
      await page.locator(boldButton).click();

      await expect(output).toContainText('<strong>should bold</strong>');
    });

    test('refocus after blur allows normal editing without ghost formatting', async ({ page }) => {
      const editor = page.locator(editorSelector);
      const output = page.locator('pre.output');
      await editor.click();

      await page.keyboard.press(`${modifier}+a`);
      await page.keyboard.type('original');
      await page.keyboard.press(`${modifier}+a`);

      // Blur
      await page.locator('h1').click();

      // Refocus and type at end
      await editor.click();
      await page.keyboard.press('End');
      await page.keyboard.type(' added');

      // "original" should NOT be formatted
      await expect(output).toContainText('original added');
      await expect(output).not.toContainText('<strong>');
    });
  });

  test.describe('blur/focus cycling', () => {
    test('typing works after blur/focus cycle', async ({ page }) => {
      const editor = page.locator(editorSelector);
      await editor.click();

      await page.keyboard.press(`${modifier}+a`);
      await page.locator('h1').click();
      await editor.click();

      await page.keyboard.press('End');
      await page.keyboard.type(' extra');

      await expect(editor).toContainText('extra');
    });

    test('repeated blur/focus does not break editing', async ({ page }) => {
      const editor = page.locator(editorSelector);
      await editor.click();

      // Cycle 1
      await page.keyboard.press(`${modifier}+a`);
      await page.keyboard.type('cycle1');
      await page.locator('h1').click();
      await editor.click();

      // Cycle 2
      await page.keyboard.press(`${modifier}+a`);
      await page.keyboard.type('cycle2');
      await page.locator('h1').click();
      await editor.click();

      // Should be able to type normally
      await page.keyboard.press('End');
      await page.keyboard.type(' done');
      await expect(editor).toContainText('cycle2 done');
    });
  });
});
