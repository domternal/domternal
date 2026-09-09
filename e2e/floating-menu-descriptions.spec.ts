import { expect } from '@playwright/test';
import { test } from './fixtures.js';
import { demoTargets } from './targets.js';
import { openDemo } from './tutorial-menu-helpers.js';

const MENU = '.dm-floating-menu';
const DESCRIBED_ITEM = '[data-floating-menu-item="heading-1"]';
const COMPACT_ITEM = '[data-floating-menu-item="heading-2"]';
const DESCRIPTION =
  'Create a prominent section heading: Résumé, čćž, 日本語, <b>literal text</b>, including ' +
  'aVeryLongUnbrokenDescriptionThatStillNeedsToFitInsideTheAvailableMenuWidth.';

interface DemoEditor {
  view: { dom: HTMLElement };
  setContent: (content: string, emitUpdate: boolean) => boolean;
  floatingMenuItems: {
    name: string;
    description?: string;
    isDisabled?: () => boolean;
  }[];
}

test.use({ viewport: { width: 1440, height: 1000 } });

for (const target of demoTargets) {
  test.describe(`tutorial menu contracts [${target.name}]`, () => {
    test('floating descriptions wrap while items without descriptions stay compact', async ({ page }) => {
      await openDemo(page, target, true);
      const menu = page.locator(MENU);
      const described = menu.locator(DESCRIBED_ITEM);
      const compact = menu.locator(COMPACT_ITEM);
      await expect(described.locator('.dm-floating-menu-item-description'))
        .toHaveText('Big section heading');

      // All demo defaults have descriptions. Reuse their public item objects
      // as fixtures for a long description and an omitted optional field.
      // A disabled-state change asks each native controller to render again.
      await page.evaluate((description) => {
        const editor = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
          | DemoEditor
          | undefined;
        if (!editor) throw new Error('The demo editor is unavailable.');
        const describedItem = editor.floatingMenuItems.find((item) => item.name === 'heading-1');
        const compactItem = editor.floatingMenuItems.find((item) => item.name === 'heading-2');
        if (!describedItem || !compactItem) throw new Error('Expected heading menu items.');
        describedItem.description = description;
        delete compactItem.description;
        compactItem.isDisabled = () => true;
        editor.setContent('<p>Insert a block after this paragraph.</p>', false);
      }, DESCRIPTION);
      await page.addStyleTag({
        content: '.dm-floating-menu { width: 280px; max-width: 280px; box-sizing: border-box; }',
      });
      await page.locator(`${target.editorSelector} > p`).hover();
      const handle = page.locator('.dm-block-handle');
      await expect(handle).toHaveAttribute('data-show', '');
      await handle.getByRole('button', { name: 'Add block below', exact: true }).click();
      await expect(menu).toHaveAttribute('data-show', '');
      await expect(menu).toBeVisible();

      const description = described.locator('.dm-floating-menu-item-description');
      await expect(description).toBeVisible();
      await expect(description).toHaveText(DESCRIPTION);
      await expect(description.locator('b')).toHaveCount(0);
      await expect(described.locator('.dm-floating-menu-item-label')).toHaveText('Heading 1');
      await expect(described.locator('.dm-floating-menu-item-icon svg')).toBeVisible();
      await expect(described.locator('.dm-floating-menu-item-shortcut')).toHaveText('#');
      await expect(compact).toBeDisabled();
      await expect(compact.locator('.dm-floating-menu-item-text')).toHaveCount(0);
      await expect(compact.locator('.dm-floating-menu-item-description')).toHaveCount(0);
      await expect(compact.locator(':scope > .dm-floating-menu-item-label')).toHaveText('Heading 2');
      await expect(compact.locator('.dm-floating-menu-item-icon svg')).toBeVisible();
      await expect(compact.locator('.dm-floating-menu-item-shortcut')).toHaveText('##');

      const geometry = await menu.evaluate((element) => {
        const getElement = (selector: string): HTMLElement => {
          const match = element.querySelector(selector);
          if (!(match instanceof HTMLElement)) throw new Error(`Missing menu element: ${selector}`);
          return match;
        };
        const row = getElement('[data-floating-menu-item="heading-1"]');
        const compactRow = getElement('[data-floating-menu-item="heading-2"]');
        const label = getElement('[data-floating-menu-item="heading-1"] .dm-floating-menu-item-label');
        const text = getElement('.dm-floating-menu-item-description');
        const shortcut = getElement('[data-floating-menu-item="heading-1"] .dm-floating-menu-item-shortcut');
        const bounds = text.getBoundingClientRect();
        return {
          overflow: element.scrollWidth - element.clientWidth,
          descriptionHeight: bounds.height,
          descriptionLineHeight: Number.parseFloat(getComputedStyle(text).lineHeight),
          descriptionTop: bounds.top,
          labelBottom: label.getBoundingClientRect().bottom,
          descriptionRight: bounds.right,
          shortcutLeft: shortcut.getBoundingClientRect().left,
          describedHeight: row.getBoundingClientRect().height,
          compactHeight: compactRow.getBoundingClientRect().height,
          clippedDescription: text.scrollHeight - text.clientHeight,
        };
      });
      expect(geometry.overflow).toBeLessThanOrEqual(1);
      expect(geometry.descriptionHeight).toBeGreaterThan(geometry.descriptionLineHeight);
      expect(geometry.descriptionTop).toBeGreaterThanOrEqual(geometry.labelBottom);
      expect(geometry.descriptionRight).toBeLessThanOrEqual(geometry.shortcutLeft);
      expect(geometry.describedHeight).toBeGreaterThan(geometry.compactHeight);
      expect(geometry.clippedDescription).toBeLessThanOrEqual(1);

      await described.click();
      await expect(page.locator(`${target.editorSelector} > h1`)).toHaveCount(1);
      await expect(menu).not.toHaveAttribute('data-show', '');
    });

  });
}
