import { expect } from '@playwright/test';
import type {} from '@domternal/extension-details';
import type {} from '@domternal/extension-mention';
import type {} from '@domternal/extension-toc';
import { test } from './fixtures.js';
import { demoTargets } from './targets.js';
import { selectTextPrefix } from './menu-selection.js';
import {
  captureI18nState, classicEditor, expectI18nStateUnchanged, openI18nDemo,
  settleI18n, translateI18n, type I18nAuditWindow,
} from './i18n-audit-helpers.js';

for (const target of demoTargets) {
  test(`${target.name}: translated link controls preserve the draft and commit one undoable link`, async ({ page }) => {
    await openI18nDemo(page, target, '<p>Selected link text stays unchanged.</p>');
    await selectTextPrefix(page, classicEditor, 8);
    await page.locator('.dm-toolbar [aria-label="Link"]').click();
    const input = page.locator('.dm-link-popover-input');
    await expect(input).toBeFocused();
    const href = 'https://example.com/draft?lang=en&value=%3Cb%3E';
    await input.fill(href);
    const selectors = { input: '.dm-link-popover-input', apply: '.dm-link-popover-apply' };
    await captureI18nState(page, selectors);
    await translateI18n(page, {
      'core.linkPopover.urlLabel': 'Adresse du lien',
      'core.linkPopover.urlPlaceholder': '<b>Adresse</b>',
      'core.linkPopover.apply': 'Appliquer le lien',
      'core.linkPopover.remove': 'Supprimer le lien',
    });
    await expect(input).toHaveValue(href);
    await expect(input).toBeFocused();
    await expect(input).toHaveAttribute('aria-label', 'Adresse du lien');
    await expect(input).toHaveAttribute('placeholder', '<b>Adresse</b>');
    await expect(input).toHaveAttribute('lang', 'fr');
    await expectI18nStateUnchanged(page, selectors);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Appliquer le lien', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    const link = page.locator(`${classicEditor} a`);
    await expect(link).toHaveText('Selected');
    await expect(link).toHaveAttribute('href', href);
    await expect(page.locator(classicEditor)).toBeFocused();
    await page.evaluate(() => { (window as unknown as I18nAuditWindow).__DEMO_EDITOR__.commands.undo(); });
    await expect(link).toHaveCount(0);
    await expect(page.locator(classicEditor)).toHaveText('Selected link text stays unchanged.');
  });

  test(`${target.name}: details and task chrome translate without replacing open blocks or serializing UI copy`, async ({ page }) => {
    await openI18nDemo(page, target,
      '<details><summary>Author summary</summary><div data-details-content><p>Private body</p></div></details>'
      + '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Author task</p></li></ul><p></p>');
    const toggle = page.locator('[data-type="details"] > button');
    const checkbox = page.locator(`${classicEditor} input[type="checkbox"]`);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('[data-details-content]')).toBeVisible();
    await checkbox.focus();
    const selectors = { toggle: '[data-type="details"] > button', checkbox: `${classicEditor} input[type="checkbox"]` };
    await captureI18nState(page, selectors);
    await translateI18n(page, { 'details.toggle.label': '<b>Déplier</b>', 'core.taskItem.status': 'État de la tâche' });
    await expect(toggle).toHaveAttribute('aria-label', '<b>Déplier</b>');
    await expect(toggle.locator('b')).toHaveCount(0);
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(checkbox).toHaveAttribute('aria-label', 'État de la tâche');
    await expect(checkbox).toHaveAttribute('lang', 'fr');
    await expect(checkbox).not.toBeChecked();
    await expect(checkbox).toBeFocused();
    await expectI18nStateUnchanged(page, selectors);
    await checkbox.check();
    await expect(checkbox).toBeChecked();
    expect(await page.evaluate(() => (window as unknown as I18nAuditWindow).__DEMO_EDITOR__.getHTML()))
      .not.toContain('État de la tâche');
    await page.evaluate(() => { (window as unknown as I18nAuditWindow).__DEMO_EDITOR__.commands.undo(); });
    await expect(checkbox).not.toBeChecked();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  test(`${target.name}: outline translation preserves heading content, navigation targets and focus`, async ({ page }) => {
    await openI18nDemo(page, target,
      '<div data-type="table-of-contents"></div><h1>Author title</h1><p>Intro</p><h2>Second section</h2><p>Body</p>', true);
    const tick = page.locator('.dm-toc-outline-tick').nth(1);
    await expect(page.locator('.dm-toc-block-link')).toHaveCount(2);
    await expect(tick).toHaveAttribute('aria-label', 'Second section (heading 2)');
    await tick.focus();
    const selectors = { tick: '.dm-toc-outline-tick:nth-child(2)', link: '.dm-toc-block-link' };
    await captureI18nState(page, selectors);
    await page.evaluate(() => {
      (window as unknown as I18nAuditWindow).__DEMO_EDITOR__.i18n.set({
        locale: 'fr', messages: {
          'toc.outline.label': 'Plan du document',
          'toc.heading.label': ({ label, level }) => `${label} : titre ${String(level)}`,
          'toc.heading.fallback': ({ level }) => `Titre vide ${String(level)}`,
        },
      });
    });
    await expect(page.locator('.dm-toc-outline')).toHaveAttribute('aria-label', 'Plan du document');
    await expect(tick).toHaveAttribute('aria-label', 'Second section : titre 2');
    await expect(tick).toBeFocused();
    await expect(page.locator('.dm-toc-block-link').nth(1)).toHaveText('Second section');
    // The demo document declares English content independently of the UI locale.
    await expect(page.locator('.dm-toc-block-link').nth(1)).toHaveAttribute('lang', 'en');
    await expectI18nStateUnchanged(page, selectors);
    await page.keyboard.press('Enter');
    await expect(page.locator('.dm-toc-block-link--active')).toHaveText('Second section');
    await expect(page.locator(`${target.editorSelector} h2`)).toHaveText('Second section');
  });

  test(`${target.name}: empty table of contents copy is plain text and preserves editor state`, async ({ page }) => {
    await openI18nDemo(page, target, '<div data-type="table-of-contents"></div><p></p>', true);
    await expect(page.locator('.dm-toc-block-empty')).toBeVisible();
    await captureI18nState(page, { empty: '.dm-toc-block-empty' });
    await translateI18n(page, { 'toc.block.empty': '<b>Ajoutez des titres</b>' });
    await expect(page.locator('.dm-toc-block-empty')).toHaveText('<b>Ajoutez des titres</b>');
    await expect(page.locator('.dm-toc-block-empty b')).toHaveCount(0);
    await expectI18nStateUnchanged(page, { empty: '.dm-toc-block-empty' });
  });

  test(`${target.name}: mention translations retain the query, keyboard choice and caller-owned identity`, async ({ page }) => {
    await openI18nDemo(page, target, '<p></p>');
    await page.keyboard.type('@');
    const menu = page.locator('.dm-mention-suggestion');
    await expect(menu).toBeVisible();
    await page.keyboard.press('ArrowDown');
    const selected = '.dm-mention-suggestion-item[aria-selected="true"]';
    await expect(page.locator(selected)).toHaveText('Bob Smith');
    await captureI18nState(page, { row: selected });
    await translateI18n(page, { 'mention.suggestions.label': 'Personnes', 'mention.suggestions.empty': 'Aucune personne' });
    await expect(menu).toHaveAttribute('aria-label', 'Personnes');
    await expect(menu).toHaveAttribute('lang', 'fr');
    await expect(page.locator(selected)).toHaveText('Bob Smith');
    await expect(page.locator(selected)).toHaveAttribute('lang', '');
    await expect(page.locator(classicEditor)).toHaveText('@');
    await expect(page.locator(classicEditor)).toBeFocused();
    await expectI18nStateUnchanged(page, { row: selected });
    await page.keyboard.press('Enter');
    await expect(menu).toHaveCount(0);
    await expect(page.locator(`${classicEditor} [data-type="mention"]`)).toHaveAttribute('data-id', '2');
    await expect(page.locator(`${classicEditor} [data-type="mention"]`)).toHaveAttribute('data-label', 'Bob Smith');
    await page.keyboard.type(' @no_such_person_987');
    await expect(menu.getByRole('status')).toHaveText('Aucune personne');
    await captureI18nState(page, { empty: '.dm-mention-suggestion-empty' });
    await translateI18n(page, { 'mention.suggestions.empty': '<b>Aucun résultat</b>' });
    await expect(menu.getByRole('status')).toHaveText('<b>Aucun résultat</b>');
    await expect(menu.locator('b')).toHaveCount(0);
    await expectI18nStateUnchanged(page, { empty: '.dm-mention-suggestion-empty' });
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await settleI18n(page);
  });
}
