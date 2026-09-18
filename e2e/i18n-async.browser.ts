import { expect, type Page } from '@playwright/test';
import type { Editor, I18nOptions } from '@domternal/core';
import type {} from '@domternal/extension-image';
import type {} from '@domternal/extension-mention';
import { test } from './fixtures.js';

interface AsyncWindow {
  __i18nOwnership: {
    ready: boolean;
    editor: Editor;
    uploadedSource: string;
    replace: (settings: I18nOptions) => void;
    prepare: () => void;
    snapshot: () => {
      created: number;
      destroyed: number;
      sameEditor: boolean;
      sameView: boolean;
      sameState: boolean;
      sameHtml: boolean;
      transactionsSincePrepare: number;
      updatesSincePrepare: number;
      historyUnchanged: boolean;
    };
    asyncStatus: () => {
      mentionCalls: number;
      uploadCalls: number;
      file: { name: string; size: number; type: string } | null;
    };
    finishMention: (items: { id: string; label: string }[]) => void;
    finishUpload: () => void;
  };
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => { resolve(); }));
  }));
}

async function openFixture(page: Page, framework: string): Promise<void> {
  await page.goto(`http://127.0.0.1:5894/?framework=${framework}&async`);
  await page.waitForFunction(() => (window as unknown as Partial<AsyncWindow>).__i18nOwnership?.ready);
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await expect(page.locator('.dm-toolbar')).toBeVisible();
}

async function expectPreserved(page: Page): Promise<void> {
  await settle(page);
  expect(await page.evaluate(() => (window as unknown as AsyncWindow).__i18nOwnership.snapshot())).toMatchObject({
    created: 1, destroyed: 0, sameEditor: true, sameView: true, sameState: true, sameHtml: true,
    transactionsSincePrepare: 0, updatesSincePrepare: 0, historyUnchanged: true,
  });
}

