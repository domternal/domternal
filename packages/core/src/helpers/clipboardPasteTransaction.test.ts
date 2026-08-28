import { afterEach, describe, expect, it } from 'vitest';
import { Plugin, PluginKey } from '@domternal/pm/state';
import type { Transaction } from '@domternal/pm/state';
import { Editor } from '../Editor.js';
import { Extension } from '../Extension.js';
import { Document } from '../nodes/Document.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Text } from '../nodes/Text.js';
import { armClipboardPasteTransaction } from './clipboardPasteTransaction.js';

const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors) if (!editor.isDestroyed) editor.destroy();
  editors.length = 0;
});

function mount(onTransaction?: (transaction: Transaction, editor: Editor) => void): {
  editor: Editor;
  key: PluginKey<readonly unknown[]>;
} {
  const key = new PluginKey<readonly unknown[]>('pasteReceiptProbe');
  const Receipt = Extension.create({
    name: 'pasteReceiptProbe',
    addProseMirrorPlugins() {
      return [new Plugin<readonly unknown[]>({
        key,
        filterTransaction: transaction => transaction.getMeta('vetoProbe') !== true,
        state: {
          init: () => [],
          apply(transaction, previous) {
            const descriptor: unknown = transaction.getMeta(key);
            return descriptor === undefined ? previous : [...previous, descriptor];
          },
        },
      })];
    },
  });
  const editor: Editor = new Editor({
    extensions: [Document, Paragraph, Text, Receipt],
    content: '<p>Original</p>',
    onTransaction: ({ transaction }) => onTransaction?.(transaction, editor),
  });
  editors.push(editor);
  return { editor, key };
}

