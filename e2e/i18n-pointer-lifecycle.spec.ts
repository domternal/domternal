import { expect, type Locator, type Page } from '@playwright/test';
import type { Editor, Messages } from '@domternal/core';
import type {} from '@domternal/extension-toc';
import type {} from '@domternal/extension-math';
import type {} from '@domternal/extension-block-controls';
import { test } from './fixtures.js';
import { demoTargets } from './targets.js';
import { openI18nDemo, type I18nAuditWindow } from './i18n-audit-helpers.js';

interface PressWindow extends I18nAuditWindow {
  __I18N_NATIVE_PRESS__?: { label: Element; text: ChildNode; state: Editor['state'] };
}

/** Press the actual glyphs rather than an icon or padding inside the button. */
async function pressTextAcrossLocale(page: Page, label: Locator, messages: Messages, expectedText?: string): Promise<void> {
  await label.scrollIntoViewIfNeeded();
  await expect(label).toBeVisible();
  const point = await label.evaluate(element => {
    const text = element.firstChild;
    if (text?.nodeType !== Node.TEXT_NODE) throw new Error('The label needs a text node.');
    const range = document.createRange();
    range.selectNodeContents(text);
    const box = range.getBoundingClientRect();
    if (!box.width || !box.height) throw new Error('The label text has no rendered bounds.');
    const win = window as unknown as PressWindow;
    win.__I18N_NATIVE_PRESS__ = { label: element, text, state: win.__DEMO_EDITOR__.state };
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  });
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  const during = await page.evaluate(messages => {
    const win = window as unknown as PressWindow;
    const press = win.__I18N_NATIVE_PRESS__!;
    const before = win.__DEMO_EDITOR__.state;
    win.__DEMO_EDITOR__.i18n.set({ locale: 'fr', messages });
    return {
      sameState: win.__DEMO_EDITOR__.state === before,
      sameLabel: press.label.isConnected,
      sameText: press.text.isConnected && press.label.firstChild === press.text,
      text: press.label.textContent,
    };
  }, messages);
  if (expectedText !== undefined) expect.soft(during.text).toBe(expectedText);
  await page.mouse.up();
  const { text: _text, ...identity } = during;
  expect.soft(identity, 'Localization must preserve the native pressed text target.').toEqual({
    sameState: true, sameLabel: true, sameText: true,
  });
}

