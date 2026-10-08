import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Extension, type Editor } from '@domternal/core';
import { Plugin, TextSelection } from '@domternal/pm/state';
import { DomternalEditor } from './DomternalEditor.js';

/** Appends a document change to a root marked appendDoc, and vetoes a root marked veto. */
const AppendProbe = Extension.create({
  name: 'wrapperAppendProbe',
  addProseMirrorPlugins: () => [new Plugin({
    filterTransaction: transaction => transaction.getMeta('veto') !== true,
    appendTransaction(transactions, _previous, state) {
      if (!transactions.some(transaction => transaction.getMeta('appendDoc') === true)) return null;
      return state.tr.insertText('!', state.doc.content.size - 1);
    },
  })],
});

let host: HTMLDivElement;
let wrapper: DomternalEditor | undefined;

function moveSelection(editor: Editor, meta: Record<string, unknown> = {}): void {
  const tr = editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2));
  for (const [key, value] of Object.entries(meta)) tr.setMeta(key, value);
  editor.view.dispatch(tr);
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  wrapper?.destroy();
  wrapper = undefined;
  host.remove();
});

describe('DomternalEditor transaction callbacks', () => {
  it('reports a selection move that a plugin answers with a change as selectionchange, then update, to the callback and the event', () => {
    const calls: string[] = [];
    wrapper = new DomternalEditor(host, {
      extensions: [AppendProbe],
      content: '<p>Hello</p>',
      onUpdate: ({ editor }) => { calls.push(`callback:update:${editor.getText()}`); },
      onSelectionChange: () => { calls.push('callback:selection'); },
    });
    wrapper.addEventListener('update', () => { calls.push('event:update'); });
    wrapper.addEventListener('selectionchange', () => { calls.push('event:selection'); });

    // The root moved the selection and a plugin answered with a change: the move, then the change.
    moveSelection(wrapper.editor, { appendDoc: true });
    expect(calls).toEqual(['callback:selection', 'event:selection', 'callback:update:Hello!', 'event:update']);

    calls.length = 0;
    moveSelection(wrapper.editor);
    expect(calls).toEqual(['callback:selection', 'event:selection']);
  });

  it('reports nothing for a vetoed transaction and only the selection move of a skipUpdate root with an appended change', () => {
    const calls: string[] = [];
    wrapper = new DomternalEditor(host, {
      extensions: [AppendProbe],
      content: '<p>Hello</p>',
      onUpdate: () => { calls.push('update'); },
      onSelectionChange: () => { calls.push('selection'); },
    });
    wrapper.addEventListener('update', () => { calls.push('event:update'); });
    const editor = wrapper.editor;

    editor.view.dispatch(editor.state.tr.insertText('X', 1).setMeta('veto', true));
    moveSelection(editor, { veto: true });
    expect(calls).toEqual([]);

    moveSelection(editor, { appendDoc: true, skipUpdate: true });
    expect(editor.getText()).toBe('Hello!');
    expect(calls).toEqual(['selection']);
  });
});
