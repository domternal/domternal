import { afterEach, describe, expect, it, vi } from 'vitest';
import { Plugin, PluginKey, TextSelection } from '@domternal/pm/state';
import type { Transaction } from '@domternal/pm/state';
import { Editor } from './Editor.js';
import { Extension } from './Extension.js';
import { Document } from './nodes/Document.js';
import { Paragraph } from './nodes/Paragraph.js';
import { Text } from './nodes/Text.js';
import { BulletList } from './nodes/BulletList.js';
import { ListItem } from './nodes/ListItem.js';
import { Heading } from './nodes/Heading.js';
import { TrailingNode } from './extensions/TrailingNode.js';

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

describe('Editor callback contract for appended transactions', () => {
  interface Props { transaction: Transaction; appendedTransactions?: readonly Transaction[] }

  function mountAppending(): {
    editor: Editor;
    order: string[];
    payloads: { name: string; props: Props }[];
    hookProps: Props[];
  } {
    const order: string[] = [];
    const payloads: { name: string; props: Props }[] = [];
    const hookProps: Props[] = [];
    const Appender = Extension.create({
      name: 'appendedContractProbe',
      addProseMirrorPlugins() {
        return [new Plugin({
          filterTransaction: transaction => transaction.getMeta('vetoProbe') !== true,
          appendTransaction(transactions, _previous, state) {
            if (transactions.some(transaction => transaction.getMeta('appendDocProbe') === true)) {
              return state.tr.insertText('!', state.doc.content.size - 1);
            }
            if (transactions.some(transaction => transaction.getMeta('appendSelectionProbe') === true)) {
              return state.tr.setSelection(TextSelection.create(state.doc, 3));
            }
            return null;
          },
        })];
      },
      onTransaction(props) { order.push('extension:transaction'); hookProps.push(props); },
      onUpdate() { order.push('extension:update'); },
      onSelectionUpdate() { order.push('extension:selection'); },
    });
    const instance = new Editor({
      extensions: [Document, Paragraph, Text, Appender],
      content: '<p>Original</p>',
      onTransaction: props => { order.push('option:transaction'); payloads.push({ name: 'option:transaction', props }); },
      onUpdate: props => { order.push('option:update'); payloads.push({ name: 'option:update', props }); },
      onSelectionUpdate: props => { order.push('option:selection'); payloads.push({ name: 'option:selection', props }); },
    });
    editor = instance;
    instance.on('transaction', props => { order.push('event:transaction'); payloads.push({ name: 'event:transaction', props }); });
    instance.on('update', props => { order.push('event:update'); payloads.push({ name: 'event:update', props }); });
    instance.on('selectionUpdate', props => { order.push('event:selection'); payloads.push({ name: 'event:selection', props }); });
    return { editor: instance, order, payloads, hookProps };
  }

  it('fires selectionUpdate for the root selection move, then update, when only an appended transaction changed the document', () => {
    const { editor: instance, order, payloads } = mountAppending();
    const root = instance.state.tr.setSelection(TextSelection.create(instance.state.doc, 4)).setMeta('appendDocProbe', true);

    instance.view.dispatch(root);

    expect(instance.state.doc.textContent).toBe('Original!');
    expect(order).toEqual([
      'event:transaction', 'option:transaction', 'extension:transaction',
      'event:selection', 'option:selection', 'extension:selection',
      'event:update', 'option:update', 'extension:update',
    ]);
    const update = payloads.find(entry => entry.name === 'event:update');
    expect(update?.props.transaction).toBe(root);
    expect(update?.props.transaction.docChanged).toBe(false);
    expect(update?.props.appendedTransactions).toHaveLength(1);
    expect(update?.props.appendedTransactions?.[0]?.docChanged).toBe(true);
    expect(update?.props.appendedTransactions?.[0]?.getMeta('appendedTransaction')).toBe(root);
  });

  it('fires selectionUpdate when only an appended transaction set the selection', () => {
    const { editor: instance, order, payloads } = mountAppending();
    const root = instance.state.tr.setMeta('appendSelectionProbe', true);

    instance.view.dispatch(root);

    expect(instance.state.selection.from).toBe(3);
    expect(order).toEqual([
      'event:transaction', 'option:transaction', 'extension:transaction',
      'event:selection', 'option:selection', 'extension:selection',
    ]);
    const selection = payloads.find(entry => entry.name === 'event:selection');
    expect(selection?.props.transaction).toBe(root);
    expect(selection?.props.appendedTransactions).toHaveLength(1);
  });

  it('fires only update when the root changed the document, whatever an appended transaction did', () => {
    const { editor: instance, order } = mountAppending();

    instance.view.dispatch(instance.state.tr.insertText('X', 1).setMeta('appendSelectionProbe', true));

    expect(instance.state.selection.from).toBe(3);
    expect(order).toEqual([
      'event:transaction', 'option:transaction', 'extension:transaction',
      'event:update', 'option:update', 'extension:update',
    ]);
  });

  it('fires only update when a root that set no selection gets an appended document change', () => {
    const { editor: instance, order } = mountAppending();

    instance.view.dispatch(instance.state.tr.setMeta('appendDocProbe', true));

    expect(instance.state.doc.textContent).toBe('Original!');
    expect(order).toEqual([
      'event:transaction', 'option:transaction', 'extension:transaction',
      'event:update', 'option:update', 'extension:update',
    ]);
  });

  it('keeps selectionUpdate for the root selection move when skipUpdate holds back the appended change', () => {
    const { editor: instance, order } = mountAppending();

    instance.view.dispatch(instance.state.tr.setSelection(TextSelection.create(instance.state.doc, 4))
      .setMeta('appendDocProbe', true).setMeta('skipUpdate', true));

    expect(instance.state.doc.textContent).toBe('Original!');
    expect(order).toEqual([
      'event:transaction', 'option:transaction', 'extension:transaction',
      'event:selection', 'option:selection', 'extension:selection',
    ]);
  });

  it('reports a click that TrailingNode answers with a paragraph as a selection move and a document change', () => {
    const calls: string[] = [];
    const instance = new Editor({
      extensions: [Document, Paragraph, Text, Heading, TrailingNode],
      content: '<p>intro text</p><h2>Last</h2>',
      onSelectionUpdate: () => { calls.push('selection'); },
      onUpdate: () => { calls.push('update'); },
    });
    editor = instance;

    instance.view.dispatch(instance.state.tr.setSelection(TextSelection.create(instance.state.doc, 3)));

    expect(calls).toEqual(['selection', 'update']);
    expect(instance.getHTML()).toBe('<p>intro text</p><h2>Last</h2><p></p>');
  });

  it('fires neither update nor selectionUpdate for an accepted meta-only transaction', () => {
    const { editor: instance, order } = mountAppending();

    instance.view.dispatch(instance.state.tr.setMeta('unrelated', true));

    expect(order).toEqual(['event:transaction', 'option:transaction', 'extension:transaction']);
  });

  it('passes appendedTransactions, empty when there are none, to events, options and extension hooks', () => {
    const { editor: instance, payloads, hookProps } = mountAppending();
    const root = instance.state.tr.insertText('X', 1);

    instance.view.dispatch(root);

    expect(payloads.map(entry => entry.name)).toEqual([
      'event:transaction', 'option:transaction', 'event:update', 'option:update',
    ]);
    for (const { props } of [...payloads, ...hookProps.map(props => ({ props }))]) {
      expect(props.transaction).toBe(root);
      expect(props.appendedTransactions).toEqual([]);
    }
    expect(hookProps).toHaveLength(1);
  });

  it('passes the appended transactions in order to the extension onTransaction hook', () => {
    const { editor: instance, hookProps } = mountAppending();
    const root = instance.state.tr.insertText('X', 1).setMeta('appendDocProbe', true);

    instance.view.dispatch(root);

    expect(hookProps).toHaveLength(1);
    expect(hookProps[0]?.transaction).toBe(root);
    expect(hookProps[0]?.appendedTransactions).toHaveLength(1);
    expect(instance.state.doc.textContent).toBe('XOriginal!');
  });

  it('emits nothing for a vetoed root even when a plugin would have appended a document change', () => {
    const { editor: instance, order } = mountAppending();
    const original = instance.state;

    instance.view.dispatch(instance.state.tr.setSelection(TextSelection.create(instance.state.doc, 4))
      .setMeta('appendDocProbe', true).setMeta('vetoProbe', true));

    expect(instance.state).toBe(original);
    expect(order).toEqual([]);
  });

  it('emits nothing for a vetoed transaction that only sets stored marks', () => {
    const { editor: instance, order } = mountAppending();
    const original = instance.state;

    instance.view.dispatch(instance.state.tr.setStoredMarks([]).setMeta('vetoProbe', true));

    expect(instance.state).toBe(original);
    expect(order).toEqual([]);
  });

  it('keeps skipUpdate on the root for a change that only an appended transaction made', () => {
    const { editor: instance, order } = mountAppending();

    instance.view.dispatch(instance.state.tr.setMeta('appendDocProbe', true).setMeta('skipUpdate', true));

    expect(instance.state.doc.textContent).toBe('Original!');
    expect(order).toEqual(['event:transaction', 'option:transaction', 'extension:transaction']);
  });

  it('stops the callback sequence when a transaction listener destroys the editor', () => {
    const { editor: instance, order } = mountAppending();
    const errors: string[] = [];
    instance.on('error', ({ context }) => { errors.push(context); });
    instance.on('transaction', () => { order.push('event:destroy'); instance.destroy(); });

    expect(() => { instance.view.dispatch(instance.state.tr.insertText('X', 1)); }).not.toThrow();

    expect(instance.isDestroyed).toBe(true);
    expect(order).toEqual(['event:transaction', 'event:destroy']);
    expect(errors).toEqual([]);
  });

  it('stops the callback sequence when the onTransaction option destroys the editor', () => {
    const order: string[] = [];
    const instance = new Editor({
      extensions: [Document, Paragraph, Text, Extension.create({
        name: 'destroyProbeHooks',
        onTransaction() { order.push('extension:transaction'); },
        onUpdate() { order.push('extension:update'); },
      })],
      content: '<p>Original</p>',
      onTransaction: () => { order.push('option:transaction'); instance.destroy(); },
      onUpdate: () => { order.push('option:update'); },
    });
    editor = instance;

    instance.view.dispatch(instance.state.tr.insertText('X', 1));

    expect(order).toEqual(['option:transaction']);
  });

  it('stops the remaining extension hooks when an extension hook destroys the editor', () => {
    const order: string[] = [];
    const First = Extension.create({
      name: 'destroyingHook',
      priority: 200,
      onTransaction() { order.push('first:transaction'); editor?.destroy(); },
    });
    const Second = Extension.create({
      name: 'laterHook',
      priority: 100,
      onTransaction() { order.push('second:transaction'); },
      onUpdate() { order.push('second:update'); },
    });
    editor = new Editor({
      extensions: [Document, Paragraph, Text, First, Second],
      content: '<p>Original</p>',
      onUpdate: () => { order.push('option:update'); },
    });

    editor.view.dispatch(editor.state.tr.insertText('X', 1));

    expect(order).toEqual(['first:transaction']);
    expect(editor.isDestroyed).toBe(true);
  });

  it('stops before update when a selectionUpdate or contentDiagnostic listener destroys the editor', () => {
    const { editor: instance, order } = mountAppending();
    instance.on('selectionUpdate', () => { order.push('event:destroy'); instance.destroy(); });

    instance.view.dispatch(instance.state.tr.setSelection(TextSelection.create(instance.state.doc, 4)));

    expect(order).toEqual([
      'event:transaction', 'option:transaction', 'extension:transaction', 'event:selection', 'event:destroy',
    ]);
  });

  it('isolates a throwing extension hook and reports it through error while the sequence continues', () => {
    const order: string[] = [];
    const errors: string[] = [];
    const Throwing = Extension.create({
      name: 'throwingHook',
      onTransaction() { throw new Error('hook failed'); },
      onUpdate() { order.push('extension:update'); },
    });
    editor = new Editor({
      extensions: [Document, Paragraph, Text, Throwing],
      content: '<p>Original</p>',
      onUpdate: () => { order.push('option:update'); },
    });
    editor.on('error', ({ context }) => { errors.push(context); });

    editor.view.dispatch(editor.state.tr.insertText('X', 1));

    expect(errors).toEqual(['throwingHook.onTransaction']);
    expect(order).toEqual(['option:update', 'extension:update']);
  });

  it('propagates a throwing event listener to the dispatcher and ends the sequence', () => {
    const { editor: instance, order } = mountAppending();
    instance.on('update', () => { throw new Error('listener failed'); });

    expect(() => { instance.view.dispatch(instance.state.tr.insertText('X', 1)); }).toThrow('listener failed');

    expect(instance.state.doc.textContent).toBe('XOriginal');
    expect(order).toEqual([
      'event:transaction', 'option:transaction', 'extension:transaction', 'event:update',
    ]);
  });

  it('runs a nested dispatch from an update listener before the rest of the outer sequence', () => {
    const { editor: instance, order } = mountAppending();
    const seen: string[] = [];
    let nested = false;
    instance.on('update', () => {
      if (nested) return;
      nested = true;
      order.push('nested:start');
      instance.view.dispatch(instance.state.tr.insertText('N', 1));
      order.push('nested:end');
    });
    instance.on('update', ({ transaction }) => { seen.push(`${transaction.doc.textContent}|${instance.state.doc.textContent}`); });

    instance.view.dispatch(instance.state.tr.insertText('X', 1));

    expect(order).toEqual([
      'event:transaction', 'option:transaction', 'extension:transaction',
      'event:update', 'nested:start',
      'event:transaction', 'option:transaction', 'extension:transaction',
      'event:update', 'option:update', 'extension:update',
      'nested:end', 'option:update', 'extension:update',
    ]);
    // The nested sequence reaches the second listener first; the outer payload is older than editor.state.
    expect(seen).toEqual(['NXOriginal|NXOriginal', 'XOriginal|NXOriginal']);
  });

  it('reports content diagnostics after the transaction hooks and before update', () => {
    const order: string[] = [];
    const instance = new Editor({
      extensions: [Document, Paragraph, Text, BulletList, ListItem, Extension.create({
        name: 'diagnosticOrderProbe',
        onTransaction() { order.push('extension:transaction'); },
        onUpdate() { order.push('extension:update'); },
      })],
      content: '<p>Original</p>',
      onTransaction: () => { order.push('option:transaction'); },
      onContentDiagnostic: () => { order.push('option:diagnostic'); },
      onUpdate: () => { order.push('option:update'); },
    });
    editor = instance;
    instance.on('contentDiagnostic', () => { order.push('event:diagnostic'); });
    instance.on('update', () => { order.push('event:update'); });

    instance.commands.setContent({ type: 'doc', content: [{
      type: 'bulletList', attrs: { listStyleType: 'bogus' },
      content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }] }],
    }] });

    expect(order).toEqual([
      'option:transaction', 'extension:transaction', 'event:diagnostic', 'option:diagnostic', 'event:update', 'option:update', 'extension:update',
    ]);

  });
});

