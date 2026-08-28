import { afterEach, describe, expect, it, vi } from 'vitest';
import { Bold, Document, Editor, Extension, History, Paragraph, Text } from '@domternal/core';
import type { EditorOptions } from '@domternal/core';
import { Plugin, TextSelection } from '@domternal/pm/state';
import type { Transaction } from '@domternal/pm/state';
import {
  getPasteAffectedReferences,
  pasteCleanupKey,
  pasteDocumentRevision,
  readPasteReceipt,
  receiptStateField,
} from './operations.js';
import type { PasteAffectedReferences } from './operations.js';

const editors: Editor[] = [];

afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors.length = 0;
});

function mount(options: {
  content?: string;
  plugins?: Plugin[];
  onTransaction?: EditorOptions['onTransaction'];
  withReceipts?: boolean;
} = {}): Editor {
  const Receipts = Extension.create({
    name: 'receiptTestHost',
    addProseMirrorPlugins: () => [
      ...(options.withReceipts === false ? [] : [new Plugin({ key: pasteCleanupKey, state: receiptStateField })]),
      ...(options.plugins ?? []),
    ],
  });
  const editor = new Editor({
    extensions: [Document, Paragraph, Text, Bold, History, Receipts],
    content: options.content ?? '<p>Before old after</p>',
    ...(options.onTransaction === undefined ? {} : { onTransaction: options.onTransaction }),
  });
  editors.push(editor);
  return editor;
}

function tag(transaction: Transaction, id = 'operation'): Transaction {
  return transaction.setMeta(pasteCleanupKey, Object.freeze({ operationId: id })).setMeta('paste', true);
}

function replace(instance: Editor, id = 'operation'): void {
  instance.view.dispatch(tag(instance.state.tr.insertText('New', 8, 11), id));
}

function references(instance: Editor, id = 'operation'): PasteAffectedReferences {
  const value = getPasteAffectedReferences(instance.view, id);
  expect(value).toBeDefined();
  if (value === undefined) throw new Error('The installed receipt must exist');
  return value;
}

describe('installed paste receipts', () => {
  it('records replacement geometry only after the transaction is installed', () => {
    const instance = mount();
    const transaction = tag(instance.state.tr.insertText('New', 8, 11));

    expect(getPasteAffectedReferences(instance.view, 'operation')).toBeUndefined();
    expect(pasteDocumentRevision(instance.view)).toBe(0);
    instance.view.dispatch(transaction);

    expect(instance.getHTML()).toBe('<p>Before New after</p>');
    expect(readPasteReceipt(instance.view, 'operation')).toEqual({
      changed: true,
      references: {
        referenceId: 'operation', precision: 'operation', documentRevision: 1,
        ranges: [{ from: 8, to: 11 }], expired: false,
      },
    });
  });

  it('distinguishes an accepted selection-only transaction from a changed document', () => {
    const instance = mount();

    instance.view.dispatch(tag(instance.state.tr.setSelection(TextSelection.create(instance.state.doc, 4))));

    expect(readPasteReceipt(instance.view, 'operation')).toMatchObject({
      changed: false, references: { documentRevision: 0, ranges: [], expired: false },
    });
    expect(instance.state.selection.from).toBe(4);
  });

  it('does not manufacture references when the plugin is absent or the view is destroyed', () => {
    const absent = mount({ withReceipts: false });
    replace(absent);
    expect(readPasteReceipt(absent.view, 'operation')).toBeUndefined();
    expect(pasteDocumentRevision(absent.view)).toBe(0);

    const instance = mount();
    replace(instance);
    instance.destroy();

    expect(getPasteAffectedReferences(instance.view, 'operation')).toBeUndefined();
    expect(readPasteReceipt(instance.view, 'operation')).toMatchObject({ changed: true,
      references: { expired: true, ranges: [] } });
  });

  it('keeps speculative state.apply receipts out of the installed view', () => {
    const instance = mount();
    const transaction = tag(instance.state.tr.insertText('New', 8, 11));
    const originalState = instance.state;

    const speculative = originalState.apply(transaction);

    expect(pasteCleanupKey.getState(speculative)?.receipts).toHaveLength(1);
    expect(speculative.doc.textContent).toBe('Before New after');
    expect(instance.state).toBe(originalState);
    expect(getPasteAffectedReferences(instance.view, 'operation')).toBeUndefined();
    expect(pasteDocumentRevision(instance.view)).toBe(0);

    instance.view.dispatch(transaction);
    expect(references(instance).documentRevision).toBe(1);
    expect(pasteCleanupKey.getState(instance.state)?.receipts).toHaveLength(1);
  });

  it('does not record or invalidate references for a vetoed transaction', () => {
    const instance = mount({
      plugins: [new Plugin({ filterTransaction: transaction => transaction.getMeta('veto') !== true })],
    });
    replace(instance);
    const accepted = references(instance);
    const previous = instance.state;

    instance.view.dispatch(tag(instance.state.tr.insertText('Blocked', 8, 11), 'blocked').setMeta('veto', true));

    expect(instance.state).toBe(previous);
    expect(readPasteReceipt(instance.view, 'blocked')).toBeUndefined();
    expect(references(instance)).toEqual(accepted);
  });

  it('retains an installed receipt when a post-commit observer throws', () => {
    const observer = vi.fn(() => { throw new Error('Host observer failed'); });
    const instance = mount({ onTransaction: observer });

    expect(() => { replace(instance); }).toThrow('Host observer failed');

    expect(observer).toHaveBeenCalledOnce();
    expect(instance.getHTML()).toBe('<p>Before New after</p>');
    expect(readPasteReceipt(instance.view, 'operation')).toMatchObject({
      changed: true, references: { ranges: [{ from: 8, to: 11 }], expired: false },
    });
  });

  it('returns frozen snapshots that cannot mutate installed or later references', () => {
    const instance = mount();
    replace(instance);
    const first = references(instance);

    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.ranges)).toBe(true);
    expect(Object.isFrozen(first.ranges[0])).toBe(true);
    expect(Reflect.set(first, 'expired', true)).toBe(false);
    expect(Reflect.set(first.ranges, 'length', 0)).toBe(false);
    expect(Reflect.set(first.ranges[0] as object, 'from', 0)).toBe(false);
    instance.view.dispatch(instance.state.tr.insertText('!', 1));

    expect(first).toMatchObject({ documentRevision: 1, ranges: [{ from: 8, to: 11 }], expired: false });
    expect(references(instance)).toMatchObject({ documentRevision: 2, ranges: [{ from: 9, to: 12 }], expired: false });
  });
});