describe('one-shot clipboard paste transaction metadata', () => {
  it.each(['paste', 'uiEvent'] as const)('claims a paste identified by %s without consuming ordinary transactions', meta => {
    const { editor, key } = mount();
    armClipboardPasteTransaction(editor.view, key, { operationId: 'operation-1' });
    const ordinary = editor.state.tr.insertText('A', 1);
    editor.view.dispatch(ordinary);
    expect(ordinary.getMeta(key)).toBeUndefined();

    const paste = editor.state.tr.insertText('P', 2).setMeta(meta, meta === 'paste' ? true : 'paste');
    editor.view.dispatch(paste);

    expect(paste.getMeta(key)).toEqual({ operationId: 'operation-1' });
    expect(key.getState(editor.state)).toEqual([{ operationId: 'operation-1' }]);
    const nextPaste = editor.state.tr.insertText('N', 3).setMeta('paste', true);
    editor.view.dispatch(nextPaste);
    expect(nextPaste.getMeta(key)).toBeUndefined();
  });

  it('copies and freezes the descriptor before caller mutation', () => {
    const { editor, key } = mount();
    const descriptor = { operationId: 'original' };
    armClipboardPasteTransaction(editor.view, key, descriptor);
    descriptor.operationId = 'changed';
    const transaction = editor.state.tr.insertText('P', 1).setMeta('paste', true);

    editor.view.dispatch(transaction);

    const captured: unknown = transaction.getMeta(key);
    expect(captured).toEqual({ operationId: 'original' });
    expect(captured).not.toBe(descriptor);
    expect(Object.isFrozen(captured)).toBe(true);
  });

  it('lets a disposer cancel only its own arm, preserving a newer operation', () => {
    const { editor, key } = mount();
    const disposeOld = armClipboardPasteTransaction(editor.view, key, { operationId: 'old' });
    armClipboardPasteTransaction(editor.view, key, { operationId: 'new' });
    disposeOld();
    const transaction = editor.state.tr.insertText('P', 1).setMeta('paste', true);

    editor.view.dispatch(transaction);

    expect(transaction.getMeta(key)).toEqual({ operationId: 'new' });
    const disposeCurrent = armClipboardPasteTransaction(editor.view, key, { operationId: 'cancelled' });
    disposeCurrent();
    const cancelled = editor.state.tr.insertText('C', 1).setMeta('paste', true);
    editor.view.dispatch(cancelled);
    expect(cancelled.getMeta(key)).toBeUndefined();
  });

  it('expires before a later microtask paste and never marks untagged async image insertion', async () => {
    const { editor, key } = mount();
    armClipboardPasteTransaction(editor.view, key, { operationId: 'expired' });
    const placeholder = editor.state.tr.setMeta('uploadPlaceholder', true);
    editor.view.dispatch(placeholder);
    expect(placeholder.getMeta(key)).toBeUndefined();
    await Promise.resolve();
    const laterPaste = editor.state.tr.insertText('Later', 1).setMeta('paste', true);
    editor.view.dispatch(laterPaste);
    expect(laterPaste.getMeta(key)).toBeUndefined();

    armClipboardPasteTransaction(editor.view, key, { operationId: 'not-image' });
    const asyncImage = editor.state.tr.insertText('Unmarked upload result', 1);
    editor.view.dispatch(asyncImage);
    expect(asyncImage.getMeta(key)).toBeUndefined();
  });

  it('isolates arms between editor views', () => {
    const first = mount();
    const second = mount();
    armClipboardPasteTransaction(first.editor.view, first.key, { operationId: 'first' });
    const otherPaste = second.editor.state.tr.insertText('Other', 1).setMeta('paste', true);
    second.editor.view.dispatch(otherPaste);
    expect(otherPaste.getMeta(first.key)).toBeUndefined();
    const firstPaste = first.editor.state.tr.insertText('First', 1).setMeta('paste', true);
    first.editor.view.dispatch(firstPaste);
    expect(firstPaste.getMeta(first.key)).toEqual({ operationId: 'first' });
  });

  it('consumes the arm before a filter veto without recording an accepted receipt', () => {
    const { editor, key } = mount();
    const original = editor.state;
    armClipboardPasteTransaction(editor.view, key, { operationId: 'vetoed' });
    const rejected = editor.state.tr.insertText('Rejected', 1).setMeta('paste', true).setMeta('vetoProbe', true);

    editor.view.dispatch(rejected);

    expect(rejected.getMeta(key)).toEqual({ operationId: 'vetoed' });
    expect(editor.state).toBe(original);
    expect(key.getState(editor.state)).toEqual([]);
    const next = editor.state.tr.insertText('Next', 1).setMeta('paste', true);
    editor.view.dispatch(next);
    expect(next.getMeta(key)).toBeUndefined();
  });

  it('does not claim an arm during speculative state.apply', () => {
    const { editor, key } = mount();
    armClipboardPasteTransaction(editor.view, key, { operationId: 'installed-only' });
    const transaction = editor.state.tr.insertText('P', 1).setMeta('paste', true);
    const speculative = editor.state.apply(transaction);
    expect(transaction.getMeta(key)).toBeUndefined();
    expect(key.getState(speculative)).toEqual([]);
    expect(editor.state.doc.textContent).toBe('Original');

    editor.view.dispatch(transaction);

    expect(transaction.getMeta(key)).toEqual({ operationId: 'installed-only' });
    expect(key.getState(editor.state)).toEqual([{ operationId: 'installed-only' }]);
  });

  it('consumes before observers so a nested paste can receive its own arm', () => {
    const received: unknown[] = [];
    const { editor, key } = mount((transaction, current) => {
      const descriptor: unknown = transaction.getMeta(key);
      received.push(descriptor);
      if (received.length !== 1) return;
      armClipboardPasteTransaction(current.view, key, { operationId: 'inner' });
      current.view.dispatch(current.state.tr.insertText('Inner', 1).setMeta('paste', true));
    });
    armClipboardPasteTransaction(editor.view, key, { operationId: 'outer' });

    editor.view.dispatch(editor.state.tr.insertText('Outer', 1).setMeta('paste', true));

    expect(received).toEqual([{ operationId: 'outer' }, { operationId: 'inner' }]);
    expect(key.getState(editor.state)).toEqual(received);
  });

  it('preserves explicit transaction metadata without consuming another pending operation', () => {
    const { editor, key } = mount();
    const explicit = Object.freeze({ operationId: 'explicit' });
    armClipboardPasteTransaction(editor.view, key, { operationId: 'pending' });
    const marked = editor.state.tr.insertText('Explicit', 1).setMeta('paste', true).setMeta(key, explicit);

    editor.view.dispatch(marked);

    expect(marked.getMeta(key)).toBe(explicit);
    const pending = editor.state.tr.insertText('Pending', 1).setMeta('paste', true);
    editor.view.dispatch(pending);
    expect(pending.getMeta(key)).toEqual({ operationId: 'pending' });
  });

  it('does not claim metadata after the editor has been destroyed', () => {
    const { editor, key } = mount();
    armClipboardPasteTransaction(editor.view, key, { operationId: 'destroyed' });
    const transaction = editor.state.tr.insertText('P', 1).setMeta('paste', true);
    editor.destroy();

    expect(() => { editor.view.dispatch(transaction); }).not.toThrow();
    expect(transaction.getMeta(key)).toBeUndefined();
  });
});