describe('Editor commands under a plugin veto', () => {
  function mountVeto(): { editor: Editor; events: string[] } {
    const events: string[] = [];
    const instance = new Editor({
      extensions: [Document, Paragraph, Text, Extension.create({
        name: 'vetoEverything',
        addProseMirrorPlugins: () => [new Plugin({ filterTransaction: transaction => transaction.getMeta('allow') === true })],
      })],
      content: '<p>Start</p>',
    });
    editor = instance;
    for (const name of ['transaction', 'update', 'selectionUpdate', 'contentDiagnostic'] as const) {
      instance.on(name, () => { events.push(name); });
    }
    return { editor: instance, events };
  }

  it('returns true from single commands and chains whose dispatch a plugin vetoed, leaving editor.state the same object', () => {
    const { editor: instance, events } = mountVeto();
    const before = instance.state;

    expect(instance.commands.insertContent('XYZ')).toBe(true);
    expect(instance.commands.setContent('<p>Replaced</p>')).toBe(true);
    expect(instance.chain().insertContent('XYZ').run()).toBe(true);

    expect(instance.state).toBe(before);
    expect(instance.getHTML()).toBe('<p>Start</p>');
    expect(events).toEqual([]);
  });

  it('installs a new state object for every accepted dispatch', () => {
    const { editor: instance } = mountVeto();
    const before = instance.state;

    instance.view.dispatch(instance.state.tr.setMeta('allow', true));

    expect(instance.state).not.toBe(before);
  });

  it('returns true from a chain with nothing to dispatch without dispatching, and can() never dispatches', () => {
    const { editor: instance, events } = mountVeto();
    const dispatch = vi.spyOn(instance.view, 'dispatch');

    expect(instance.chain().run()).toBe(true);
    expect(instance.can().insertContent('X')).toBe(true);

    expect(dispatch).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });
});

