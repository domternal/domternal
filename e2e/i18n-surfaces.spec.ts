import { expect, type Locator, type Page } from '@playwright/test';
import type { Editor, Messages } from '@domternal/core';
import type {} from '@domternal/extension-image';
import type {} from '@domternal/extension-math';
import type {} from '@domternal/extension-table';
import { test } from './fixtures.js';
import { demoTargets, type DemoTarget } from './targets.js';
import { selectTextPrefix } from './menu-selection.js';

interface SurfaceProbe {
  editor: Editor;
  view: Editor['view'];
  state: Editor['state'];
  html: string;
  elements: Record<string, Element>;
  transactions: number;
}
interface SurfaceWindow {
  __DEMO_EDITOR__: Editor;
  __I18N_SURFACE__?: SurfaceProbe;
  __I18N_SURFACE_PRESS__?: { sameState: boolean; sameButton: boolean; sameTarget: boolean };
}

const CLASSIC_EDITOR = '.dm-editor .ProseMirror';
const EMOJI_SEARCH = '.dm-emoji-picker-search input';

async function settle(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => { resolve(); }));
  }));
}

async function openDemo(page: Page, target: DemoTarget, notion = false, content = '<p>The sentence under the pointer.</p>'): Promise<void> {
  await page.goto(target.baseURL);
  if (notion) await page.locator(target.notionToggle).click();
  await expect(page.locator(notion ? target.editorSelector : CLASSIC_EDITOR)).toBeVisible();
  await page.waitForFunction(() => Boolean((window as unknown as SurfaceWindow).__DEMO_EDITOR__));
  await page.evaluate(html => {
    const editor = (window as unknown as SurfaceWindow).__DEMO_EDITOR__;
    editor.setContent(html, false);
    editor.commands.focus('end');
  }, content);
  await settle(page);
}

async function setMessages(page: Page, messages: Messages): Promise<void> {
  await page.evaluate(messages => {
    (window as unknown as SurfaceWindow).__DEMO_EDITOR__.i18n.set({ locale: 'fr', messages });
  }, messages);
  await settle(page);
}

async function remember(page: Page, selectors: Record<string, string>): Promise<void> {
  await settle(page);
  await page.evaluate(selectors => {
    const win = window as unknown as SurfaceWindow;
    const editor = win.__DEMO_EDITOR__;
    const elements = Object.fromEntries(Object.entries(selectors).map(([key, selector]) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`Missing surface: ${selector}`);
      return [key, element];
    }));
    const probe = { editor, view: editor.view, state: editor.state, html: editor.getHTML(), elements, transactions: 0 };
    win.__I18N_SURFACE__ = probe;
    editor.on('transaction', () => { probe.transactions += 1; });
  }, selectors);
}

async function expectUnchanged(page: Page, selectors: Record<string, string>): Promise<void> {
  expect(await page.evaluate(selectors => {
    const win = window as unknown as SurfaceWindow;
    const probe = win.__I18N_SURFACE__;
    if (!probe) throw new Error('Missing surface snapshot.');
    const editor = win.__DEMO_EDITOR__;
    return {
      sameEditor: editor === probe.editor,
      sameView: editor.view === probe.view,
      sameState: editor.state === probe.state,
      sameHtml: editor.getHTML() === probe.html,
      sameNodes: Object.entries(selectors).every(([key, selector]) => document.querySelector(selector) === probe.elements[key]),
      transactions: probe.transactions,
    };
  }, selectors)).toEqual({ sameEditor: true, sameView: true, sameState: true, sameHtml: true, sameNodes: true, transactions: 0 });
}

/** Change locale during an actual native press, before mouseup and activation. */
async function pressAcrossLocale(page: Page, button: Locator, messages: Messages): Promise<void> {
  await button.evaluate((element, messages) => {
    const win = window as unknown as SurfaceWindow;
    const editor = win.__DEMO_EDITOR__;
    element.addEventListener('mousedown', event => {
      const state = editor.state;
      const pressed = event.target as Node;
      editor.i18n.set({ locale: 'fr', messages });
      element.addEventListener('mouseup', () => {
        win.__I18N_SURFACE_PRESS__ = {
          sameState: editor.state === state,
          sameButton: element.isConnected,
          sameTarget: pressed.isConnected && element.contains(pressed),
        };
      }, { once: true });
    }, { once: true });
  }, messages);
  await button.click({ delay: 150 });
  expect(await page.evaluate(() => (window as unknown as SurfaceWindow).__I18N_SURFACE_PRESS__))
    .toEqual({ sameState: true, sameButton: true, sameTarget: true });
}

async function openEmoji(page: Page): Promise<void> {
  await page.locator('.dm-toolbar [aria-label="Insert Emoji"]').click();
  await expect(page.locator(EMOJI_SEARCH)).toBeFocused();
}

async function selectDraft(page: Page, selector: string, value: string): Promise<void> {
  const field = page.locator(selector);
  await field.fill(value);
  await field.evaluate(element => {
    (element as HTMLInputElement | HTMLTextAreaElement).setSelectionRange(2, 6);
  });
}

