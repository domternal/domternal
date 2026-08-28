import { afterEach, describe, expect, it, vi } from 'vitest';
import { Plugin, PluginKey } from '@domternal/pm/state';
import { Document, Editor, Extension, History, Paragraph, Text } from '../index.js';
import { registerClipboardHTMLPreparation, getClipboardPasteAttemptEvent } from './clipboardHTMLPreparation.js';
import type { ClipboardHTMLReplay } from './clipboardHTMLPreparation.js';
import { armClipboardPasteTransaction } from './clipboardPasteTransaction.js';

const editors: Editor[] = [];
afterEach(() => { for (const editor of editors) editor.destroy(); editors.length = 0; document.body.replaceChildren(); });

function clipboard(html = '<p>Source</p>', text = 'Source'): ClipboardEvent {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: {
    getData: (type: string): string => type === 'text/html' ? html : type === 'text/plain' ? text : '',
  } });
  return event as ClipboardEvent;
}

function mount(): {
  editor: Editor;
  replay: () => ClipboardHTMLReplay;
  calls: { html: ReturnType<typeof vi.fn>; slice: ReturnType<typeof vi.fn>; handle: ReturnType<typeof vi.fn>; gate: ReturnType<typeof vi.fn>; discard: ReturnType<typeof vi.fn> };
  receipts: unknown[];
} {
  let replay: ClipboardHTMLReplay | undefined;
  const key = new PluginKey('preparedReceiptFixture');
  const calls = { html: vi.fn(), slice: vi.fn(), handle: vi.fn(), gate: vi.fn(), discard: vi.fn() };
  const receipts: unknown[] = [];
  const extension = Extension.create({
    name: 'preparationFixture',
    addProseMirrorPlugins: () => [new Plugin({
      view: view => ({ destroy: registerClipboardHTMLPreparation(view, () => {
        calls.gate();
        return { onDeferred(value) { replay = value; }, discard: calls.discard };
      }) }),
      props: {
        transformPastedHTML(html) { calls.html(html); return html; },
        transformPasted(slice) { calls.slice(); return slice; },
        handlePaste(view) { calls.handle(); armClipboardPasteTransaction(view, key, { operationId: 'prepared-fixture' }); return false; },
      },
    })],
  });
  const host = document.body.appendChild(document.createElement('div'));
  const editor = new Editor({
    element: host, content: '<p>Keep</p>', extensions: [Document, Paragraph, Text, History, extension],
    onTransaction: ({ transaction }) => {
      if (transaction.getMeta('paste') === true) receipts.push(transaction.getMeta(key));
    },
  });
  editors.push(editor);
  editor.commands.selectAll();
  return { editor, calls, receipts, replay: () => {
    if (replay === undefined) throw new Error('Expected a deferred replay');
    return replay;
  } };
}

describe('Core editor deferred clipboard integration', () => {
  it('exposes only the active attempt event and restores it after a nested public paste', () => {
    const { editor } = mount();
    const seen: (ClipboardEvent | undefined)[] = [];
    const outer = clipboard('<p>Outer</p>');
    const inner = clipboard('<p>Inner</p>');
    const dispose = registerClipboardHTMLPreparation(editor.view, (_html, context) => {
      seen.push(getClipboardPasteAttemptEvent(editor.view));
      if (context.event === outer) {
        editor.view.pasteHTML('<p>Inner</p>', inner);
        seen.push(getClipboardPasteAttemptEvent(editor.view));
      }
      return undefined;
    });
    expect(getClipboardPasteAttemptEvent(editor.view)).toBeUndefined();
    editor.view.pasteHTML('<p>Outer</p>', outer);
    expect(seen).toEqual([outer, inner, outer]);
    expect(getClipboardPasteAttemptEvent(editor.view)).toBeUndefined();
    dispose();
    editor.destroy();
    expect(getClipboardPasteAttemptEvent(editor.view)).toBeUndefined();
  });

  it.each(['native', 'programmatic', 'dispatchEvent'] as const)('uses one ordinary pipeline and one accepted history step for %s paste', async route => {
    const { editor, calls, receipts, replay } = mount();
    const before = { doc: editor.getJSON(), selection: editor.state.selection.toJSON() };
    const event = clipboard();
    if (route === 'native') editor.view.dom.dispatchEvent(event);
    else if (route === 'dispatchEvent') editor.view.dispatchEvent(event);
    else editor.view.pasteHTML('<p>Source</p>', event);
    expect(editor.getJSON()).toEqual(before.doc);
    expect(editor.state.selection.toJSON()).toEqual(before.selection);
    expect(calls.html).not.toHaveBeenCalled();
    expect(calls.slice).not.toHaveBeenCalled();
    expect(calls.handle).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(replay()('<p>Prepared</p>', clipboard('<p>Prepared</p>', 'Prepared'))).toBe(true);
    expect(editor.state.doc.textContent).toBe('Prepared');
    expect(calls.gate).toHaveBeenCalledOnce();
    expect(calls.html).toHaveBeenCalledExactlyOnceWith('<p>Prepared</p>');
    expect(calls.slice).toHaveBeenCalledOnce();
    expect(calls.handle).toHaveBeenCalledOnce();
    expect(calls.discard).toHaveBeenCalledOnce();
    expect(receipts).toEqual([{ operationId: 'prepared-fixture' }]);
    const after = { doc: editor.getJSON(), selection: editor.state.selection.toJSON() };
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getJSON()).toEqual(before.doc);
    expect(editor.state.selection.toJSON()).toEqual(before.selection);
    expect(editor.commands.redo()).toBe(true);
    expect(editor.getJSON()).toEqual(after.doc);
    expect(editor.state.selection.toJSON()).toEqual(after.selection);
  });

  it('invalidates prepared replay through an empty public text attempt', async () => {
    const { editor, calls, replay } = mount();
    editor.view.pasteHTML('<p>Source</p>', clipboard());
    await Promise.resolve();
    const resume = replay();
    editor.view.pasteText('', clipboard('', ''));
    expect(resume('<p>Stale</p>', clipboard('<p>Stale</p>'))).toBe(false);
    expect(editor.state.doc.textContent).toBe('Keep');
    expect(calls.discard).toHaveBeenCalledOnce();
  });

  it('disposes preparation with the real plugin view and cannot resume into a destroyed editor', async () => {
    const { editor, calls, replay } = mount();
    editor.view.pasteHTML('<p>Source</p>', clipboard());
    await Promise.resolve();
    const resume = replay();
    editor.destroy();
    expect(calls.discard).toHaveBeenCalledOnce();
    expect(resume('<p>Stale</p>', clipboard('<p>Stale</p>'))).toBe(false);
  });
});
