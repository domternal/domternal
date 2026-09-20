import { expect, type Page } from '@playwright/test';
import type { Editor, I18nOptions, Messages } from '@domternal/core';
import { test } from './fixtures.js';

interface OwnershipWindow {
  __i18nOwnership: {
    ready: boolean;
    editor: Editor;
    replace: (settings: I18nOptions | undefined) => void;
    replaceGerman: (overrides?: Messages) => void;
    imperative: (settings: I18nOptions) => void;
    rerender: () => void;
    prepare: () => void;
    unmount: () => void;
    snapshot: () => {
      created: number;
      destroyed: number;
      updates: number;
      transactions: number;
      parentRenders: number;
      sameEditor: boolean;
      sameView: boolean;
      sameState: boolean;
      sameHtml: boolean;
      transactionsSincePrepare: number;
      updatesSincePrepare: number;
      historyUnchanged: boolean;
      locale: string;
      destroyedEditor: boolean;
      connected: boolean;
    };
  };
}

async function openFixture(page: Page, framework: string, imperative = false): Promise<void> {
  await page.goto(`http://127.0.0.1:5894/?framework=${framework}${imperative ? '&imperative' : ''}`);
  await page.waitForFunction(() => (window as unknown as Partial<OwnershipWindow>).__i18nOwnership?.ready);
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await expect(page.locator('.dm-toolbar')).toBeVisible();
}

async function replace(page: Page, settings: I18nOptions): Promise<void> {
  await page.evaluate(settings => { (window as unknown as OwnershipWindow).__i18nOwnership.replace(settings); }, settings);
}

async function expectPreserved(page: Page): Promise<void> {
  expect(await page.evaluate(() => (window as unknown as OwnershipWindow).__i18nOwnership.snapshot())).toMatchObject({
    created: 1, destroyed: 0, sameEditor: true, sameView: true, sameState: true, sameHtml: true,
    transactionsSincePrepare: 0, updatesSincePrepare: 0, historyUnchanged: true,
  });
}

async function rerender(page: Page, framework: string): Promise<void> {
  const element = page.locator(framework === 'vanilla' ? '#fixture' : '[data-parent-revision]');
  const attribute = framework === 'vanilla' ? 'data-render' : 'data-parent-revision';
  const before = await element.getAttribute(attribute) ?? '0';
  await page.evaluate(() => { (window as unknown as OwnershipWindow).__i18nOwnership.rerender(); });
  await expect(element).not.toHaveAttribute(attribute, before);
  await page.evaluate(() => new Promise<void>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => { resolve(); }));
  }));
}

