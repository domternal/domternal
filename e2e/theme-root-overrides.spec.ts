import { expect, type Page } from '@playwright/test';
import { test } from './fixtures.js';
import { demoTargets } from './targets.js';
import { openDemo, setContent, waitForEditor } from './tutorial-menu-helpers.js';

/** Scope the example to the closest existing ancestor shared by its UI roots. */
async function addBrandScope(page: Page, selectors: string[]): Promise<void> {
  await page.evaluate((roots) => {
    const elements = roots.map((selector) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`Missing theme root: ${selector}`);
      return element;
    });
    let scope = elements[0]?.parentElement ?? null;
    while (scope && !elements.every((element) => scope?.contains(element))) {
      scope = scope.parentElement;
    }
    if (!scope || scope === document.body || scope === document.documentElement) {
      throw new Error('The demo should provide a local container for its UI roots.');
    }
    scope.classList.add('brand');
  }, selectors);
}

test.use({ viewport: { width: 1440, height: 1000 } });

for (const target of demoTargets) {
  test.describe(`tutorial menu contracts [${target.name}]`, () => {
    test('local theme selectors style the editor, toolbar and external outline roots', async ({ page }) => {
      await openDemo(page, target);
      await setContent(page, '<p><a href="https://example.com">Branded link</a></p>');
      const editor = page.locator('.dm-editor');
      const toolbar = page.locator('.dm-toolbar');
      const originalEditor = await editor.evaluate((element) => getComputedStyle(element).backgroundColor);
      const originalToolbar = await toolbar.evaluate((element) => getComputedStyle(element).backgroundColor);
      await page.addStyleTag({ content: `
        .brand .dm-editor {
          --dm-editor-bg: rgb(241, 247, 253);
          --dm-editor-text: rgb(31, 47, 71);
          --dm-link-color: rgb(113, 47, 151);
        }
        .brand .dm-toolbar { --dm-toolbar-bg: rgb(229, 239, 251); }
        .brand .dm-toc-outline {
          --dm-toc-tick-color: rgb(83, 61, 173);
          --dm-toc-tick-active-color: rgb(83, 61, 173);
          --dm-toc-tick-hover-color: rgb(83, 61, 173);
        }
      ` });
      // The stylesheet alone must leave roots outside the brand scope alone.
      await expect(editor).toHaveCSS('background-color', originalEditor);
      await expect(toolbar).toHaveCSS('background-color', originalToolbar);
      await addBrandScope(page, ['.dm-editor', '.dm-toolbar']);
      await expect(editor).toHaveCSS('background-color', 'rgb(241, 247, 253)');
      await expect(editor).toHaveCSS('color', 'rgb(31, 47, 71)');
      await expect(editor.locator('a')).toHaveCSS('color', 'rgb(113, 47, 151)');
      await expect(toolbar).toHaveCSS('background-color', 'rgb(229, 239, 251)');
      await page.evaluate(() => {
        document.querySelectorAll('.brand').forEach((element) => {
          element.classList.remove('brand');
        });
      });
      await expect(editor).toHaveCSS('background-color', originalEditor);
      await expect(toolbar).toHaveCSS('background-color', originalToolbar);

      await page.locator(target.notionToggle).click();
      await waitForEditor(page, target.editorSelector);
      await setContent(page, '<h1>First section</h1><p>First body.</p><h2>Second section</h2>' +
        '<p>Second body.</p><h2>Third section</h2><p>Third body.</p>');
      const outline = page.locator('.dm-toc-outline');
      await expect(outline).toBeVisible();
      await expect(outline.locator('.dm-toc-outline-tick')).toHaveCount(3);
      expect(await outline.evaluate((element) => element.closest('.dm-editor') === null)).toBe(true);
      await addBrandScope(page, ['.dm-editor', '.dm-toc-outline']);
      // The Notion preset keeps its surface transparent while text tokens apply.
      await expect(editor).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      await expect(editor).toHaveCSS('color', 'rgb(31, 47, 71)');
      await expect(outline.locator('.dm-toc-outline-tick').first())
        .toHaveCSS('background-color', 'rgb(83, 61, 173)');
      await page.addStyleTag({
        content: '.brand .dm-editor.dm-notion-mode { background: var(--dm-editor-bg); }',
      });
      await expect(editor).toHaveCSS('background-color', 'rgb(241, 247, 253)');
    });
  });
}
