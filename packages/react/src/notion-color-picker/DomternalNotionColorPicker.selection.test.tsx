import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Editor, Document, Extension, Paragraph, Text, TextStyle, NotionColorPicker } from '@domternal/core';
import { Plugin, TextSelection } from '@domternal/pm/state';
import { DomternalNotionColorPicker } from './DomternalNotionColorPicker.js';

/** Answers a selection move marked appendDoc with a document change, as some plugins do. */
const AppendProbe = Extension.create({
  name: 'pickerAppendProbe',
  addProseMirrorPlugins: () => [new Plugin({
    appendTransaction(transactions, _previous, state) {
      if (!transactions.some(transaction => transaction.getMeta('appendDoc') === true)) return null;
      return state.tr.insertText('!', state.doc.content.size - 1);
    },
  })],
});

let host: HTMLDivElement;
let anchor: HTMLButtonElement;
let editor: Editor;
let root: Root;

async function update(action: () => void): Promise<void> {
  await act(async () => { action(); await Promise.resolve(); });
}

const isOpen = (): boolean => (editor.storage['notionColorPicker'] as { isOpen: boolean }).isOpen;

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(1);
  vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => undefined);
  host = document.createElement('div');
  host.className = 'dm-editor';
  const mount = document.createElement('div');
  anchor = document.createElement('button');
  const content = document.createElement('div');
  host.append(mount, anchor, content);
  document.body.append(host);
  editor = new Editor({
    element: content,
    extensions: [Document, Paragraph, Text, TextStyle, NotionColorPicker, AppendProbe],
    content: '<p>Keep content</p>',
  });
  root = createRoot(mount);
  await update(() => { root.render(<DomternalNotionColorPicker editor={editor} />); });
  await update(() => {
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 5)));
    editor.emit('notionColorOpen', { anchorElement: anchor });
  });
});

afterEach(async () => {
  await update(() => { root.unmount(); });
  editor.destroy();
  host.remove();
  vi.restoreAllMocks();
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
});

describe('color picker selection tracking', () => {
  it('closes when the selection collapses, also when a plugin answers the move with a document change', async () => {
    expect(isOpen()).toBe(true);

    await update(() => {
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 3)).setMeta('appendDoc', true));
    });

    expect(editor.getText()).toBe('Keep content!');
    expect(isOpen()).toBe(false);
  });

  it('stays open when the document changes without a selection move', async () => {
    await update(() => { editor.view.dispatch(editor.state.tr.insertText('X', 8)); });

    expect(isOpen()).toBe(true);
  });
});
