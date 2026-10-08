import { createApp, h, nextTick, type App } from 'vue';
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
let app: App;

const isOpen = (): boolean => (editor.storage['notionColorPicker'] as { isOpen: boolean }).isOpen;

beforeEach(async () => {
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
  app = createApp({ render: () => h(DomternalNotionColorPicker, { editor }) });
  app.mount(mount);
  await nextTick();
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 5)));
  editor.emit('notionColorOpen', { anchorElement: anchor });
  await nextTick();
});

afterEach(() => {
  app.unmount();
  editor.destroy();
  host.remove();
  vi.restoreAllMocks();
});

describe('color picker selection tracking', () => {
  it('closes when the selection collapses, also when a plugin answers the move with a document change', async () => {
    expect(isOpen()).toBe(true);

    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 3)).setMeta('appendDoc', true));
    await nextTick();

    expect(editor.getText()).toBe('Keep content!');
    expect(isOpen()).toBe(false);
  });

  it('stays open when the document changes without a selection move', async () => {
    editor.view.dispatch(editor.state.tr.insertText('X', 8));
    await nextTick();

    expect(isOpen()).toBe(true);
  });
});
