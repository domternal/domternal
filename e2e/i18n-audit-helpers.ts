import { expect, type Page } from '@playwright/test';
import type { Editor, I18nDiagnostic, Messages, TransactionEventProps } from '@domternal/core';
import type { DemoTarget } from './targets.js';

export interface I18nAuditWindow {
  __DEMO_EDITOR__: Editor;
  __MULTI_EDITORS__?: Editor[];
  __I18N_AUDIT__?: {
    editor: Editor;
    view: Editor['view'];
    state: Editor['state'];
    html: string;
    nodes: Record<string, Element | null>;
    transactions: number;
    events: { docChanged: boolean; selectionSet: boolean; from: number; to: number; pointer: boolean; uiEvent: unknown }[];
    stop: () => void;
  };
  __I18N_DIAGNOSTICS__?: I18nDiagnostic[];
  __I18N_REFRESH__?: () => void;
  __I18N_REMOVED__?: Editor;
}

export const classicEditor = '.dm-editor .ProseMirror';

export async function settleI18n(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => { resolve(); }));
  }));
}

export async function openI18nDemo(page: Page, target: DemoTarget, content: string, notion = false): Promise<void> {
  await page.goto(target.baseURL);
  if (notion) await page.locator(target.notionToggle).click();
  await expect(page.locator(notion ? target.editorSelector : classicEditor)).toBeVisible();
  await page.waitForFunction(() => Boolean((window as unknown as I18nAuditWindow).__DEMO_EDITOR__));
  await page.evaluate(content => {
    const editor = (window as unknown as I18nAuditWindow).__DEMO_EDITOR__;
    editor.setContent(content, false);
    editor.commands.focus('end');
  }, content);
  await settleI18n(page);
}

export async function captureI18nState(page: Page, selectors: Record<string, string> = {}): Promise<void> {
  await settleI18n(page);
  await page.evaluate(selectors => {
    const win = window as unknown as I18nAuditWindow;
    win.__I18N_AUDIT__?.stop();
    const editor = win.__DEMO_EDITOR__;
    const probe = {
      editor, view: editor.view, state: editor.state, html: editor.getHTML(),
      nodes: Object.fromEntries(Object.entries(selectors).map(([key, selector]) => [key, document.querySelector(selector)])),
      transactions: 0,
      events: [] as NonNullable<I18nAuditWindow['__I18N_AUDIT__']>['events'],
      stop: () => { editor.off('transaction', listener); },
    };
    const listener = ({ transaction }: TransactionEventProps): void => {
      probe.transactions++;
      const uiEvent: unknown = transaction.getMeta('uiEvent');
      probe.events.push({ docChanged: transaction.docChanged, selectionSet: transaction.selectionSet,
        from: transaction.selection.from, to: transaction.selection.to,
        pointer: transaction.getMeta('pointer') === true, uiEvent: uiEvent ?? null });
    };
    editor.on('transaction', listener);
    win.__I18N_AUDIT__ = probe;
  }, selectors);
}

export async function expectI18nStateUnchanged(page: Page, selectors: Record<string, string> = {}): Promise<void> {
  await settleI18n(page);
  const { events, ...state } = await page.evaluate(selectors => {
    const win = window as unknown as I18nAuditWindow;
    const before = win.__I18N_AUDIT__;
    if (!before) throw new Error('Missing localization state capture.');
    const editor = win.__DEMO_EDITOR__;
    return {
      editor: editor === before.editor,
      view: editor.view === before.view,
      state: editor.state === before.state,
      html: editor.getHTML() === before.html,
      nodes: Object.entries(selectors).every(([key, selector]) => {
        const node = document.querySelector(selector);
        return node !== null && node === before.nodes[key];
      }),
      transactions: before.transactions,
      events: before.events,
    };
  }, selectors);
  expect(state, `Unexpected transactions: ${JSON.stringify(events)}`).toEqual({ editor: true, view: true, state: true, html: true, nodes: true, transactions: 0 });
}

export async function translateI18n(page: Page, messages: Messages, locale = 'fr'): Promise<void> {
  await page.evaluate(({ messages, locale }) => {
    (window as unknown as I18nAuditWindow).__DEMO_EDITOR__.i18n.set({ locale, messages });
  }, { messages, locale });
  await settleI18n(page);
}
