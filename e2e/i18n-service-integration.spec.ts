import { expect } from '@playwright/test';
import type { I18nFormattingContext } from '@domternal/core';
import { test } from './fixtures.js';
import { demoTargets } from './targets.js';
import {
  captureI18nState, expectI18nStateUnchanged, openI18nDemo,
  settleI18n, translateI18n, type I18nAuditWindow,
} from './i18n-audit-helpers.js';

for (const target of demoTargets) {
  test(`${target.name}: invalid translations fall through safely and external resources refresh without editor transactions`, async ({ page }) => {
    await openI18nDemo(page, target, '<p>Unmodified author text.</p>');
    await captureI18nState(page, { bold: '.dm-toolbar [data-dm-command="toggleBold"]' });
    await page.evaluate(() => {
      const win = window as unknown as I18nAuditWindow;
      const editor = win.__DEMO_EDITOR__;
      let version = 1;
      win.__I18N_DIAGNOSTICS__ = [];
      win.__I18N_REFRESH__ = () => { version++; editor.i18n.refresh(); };
      editor.i18n.set({
        locale: 'fr',
        messages: {
          'core.toolbar.bold': () => { throw new Error('Private callback detail'); },
          'core.toolbar.italic': '',
          'core.toolbar.underline': '<b>Souligné</b>',
        },
        resolve: id => {
          if (id === 'core.toolbar.bold') return `Gras ${String(version)}`;
          if (id === 'core.toolbar.italic') throw new Error('Private resolver detail');
          return undefined;
        },
        onDiagnostic: diagnostic => { win.__I18N_DIAGNOSTICS__!.push(diagnostic); },
      });
    });
    const bold = page.locator('.dm-toolbar [data-dm-command="toggleBold"]');
    const italic = page.locator('.dm-toolbar [data-dm-command="toggleItalic"]');
    await expect(bold).toHaveAttribute('aria-label', 'Gras 1');
    await expect(bold).toHaveAttribute('lang', 'fr');
    await expect(italic).toHaveAttribute('aria-label', 'Italic');
    await expect(italic).toHaveAttribute('lang', 'en');
    await expect(page.locator('.dm-toolbar [data-dm-command="toggleUnderline"]')).toHaveAttribute('aria-label', '<b>Souligné</b>');
    await expect(page.locator('.dm-toolbar b')).toHaveCount(0);
    const diagnostics = await page.evaluate(() => (window as unknown as I18nAuditWindow).__I18N_DIAGNOSTICS__!);
    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'core.toolbar.bold', code: 'callback-error' }),
      expect.objectContaining({ key: 'core.toolbar.italic', code: 'invalid-message' }),
    ]));
    expect(new Set(diagnostics.map(item => item.key)).size).toBe(diagnostics.length);
    expect(diagnostics.every(item => Object.keys(item).sort().join(',') === 'code,key,revision')).toBe(true);
    expect(JSON.stringify(diagnostics)).not.toContain('Private');
    await page.evaluate(() => { (window as unknown as I18nAuditWindow).__I18N_REFRESH__!(); });
    await expect(bold).toHaveAttribute('aria-label', 'Gras 2');
    expect(await page.evaluate(() => {
      const i18n = (window as unknown as I18nAuditWindow).__DEMO_EDITOR__.i18n;
      const snapshot = i18n.getSnapshot();
      const { resolve, onDiagnostic, ...settings } = snapshot;
      i18n.set({ ...settings, ...(resolve ? { resolve } : {}), ...(onDiagnostic ? { onDiagnostic } : {}) });
      return snapshot === i18n.getSnapshot();
    })).toBe(true);
    await expectI18nStateUnchanged(page, { bold: '.dm-toolbar [data-dm-command="toggleBold"]' });
    await translateI18n(page, { 'core.toolbar.bold': 'Gras remplacé' });
    await expect(bold).toHaveAttribute('aria-label', 'Gras remplacé');
    await expect(page.locator('.dm-toolbar [data-dm-command="toggleUnderline"]')).toHaveAttribute('aria-label', 'Underline');
    await expectI18nStateUnchanged(page, { bold: '.dm-toolbar [data-dm-command="toggleBold"]' });
  });

  test(`${target.name}: formatter context and time zone update UI atomically while invalid settings leave it unchanged`, async ({ page }) => {
    await openI18nDemo(page, target, '<p>Formatting does not edit content.</p>');
    await captureI18nState(page, { toolbar: '.dm-toolbar' });
    const expected = await page.evaluate(() => {
      const editor = (window as unknown as I18nAuditWindow).__DEMO_EDITOR__;
      const instant = Date.UTC(2025, 0, 1, 0, 30);
      const messages = {
        'core.toolbar.label': (_params: undefined, context: I18nFormattingContext) =>
          `${context.number(1234.5)} | ${context.date(instant, { year: 'numeric', month: '2-digit', day: '2-digit' })}`,
      };
      editor.i18n.set({ locale: 'de-DE', timeZone: 'UTC', messages });
      return {
        utc: `${new Intl.NumberFormat('de-DE').format(1234.5)} | ${new Intl.DateTimeFormat('de-DE', {
          timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
        }).format(instant)}`,
        losAngeles: `${new Intl.NumberFormat('de-DE').format(1234.5)} | ${new Intl.DateTimeFormat('de-DE', {
          timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
        }).format(instant)}`,
      };
    });
    const toolbar = page.locator('.dm-toolbar');
    await expect(toolbar).toHaveAttribute('aria-label', expected.utc);
    await page.evaluate(() => {
      const i18n = (window as unknown as I18nAuditWindow).__DEMO_EDITOR__.i18n;
      const { locale, messages } = i18n.getSnapshot();
      i18n.set({ locale, messages, timeZone: 'America/Los_Angeles' });
    });
    await expect(toolbar).toHaveAttribute('aria-label', expected.losAngeles);
    expect(expected.losAngeles).not.toBe(expected.utc);
    expect(await page.evaluate(() => {
      const i18n = (window as unknown as I18nAuditWindow).__DEMO_EDITOR__.i18n;
      const before = i18n.getSnapshot();
      let rejected = false;
      try { i18n.set({ locale: 'fr', timeZone: 'Invalid/Time_Zone' }); } catch { rejected = true; }
      return { rejected, sameSnapshot: i18n.getSnapshot() === before };
    })).toEqual({ rejected: true, sameSnapshot: true });
    await expect(toolbar).toHaveAttribute('aria-label', expected.losAngeles);
    await expectI18nStateUnchanged(page, { toolbar: '.dm-toolbar' });
    await page.evaluate(() => {
      const i18n = (window as unknown as I18nAuditWindow).__DEMO_EDITOR__.i18n;
      const { locale, messages, timeZone } = i18n.getSnapshot();
      i18n.set({ locale, messages, timeZone, formatters: { number: value => `Number(${String(value)})` } });
    });
    await expect(toolbar).toHaveAttribute('aria-label', expected.losAngeles.replace('1.234,5', 'Number(1234.5)'));
    await expectI18nStateUnchanged(page, { toolbar: '.dm-toolbar' });
  });

  test(`${target.name}: shared extension instances keep independent locales through editor addition and removal`, async ({ page }) => {
    await page.goto(target.baseURL);
    await page.getByRole('button', { name: 'Multiple editors', exact: true }).click();
    const panels = page.locator('.multi-editor-panel');
    await expect(panels).toHaveCount(3);
    await page.waitForFunction(() => (window as unknown as I18nAuditWindow).__MULTI_EDITORS__?.length === 3);
    const originals = await page.evaluate(() => {
      const editors = (window as unknown as I18nAuditWindow).__MULTI_EDITORS__!;
      const html = editors.map(editor => editor.getHTML());
      editors[0]!.i18n.set({ locale: 'fr', messages: { 'core.taskItem.status': 'Tâche française', 'core.editor.label': 'Éditeur français' } });
      editors[1]!.i18n.set({ locale: 'de', messages: { 'core.taskItem.status': 'Deutsche Aufgabe', 'core.editor.label': 'Deutscher Editor' } });
      return html;
    });
    await expect(panels.nth(0).getByRole('checkbox')).toHaveAttribute('aria-label', 'Tâche française');
    await expect(panels.nth(1).getByRole('checkbox')).toHaveAttribute('aria-label', 'Deutsche Aufgabe');
    await expect(panels.nth(2).getByRole('checkbox')).toHaveAttribute('aria-label', 'Task status');
    await expect(panels.nth(0).locator('.ProseMirror')).toHaveAttribute('aria-label', 'Éditeur français');
    await expect(panels.nth(1).locator('.ProseMirror')).toHaveAttribute('aria-label', 'Deutscher Editor');
    await expect(panels.nth(2).locator('.ProseMirror')).toHaveAttribute('aria-label', 'Rich text editor');
    expect(await page.evaluate(() => (window as unknown as I18nAuditWindow).__MULTI_EDITORS__!.map(editor => editor.getHTML()))).toEqual(originals);
    await page.getByTestId('multi-add-toolbar').click();
    await expect(panels).toHaveCount(4);
    await expect(panels.nth(3).getByRole('checkbox')).toHaveAttribute('aria-label', 'Task status');
    await page.evaluate(() => {
      const win = window as unknown as I18nAuditWindow;
      win.__I18N_REMOVED__ = win.__MULTI_EDITORS__![0]!;
    });
    await panels.nth(0).getByTestId('multi-remove-editor').click();
    await expect(panels).toHaveCount(3);
    await page.evaluate(() => {
      const win = window as unknown as I18nAuditWindow;
      win.__I18N_REMOVED__!.i18n.refresh();
      win.__I18N_REMOVED__!.i18n.set({ locale: 'es', messages: { 'core.taskItem.status': 'Must stay destroyed' } });
      win.__MULTI_EDITORS__![0]!.i18n.set({ locale: 'hr', messages: { 'core.taskItem.status': 'Zadatak' } });
    });
    await expect(panels.nth(0).getByRole('checkbox')).toHaveAttribute('aria-label', 'Zadatak');
    await expect(panels.nth(1).getByRole('checkbox')).toHaveAttribute('aria-label', 'Task status');
    await expect(panels.nth(2).getByRole('checkbox')).toHaveAttribute('aria-label', 'Task status');
    expect(await page.evaluate(() => (window as unknown as I18nAuditWindow).__I18N_REMOVED__!.isDestroyed)).toBe(true);
  });

  test(`${target.name}: caller-owned placeholder text and stored marks survive composition-time localization`, async ({ page }) => {
    await openI18nDemo(page, target, '<p></p>', true);
    const editorRoot = page.locator(target.editorSelector);
    const placeholder = editorRoot.locator('[data-placeholder]');
    await expect(placeholder).toHaveAttribute('data-placeholder', "Press '/' for commands");
    await page.evaluate(() => { (window as unknown as I18nAuditWindow).__DEMO_EDITOR__.commands.toggleBold(); });
    // Synthetic composition exercises the browser event contract, not a native OS IME.
    await editorRoot.dispatchEvent('compositionstart', { data: '' });
    expect(await page.evaluate(() => (window as unknown as I18nAuditWindow).__DEMO_EDITOR__.view.composing)).toBe(true);
    await captureI18nState(page, { paragraph: `${target.editorSelector} p` });
    await translateI18n(page, { 'core.placeholder.default': 'Translated default', 'core.editor.label': 'Éditeur pendant la composition' });
    await expect(placeholder).toHaveAttribute('data-placeholder', "Press '/' for commands");
    expect(await page.evaluate(() => (window as unknown as I18nAuditWindow).__DEMO_EDITOR__.view.composing)).toBe(true);
    await expect(editorRoot).toHaveAttribute('aria-label', 'Rich text editor');
    await expect(editorRoot).toBeFocused();
    await expectI18nStateUnchanged(page, { paragraph: `${target.editorSelector} p` });
    await editorRoot.dispatchEvent('compositionend', { data: '' });
    await settleI18n(page);
    await expect(editorRoot).toHaveAttribute('aria-label', 'Éditeur pendant la composition');
    expect(await page.evaluate(() => {
      const editor = (window as unknown as I18nAuditWindow).__DEMO_EDITOR__;
      return editor.state.storedMarks?.map(mark => mark.type.name);
    })).toEqual(['bold']);
    await page.keyboard.type('Bold survives');
    await expect(editorRoot.locator('strong')).toHaveText('Bold survives');
    await expect(editorRoot).toHaveText('Bold survives');
    await page.evaluate(() => { (window as unknown as I18nAuditWindow).__DEMO_EDITOR__.commands.undo(); });
    await expect(editorRoot).toHaveText('');
    await expect(placeholder).toHaveAttribute('data-placeholder', "Press '/' for commands");
  });
}
