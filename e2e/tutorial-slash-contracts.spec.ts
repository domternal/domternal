import { expect, type Page } from '@playwright/test';
import { test } from './fixtures.js';
import type { JSONContent } from '@domternal/core';
import type {} from './fixtures/tutorial-menus/main.js';

const FIXTURE = 'http://127.0.0.1:5793/tutorial-menus/';
const MENU = '.dm-slash-command-menu';

async function open(page: Page): Promise<void> {
  await page.goto(FIXTURE);
  await page.waitForFunction(() => Boolean(window.__TUTORIAL_MENUS__));
}

function node(type: string, ...content: JSONContent[]): JSONContent {
  return { type, ...(content.length ? { content } : {}) };
}

const paragraph = (): JSONContent => node('paragraph');
const label = (): JSONContent => node('paragraph', { type: 'text', text: 'Label' });

async function seedEmptyParagraph(page: Page, content: JSONContent): Promise<void> {
  await page.evaluate((serialized) => {
    const doc = JSON.parse(serialized) as JSONContent;
    const { editor, seed } = window.__TUTORIAL_MENUS__;
    seed(doc);
    let position: number | undefined;
    editor.state.doc.descendants((child, pos) => {
      if (child.type.name === 'paragraph' && child.content.size === 0) position = pos + 1;
    });
    if (position === undefined) throw new Error('Expected an empty paragraph.');
    seed(doc, position);
  }, JSON.stringify(content));
  await expect(page.locator('#editor .ProseMirror')).toBeFocused();
}

test('slash icons support custom keys, overrides, fallback and readable missing icons', async ({ page }) => {
  await open(page);
  await seedEmptyParagraph(page, node('doc', paragraph()));
  await page.keyboard.type('/');
  const menu = page.locator(MENU);
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Custom action', exact: true })
    .locator('[data-tutorial-icon="custom"]')).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Overridden heading', exact: true })
    .locator('[data-tutorial-icon="override"]')).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Default bullet', exact: true }).locator('svg')).toBeVisible();
  await expect(page.locator('#toolbar').getByRole('button', { name: 'Display only shortcut', exact: true })
    .locator('svg')).toBeVisible();
  for (const name of ['Intentionally empty icon', 'Missing icon stays readable']) {
    const row = menu.getByRole('menuitem', { name, exact: true });
    await expect(row).toBeVisible();
    await expect(row.locator('svg')).toHaveCount(0);
  }
  await page.keyboard.type('missing');
  await expect(menu.getByRole('menuitem')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(page.locator('#editor .ProseMirror')).toHaveText('missing');
  await expect(menu).toHaveCount(0);
});

test('a distant custom ancestor excludes slash items without changing the floating menu', async ({ page }) => {
  await open(page);
  const nested = node('doc', node('callout', node('blockquote', paragraph())));
  await seedEmptyParagraph(page, nested);
  await page.keyboard.type('/custom');
  await expect(page.locator(`${MENU} [role="status"]`)).toHaveText('No matches');
  await expect(page.locator(`${MENU} [role="menuitem"]`)).toHaveCount(0);
  await page.keyboard.press('Escape');

  // The independent floating surface intentionally keeps the same item.
  await seedEmptyParagraph(page, nested);
  await page.evaluate(() => { window.__TUTORIAL_MENUS__.openFloating(); });
  const floating = page.locator('.dm-floating-menu');
  await expect(floating).toHaveAttribute('data-show', '');
  await expect(floating.locator('[data-floating-menu-item="custom"]')).toBeVisible();
  await floating.locator('[data-floating-menu-item="custom"]').click();
  await expect(page.locator('#editor aside blockquote p')).toHaveText('custom');

  await seedEmptyParagraph(page, node('doc', paragraph()));
  await page.keyboard.type('/custom');
  await expect(page.locator(MENU).getByRole('menuitem', { name: 'Custom action', exact: true })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('#editor .ProseMirror')).toHaveText('custom');
});

for (const scenario of [
  { name: 'bullet label', doc: node('doc', node('bulletList', node('listItem', paragraph()))), hidden: ['Default bullet'], visible: ['Default ordered'] },
  { name: 'bullet child paragraph', doc: node('doc', node('bulletList', node('listItem', label(), paragraph()))), hidden: [], visible: ['Default bullet'] },
  { name: 'different nearest nested list', doc: node('doc', node('bulletList', node('listItem', label(), node('orderedList', node('listItem', paragraph()))))), hidden: ['Default ordered'], visible: ['Default bullet'] },
  { name: 'task label', doc: node('doc', node('taskList', node('taskItem', paragraph()))), hidden: ['Default task'], visible: ['Default bullet'] },
]) {
  test(`slash ancestor compatibility: ${scenario.name}`, async ({ page }) => {
    await open(page);
    await seedEmptyParagraph(page, scenario.doc);
    await page.keyboard.type('/');
    const menu = page.locator(MENU);
    await expect(menu).toBeVisible();
    for (const name of scenario.hidden) await expect(menu.getByRole('menuitem', { name, exact: true })).toHaveCount(0);
    for (const name of scenario.visible) await expect(menu.getByRole('menuitem', { name, exact: true })).toBeVisible();
    await menu.getByRole('menuitem', { name: scenario.visible[0]!, exact: true }).click();
    await expect(menu).toHaveCount(0);
    expect(await page.locator('#editor .ProseMirror').textContent()).not.toContain('/');
    expect(await page.evaluate(() => window.__TUTORIAL_MENUS__.editor.state.doc.textContent))
      .toContain(scenario.visible[0] === 'Default ordered' ? 'ordered' : 'bullet');
  });
}