for (const target of demoTargets) {
  test(`${target.name}: a slash command pressed on its label survives live translation`, async ({ page }) => {
    await openI18nDemo(page, target, '<p></p>', true);
    await page.keyboard.type('/h1');
    const label = page.locator('.dm-slash-command-item-label');
    await expect(label).toHaveText('Heading 1');
    await pressTextAcrossLocale(page, label, { 'core.heading.level': 'Titre français' }, 'Titre français');
    await expect(page.locator(`${target.editorSelector} h1`)).toHaveCount(1);
    await expect(page.locator(target.editorSelector)).not.toContainText('/h1');
    await page.keyboard.type('Author title');
    await expect(page.locator(`${target.editorSelector} h1`)).toHaveText('Author title');
  });

  test(`${target.name}: table of contents text remains clickable during a locale update`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openI18nDemo(page, target,
      '<div data-type="table-of-contents"></div><h1>First author heading</h1><p>Intro</p>'
      + '<h2>Second author heading</h2><p>Body</p>', true);
    const links = page.locator('.dm-toc-block-link');
    await expect(links).toHaveCount(2);
    const firstId = await links.first().getAttribute('data-toc-anchor');
    const secondId = await links.nth(1).getAttribute('data-toc-anchor');
    // Control navigation without a locale change before exercising the native press.
    await links.nth(1).click();
    await expect.poll(() => page.evaluate(() => location.hash.slice(1))).toBe(secondId);
    await links.first().click();
    await expect.poll(() => page.evaluate(() => location.hash.slice(1))).toBe(firstId);
    await pressTextAcrossLocale(page, links.nth(1), { 'toc.outline.label': 'Plan du document' });
    await expect.poll(() => page.evaluate(() => location.hash.slice(1))).toBe(secondId);
    await expect(page.locator(`${target.editorSelector} h2`)).toHaveText('Second author heading');
  });

  test(`${target.name}: expanded outline row text remains clickable during a locale update`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openI18nDemo(page, target,
      '<h1>First author heading</h1><p>Intro</p><h2>Second author heading</h2><p>Body</p>', true);
    const outline = page.locator('.dm-toc-outline');
    await outline.hover();
    await expect(outline).toHaveAttribute('data-state', 'expanded');
    await expect(outline.locator('.dm-toc-outline-card')).toHaveCSS('opacity', '1');
    const row = outline.locator('.dm-toc-outline-row').nth(1);
    const secondId = await row.getAttribute('data-toc-anchor');
    expect(await page.evaluate(() => location.hash.slice(1))).not.toBe(secondId);
    await row.click({ trial: true });
    await expect.poll(() => row.evaluate(element => {
      const range = document.createRange();
      range.selectNodeContents(element.firstChild!);
      const box = range.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return hit !== null && element.contains(hit);
    })).toBe(true);
    await pressTextAcrossLocale(page, row, { 'toc.outline.label': 'Plan traduit' }, 'Second author heading');
    await expect.poll(() => page.evaluate(() => location.hash.slice(1))).toBe(secondId);
    await expect(outline).toHaveAttribute('aria-label', 'Plan traduit');
    await expect(page.locator(`${target.editorSelector} h2`)).toHaveText('Second author heading');
  });
  test(`${target.name}: a block action pressed on its text survives live translation`, async ({ page }) => {
    await openI18nDemo(page, target, '<p>Author paragraph</p>', true);
    await page.locator(`${target.editorSelector} p`).hover();
    await page.locator('.dm-block-handle-drag').click();
    const menu = page.locator('.dm-block-context-menu');
    const duplicate = menu.getByRole('menuitem', { name: 'Duplicate', exact: true });
    await expect(duplicate).toBeVisible();
    await pressTextAcrossLocale(page, duplicate.locator('.dm-block-context-menu-item-label'), {
      'blockControls.context.duplicate': 'Dupliquer le bloc',
    }, 'Dupliquer le bloc');
    await expect(page.locator(`${target.editorSelector} p`)).toHaveText(['Author paragraph', 'Author paragraph']);
    await expect(menu).not.toBeVisible();
  });

  test(`${target.name}: a suggested emoji pressed on its name survives live translation`, async ({ page }) => {
    await openI18nDemo(page, target, '<p></p>');
    await page.keyboard.type(':grinning');
    const name = page.locator('.dm-emoji-suggestion-name').first();
    await expect(name).toHaveText('grinning face');
    await pressTextAcrossLocale(page, name, { 'core.emojiPicker.itemName': 'Nom traduit de cette émoticône' }, 'Nom traduit de cette émoticône');
    await expect(page.locator('.dm-emoji-suggestion')).toHaveCount(0);
    expect(await page.evaluate(() => {
      const names: unknown[] = [];
      (window as unknown as I18nAuditWindow).__DEMO_EDITOR__.state.doc.descendants(node => {
        if (node.type.name === 'emoji') names.push(node.attrs['name']);
      });
      return names;
    })).toEqual(['grinning_face']);
  });

  test(`${target.name}: empty math pressed on its placeholder opens the editor after live translation`, async ({ page }) => {
    await openI18nDemo(page, target, '<p><span data-type="math-inline" data-latex=""></span></p>', true);
    const placeholder = page.locator(`${target.editorSelector} .dm-math-empty`);
    await expect(placeholder).toBeVisible();
    await pressTextAcrossLocale(page, placeholder, { 'math.empty': 'Expression mathématique à modifier' }, 'Expression mathématique à modifier');
    const source = page.locator('.dm-math-popover textarea');
    await expect(source).toBeFocused();
    await expect(source).toHaveValue('');
    await source.fill('x^2');
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => {
      const latex: unknown[] = [];
      (window as unknown as I18nAuditWindow).__DEMO_EDITOR__.state.doc.descendants(node => {
        if (node.type.name === 'mathInline') latex.push(node.attrs['latex']);
      });
      return latex;
    })).toEqual(['x^2']);
  });

}
