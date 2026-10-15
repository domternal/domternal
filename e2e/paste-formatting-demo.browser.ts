import { expect, test } from '@playwright/test';
import type { Editor } from '@domternal/core';

interface DemoWindow { __DEMO_EDITOR__: Editor }

test('the application choice changes the next paste without recreating the editor', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => { errors.push(error.message); });
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as unknown as Partial<DemoWindow>).__DEMO_EDITOR__));
  const choice = page.getByLabel('Paste formatting');
  await expect(choice).toHaveValue('preserve');
  await choice.selectOption('adapt');
  await page.evaluate(() => {
    const editor = (window as unknown as DemoWindow).__DEMO_EDITOR__;
    if (!editor.setContent('<p>Before</p>', false)) throw new Error('Cannot seed demo');
    editor.commands.selectAll();
    editor.view.pasteHTML('<p><strong><span style="color:#ff0000;font-family:Georgia">Chosen paste</span></strong></p>');
  });
  await expect(page.locator('.ProseMirror')).toHaveText('Chosen paste');
  expect(await page.evaluate(() => {
    const doc = (window as unknown as DemoWindow).__DEMO_EDITOR__.state.doc;
    const color: unknown = doc.firstChild?.firstChild?.marks.find(mark => mark.type.name === 'textStyle')?.attrs['color'] ?? null;
    return color;
  })).toBeNull();
  await page.getByTestId('mode-custom').click();
  await expect(choice).toHaveValue('adapt');
  await expect(page.locator('.ProseMirror')).toHaveText('Chosen paste');
  await choice.selectOption('preserve');
  await page.locator('.theme-toggle').click();
  await page.evaluate(() => {
    const editor = (window as unknown as DemoWindow).__DEMO_EDITOR__;
    editor.commands.selectAll();
    editor.view.pasteHTML('<p><strong><span style="color:#ff0000;font-family:Georgia">Kept paste</span></strong></p>');
  });
  expect(await page.evaluate(() => {
    const doc = (window as unknown as DemoWindow).__DEMO_EDITOR__.state.doc;
    const color: unknown = doc.firstChild?.firstChild?.marks.find(mark => mark.type.name === 'textStyle')?.attrs['color'];
    return color;
  })).toBe('#ff0000');
  await expect(choice).toHaveValue('preserve');
  await page.getByTestId('mode-tab').click();
  await expect(choice).toBeHidden();
  await page.getByTestId('mode-default').click();
  await expect(choice).toBeVisible();
  await expect(choice).toHaveValue('preserve');
  expect(errors).toEqual([]);
});

test('the formatting selector is absent when cleanup is explicitly disabled', async ({ page }) => {
  await page.goto('/?paste-cleanup=off');
  await page.waitForFunction(() => Boolean((window as unknown as Partial<DemoWindow>).__DEMO_EDITOR__));
  await expect(page.getByLabel('Paste formatting')).toHaveCount(0);
});
