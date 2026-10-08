import { createApp, defineComponent, h, nextTick, type App } from 'vue';
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
const extensions = [AppendProbe];

let container: HTMLDivElement;
let app: App | undefined;
let editors: Editor[];
const onCreate = (editor: Editor): void => { editors.push(editor); };

function mount(render: () => ReturnType<typeof h>): void {
  app = createApp(defineComponent({ setup: () => render }));
  app.mount(container);
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
  container = document.createElement('div');
  document.body.appendChild(container);
  editors = [];
});

afterEach(() => {
  app?.unmount();
  app = undefined;
  container.remove();
});

describe('Vue transaction callbacks', () => {
  it('reports a selection move that a plugin answers with a change to onSelectionChange, then onUpdate and v-model', async () => {
    const calls: string[] = [];
    const models: unknown[] = [];
    mount(() => h(DomternalEditor, {
      extensions, modelValue: '<p>Hello</p>', onCreate,
      onUpdate: ({ editor }: { editor: Editor }) => { calls.push(`update:${editor.getText()}`); },
      onSelectionChange: () => { calls.push('selection'); },
      'onUpdate:modelValue': (value: unknown) => { models.push(value); },
    }));
    await nextTick();

    moveSelection(liveEditor(), { appendDoc: true });
    expect(calls).toEqual(['selection', 'update:Hello!']);
    expect(models).toEqual(['<p>Hello!</p>']);

    moveSelection(liveEditor());
    expect(calls).toEqual(['selection', 'update:Hello!', 'selection']);
  });

  it('reports nothing for a vetoed transaction and only the selection move of a skipUpdate root with an appended change', async () => {
    const calls: string[] = [];
    mount(() => h(DomternalEditor, {
      extensions, content: '<p>Hello</p>', onCreate,
      onUpdate: () => { calls.push('update'); },
      onSelectionChange: () => { calls.push('selection'); },
    }));
    await nextTick();
    const editor = liveEditor();

    editor.view.dispatch(editor.state.tr.insertText('X', 1).setMeta('veto', true));
    moveSelection(editor, { veto: true });
    expect(calls).toEqual([]);

    moveSelection(editor, { appendDoc: true, skipUpdate: true });
    expect(editor.getText()).toBe('Hello!');
    expect(calls).toEqual(['selection']);
  });
});
