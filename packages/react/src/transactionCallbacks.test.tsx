import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Document, Editor, Extension, Paragraph, Text } from '@domternal/core';
import { Plugin, TextSelection } from '@domternal/pm/state';
import { DomternalEditor } from './DomternalEditor.js';
import { useEditorState } from './useEditorState.js';

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
const extensions = [AppendProbe];

let container: HTMLDivElement;
let root: Root;
let editors: Editor[];
const onCreate = (editor: Editor): void => { editors.push(editor); };

async function update(action: () => void): Promise<void> {
  await act(async () => { action(); await Promise.resolve(); });
}

function liveEditor(): Editor {
  const editor = editors.at(-1);
  if (!editor) throw new Error('Expected a live editor.');
  return editor;
}

function moveSelection(editor: Editor, meta: Record<string, unknown> = {}): void {
  const tr = editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2));
  for (const [key, value] of Object.entries(meta)) tr.setMeta(key, value);
  editor.view.dispatch(tr);
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  editors = [];
});

afterEach(async () => {
  await update(() => { root.unmount(); });
  container.remove();
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
});

describe('React transaction callbacks', () => {
  it('reports a document change that only an appended transaction made to onUpdate, not onSelectionChange', async () => {
    const calls: string[] = [];
    await update(() => {
      root.render(<DomternalEditor extensions={extensions} content="<p>Hello</p>" onCreate={onCreate}
        onUpdate={({ editor }) => { calls.push(`update:${editor.getText()}`); }}
        onSelectionChange={() => { calls.push('selection'); }} />);
    });

    await update(() => { moveSelection(liveEditor(), { appendDoc: true }); });
    expect(calls).toEqual(['update:Hello!']);

    await update(() => { moveSelection(liveEditor()); });
    expect(calls).toEqual(['update:Hello!', 'selection']);
  });

  it('reports nothing for a vetoed transaction and no update for a skipUpdate root with an appended change', async () => {
    const calls: string[] = [];
    await update(() => {
      root.render(<DomternalEditor extensions={extensions} content="<p>Hello</p>" onCreate={onCreate}
        onUpdate={() => { calls.push('update'); }} onSelectionChange={() => { calls.push('selection'); }} />);
    });
    const editor = liveEditor();

    await update(() => { editor.view.dispatch(editor.state.tr.insertText('X', 1).setMeta('veto', true)); });
    await update(() => { moveSelection(editor, { veto: true }); });
    await update(() => { moveSelection(editor, { appendDoc: true, skipUpdate: true }); });

    expect(editor.getText()).toBe('Hello!');
    expect(calls).toEqual([]);
  });

  it('refreshes useEditorState when only an appended transaction changed the document', async () => {
    const element = document.createElement('div');
    document.body.appendChild(element);
    const editor = new Editor({ element, extensions: [Document, Paragraph, Text, AppendProbe], content: '<p>Hello</p>' });
    function Html(): ReactNode {
      const { htmlContent } = useEditorState(editor);
      return createElement('output', null, htmlContent);
    }
    try {
      await update(() => { root.render(<Html />); });
      expect(container.textContent).toBe('<p>Hello</p>');

      await update(() => { moveSelection(editor, { appendDoc: true }); });
      expect(container.textContent).toBe('<p>Hello!</p>');

      await update(() => { moveSelection(editor, { appendDoc: true, skipUpdate: true }); });
      expect(container.textContent).toBe('<p>Hello!!</p>');
    } finally {
      editor.destroy();
      element.remove();
    }
  });
});