describe('paste operation geometry', () => {
  it('records explicit add-mark and remove-mark ranges with empty step maps', () => {
    const instance = mount();
    const bold = instance.schema.marks['bold'];
    if (bold === undefined) throw new Error('Bold is required');

    instance.view.dispatch(tag(instance.state.tr.addMark(8, 11, bold.create()), 'add-mark'));

    expect(instance.getHTML()).toBe('<p>Before <strong>old</strong> after</p>');
    expect(references(instance, 'add-mark')).toMatchObject({ ranges: [{ from: 8, to: 11 }], expired: false });
    instance.view.dispatch(tag(instance.state.tr.removeMark(8, 11, bold), 'remove-mark'));

    expect(instance.getHTML()).toBe('<p>Before old after</p>');
    expect(readPasteReceipt(instance.view, 'remove-mark')).toMatchObject({
      changed: true, references: { ranges: [{ from: 8, to: 11 }], expired: false },
    });
    expect(references(instance, 'add-mark')).toMatchObject({ ranges: [], expired: true });
  });

  it('maps every root step into final transaction coordinates', () => {
    const instance = mount();
    const transaction = instance.state.tr.insertText('New', 8, 11).insertText('Prefix ', 1);

    instance.view.dispatch(tag(transaction));

    expect(instance.state.doc.textContent).toBe('Prefix Before New after');
    expect(references(instance)).toMatchObject({
      ranges: [{ from: 1, to: 8 }, { from: 15, to: 18 }], expired: false,
    });
  });

  it('maps mark geometry through later root insertions and compacts overlapping ranges', () => {
    const instance = mount();
    const bold = instance.schema.marks['bold'];
    if (bold === undefined) throw new Error('Bold is required');
    const transaction = instance.state.tr.addMark(8, 11, bold.create()).insertText('!', 9).insertText('Prefix ', 1);

    instance.view.dispatch(tag(transaction));

    expect(instance.state.doc.textContent).toBe('Prefix Before o!ld after');
    expect(references(instance)).toMatchObject({
      ranges: [{ from: 1, to: 8 }, { from: 15, to: 19 }], expired: false,
    });
  });

  it('extends the root receipt through accepted appended text and mark normalizers', () => {
    const instance = mount({ plugins: [new Plugin({
      appendTransaction(transactions, _oldState, state) {
        if (!transactions.some(transaction => transaction.getMeta(pasteCleanupKey) !== undefined)) return null;
        const bold = state.schema.marks['bold'];
        if (bold === undefined) throw new Error('Bold is required');
        return state.tr.insertText('!', 11).addMark(8, 12, bold.create());
      },
    })] });

    replace(instance);

    expect(instance.getHTML()).toBe('<p>Before <strong>New!</strong> after</p>');
    expect(references(instance)).toMatchObject({ documentRevision: 2, ranges: [{ from: 8, to: 12 }], expired: false });
    expect(pasteCleanupKey.getState(instance.state)?.receipts).toHaveLength(1);
  });

  it('does not include a vetoed appended normalizer in the root receipt', () => {
    const instance = mount({ plugins: [
      new Plugin({ filterTransaction: transaction => transaction.getMeta('normalizer') !== true }),
      new Plugin({ appendTransaction(transactions, _oldState, state) {
        return transactions.some(transaction => transaction.getMeta(pasteCleanupKey) !== undefined)
          ? state.tr.insertText('!', 11).setMeta('normalizer', true) : null;
      } }),
    ] });

    replace(instance);

    expect(instance.state.doc.textContent).toBe('Before New after');
    expect(references(instance)).toMatchObject({ documentRevision: 1, ranges: [{ from: 8, to: 11 }], expired: false });
  });

  it('ignores an appended descriptor whose root was never installed', () => {
    const instance = mount();
    const uninstalledRoot = tag(instance.state.tr, 'uninstalled');

    instance.view.dispatch(instance.state.tr.insertText('!', 1).setMeta('appendedTransaction', uninstalledRoot));

    expect(instance.state.doc.textContent).toBe('!Before old after');
    expect(getPasteAffectedReferences(instance.view, 'uninstalled')).toBeUndefined();
    expect(pasteDocumentRevision(instance.view)).toBe(1);
  });

  it('tracks a selection-only root that acquires document changes through multiple normalizers', () => {
    const instance = mount({ plugins: [
      new Plugin({ appendTransaction(transactions, _oldState, state) {
        return transactions.some(transaction => transaction.getMeta(pasteCleanupKey) !== undefined)
          ? state.tr.insertText('New', 8, 11).setMeta('firstNormalizer', true) : null;
      } }),
      new Plugin({ appendTransaction(transactions, _oldState, state) {
        return transactions.some(transaction => transaction.getMeta('firstNormalizer') === true)
          ? state.tr.insertText('!', 11).insertText('Prefix ', 1) : null;
      } }),
    ] });

    instance.view.dispatch(tag(instance.state.tr.setSelection(TextSelection.create(instance.state.doc, 4))));

    expect(instance.state.doc.textContent).toBe('Prefix Before New! after');
    expect(readPasteReceipt(instance.view, 'operation')).toMatchObject({
      changed: true,
      references: { documentRevision: 2, ranges: [{ from: 1, to: 8 }, { from: 15, to: 19 }], expired: false },
    });
    expect(pasteCleanupKey.getState(instance.state)?.receipts).toHaveLength(1);
  });
});

