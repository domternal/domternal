import { afterEach, describe, expect, it, vi } from 'vitest';
import { Plugin, PluginKey, TextSelection } from '@domternal/pm/state';
import type { Transaction } from '@domternal/pm/state';
import { Editor } from './Editor.js';
import { Extension } from './Extension.js';
import { Document } from './nodes/Document.js';
import { Paragraph } from './nodes/Paragraph.js';
import { Text } from './nodes/Text.js';

let editor: Editor | undefined;
afterEach(() => { editor?.destroy(); editor = undefined; });

function mount(options: { vetoAppend?: boolean; throwObserver?: boolean } = {}): {
  editor: Editor;
  order: string[];
  callbackTransactions: Transaction[];
  observedContent: string[];
  receipt: PluginKey<readonly Transaction[]>;
  viewUpdate: ReturnType<typeof vi.fn>;
} {
  const order: string[] = [];
  const callbackTransactions: Transaction[] = [];
  const observedContent: string[] = [];
  const receipt = new PluginKey<readonly Transaction[]>('acceptedTransactionProbe');
  const viewUpdate = vi.fn();
  const Veto = Extension.create({
    name: 'transactionVetoProbe',
    priority: 1000,
    addProseMirrorPlugins() {
      return [new Plugin({
        filterTransaction: transaction => transaction.getMeta('vetoProbe') !== true
          && !(options.vetoAppend === true && transaction.getMeta('appendResultProbe') === true),
      })];
    },
  });
  const Acceptance = Extension.create({
    name: 'transactionAcceptanceProbe',
    addProseMirrorPlugins() {
      return [new Plugin<readonly Transaction[]>({
        key: receipt,
        state: { init: () => [], apply: (transaction, accepted) => [...accepted, transaction] },
        appendTransaction(transactions, _previous, state) {
          if (!transactions.some(transaction => transaction.getMeta('appendProbe') === true)) return null;
          return state.tr.insertText('!', state.doc.content.size - 1).setMeta('appendResultProbe', true);
        },
        view: () => ({ update: viewUpdate }),
      })];
    },
    onTransaction({ transaction }) { order.push('extension:transaction'); callbackTransactions.push(transaction); },
    onUpdate() { order.push('extension:update'); },
    onSelectionUpdate() { order.push('extension:selection'); },
  });
  const instance = new Editor({
    extensions: [Document, Paragraph, Text, Veto, Acceptance],
    content: '<p>Original</p>',
    onTransaction: ({ transaction }) => {
      order.push('option:transaction');
      callbackTransactions.push(transaction);
      observedContent.push(instance.state.doc.textContent);
      if (options.throwObserver === true) throw new Error('Observer failed after installation');
    },
    onUpdate: ({ transaction }) => { order.push('option:update'); callbackTransactions.push(transaction); },
    onSelectionUpdate: () => { order.push('option:selection'); },
  });
  editor = instance;
  instance.on('transaction', ({ transaction }) => { order.push('event:transaction'); callbackTransactions.push(transaction); });
  instance.on('update', ({ transaction }) => { order.push('event:update'); callbackTransactions.push(transaction); });
  instance.on('selectionUpdate', () => { order.push('event:selection'); });
  return { editor: instance, order, callbackTransactions, observedContent, receipt, viewUpdate };
}

describe('Editor accepted transaction lifecycle', () => {
  it('does not install or emit a document transaction rejected by a plugin', () => {
    const { editor: instance, order, receipt, viewUpdate } = mount();
    const original = instance.state;
    const transaction = instance.state.tr.insertText('New', 1, 9).setMeta('vetoProbe', true);

    instance.view.dispatch(transaction);

    expect(instance.state).toBe(original);
    expect(instance.getHTML()).toBe('<p>Original</p>');
    expect(receipt.getState(instance.state)).toEqual([]);
    expect(viewUpdate).not.toHaveBeenCalled();
    expect(order).toEqual([]);
  });

  it('does not emit selection or transaction callbacks for a vetoed selection change', () => {
    const { editor: instance, order, receipt } = mount();
    const selection = instance.state.selection.toJSON();
    const transaction = instance.state.tr.setSelection(TextSelection.create(instance.state.doc, 4)).setMeta('vetoProbe', true);

    instance.view.dispatch(transaction);

    expect(instance.state.selection.toJSON()).toEqual(selection);
    expect(receipt.getState(instance.state)).toEqual([]);
    expect(order).toEqual([]);
  });

  it('installs accepted appended changes before the existing single root callback sequence', () => {
    const { editor: instance, order, callbackTransactions, observedContent, receipt, viewUpdate } = mount();
    const transaction = instance.state.tr.insertText('New', 1, 9).setMeta('appendProbe', true);

    instance.view.dispatch(transaction);

    expect(instance.state.doc.textContent).toBe('New!');
    expect(receipt.getState(instance.state)).toHaveLength(2);
    expect(receipt.getState(instance.state)?.[0]).toBe(transaction);
    expect(receipt.getState(instance.state)?.[1]?.getMeta('appendedTransaction')).toBe(transaction);
    expect(viewUpdate).toHaveBeenCalledTimes(1);
    expect(order).toEqual([
      'event:transaction', 'option:transaction', 'extension:transaction',
      'event:update', 'option:update', 'extension:update',
    ]);
    expect(callbackTransactions.every(value => value === transaction)).toBe(true);
    expect(observedContent).toEqual(['New!']);
  });

  it('keeps an accepted root when another plugin vetoes the appended normalizer', () => {
    const { editor: instance, order, callbackTransactions, receipt } = mount({ vetoAppend: true });
    const transaction = instance.state.tr.insertText('New', 1, 9).setMeta('appendProbe', true);

    instance.view.dispatch(transaction);

    expect(instance.state.doc.textContent).toBe('New');
    expect(receipt.getState(instance.state)).toEqual([transaction]);
    expect(order).toEqual([
      'event:transaction', 'option:transaction', 'extension:transaction',
      'event:update', 'option:update', 'extension:update',
    ]);
    expect(callbackTransactions.every(value => value === transaction)).toBe(true);
  });

  it('preserves the accepted selection callback ordering', () => {
    const { editor: instance, order, receipt } = mount();
    const transaction = instance.state.tr.setSelection(TextSelection.create(instance.state.doc, 4));

    instance.view.dispatch(transaction);

    expect(instance.state.selection.from).toBe(4);
    expect(receipt.getState(instance.state)).toEqual([transaction]);
    expect(order).toEqual([
      'event:transaction', 'option:transaction', 'extension:transaction',
      'event:selection', 'option:selection', 'extension:selection',
    ]);
  });

  it('retains skipUpdate for an accepted root with appended changes', () => {
    const { editor: instance, order, receipt } = mount();
    const transaction = instance.state.tr.insertText('New', 1, 9).setMeta('appendProbe', true).setMeta('skipUpdate', true);

    instance.view.dispatch(transaction);

    expect(instance.state.doc.textContent).toBe('New!');
    expect(receipt.getState(instance.state)).toHaveLength(2);
    expect(order).toEqual(['event:transaction', 'option:transaction', 'extension:transaction']);
  });

  it('retains committed state and receipt when an observer throws after installation', () => {
    const { editor: instance, order, receipt } = mount({ throwObserver: true });
    const transaction = instance.state.tr.insertText('New', 1, 9);

    expect(() => { instance.view.dispatch(transaction); }).toThrow('Observer failed after installation');

    expect(instance.state.doc.textContent).toBe('New');
    expect(receipt.getState(instance.state)).toEqual([transaction]);
    expect(order).toEqual(['event:transaction', 'option:transaction']);
  });
});
