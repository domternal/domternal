import { expect, type Page } from '@playwright/test';

/** Select a text prefix in a seeded single-paragraph menu fixture. */
export async function selectTextPrefix(
  page: Page,
  editorSelector: string,
  length: number,
): Promise<void> {
  const modelSelection = (): Promise<{ from: number; to: number } | null> => page.evaluate(() => {
    const editor = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | { state: { selection: { from: number; to: number } } }
      | undefined;
    const selection = editor?.state.selection;
    return selection ? { from: selection.from, to: selection.to } : null;
  });

  // These fixtures exercise menu interactions after a text selection exists.
  // Seed it with a ProseMirror transaction, then verify model and DOM.
  await page.locator(editorSelector).focus();
  const selectedText = await page.evaluate((prefixLength) => {
    const editor = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | {
        commands: { focus: (position: 'start') => boolean };
        state: {
          doc: { textBetween: (from: number, to: number) => string };
          selection: { constructor: unknown };
          tr: { setSelection: (selection: unknown) => unknown };
        };
        view: { dispatch: (transaction: unknown) => void };
      }
      | undefined;
    if (!editor?.commands.focus('start')) throw new Error('Cannot focus the menu fixture.');
    const state = editor.state;
    // focus('start') establishes a TextSelection in the seeded paragraph.
    const selectionType = state.selection.constructor as {
      fromJSON: (doc: unknown, json: { anchor: number; head: number }) => unknown;
    };
    editor.view.dispatch(state.tr.setSelection(selectionType.fromJSON(state.doc, {
      anchor: 1,
      head: prefixLength + 1,
    })));
    return state.doc.textBetween(1, prefixLength + 1);
  }, length);
  await expect.poll(modelSelection).toEqual({ from: 1, to: length + 1 });
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ''))
    .toBe(selectedText);
  await expect(page.locator(editorSelector)).toBeFocused();
}
