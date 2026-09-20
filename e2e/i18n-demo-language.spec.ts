import { expect, test } from '@playwright/test';
import type { Editor } from '@domternal/core';
import { demoTargets } from './targets.js';

interface DemoWindow {
  __DEMO_EDITOR__: Editor;
  __MULTI_EDITORS__: Editor[];
  __TAB_EDITORS__: Editor[];
}

for (const target of demoTargets) {
  test.describe(`${target.name}: demo language dropdown`, () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(target.baseURL);
      await expect(page.getByRole('combobox', { name: 'Editor language' })).toHaveValue('en');
      await expect(page.locator('.dm-toolbar [aria-label="Bold"]')).toBeVisible();
      await page.waitForFunction(() => {
        const editor = (window as unknown as Partial<DemoWindow>).__DEMO_EDITOR__;
        return editor && !editor.isDestroyed && editor.view.dom.isConnected;
      });
    });

    test('language dropdown translates the current editor without replacing its document or undo history', async ({
      page,
    }) => {
      const language = page.getByTestId('demo-language');
      await page.evaluate(() => {
        const editor = (window as unknown as DemoWindow).__DEMO_EDITOR__;
        editor.setContent('<p>Original English document.</p>', false);
        editor.view.dispatch(editor.state.tr.insertText('Added text. ', 1));
      });
      const before = await page.evaluateHandle(() => {
        const editor = (window as unknown as DemoWindow).__DEMO_EDITOR__;
        return { editor, view: editor.view, doc: editor.state.doc, html: editor.getHTML() };
      });

      await language.selectOption('de');
      await expect(language).toHaveValue('de');
      await expect(page.locator('.dm-toolbar [aria-label="Fett"]')).toBeVisible();
      await expect(page.locator('.dm-toolbar [aria-label="Textausrichtung"]')).toBeVisible();
      await expect(page.locator('.ProseMirror')).toHaveText(
        'Added text. Original English document.'
      );
      expect(
        await before.evaluate((saved) => {
          const editor = (window as unknown as DemoWindow).__DEMO_EDITOR__;
          return (
            editor === saved.editor &&
            editor.view === saved.view &&
            editor.state.doc === saved.doc &&
            editor.getHTML() === saved.html
          );
        })
      ).toBe(true);

      await page.locator('.dm-toolbar [aria-label="Rückgängig"]').click();
      await expect(page.locator('.ProseMirror')).toHaveText('Original English document.');
      await language.selectOption('en');
      await expect(page.locator('.dm-toolbar [aria-label="Bold"]')).toBeVisible();
      await expect(page.locator('.dm-toolbar [aria-label="Text Alignment"]')).toBeVisible();
      await expect(page.locator('.dm-toolbar [aria-label="Fett"]')).toHaveCount(0);
      await expect(page.locator('.ProseMirror')).toHaveText('Original English document.');
      await before.dispose();
    });

    test('language selection survives theme changes and remounting toolbar and Notion modes', async ({
      page,
    }) => {
      await page.getByTestId('demo-language').selectOption('de');
      await page.locator('.theme-toggle').click();
      await expect(page.locator('body')).toHaveClass(/dm-theme-dark/);
      await expect(page.locator('.dm-toolbar [aria-label="Fett"]')).toBeVisible();

      for (const mode of ['custom', 'notion', 'notion-scrollable', 'default']) {
        if (target.name === 'vue' && mode === 'custom') {
          await page.getByRole('button', { name: 'Custom layout', exact: true }).click();
        } else {
          await page
            .getByTestId(`mode-${target.name === 'vue' && mode === 'default' ? 'manual' : mode}`)
            .click();
        }
        await expect(page.getByTestId('demo-language')).toHaveValue('de');
        await expect
          .poll(() =>
            page.evaluate(() => {
              const editor = (window as unknown as Partial<DemoWindow>).__DEMO_EDITOR__;
              if (!editor || editor.isDestroyed || !editor.view.dom.isConnected) return null;
              return {
                locale: editor.i18n.getSnapshot().locale,
                bold: editor.i18n.getSnapshot().messages['core.toolbar.bold'],
              };
            })
          )
          .toEqual({ locale: 'de', bold: 'Fett' });
        if (mode.startsWith('notion')) {
          await page.evaluate(() => {
            const editor = (window as unknown as DemoWindow).__DEMO_EDITOR__;
            editor.setContent('<p>English text stays English.</p>', false);
            editor.commands.setSelection(1, 8);
            editor.commands.focus();
          });
          await expect(page.locator('.dm-bubble-menu [aria-label="Fett"]')).toBeVisible();
        } else {
          await expect(page.locator('.dm-toolbar [aria-label="Fett"]')).toBeVisible();
        }
      }
      await page.getByTestId('demo-language').selectOption('en');
      await expect(page.locator('.dm-toolbar [aria-label="Bold"]')).toBeVisible();
    });

    test('language dropdown updates every existing and newly added editor', async ({ page }) => {
      await page.getByTestId('demo-language').selectOption('de');
      await page.getByTestId('mode-multi').click();
      await expect(page.locator('.multi-editor-panel')).toHaveCount(3);
      await expect(page.locator('.dm-toolbar [aria-label="Fett"]')).toBeVisible();
      await page.getByTestId('multi-add-toolbar').click();
      await expect(page.locator('.multi-editor-panel')).toHaveCount(4);
      await expect(page.locator('.dm-toolbar [aria-label="Fett"]')).toHaveCount(2);
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (window as unknown as Partial<DemoWindow>).__MULTI_EDITORS__
                ?.filter((editor) => !editor.isDestroyed && editor.view.dom.isConnected)
                .map((editor) => editor.i18n.getSnapshot().locale) ?? []
          )
        )
        .toEqual(['de', 'de', 'de', 'de']);

      const before = await page.evaluateHandle(() =>
        (window as unknown as DemoWindow).__MULTI_EDITORS__.map((editor) => ({
          editor,
          doc: editor.state.doc,
        }))
      );
      await page.getByTestId('demo-language').selectOption('en');
      await expect(page.locator('.dm-toolbar [aria-label="Bold"]')).toHaveCount(2);
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (window as unknown as Partial<DemoWindow>).__MULTI_EDITORS__
                ?.filter((editor) => !editor.isDestroyed && editor.view.dom.isConnected)
                .map((editor) => editor.i18n.getSnapshot().locale) ?? []
          )
        )
        .toEqual(['en', 'en', 'en', 'en']);
      expect(
        await before.evaluate((saved) =>
          (window as unknown as DemoWindow).__MULTI_EDITORS__.every(
            (editor, index) =>
              editor === saved[index]?.editor && editor.state.doc === saved[index].doc
          )
        )
      ).toBe(true);
      await before.dispose();
    });

    test('form editors inherit language and update together', async ({ page }) => {
      await page.getByTestId('demo-language').selectOption('de');
      await page.getByTestId('mode-tab').click();
      await expect(page.locator('.ProseMirror')).toHaveCount(2);
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (window as unknown as Partial<DemoWindow>).__TAB_EDITORS__
                ?.filter((editor) => !editor.isDestroyed && editor.view.dom.isConnected)
                .map((editor) => editor.i18n.getSnapshot().locale) ?? []
          )
        )
        .toEqual(['de', 'de']);
      await page.getByTestId('demo-language').selectOption('en');
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (window as unknown as Partial<DemoWindow>).__TAB_EDITORS__
                ?.filter((editor) => !editor.isDestroyed && editor.view.dom.isConnected)
                .map((editor) => editor.i18n.getSnapshot().locale) ?? []
          )
        )
        .toEqual(['en', 'en']);
    });

    if (target.name === 'react' || target.name === 'vue') {
      test('compound and node view modes inherit the language and reset to English', async ({
        page,
      }) => {
        await page.getByTestId('demo-language').selectOption('de');
        for (const mode of ['compound', 'nodeview']) {
          await page.getByTestId(`mode-${mode}`).click();
          await expect(page.locator('.dm-toolbar [aria-label="Fett"]')).toBeVisible();
          await page.getByTestId('demo-language').selectOption('en');
          await expect(page.locator('.dm-toolbar [aria-label="Bold"]')).toBeVisible();
          await page.getByTestId('demo-language').selectOption('de');
        }
      });
    }

    if (target.name === 'angular' || target.name === 'vue') {
      test('language changes preserve the two-way form model without firing an update', async ({
        page,
      }) => {
        await page.getByTestId(target.name === 'angular' ? 'mode-ngmodel' : 'mode-vmodel').click();
        await page.getByTestId('set-initial').click();
        await expect(page.locator('.ProseMirror')).toHaveText('Initial from parent');
        const before = await page.locator('.ProseMirror').elementHandle();
        if (!before) throw new Error('The form model editor is not mounted.');
        const updates = await page.getByTestId('update-count').textContent();
        await page.getByTestId('demo-language').selectOption('de');
        await expect(page.getByTestId('vmodel-output')).toHaveText('<p>Initial from parent</p>');
        await expect(page.getByTestId('update-count')).toHaveText(updates ?? '');
        expect(
          await before.evaluate((element) => element === document.querySelector('.ProseMirror'))
        ).toBe(true);
        await before.dispose();
      });
    }
  });
}
