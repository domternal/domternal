import { expect } from '@playwright/test';
import type {} from '@domternal/extension-block-controls';
import type {} from '@domternal/extension-details';
import { test } from './fixtures.js';
import { demoTargets } from './targets.js';
import { captureI18nState, expectI18nStateUnchanged, openI18nDemo, translateI18n, type I18nAuditWindow } from './i18n-audit-helpers.js';

for (const target of demoTargets) {
  test(`${target.name}: live search aliases activate a translated action without editing the open slash query`, async ({ page }) => {
    await openI18nDemo(page, target, '<p></p>', true);
    await page.keyboard.type('/skrij');
    await expect(page.locator('.dm-slash-command-empty')).toHaveText('No matches');
    await captureI18nState(page);
    await page.evaluate(() => {
      (window as unknown as I18nAuditWindow).__DEMO_EDITOR__.i18n.set({
        locale: 'hr',
        messages: { 'details.insert.label': 'Sklopivi blok', 'details.insert.description': 'Sadržaj koji se skriva' },
        searchAliases: { 'details.insert.label': ['skrij'] },
      });
    });
    const item = page.getByRole('menuitem', { name: 'Sklopivi blok', exact: true });
    await expect(item).toBeVisible();
    await expect(item).toHaveAttribute('lang', 'hr');
    await expect(page.locator(target.editorSelector)).toHaveText('/skrij');
    await expect(page.locator(target.editorSelector)).toBeFocused();
    await expectI18nStateUnchanged(page);
    await page.keyboard.press('Enter');
    await expect(page.locator(`${target.editorSelector} [data-type="details"]`)).toHaveCount(1);
    await expect(page.locator(target.editorSelector)).not.toContainText('/skrij');
    await expect(page.locator(target.editorSelector)).not.toContainText('Sklopivi blok');
    await expect(page.locator('.dm-slash-command-menu')).toHaveCount(0);
  });

  test(`${target.name}: translated block actions preserve the focused target and duplicate only authored content`, async ({ page }) => {
    await openI18nDemo(page, target, '<p>Author paragraph</p>', true);
    await page.locator(`${target.editorSelector} p`).hover();
    await page.locator('.dm-block-handle-drag').click();
    const menu = page.locator('.dm-block-context-menu');
    const duplicate = menu.getByRole('menuitem', { name: 'Duplicate', exact: true });
    await expect(duplicate).toBeVisible();
    await duplicate.focus();
    await captureI18nState(page, { action: '.dm-block-context-menu [aria-label="Duplicate"]' });
    await translateI18n(page, {
      'blockControls.context.label': 'Options du bloc',
      'blockControls.context.duplicate': '<b>Dupliquer</b>',
      'blockControls.context.turnInto': 'Transformer',
      'blockControls.context.colors': 'Couleurs',
    });
    const translated = menu.getByRole('menuitem', { name: '<b>Dupliquer</b>', exact: true });
    await expect(menu).toHaveAttribute('aria-label', 'Options du bloc');
    await expect(translated).toBeFocused();
    await expect(translated).toHaveAttribute('lang', 'fr');
    await expect(translated.locator('b')).toHaveCount(0);
    await expectI18nStateUnchanged(page, { action: '.dm-block-context-menu [aria-label="<b>Dupliquer</b>"]' });
    await page.keyboard.press('Enter');
    await expect(page.locator(`${target.editorSelector} p`)).toHaveCount(2);
    await expect(page.locator(`${target.editorSelector} p`)).toHaveText(['Author paragraph', 'Author paragraph']);
    await expect(menu).not.toBeVisible();
  });
}
