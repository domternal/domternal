import type { Page } from '@playwright/test';
import type { DemoTarget } from './targets.js';

const EDITOR = '.dm-editor .ProseMirror';

interface DemoEditor {
  view: { dom: HTMLElement };
  setContent: (content: string, emitUpdate: boolean) => boolean;
}

export async function waitForEditor(page: Page, selector: string): Promise<void> {
  await page.waitForSelector(selector);
  await page.waitForFunction((editorSelector) => {
    const editor = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | DemoEditor
      | undefined;
    return editor?.view.dom === document.querySelector(editorSelector);
  }, selector);
}

export async function openDemo(page: Page, target: DemoTarget, notion = false): Promise<void> {
  await page.goto(target.baseURL + '/');
  await waitForEditor(page, EDITOR);
  if (notion) {
    await page.locator(target.notionToggle).click();
    await waitForEditor(page, target.editorSelector);
  }
}

export async function setContent(page: Page, content: string): Promise<void> {
  await page.evaluate((html) => {
    const editor = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | DemoEditor
      | undefined;
    if (!editor) throw new Error('The demo editor is unavailable.');
    editor.setContent(html, false);
  }, content);
}