describe('short-lived paste references', () => {
  it('maps outside edits and excludes insertions exactly at either boundary', () => {
    const instance = mount();
    replace(instance);

    instance.view.dispatch(instance.state.tr.insertText('!', 8));
    expect(references(instance)).toMatchObject({ ranges: [{ from: 9, to: 12 }], expired: false });
    instance.view.dispatch(instance.state.tr.insertText('?', 12));
    expect(references(instance)).toMatchObject({ ranges: [{ from: 9, to: 12 }], expired: false });
    instance.view.dispatch(instance.state.tr.delete(1, 3));
    expect(references(instance)).toMatchObject({ ranges: [{ from: 7, to: 10 }], expired: false });
    instance.view.dispatch(instance.state.tr.insertText(' later', instance.state.doc.content.size - 1));
    expect(references(instance)).toMatchObject({ ranges: [{ from: 7, to: 10 }], expired: false });
    expect(instance.state.doc.textBetween(7, 10)).toBe('New');
  });

  it('does not invalidate or advance document revision for selection and metadata changes', () => {
    const instance = mount();
    replace(instance);
    const previous = references(instance);

    instance.view.dispatch(instance.state.tr.setSelection(TextSelection.create(instance.state.doc, 2)).setMeta('host', true));

    expect(references(instance)).toEqual(previous);
  });

  it('retains references through mark changes immediately outside their boundaries', () => {
    const instance = mount();
    replace(instance);
    const bold = instance.schema.marks['bold'];
    if (bold === undefined) throw new Error('Bold is required');

    instance.view.dispatch(instance.state.tr.addMark(1, 8, bold.create()).addMark(11, 17, bold.create()));
    expect(references(instance)).toMatchObject({ ranges: [{ from: 8, to: 11 }], expired: false });
    instance.view.dispatch(instance.state.tr.removeMark(1, 8, bold).removeMark(11, 17, bold));

    expect(instance.getHTML()).toBe('<p>Before New after</p>');
    expect(references(instance)).toMatchObject({ documentRevision: 3, ranges: [{ from: 8, to: 11 }], expired: false });
  });

  it.each(['insert', 'delete', 'replace', 'mark'] as const)('expires a reference after an interior %s', (kind) => {
    const instance = mount();
    replace(instance);
    const transaction = instance.state.tr;
    if (kind === 'insert') transaction.insertText('!', 9);
    if (kind === 'delete') transaction.delete(9, 10);
    if (kind === 'replace') transaction.insertText('Changed', 8, 11);
    if (kind === 'mark') {
      const bold = instance.schema.marks['bold'];
      if (bold === undefined) throw new Error('Bold is required');
      transaction.addMark(9, 10, bold.create());
    }

    instance.view.dispatch(transaction);

    expect(references(instance)).toMatchObject({ documentRevision: 2, ranges: [], expired: true });
    instance.view.dispatch(instance.state.tr.insertText('Outside ', 1));
    expect(references(instance)).toMatchObject({ ranges: [], expired: true });
  });

  it('expires deleted and whole-document-replaced content', () => {
    const deleted = mount();
    replace(deleted);
    deleted.view.dispatch(deleted.state.tr.delete(8, 11));
    expect(references(deleted)).toMatchObject({ ranges: [], expired: true });

    const replaced = mount();
    replace(replaced);
    const paragraph = replaced.schema.nodes['paragraph'];
    if (paragraph === undefined) throw new Error('Paragraph is required');
    replaced.view.dispatch(replaced.state.tr.replaceWith(0, replaced.state.doc.content.size, paragraph.create(null, replaced.schema.text('Replacement'))));
    expect(replaced.getHTML()).toBe('<p>Replacement</p>');
    expect(references(replaced)).toMatchObject({ ranges: [], expired: true });
  });

  it('expires undo references and does not revive them when redo restores the content', () => {
    const instance = mount();
    replace(instance);
    expect(instance.commands.undo()).toBe(true);

    expect(instance.getHTML()).toBe('<p>Before old after</p>');
    expect(references(instance)).toMatchObject({ ranges: [], expired: true });
    expect(instance.commands.redo()).toBe(true);
    expect(instance.getHTML()).toBe('<p>Before New after</p>');
    expect(references(instance)).toMatchObject({ ranges: [], expired: true });
  });

  it('keeps unaffected ranges but marks the operation expired when one range is edited', () => {
    const instance = mount();
    instance.view.dispatch(tag(instance.state.tr.insertText('New', 8, 11).insertText('Prefix ', 1)));

    instance.view.dispatch(instance.state.tr.insertText('!', 16));

    expect(references(instance)).toMatchObject({ ranges: [{ from: 1, to: 8 }], expired: true });
  });

  it('retains only the latest bounded set of operations', () => {
    const instance = mount({ content: '<p></p>' });
    for (let index = 0; index < 17; index++) {
      instance.view.dispatch(tag(instance.state.tr.insertText(String(index % 10), instance.state.doc.content.size - 1), `paste-${String(index)}`));
    }

    expect(getPasteAffectedReferences(instance.view, 'paste-0')).toBeUndefined();
    expect(pasteCleanupKey.getState(instance.state)?.receipts).toHaveLength(16);
    expect(references(instance, 'paste-1')).toMatchObject({ documentRevision: 17, ranges: [{ from: 2, to: 3 }], expired: false });
    expect(references(instance, 'paste-16')).toMatchObject({ ranges: [{ from: 17, to: 18 }], expired: false });
  });

  it('expires incomplete geometry when one operation exceeds its range budget', () => {
    const instance = mount({ content: `<p>${'x'.repeat(40)}</p>` });
    const transaction = instance.state.tr;
    for (let index = 0; index < 33; index++) transaction.insertText('!', 1 + index * 2);

    instance.view.dispatch(tag(transaction));

    expect(instance.state.doc.textContent).toBe('!x'.repeat(33) + 'x'.repeat(7));
    const value = references(instance);
    expect(value.expired).toBe(true);
    expect(value.ranges.length).toBeLessThanOrEqual(32);
    expect(value.ranges.every(range => range.from >= 0 && range.to <= instance.state.doc.content.size)).toBe(true);
  });

  it('applies the range budget across the root and its appended normalizer', () => {
    const instance = mount({
      content: `<p>${'x'.repeat(40)}</p>`,
      plugins: [new Plugin({ appendTransaction(transactions, _oldState, state) {
        return transactions.some(transaction => transaction.getMeta(pasteCleanupKey) !== undefined)
          ? state.tr.insertText('?', 66) : null;
      } })],
    });
    const transaction = instance.state.tr;
    for (let index = 0; index < 32; index++) transaction.insertText('!', 1 + index * 2);

    instance.view.dispatch(tag(transaction));

    expect(instance.state.doc.textContent).toBe('!x'.repeat(32) + 'x?xxxxxxx');
    expect(references(instance)).toMatchObject({ documentRevision: 2, ranges: [], expired: true });
  });
});