async function expectDraft(page: Page, selector: string, value: string): Promise<void> {
  const field = page.locator(selector);
  await expect(field).toHaveValue(value);
  await expect(field).toBeFocused();
  expect(await field.evaluate(element => {
    const input = element as HTMLInputElement | HTMLTextAreaElement;
    return [input.selectionStart, input.selectionEnd];
  })).toEqual([2, Math.min(6, value.length)]);
}

for (const target of demoTargets) {
  test(`${target.name}: emoji locale changes preserve search, caret and the selected category`, async ({ page }) => {
    await openDemo(page, target);
    await openEmoji(page);
    await page.getByRole('tab', { name: 'Animals & Nature', exact: true }).click();
    await expect(page.locator('.dm-emoji-swatch:focus')).toBeVisible();
    await selectDraft(page, EMOJI_SEARCH, 'smile');
    const selectors = { input: EMOJI_SEARCH, tab: '.dm-emoji-picker-tab[aria-selected="true"]' };
    await remember(page, selectors);
    await setMessages(page, {
      'core.emojiPicker.label': 'Émojis',
      'core.emojiPicker.searchLabel': 'Rechercher un émoji',
      'core.emojiPicker.searchPlaceholder': '<b>Rechercher</b>',
      'core.emojiPicker.category.animalsNature': 'Animaux et nature',
    });
    await expect(page.getByRole('dialog', { name: 'Émojis', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Animaux et nature', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator(EMOJI_SEARCH)).toHaveAttribute('placeholder', '<b>Rechercher</b>');
    await expectDraft(page, EMOJI_SEARCH, 'smile');
    await expectUnchanged(page, selectors);
    await page.locator(EMOJI_SEARCH).fill('no_such_emoji_987654');
    await setMessages(page, { 'core.emojiPicker.empty': '<b>Aucun résultat</b>' });
    await expect(page.locator('.dm-emoji-picker-empty')).toHaveText('<b>Aucun résultat</b>');
    await expect(page.locator('.dm-emoji-picker b')).toHaveCount(0);
  });

  test(`${target.name}: a pressed emoji survives translated labels and inserts the stable emoji identity`, async ({ page }) => {
    await openDemo(page, target);
    await openEmoji(page);
    await page.locator(EMOJI_SEARCH).fill('grinning');
    const button = page.locator('.dm-emoji-swatch').first();
    const name = await button.getAttribute('data-emoji-name');
    expect(name).toBeTruthy();
    await pressAcrossLocale(page, button, { 'core.emojiPicker.itemName': 'Émoji traduit' });
    await expect(page.locator('.dm-emoji-picker')).not.toBeVisible();
    expect(await page.evaluate(() => {
      const names: unknown[] = [];
      (window as unknown as SurfaceWindow).__DEMO_EDITOR__.state.doc.descendants(node => {
        if (node.type.name === 'emoji') names.push(node.attrs['name']);
      });
      return names;
    })).toEqual([name]);
  });

  test(`${target.name}: the color picker preserves focused swatches and applies the original color token`, async ({ page }) => {
    await openDemo(page, target, true);
    await selectTextPrefix(page, target.editorSelector, 12);
    await page.locator('.dm-ncp-trigger').click();
    const selector = '.dm-notion-color-picker .dm-ncp-swatch--text[data-color="red"]';
    const swatch = page.locator(selector);
    await expect(page.locator('.dm-notion-color-picker')).toBeVisible();
    await settle(page);
    await swatch.focus();
    await remember(page, { swatch: selector });
    await setMessages(page, { 'core.colorPicker.label': 'Couleurs', 'core.colorPicker.textSwatch': 'Texte traduit' });
    await expect(page.getByRole('dialog', { name: 'Couleurs', exact: true })).toBeVisible();
    await expect(swatch).toBeFocused();
    await expect(swatch).toHaveAttribute('aria-label', 'Texte traduit');
    await expectUnchanged(page, { swatch: selector });
    await pressAcrossLocale(page, swatch, { 'core.colorPicker.textSwatch': 'Couleur du texte' });
    await expect(page.locator(`${target.editorSelector} [data-text-color="red"]`)).toHaveText('The sentence');
  });

  test(`${target.name}: an open hex palette retains its color value across a translated pointer press`, async ({ page }) => {
    await openDemo(page, target);
    await selectTextPrefix(page, CLASSIC_EDITOR, 12);
    await page.locator('.dm-toolbar [aria-label="Text Color"]').click();
    const swatch = page.locator('.dm-color-palette [aria-label="#e03131"]');
    await expect(swatch).toBeVisible();
    await pressAcrossLocale(page, swatch, { 'core.toolbar.textColor': 'Couleur', 'core.toolbar.textColorDefault': 'Par défaut' });
    await expect(page.locator(`${CLASSIC_EDITOR} span[style*="color"]`)).toHaveCSS('color', 'rgb(224, 49, 49)');
    await expect(page.locator(`${CLASSIC_EDITOR} span[style*="color"]`)).toHaveText('The sentence');
  });

  test(`${target.name}: an open slash query and its pending action survive translation`, async ({ page }) => {
    await openDemo(page, target, true, '<p></p>');
    await expect(page.locator(target.editorSelector)).toBeFocused();
    await page.keyboard.type('/h1');
    const selector = '.dm-slash-command-item';
    const item = page.locator(selector);
    await expect(item).toHaveCount(1);
    await expect(item).toHaveAttribute('aria-label', 'Heading 1');
    await remember(page, { item: selector });
    await setMessages(page, { 'core.heading.level': 'Titre', 'core.floatingMenu.label': 'Insérer un bloc' });
    await expect(item).toHaveAttribute('aria-label', 'Titre');
    await expect(page.locator(target.editorSelector)).toHaveText('/h1');
    await expect(page.locator(target.editorSelector)).toBeFocused();
    await expectUnchanged(page, { item: selector });
    await pressAcrossLocale(page, item, { 'core.heading.level': 'Titre traduit' });
    await expect(page.locator(`${target.editorSelector} h1`)).toHaveCount(1);
    await expect(page.locator(target.editorSelector)).not.toContainText('/h1');
  });

  test(`${target.name}: image insertion keeps the unsaved URL and caret while translating its controls`, async ({ page }) => {
    await openDemo(page, target);
    await page.locator('.dm-toolbar [aria-label="Insert Image"]').click();
    const selector = '.dm-image-popover-input';
    const draft = 'https://example.com/unsaved-image.png';
    await selectDraft(page, selector, draft);
    await remember(page, { input: selector });
    await setMessages(page, {
      'image.popover.urlLabel': 'Adresse de l’image', 'image.popover.urlPlaceholder': 'Adresse', 'image.popover.insert': 'Insérer l’image',
    });
    await expect(page.locator(selector)).toHaveAttribute('aria-label', 'Adresse de l’image');
    await expect(page.locator('.dm-image-popover-apply')).toHaveAttribute('aria-label', 'Insérer l’image');
    await expectDraft(page, selector, draft);
    await expectUnchanged(page, { input: selector });
    await page.keyboard.press('Escape');
    await expect(page.locator('.dm-image-popover')).not.toBeVisible();
    await expect(page.locator(`${CLASSIC_EDITOR} img`)).toHaveCount(0);
  });

  test(`${target.name}: table row options keep their pending action during translation`, async ({ page }) => {
    await openDemo(page, target, true, '<table><tbody><tr><td><p>One</p></td><td><p>Two</p></td></tr><tr><td><p>Three</p></td><td><p>Four</p></td></tr></tbody></table><p></p>');
    await page.locator(`${target.editorSelector} td`).first().hover();
    await page.locator('.dm-table-row-handle').click();
    const selector = '.dm-table-controls-dropdown [aria-label="Insert Row Below"]';
    const item = page.locator(selector);
    await expect(item).toBeVisible();
    await pressAcrossLocale(page, item, { 'table.controls.rowOptions': 'Options de ligne', 'table.row.insertBelow': 'Insérer en dessous' });
    await expect(page.locator(`${target.editorSelector} tr`)).toHaveCount(3);
    await expect(page.locator(`${target.editorSelector} tr`).first()).toContainText('One');
    await expect(page.locator(`${target.editorSelector} tr`).nth(1)).toHaveText('');
    await expect(page.locator(`${target.editorSelector} tr`).nth(2)).toContainText('Three');
  });

  test(`${target.name}: an open math editor preserves its source draft and selection across translation`, async ({ page }) => {
    await openDemo(page, target, true, '<p><span data-type="math-inline" data-latex="x^2"></span></p>');
    await page.locator(`${target.editorSelector} .dm-math-inline`).click();
    const selector = '.dm-math-popover textarea';
    const draft = '\\frac{alpha}{beta}';
    await selectDraft(page, selector, draft);
    await remember(page, { input: selector });
    await setMessages(page, { 'math.source.label': 'Source LaTeX', 'math.preview.placeholder': 'Aperçu' });
    await expect(page.locator(selector)).toHaveAttribute('aria-label', 'Source LaTeX');
    await expect(page.locator('.dm-math-popover-preview')).toHaveAttribute('data-placeholder', 'Aperçu');
    await expectDraft(page, selector, draft);
    await expectUnchanged(page, { input: selector });
    await page.keyboard.press('Escape');
    await expect(page.locator('.dm-math-popover')).not.toBeVisible();
    expect(await page.evaluate(() => {
      const formulas: unknown[] = [];
      (window as unknown as SurfaceWindow).__DEMO_EDITOR__.state.doc.descendants(node => {
        if (node.type.name === 'mathInline') formulas.push(node.attrs['latex']);
      });
      return formulas;
    })).toEqual(['x^2']);
  });
}
