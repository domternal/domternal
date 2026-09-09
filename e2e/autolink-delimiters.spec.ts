import { expect } from '@playwright/test';
import { test } from './fixtures.js';
import { demoTargets } from './targets.js';

interface DemoEditor {
  setContent: (content: string, emit: boolean) => void;
  commands: { focus: (position: 'end') => boolean; undo: () => boolean; redo: () => boolean };
  state: { doc: { firstChild: {
    forEach: (callback: (node: { text?: string; marks: readonly { type: { name: string } }[] }) => void) => void;
  } | null } };
}

for (const target of demoTargets) {
  test(`${target.name}: a typed URL keeps its complete path, query, fragment and destination`, async ({ page }) => {
    await page.goto(target.baseURL);
    await page.waitForFunction(() => Boolean((window as unknown as Record<string, unknown>)['__DEMO_EDITOR__']));
    await page.evaluate(() => {
      const editor = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as DemoEditor;
      editor.setContent('<p></p>', false);
      editor.commands.focus('end');
    });
    const editable = page.locator('.dm-editor .ProseMirror').first();
    await expect(editable).toBeFocused();
    const url = 'https://example.com/path?query=value#section';
    await page.keyboard.type(url);
    await page.keyboard.press('Space');
    await page.keyboard.type('after');
    await expect(editable.locator('a')).toHaveText(url);
    await expect(editable.locator('a')).toHaveAttribute('href', url);
    await expect(editable).toHaveText(`${url} after`);
  });

  test(`${target.name}: leaving an existing URL preserves its custom destination through undo and redo`, async ({ page }) => {
    await page.goto(target.baseURL);
    await page.waitForFunction(() => Boolean((window as unknown as Record<string, unknown>)['__DEMO_EDITOR__']));
    await page.evaluate(() => {
      const editor = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as DemoEditor;
      editor.setContent('<p><a href="https://destination.test" target="_self">https://example.com</a></p>', false);
      editor.commands.focus('end');
    });
    const editable = page.locator('.dm-editor .ProseMirror').first();
    await expect(editable).toBeFocused();
    await page.keyboard.press('Space');
    await page.keyboard.type('after');
    await expect(editable.locator('a')).toHaveText('https://example.com');
    await expect(editable.locator('a')).toHaveAttribute('href', 'https://destination.test');
    await expect(editable.locator('a')).toHaveAttribute('target', '_self');
    await expect(editable).toHaveText('https://example.com after');
    await page.keyboard.press('ControlOrMeta+z');
    await expect(editable).toHaveText('https://example.com');
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(editable).toHaveText('https://example.com after');
    await expect(editable.locator('a')).toHaveText('https://example.com');
    await expect(editable.locator('a')).toHaveAttribute('href', 'https://destination.test');
  });

  test(`${target.name}: typing a URL delimiter ends the link and preserves bold`, async ({ page }) => {
    await page.goto(target.baseURL);
    await page.waitForFunction(() => Boolean((window as unknown as Record<string, unknown>)['__DEMO_EDITOR__']));
    await page.evaluate(() => {
      const editor = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as DemoEditor;
      editor.setContent('<p></p>', false);
    });
    const editable = page.locator('.dm-editor .ProseMirror').first();
    await editable.click();
    await page.keyboard.press('ControlOrMeta+b');
    await page.keyboard.type('https://example.com');
    await page.keyboard.press('Space');
    await page.keyboard.type('following');

    await expect(editable.locator('a')).toHaveText('https://example.com');
    await expect(editable).toHaveText('https://example.com following');
    const formatting = await page.evaluate(() => {
      const editor = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as DemoEditor;
      const result: { text: string | undefined; marks: string[] }[] = [];
      editor.state.doc.firstChild?.forEach(node => {
        result.push({ text: node.text, marks: node.marks.map(mark => mark.type.name).sort() });
      });
      return result;
    });
    expect(formatting).toEqual([
      { text: 'https://example.com', marks: ['bold', 'link'] },
      { text: ' following', marks: ['bold'] },
    ]);
  });

  test(`${target.name}: named link editing keeps the explicit ArrowRight exit`, async ({ page }) => {
    await page.goto(target.baseURL);
    await page.waitForFunction(() => Boolean((window as unknown as Record<string, unknown>)['__DEMO_EDITOR__']));
    await page.evaluate(() => {
      const editor = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as DemoEditor;
      editor.setContent('<p><a href="https://example.com">Named link</a></p>', false);
    });
    const editable = page.locator('.dm-editor .ProseMirror').first();
    await editable.click();
    await page.keyboard.press('End');
    await page.keyboard.type('x');
    await expect(editable.locator('a')).toHaveText('Named linkx');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.type(' after');
    await expect(editable.locator('a')).toHaveText('Named linkx');
    await expect(editable).toHaveText('Named linkx after');
  });
}
