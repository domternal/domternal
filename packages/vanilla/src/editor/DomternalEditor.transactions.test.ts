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
  it('reports a document change that only an appended transaction made as update, to the callback and the event', () => {
    const calls: string[] = [];
    wrapper = new DomternalEditor(host, {
      extensions: [AppendProbe],
      content: '<p>Hello</p>',
      onUpdate: ({ editor }) => { calls.push(`callback:update:${editor.getText()}`); },
      onSelectionChange: () => { calls.push('callback:selection'); },
    });
    wrapper.addEventListener('update', () => { calls.push('event:update'); });
    wrapper.addEventListener('selectionchange', () => { calls.push('event:selection'); });

    moveSelection(wrapper.editor, { appendDoc: true });
    expect(calls).toEqual(['callback:update:Hello!', 'event:update']);

    moveSelection(wrapper.editor);
    expect(calls).toEqual(['callback:update:Hello!', 'event:update', 'callback:selection', 'event:selection']);
  });

  it('reports nothing for a vetoed transaction and no update for a skipUpdate root with an appended change', () => {
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
    moveSelection(editor, { appendDoc: true, skipUpdate: true });

    expect(editor.getText()).toBe('Hello!');
    expect(calls).toEqual([]);
  });
});
