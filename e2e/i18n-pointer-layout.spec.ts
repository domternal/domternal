import { expect } from '@playwright/test';
import type {} from '@domternal/extension-table';
import { test } from './fixtures.js';
import { demoTargets } from './targets.js';
import {
  captureI18nState, expectI18nStateUnchanged, openI18nDemo, settleI18n, translateI18n,
  type I18nAuditWindow,
} from './i18n-audit-helpers.js';

interface LayoutPressWindow extends I18nAuditWindow {
  __I18N_TABLE_PRESS__?: { button: Element; text: Node };
  __I18N_FLOATING_PRESS__?: { button: Element; text: Node };
}

for (const target of demoTargets) {
  test(`${target.name}: a table column action stays under its pressed glyph when translation changes menu width`, async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 900 });
    await openI18nDemo(page, target,
      '<table><tbody><tr><td><p>One</p></td><td><p>Two</p></td><td><p>Three</p></td></tr></tbody></table><p></p>', true);
    const longLabel = 'Insert another column after this selected column and retain all existing table content';
    await translateI18n(page, { 'table.column.insertRight': longLabel });
    const cells = page.locator(`${target.editorSelector} tr`).first().locator('td');
    await cells.last().hover();
    await page.locator('.dm-table-col-handle').click();
    const menu = page.locator('.dm-table-controls-dropdown');
    const action = menu.getByRole('menuitem', { name: longLabel, exact: true });
    await action.click({ trial: true });
    await settleI18n(page);
    const point = await action.evaluate((element, label) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let text: Node | null;
      while ((text = walker.nextNode()) !== null && text.textContent !== label) { /* Find the actual label text. */ }
      if (!text) throw new Error('The table action needs its own label text node.');
      const range = document.createRange();
      range.setStart(text, 0);
      range.setEnd(text, 1);
      const rect = range.getBoundingClientRect();
      const point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      const hit = document.elementFromPoint(point.x, point.y);
      if (!hit || !element.contains(hit)) throw new Error('The first label glyph must receive the native press.');
      (window as unknown as LayoutPressWindow).__I18N_TABLE_PRESS__ = { button: element, text };
      return point;
    }, longLabel);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await captureI18nState(page, { menu: '.dm-table-controls-dropdown' });
    await translateI18n(page, { 'table.column.insertRight': 'Go' }, 'de');
    await expectI18nStateUnchanged(page, { menu: '.dm-table-controls-dropdown' });
    expect.soft(await page.evaluate(point => {
      const press = (window as unknown as LayoutPressWindow).__I18N_TABLE_PRESS__!;
      const hit = document.elementFromPoint(point.x, point.y);
      return {
        button: press.button.isConnected,
        text: press.text.isConnected && press.button.contains(press.text),
        hit: hit !== null && press.button.contains(hit),
      };
    }, point)).toEqual({ button: true, text: true, hit: true });
    await page.mouse.up();
    await expect(cells).toHaveCount(4);
    await expect(cells.locator('p')).toHaveText(['One', 'Two', 'Three', '']);
    await expect(menu).not.toBeVisible();
    await cells.last().hover();
    await page.locator('.dm-table-col-handle').click();
    await expect(menu.getByRole('menuitem', { name: 'Go', exact: true })).toHaveAttribute('lang', 'de');
    await page.keyboard.press('Escape');
  });

  test(`${target.name}: a floating action stays under its pressed glyph when an earlier description changes height`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const authored = 'Insert a block after this paragraph.';
    await openI18nDemo(page, target, `<p>${authored}</p>`, true);
    const longDescription = 'Create a prominent section heading for the next part of this document, with a clear description that wraps naturally in the available menu space.';
    await translateI18n(page, { 'core.floating.headingBigDescription': longDescription });
    await page.addStyleTag({ content: '.dm-floating-menu { width: 280px; max-width: 280px; box-sizing: border-box; }' });
    await page.locator(`${target.editorSelector} > p`).hover();
    const handle = page.locator('.dm-block-handle');
    await expect(handle).toHaveAttribute('data-show', '');
    await handle.getByRole('button', { name: 'Add block below', exact: true }).click();
    const menu = page.locator('.dm-floating-menu');
    await expect(menu).toHaveAttribute('data-show', '');
    await expect(menu).toHaveCSS('opacity', '1');
    const action = menu.locator('[data-floating-menu-item="heading-2"]');
    await action.click({ trial: true });
    await settleI18n(page);
    const point = await action.evaluate(element => {
      const text = element.querySelector('.dm-floating-menu-item-label')?.firstChild;
      if (text?.nodeType !== Node.TEXT_NODE) throw new Error('The floating action needs a label text node.');
      const range = document.createRange();
      range.setStart(text, 0);
      range.setEnd(text, 1);
      const rect = range.getBoundingClientRect();
      const point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      const hit = document.elementFromPoint(point.x, point.y);
      if (!hit || !element.contains(hit)) throw new Error('The first label glyph must receive the native press.');
      (window as unknown as LayoutPressWindow).__I18N_FLOATING_PRESS__ = { button: element, text };
      return point;
    });
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await captureI18nState(page, { menu: '.dm-floating-menu' });
    await translateI18n(page, { 'core.floating.headingBigDescription': 'Short' }, 'de');
    await expectI18nStateUnchanged(page, { menu: '.dm-floating-menu' });
    expect.soft(await page.evaluate(point => {
      const press = (window as unknown as LayoutPressWindow).__I18N_FLOATING_PRESS__!;
      const hit = document.elementFromPoint(point.x, point.y);
      return {
        button: press.button.isConnected,
        text: press.text.isConnected && press.button.contains(press.text),
        hit: hit !== null && press.button.contains(hit),
      };
    }, point)).toEqual({ button: true, text: true, hit: true });
    await page.mouse.up();
    await expect(page.locator(`${target.editorSelector} > h2`)).toHaveCount(1);
    await expect(page.locator(`${target.editorSelector} > p`).first()).toHaveText(authored);
    const description = menu.locator('[data-floating-menu-item="heading-1"] .dm-floating-menu-item-description');
    await expect(description).toHaveText('Short');
    await expect(description).toHaveAttribute('lang', 'de');
  });
}