for (const framework of ['vanilla', 'react', 'vue', 'angular']) {
  test(`${framework}: a pending mention request resolves in the current locale without refetching or changing its identity`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => { errors.push(error.message); });
    await openFixture(page, framework);
    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.keyboard.type('@');
    await expect.poll(() => page.evaluate(() => (window as unknown as AsyncWindow).__i18nOwnership.asyncStatus().mentionCalls)).toBe(1);
    await expect(editor).toHaveText('@');
    await expect(page.locator('.dm-mention-suggestion')).toHaveCount(0);
    await settle(page);
    await page.evaluate(() => { (window as unknown as AsyncWindow).__i18nOwnership.prepare(); });
    await page.evaluate(() => {
      (window as unknown as AsyncWindow).__i18nOwnership.replace({
        locale: 'fr', messages: { 'core.editor.label': 'Éditeur en attente', 'mention.suggestions.label': 'Personnes en attente' },
      });
    });
    await expect(editor).toHaveAttribute('aria-label', 'Éditeur en attente');
    await expectPreserved(page);
    await page.evaluate(() => {
      (window as unknown as AsyncWindow).__i18nOwnership.replace({
        locale: 'hr', messages: { 'core.editor.label': 'Uređivač s upitom', 'mention.suggestions.label': 'Dostupne osobe' },
      });
    });
    await expect(editor).toHaveAttribute('aria-label', 'Uređivač s upitom');
    await expect(editor).toBeFocused();
    await expect(editor).toHaveText('@');
    await expectPreserved(page);
    expect(await page.evaluate(() => (window as unknown as AsyncWindow).__i18nOwnership.asyncStatus())).toEqual({
      mentionCalls: 1, uploadCalls: 0, file: null,
    });
    await page.evaluate(() => {
      (window as unknown as AsyncWindow).__i18nOwnership.finishMention([{ id: 'person_42', label: 'Raw async identity' }]);
    });
    const menu = page.getByRole('listbox', { name: 'Dostupne osobe', exact: true });
    await expect(menu).toBeVisible();
    await expect(menu).toHaveAttribute('lang', 'hr');
    const item = menu.getByRole('option', { name: 'Raw async identity', exact: true });
    await expect(item).toHaveAttribute('lang', '');
    await expect(item).toHaveAttribute('aria-selected', 'true');
    await expect(editor).toBeFocused();
    await expect(editor).toHaveText('@');
    await expectPreserved(page);
    await page.keyboard.press('Enter');
    await expect(menu).toHaveCount(0);
    const mention = editor.locator('[data-type="mention"]');
    await expect(mention).toHaveCount(1);
    await expect(mention).toHaveAttribute('data-id', 'person_42');
    await expect(mention).toHaveAttribute('data-label', 'Raw async identity');
    await expect(editor).not.toContainText('Dostupne osobe');
    expect(await page.evaluate(() => (window as unknown as AsyncWindow).__i18nOwnership.asyncStatus().mentionCalls)).toBe(1);
    expect(errors).toEqual([]);
  });

  test(`${framework}: a pending file upload survives locale replacement and inserts its original result exactly once`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => { errors.push(error.message); });
    await openFixture(page, framework);
    const editor = page.locator('.ProseMirror');
    await page.evaluate(() => {
      const instance = (window as unknown as AsyncWindow).__i18nOwnership.editor;
      instance.setContent('<p>Upload anchor</p>', false);
      instance.commands.focus('end');
    });
    await settle(page);
    await page.getByRole('button', { name: 'Insert Image', exact: true }).click();
    const chooserPending = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Browse files', exact: true }).click();
    const chooser = await chooserPending;
    const uploadedSource = await page.evaluate(() => (window as unknown as AsyncWindow).__i18nOwnership.uploadedSource);
    const buffer = Buffer.from(uploadedSource.slice(uploadedSource.indexOf(',') + 1), 'base64');
    await chooser.setFiles({ name: 'i18n-pending.png', mimeType: 'image/png', buffer });
    await expect.poll(() => page.evaluate(() => (window as unknown as AsyncWindow).__i18nOwnership.asyncStatus().uploadCalls)).toBe(1);
    await expect(editor).toBeFocused();
    await expect(editor.locator('img')).toHaveCount(0);
    await expect(editor).toHaveText('Upload anchor');
    await settle(page);
    const pending = await page.evaluate(() => {
      const probe = (window as unknown as AsyncWindow).__i18nOwnership;
      probe.prepare();
      return probe.asyncStatus();
    });
    expect(pending).toEqual({
      mentionCalls: 0, uploadCalls: 1, file: { name: 'i18n-pending.png', size: buffer.length, type: 'image/png' },
    });
    await page.evaluate(() => {
      (window as unknown as AsyncWindow).__i18nOwnership.replace({
        locale: 'fr', messages: { 'core.editor.label': 'Éditeur avec téléversement', 'image.toolbar.insert': 'Insérer une image' },
      });
    });
    await expect(editor).toHaveAttribute('aria-label', 'Éditeur avec téléversement');
    await expect(page.getByRole('button', { name: 'Insérer une image', exact: true })).toHaveAttribute('lang', 'fr');
    await expect(editor).toBeFocused();
    await expect(editor.locator('img')).toHaveCount(0);
    await expectPreserved(page);
    expect(await page.evaluate(() => (window as unknown as AsyncWindow).__i18nOwnership.asyncStatus())).toEqual(pending);
    await page.evaluate(() => { (window as unknown as AsyncWindow).__i18nOwnership.finishUpload(); });
    const image = editor.locator('img');
    await expect(image).toHaveCount(1);
    await expect(image).toHaveAttribute('src', uploadedSource);
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate(node => {
      const element = node as HTMLImageElement;
      return { complete: element.complete, width: element.naturalWidth, height: element.naturalHeight };
    })).toEqual({ complete: true, width: 1, height: 1 });
    await expect(editor).toContainText('Upload anchor');
    expect(await page.evaluate(() => (window as unknown as AsyncWindow).__i18nOwnership.asyncStatus())).toEqual(pending);
    expect(errors).toEqual([]);
  });
}