describe('Editor construction-time dispatch', () => {
  function dispatchingView(options: { veto: boolean }): Extension {
    return Extension.create({
      name: 'constructionDispatch',
      addProseMirrorPlugins: () => [new Plugin({
        filterTransaction: transaction => !(options.veto && transaction.getMeta('construction') === true),
        view: view => {
          view.dispatch(view.state.tr.insertText('Init ', 1).setMeta('construction', true));
          return {};
        },
      })],
    });
  }

  it('applies a plugin view dispatch made inside the EditorView constructor without any callback', () => {
    const events: string[] = [];
    editor = new Editor({
      extensions: [Document, Paragraph, Text, dispatchingView({ veto: false })],
      content: '<p>Original</p>',
      onTransaction: () => { events.push('option:transaction'); },
      onUpdate: () => { events.push('option:update'); },
    });

    expect(editor.state.doc.textContent).toBe('Init Original');
    expect(events).toEqual([]);
  });

  it('leaves the initial state when a plugin vetoes a construction-time dispatch', () => {
    const events: string[] = [];
    editor = new Editor({
      extensions: [Document, Paragraph, Text, dispatchingView({ veto: true })],
      content: '<p>Original</p>',
      onTransaction: () => { events.push('option:transaction'); },
    });

    expect(editor.state.doc.textContent).toBe('Original');
    expect(events).toEqual([]);
  });
});
