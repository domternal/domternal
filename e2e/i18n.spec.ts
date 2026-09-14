import { expect, type Page } from '@playwright/test';
import type { Editor, Messages } from '@domternal/core';
import { test } from './fixtures.js';
import { demoTargets, type DemoTarget } from './targets.js';
import { selectTextPrefix } from './menu-selection.js';

interface ProbeWindow {
  __DEMO_EDITOR__: Editor;
  __I18N_PROBE__?: {
    editor: Editor;
    view: Editor['view'];
    state: Editor['state'];
    html: string;
    transactions: number;
    control: Element | null;
    icon: Element | null;
  };
}

async function openDemo(page: Page, target: DemoTarget): Promise<void> {
  await page.goto(target.baseURL);
  await page.waitForFunction(() => Boolean((window as unknown as ProbeWindow).__DEMO_EDITOR__));
  await page.evaluate(() => {
    (window as unknown as ProbeWindow).__DEMO_EDITOR__.setContent('<p>The sentence under the pointer.</p>', false);
  });
  await expect(page.locator('.dm-toolbar [aria-label="Text Alignment"]')).toBeVisible();
}

async function remember(page: Page, selector: string): Promise<void> {
  await page.evaluate((selector) => {
    const win = window as unknown as ProbeWindow;
    const editor = win.__DEMO_EDITOR__;
    const control = document.querySelector(selector);
    const probe = {
      editor, view: editor.view, state: editor.state, html: editor.getHTML(),
      transactions: 0, control, icon: control?.querySelector('svg') ?? null,
    };
    win.__I18N_PROBE__ = probe;
    editor.on('transaction', () => { probe.transactions++; });
  }, selector);
}

async function setMessages(page: Page, messages: Messages, locale = 'de'): Promise<void> {
  await page.evaluate(({ messages, locale }) => {
    (window as unknown as ProbeWindow).__DEMO_EDITOR__.i18n.set({ locale, messages });
  }, { messages, locale });
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => { resolve(); }));
  }));
}

for (const target of demoTargets) {
  test(`${target.name}: i18n preserves the open dropdown, focus and editor state`, async ({ page }) => {
    await openDemo(page, target);
    await page.locator('.dm-toolbar [aria-label="Text Alignment"]').click();
    const left = page.locator('.dm-toolbar-dropdown-panel [aria-label="Align Left"]');
    await expect(left).toBeVisible();
    await left.focus();
    await remember(page, '.dm-toolbar-dropdown-panel [aria-label="Align Left"]');

    const literal = '<img src=x onerror="window.__I18N_INJECTED__=true"> Links';
    await setMessages(page, {
      'core.toolbar.textAlignment': 'Ausrichtung',
      'core.toolbar.alignLeft': literal,
      'core.toolbar.label': 'Formatierung',
    });
    const translated = page.locator('.dm-toolbar-dropdown-panel').getByRole('menuitem', { name: literal, exact: true });
    await expect(translated).toBeVisible();
    await expect(translated).toBeFocused();
    await expect(translated).toHaveAttribute('lang', 'de');
    await expect(translated.locator('img')).toHaveCount(0);
    await expect(page.locator('.dm-toolbar')).toHaveAttribute('aria-label', 'Formatierung');
    expect(await page.evaluate(() => {
      const win = window as unknown as ProbeWindow;
      const probe = win.__I18N_PROBE__!;
      const editor = win.__DEMO_EDITOR__;
      return {
        sameEditor: editor === probe.editor,
        sameView: editor.view === probe.view,
        sameState: editor.state === probe.state,
        sameControl: document.activeElement === probe.control,
        sameHtml: editor.getHTML() === probe.html,
        transactions: probe.transactions,
      };
    })).toEqual({ sameEditor: true, sameView: true, sameState: true, sameControl: true, sameHtml: true, transactions: 0 });

    // An omitted key falls back to English with its own language metadata.
    await expect(page.locator('.dm-toolbar [aria-label="Bold"]')).toHaveAttribute('lang', 'en');
    await setMessages(page, { 'core.toolbar.alignLeft': 'Links neu' });
    await expect(page.getByRole('menuitem', { name: 'Links neu', exact: true })).toBeFocused();
    await setMessages(page, {}, 'en');
    await expect(page.getByRole('menuitem', { name: 'Align Left', exact: true })).toBeFocused();
  });

  test(`${target.name}: a toolbar press survives a locale update`, async ({ page }) => {
    await openDemo(page, target);
    await selectTextPrefix(page, '.dm-editor .ProseMirror', 12);
    const bold = page.locator('.dm-toolbar [aria-label="Bold"]');
    const box = await bold.boundingBox();
    if (!box) throw new Error('The bold control has no box.');
    await remember(page, '.dm-toolbar [aria-label="Bold"]');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await setMessages(page, { 'core.toolbar.bold': 'Fett' });
    expect(await page.evaluate(() => {
      const probe = (window as unknown as ProbeWindow).__I18N_PROBE__!;
      const current = document.querySelector('.dm-toolbar [aria-label="Fett"]');
      return current === probe.control && current?.querySelector('svg') === probe.icon;
    })).toBe(true);
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => (window as unknown as ProbeWindow).__DEMO_EDITOR__.isActive('bold'))).toBe(true);
    // The only undo step is the user's formatting action.
    await page.evaluate(() => { (window as unknown as ProbeWindow).__DEMO_EDITOR__.commands.undo(); });
    await expect.poll(() => page.evaluate(() => (window as unknown as ProbeWindow).__DEMO_EDITOR__.getHTML())).toBe('<p>The sentence under the pointer.</p>');
  });

  test(`${target.name}: a visible bubble menu translates without losing the selection`, async ({ page }) => {
    await openDemo(page, target);
    await selectTextPrefix(page, '.dm-editor .ProseMirror', 12);
    const bubble = page.locator('.dm-bubble-menu');
    await expect(bubble).toHaveAttribute('data-show', '');
    await remember(page, '.dm-bubble-menu [aria-label="Bold"]');
    await setMessages(page, { 'core.toolbar.bold': 'Fett', 'core.bubbleMenu.label': 'Textformatierung' });
    await expect(bubble).toHaveAttribute('aria-label', 'Textformatierung');
    await expect(bubble).toHaveAttribute('data-show', '');
    expect(await page.evaluate(() => {
      const win = window as unknown as ProbeWindow;
      return win.__DEMO_EDITOR__.state.selection.eq(win.__I18N_PROBE__!.state.selection)
        && document.querySelector('.dm-bubble-menu [aria-label="Fett"]') === win.__I18N_PROBE__!.control;
    })).toBe(true);
    await bubble.getByRole('button', { name: 'Fett', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as ProbeWindow).__DEMO_EDITOR__.isActive('bold'))).toBe(true);
  });
}
