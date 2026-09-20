import { expect } from '@playwright/test';
import type {} from '@domternal/extension-image';
import { test } from './fixtures.js';
import { demoTargets } from './targets.js';
import {
  captureI18nState, classicEditor, expectI18nStateUnchanged, openI18nDemo, type I18nAuditWindow,
} from './i18n-audit-helpers.js';

for (const target of demoTargets) {
  test(`${target.name}: a reentrant image translation preserves its draft and publishes the newest copy`, async ({ page }) => {
    await openI18nDemo(page, target, '<p>Insert after this text.</p>');
    await page.locator('.dm-toolbar [aria-label="Insert Image"]').click();
    const input = page.locator('.dm-image-popover-input');
    const draft = 'https://example.com/pending-image.png';
    await input.fill(draft);
    await input.evaluate(element => { (element as HTMLInputElement).setSelectionRange(8, 15); });
    await captureI18nState(page, { input: '.dm-image-popover-input' });
    await page.evaluate(() => {
      const editor = (window as unknown as I18nAuditWindow).__DEMO_EDITOR__;
      let replaced = false;
      editor.i18n.set({
        locale: 'hr',
        resolve: id => {
          if (id !== 'image.popover.urlLabel') return undefined;
          if (!replaced) {
            replaced = true;
            editor.i18n.set({ locale: 'de', messages: { 'image.popover.urlLabel': 'Bildadresse' } });
          }
          return 'Adresa slike';
        },
      });
    });
    await expect(input).toHaveAttribute('aria-label', 'Bildadresse');
    await expect(input).toHaveAttribute('lang', 'de');
    await expect(input).toHaveValue(draft);
    await expect(input).toBeFocused();
    expect(await input.evaluate(element => {
      const field = element as HTMLInputElement;
      return [field.selectionStart, field.selectionEnd];
    })).toEqual([8, 15]);
    await expectI18nStateUnchanged(page, { input: '.dm-image-popover-input' });
  });

  test(`${target.name}: a resolver that changes configuration cannot overwrite the newer toolbar presentation`, async ({ page }) => {
    await openI18nDemo(page, target, '<p>Author content remains unchanged.</p>');
    await captureI18nState(page, { bold: '.dm-toolbar [data-dm-command="toggleBold"]' });
    await page.evaluate(() => {
      const editor = (window as unknown as I18nAuditWindow).__DEMO_EDITOR__;
      let replaced = false;
      editor.i18n.set({
        locale: 'hr',
        resolve: id => {
          if (id !== 'core.toolbar.bold') return undefined;
          if (!replaced) {
            replaced = true;
            editor.i18n.set({ locale: 'de', messages: { 'core.toolbar.bold': 'Fett' } });
          }
          return 'Podebljano';
        },
      });
    });
    await expect(page.locator('.dm-toolbar [data-dm-command="toggleBold"]')).toHaveAttribute('aria-label', 'Fett');
    await expect(page.locator('.dm-toolbar [data-dm-command="toggleBold"]')).toHaveAttribute('lang', 'de');
    expect(await page.evaluate(() => {
      const editor = (window as unknown as I18nAuditWindow).__DEMO_EDITOR__;
      const item = editor.toolbarItems.find(item => item.type === 'button' && item.name === 'bold');
      return { locale: editor.i18n.getSnapshot().locale, label: item?.type === 'button' ? item.label : undefined };
    })).toEqual({ locale: 'de', label: 'Fett' });
    await expectI18nStateUnchanged(page, { bold: '.dm-toolbar [data-dm-command="toggleBold"]' });
  });

  test(`${target.name}: a message callback that changes configuration leaves editor accessibility on the newest revision`, async ({ page }) => {
    await openI18nDemo(page, target, '<p>Accessible editor.</p>');
    await captureI18nState(page, { editor: classicEditor });
    await page.evaluate(() => {
      const editor = (window as unknown as I18nAuditWindow).__DEMO_EDITOR__;
      editor.i18n.set({
        locale: 'hr',
        messages: {
          'core.editor.label': () => {
            editor.i18n.set({ locale: 'de', messages: { 'core.editor.label': 'Texteditor' } });
            return 'Uređivač';
          },
        },
      });
    });
    await expect(page.locator(classicEditor)).toHaveAttribute('aria-label', 'Texteditor');
    expect(await page.evaluate(() => (window as unknown as I18nAuditWindow).__DEMO_EDITOR__.i18n.getSnapshot().locale)).toBe('de');
    await expectI18nStateUnchanged(page, { editor: classicEditor });
  });
}
