import { expect } from '@playwright/test';
import type { ToolbarItem } from '@domternal/core';
import { test } from './fixtures.js';
import { demoTargets } from './targets.js';
import { openDemo, setContent } from './tutorial-menu-helpers.js';

const EDITOR = '.dm-editor .ProseMirror';

test.use({ viewport: { width: 1440, height: 1000 } });

for (const target of demoTargets) {
  test.describe(`tutorial menu contracts [${target.name}]`, () => {
    test('dropdown item titles include the platform keyboard shortcut', async ({ page }) => {
      await openDemo(page, target);
      await setContent(page, '<p>Align this paragraph.</p>');
      await page.locator(EDITOR).click();
      await page.locator('.dm-toolbar').getByRole('button', { name: 'Text Alignment', exact: true }).click();
      const panel = page.locator('.dm-toolbar-dropdown-panel');
      await expect(panel).toBeVisible();
      const mac = await page.evaluate(() => /Mac|iPhone|iPad|iPod/.test(navigator.userAgent));
      const modifier = mac ? '⌘⇧' : 'Ctrl+Shift+';
      for (const [label, key] of [
        ['Align Left', 'L'],
        ['Align Center', 'E'],
        ['Align Right', 'R'],
        ['Justify', 'J'],
      ] as const) {
        await expect(panel.getByRole('menuitem', { name: label, exact: true }))
          .toHaveAttribute('title', `${label} (${modifier}${key})`);
      }
      await panel.getByRole('menuitem', { name: 'Align Center', exact: true }).click();
      await expect(page.locator(`${EDITOR} > p`)).toHaveCSS('text-align', 'center');
    });

    test('color swatches and reset items preserve titles, accessible labels and actions', async ({ page }) => {
      await openDemo(page, target);
      await setContent(page, '<p>Color this text.</p>');
      const items = await page.evaluate(() => {
        const editor = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as {
          toolbarItems: ToolbarItem[];
          commands: { focus: (position: 'all') => boolean };
        };
        const dropdown = editor.toolbarItems.find(item => item.name === 'textColor');
        if (dropdown?.type !== 'dropdown') throw new Error('Missing text color dropdown.');
        const reset = dropdown.items.find(item => !item.color);
        const colors = dropdown.items.filter(item => item.color);
        const swatch = colors[0];
        const plain = colors[1];
        if (!reset || !swatch?.color || !plain) throw new Error('Missing palette fixtures.');
        reset.shortcut = 'Mod-Shift-X';
        swatch.shortcut = 'Mod-Shift-Y';
        delete plain.shortcut;
        editor.commands.focus('all');
        return { reset: reset.label, swatch: swatch.label, plain: plain.label, color: swatch.color };
      });
      const trigger = page.locator('.dm-toolbar').getByRole('button', { name: 'Text Color', exact: true });
      await trigger.click();
      const panel = page.locator('.dm-toolbar-dropdown-panel');
      const mac = await page.evaluate(() => /Mac|iPhone|iPad|iPod/.test(navigator.userAgent));
      const modifier = mac ? '⌘⇧' : 'Ctrl+Shift+';
      const swatch = panel.getByRole('menuitem', { name: items.swatch, exact: true });
      const reset = panel.getByRole('menuitem', { name: items.reset, exact: true });
      await expect(swatch).toHaveAttribute('title', `${items.swatch} (${modifier}Y)`);
      await expect(reset).toHaveAttribute('title', `${items.reset} (${modifier}X)`);
      await expect(panel.getByRole('menuitem', { name: items.plain, exact: true }))
        .toHaveAttribute('title', items.plain);
      await swatch.click();
      await expect(page.locator(`${EDITOR} span[style*="color"]`)).toHaveText('Color this text.');
      await trigger.click();
      await reset.click();
      await expect(page.locator(`${EDITOR} span[style*="color"]`)).toHaveCount(0);
      await expect(page.locator(EDITOR)).toHaveText('Color this text.');
    });

  });
}