for (const framework of ['vanilla', 'react', 'vue', 'angular']) {
  test(`${framework}: the shipped German catalog supports live overrides and resetting to English`, async ({ page }) => {
    await openFixture(page, framework);
    const document = page.locator('.ProseMirror');
    await document.click();
    await page.keyboard.type('Original English draft');
    await page.evaluate(() => { (window as unknown as OwnershipWindow).__i18nOwnership.prepare(); });
    await page.evaluate(() => { (window as unknown as OwnershipWindow).__i18nOwnership.replaceGerman(); });
    const formatting = page.getByRole('group', { name: 'Formatierung', exact: true });
    await expect(formatting.getByRole('button', { name: 'Fett', exact: true })).toHaveAttribute('lang', 'de');
    await expect(formatting.getByRole('button', { name: 'Kursiv', exact: true })).toBeVisible();
    await expect(document).toHaveAttribute('aria-label', 'Rich-Text-Editor');
    await expect(page.locator('.dm-toolbar')).toHaveAttribute('aria-label', 'Editorformatierung');
    await expect(document).toBeFocused();
    await expectPreserved(page);
    await rerender(page, framework);
    await expect(formatting.getByRole('button', { name: 'Fett', exact: true })).toBeVisible();
    await expectPreserved(page);
    await page.evaluate(() => {
      (window as unknown as OwnershipWindow).__i18nOwnership.replaceGerman({ 'core.toolbar.bold': 'Fettdruck' });
    });
    await expect(formatting.getByRole('button', { name: 'Fettdruck', exact: true })).toBeVisible();
    await expect(formatting.getByRole('button', { name: 'Kursiv', exact: true })).toBeVisible();
    await expectPreserved(page);
    await replace(page, {});
    await expect(page.getByRole('group', { name: 'format', exact: true }).getByRole('button', { name: 'Bold', exact: true })).toBeVisible();
    await expect(document).toHaveText('Original English draft');
    await expectPreserved(page);
  });

  test(`${framework}: caller labels with unknown language do not inherit translated toolbar language`, async ({ page }) => {
    await openFixture(page, framework);
    await expect(page.locator('.dm-toolbar')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('group', { name: 'Tools', exact: true })).toHaveAttribute('lang', 'en');
    const custom = page.getByRole('button', { name: 'Caller action', exact: true });
    const dropdown = page.getByRole('button', { name: 'Caller menu', exact: true });
    const group = page.getByRole('group', { name: 'Caller tools', exact: true });
    const known = page.getByRole('group', { name: 'Application tools', exact: true }).getByRole('button', { name: 'Bold', exact: true });
    for (const element of [custom, dropdown, group]) {
      expect.soft(await element.evaluate(node => node.closest('[lang]')?.getAttribute('lang'))).toBe('');
    }
    await expect(known).toHaveAttribute('lang', 'en');
    await dropdown.click();
    const item = page.getByRole('menuitem', { name: 'Caller item', exact: true });
    await expect(item).toBeVisible();
    expect.soft(await item.evaluate(node => node.closest('[lang]')?.getAttribute('lang'))).toBe('');
    await replace(page, { locale: 'hr', messages: { 'core.toolbar.label': 'Oblikovanje', 'core.toolbar.toolsGroup': 'Alati', 'core.toolbar.bold': 'Podebljano' } });
    await expect(page.locator('.dm-toolbar')).toHaveAttribute('lang', 'hr');
    await expect(item).toBeVisible();
    await expect(page.getByRole('group', { name: 'Alati', exact: true })).toHaveAttribute('lang', 'hr');
    for (const element of [custom, dropdown, group, item]) {
      expect.soft(await element.evaluate(node => node.closest('[lang]')?.getAttribute('lang'))).toBe('');
    }
    await expect(known).toHaveAttribute('lang', 'en');
    const dynamic = page.getByRole('button', { name: 'Menu français', exact: true });
    await page.evaluate(() => { (window as unknown as OwnershipWindow).__i18nOwnership.editor.commands.toggleItalic(); });
    await expect(dynamic.locator('.dm-toolbar-trigger-label')).toHaveText('Unknown italic');
    await expect(dynamic.locator('.dm-toolbar-trigger-label')).toHaveAttribute('lang', '');
    await expect(dynamic).toHaveAttribute('lang', 'fr');
    await page.evaluate(() => {
      const editor = (window as unknown as OwnershipWindow).__i18nOwnership.editor;
      editor.commands.toggleItalic();
      editor.commands.toggleBold();
    });
    await expect(dynamic.locator('.dm-toolbar-trigger-label')).toHaveText('Known bold');
    await expect(dynamic.locator('.dm-toolbar-trigger-label')).toHaveAttribute('lang', 'en');
  });

  test(`${framework}: public i18n ownership updates preserve the editor, history and explicit English labels`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => { errors.push(error.message); });
    await openFixture(page, framework);
    const editor = page.locator('.ProseMirror');
    const application = page.getByRole('group', { name: 'Application tools', exact: true });
    const formatting = page.getByRole('group', { name: 'format', exact: true });
    await expect(editor).toHaveAttribute('aria-label', 'Éditeur initial');
    await expect(formatting.getByRole('button', { name: 'Gras initial', exact: true })).toBeVisible();
    await expect(application.getByRole('button', { name: 'Bold', exact: true })).toHaveAttribute('lang', 'en');
    await expect(editor.locator('[data-placeholder]')).toHaveAttribute('data-placeholder', 'Write something …');
    await editor.click();
    await page.keyboard.type('Draft with history');
    await page.evaluate(() => {
      const probe = (window as unknown as OwnershipWindow).__i18nOwnership;
      probe.editor.commands.toggleBold();
      probe.prepare();
    });
    const originalBold = await formatting.getByRole('button', { name: 'Gras initial', exact: true }).elementHandle();
    if (!originalBold) throw new Error('The built-in bold button is missing.');
    await replace(page, { locale: 'de', messages: { 'core.toolbar.bold': 'Fett', 'core.editor.label': 'Texteditor' } });
    await expect(editor).toHaveAttribute('aria-label', 'Texteditor');
    await expect(formatting.getByRole('button', { name: 'Fett', exact: true })).toHaveAttribute('lang', 'de');
    await expect(application.getByRole('button', { name: 'Bold', exact: true })).toHaveAttribute('lang', 'en');
    expect(await originalBold.evaluate(node => node.isConnected)).toBe(true);
    await expect(editor).toBeFocused();
    await expectPreserved(page);
    await replace(page, { locale: 'de', messages: { 'core.toolbar.bold': 'Fett ersetzt' } });
    await expect(formatting.getByRole('button', { name: 'Fett ersetzt', exact: true })).toBeVisible();
    await expect(editor).toHaveAttribute('aria-label', 'Rich text editor');
    await expectPreserved(page);
    await page.evaluate(() => { (window as unknown as OwnershipWindow).__i18nOwnership.replace(undefined); });
    await expect(formatting.getByRole('button', { name: 'Bold', exact: true })).toBeVisible();
    await expectPreserved(page);
    await page.evaluate(() => {
      const probe = (window as unknown as OwnershipWindow).__i18nOwnership;
      probe.imperative({ locale: 'hr', messages: { 'core.toolbar.bold': 'Podebljano' } });
    });
    await rerender(page, framework);
    await expect(formatting.getByRole('button', { name: 'Podebljano', exact: true })).toBeVisible();
    await expectPreserved(page);
    await page.keyboard.type(' B');
    await expect(editor.locator('strong')).toHaveText(' B');
    expect(errors).toEqual([]);
  });

  test(`${framework}: an absent i18n prop leaves imperative updates intact on an unrelated parent render`, async ({ page }) => {
    await openFixture(page, framework, true);
    await page.evaluate(() => {
      const probe = (window as unknown as OwnershipWindow).__i18nOwnership;
      probe.prepare();
      probe.imperative({ locale: 'fr', messages: { 'core.toolbar.italic': 'Italique' } });
    });
    await expect(page.getByRole('button', { name: 'Italique', exact: true })).toBeVisible();
    await rerender(page, framework);
    await expect(page.getByRole('button', { name: 'Italique', exact: true })).toBeVisible();
    await expectPreserved(page);
  });

  test(`${framework}: unmount disposes the localized editor while a composition repaint is pending`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => { errors.push(error.message); });
    await openFixture(page, framework);
    const editorRoot = page.locator('.ProseMirror');
    await editorRoot.click();
    await page.evaluate(() => { (window as unknown as OwnershipWindow).__i18nOwnership.editor.commands.toggleBold(); });
    await editorRoot.dispatchEvent('compositionstart', { data: '' });
    await replace(page, { locale: 'de', messages: { 'core.editor.label': 'Texteditor', 'core.toolbar.bold': 'Fett' } });
    expect(await page.evaluate(() => (window as unknown as OwnershipWindow).__i18nOwnership.editor.view.composing)).toBe(true);
    await expect(editorRoot).toHaveAttribute('aria-label', 'Éditeur initial');
    await expect(page.getByRole('button', { name: 'Fett', exact: true })).toBeVisible();
    await page.evaluate(() => {
      const probe = (window as unknown as OwnershipWindow).__i18nOwnership;
      const dom = probe.editor.view.dom;
      probe.unmount();
      dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' }));
      probe.editor.i18n.refresh();
      probe.editor.i18n.set({ locale: 'fr' });
    });
    await expect(editorRoot).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as OwnershipWindow).__i18nOwnership.snapshot())).toMatchObject({
      created: 1, destroyed: 1, destroyedEditor: true, connected: false,
    });
    expect(errors).toEqual([]);
  });
  test(`${framework}: a scrolled editable keeps its viewport and selection through locale updates`, async ({ page }) => {
    await openFixture(page, framework);
    const editorRoot = page.locator('.ProseMirror');
    await page.evaluate(() => {
      const editor = (window as unknown as OwnershipWindow).__i18nOwnership.editor;
      editor.setContent(Array.from({ length: 60 }, (_, index) => `<p>Authored paragraph ${String(index)}</p>`).join(''), false);
      Object.assign(editor.view.dom.style, { height: '180px', minHeight: '0', overflowY: 'auto' });
    });
    await editorRoot.locator('p').nth(25).click();
    await expect.poll(() => page.evaluate(() => {
      const selection = (window as unknown as OwnershipWindow).__i18nOwnership.editor.state.selection;
      return { text: selection.$from.parent.textContent, atEnd: selection.$from.parentOffset === selection.$from.parent.content.size };
    })).toEqual({ text: 'Authored paragraph 25', atEnd: true });
    await expect(editorRoot).toBeFocused();
    await expect.poll(() => editorRoot.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    const before = await editorRoot.evaluate(element => ({ top: element.scrollTop, pageY: window.scrollY }));
    await page.evaluate(() => { (window as unknown as OwnershipWindow).__i18nOwnership.prepare(); });
    await replace(page, { locale: 'hr', messages: { 'core.editor.label': 'Uređivač', 'core.toolbar.bold': 'Podebljano' } });
    await expect(editorRoot).toHaveAttribute('aria-label', 'Uređivač');
    await expect(page.getByRole('button', { name: 'Podebljano', exact: true })).toBeVisible();
    await expectPreserved(page);
    await expect(editorRoot).toBeFocused();
    expect(await editorRoot.evaluate(element => ({ top: element.scrollTop, pageY: window.scrollY }))).toEqual(before);
    await page.keyboard.type(' stable caret');
    await expect(editorRoot.locator('p').nth(25)).toHaveText('Authored paragraph 25 stable caret');
  });

}
