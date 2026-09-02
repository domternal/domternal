import { createApp, defineComponent, h, nextTick, reactive, shallowRef, type App } from 'vue';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Editor, ListItem, OrderedList, type Content, type JSONContent } from '@domternal/core';
import { TextSelection } from '@domternal/pm/state';
import { Domternal } from './Domternal.js';
import { DomternalEditor } from './DomternalEditor.js';
import { DEFAULT_EXTENSIONS, useEditor, type UseEditorOptions } from './useEditor.js';

const extensions = [OrderedList, ListItem];

/** JSON the current editor wrote, with a list marker this version does not know unless `marker` says otherwise. */
function storedDocument(text = 'One', marker: string | null = 'bogus'): JSONContent {
  const scratch = new Editor({
    extensions: [...DEFAULT_EXTENSIONS, ...extensions],
    content: `<ol><li><p>${text}</p></li></ol><p>tail</p>`,
  });
  const json = scratch.getJSON();
  scratch.destroy();
  const list = json.content?.[0];
  if (!list) throw new Error('The scratch document has no list.');
  list.attrs = { ...list.attrs, listStyleType: marker };
  return json;
}

/** Stores an unknown marker the way a bound collaborative document does: without validation or history. */
function holdUnknownMarker(editor: Editor): void {
  const tr = editor.state.tr.setMeta('addToHistory', false);
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'orderedList') tr.setNodeAttribute(pos, 'listStyleType', 'bogus');
  });
  editor.view.dispatch(tr);
}

let container: HTMLDivElement;
let app: App | undefined;
let editors: Editor[];
const onCreate = (editor: Editor): void => { editors.push(editor); };

function mount(render: () => ReturnType<typeof h>): void {
  app = createApp(defineComponent({ setup: () => render }));
  app.mount(container);
}

function liveEditor(): Editor {
  const editor = [...editors].reverse().find(value => !value.isDestroyed);
  if (!editor) throw new Error('Expected a live editor.');
  return editor;
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

describe('Vue content reports', () => {
  it.each([false, true])(
    'reports the initial content once the editor is ready and later reports to the same callback (immediatelyRender=%s)',
    async (immediatelyRender) => {
      const stored = storedDocument();
      const received: unknown[] = [];
      const onContentDiagnostic: NonNullable<UseEditorOptions['onContentDiagnostic']> = ({ editor, source, total, diagnostics }) => {
        received.push({ source, total, diagnostics, created: editors.length, marker: editor.getJSON().content?.[0]?.attrs?.['listStyleType'] });
      };
      mount(() => h(DomternalEditor, { extensions, content: stored, immediatelyRender, onCreate, onContentDiagnostic }));
      await nextTick();
      expect(received).toEqual([{
        source: 'content',
        total: 1,
        diagnostics: [{ code: 'unknown-list-marker', nodeType: 'orderedList', attribute: 'listStyleType', path: [0], value: 'bogus' }],
        created: 0,
        marker: null,
      }]);

      liveEditor().commands.setContent(stored);
      expect(received).toHaveLength(2);
      expect(received[1]).toMatchObject({ source: 'setContent', total: 1, created: 1 });
    },
  );

  it('reports initial content the schema rejects to onContentError', async () => {
    const content = { type: 'doc', content: [{ type: 'missingNode' }] };
    const received: unknown[] = [];
    mount(() => h(Domternal, {
      content, outputFormat: 'json', onCreate,
      onContentError: ({ editor, error, content: rejected }: Parameters<NonNullable<UseEditorOptions['onContentError']>>[0]) => {
        received.push({ rejected, isError: error instanceof Error, empty: editor.isEmpty, created: editors.length });
      },
    }, { default: () => [h(Domternal.Content)] }));
    await nextTick();
    expect(received).toEqual([{ rejected: content, isError: true, empty: true, created: 0 }]);
  });

  it('keeps the document and selection when an equal v-model JSON value with an unknown marker is passed again', async () => {
    const stored = storedDocument();
    const model = shallowRef<Content>(structuredClone(stored));
    const reports: string[] = [];
    const changes: unknown[] = [];
    mount(() => h(DomternalEditor, {
      extensions, outputFormat: 'json', modelValue: model.value, onCreate,
      'onUpdate:modelValue': (value: Content) => { changes.push(value); model.value = value; },
      onContentDiagnostic: ({ source }: { source: string }) => { reports.push(source); },
    }));
    await nextTick();
    await expectEqualValueKeepsDocument((value) => { model.value = value; }, reports, changes);
  });

  it('keeps the document and selection when equal useEditor JSON content with an unknown marker is passed again', async () => {
    const stored = storedDocument();
    const reports: string[] = [];
    const options = reactive<UseEditorOptions>({
      extensions, outputFormat: 'json', content: structuredClone(stored), onCreate,
      onContentDiagnostic: ({ source }) => { reports.push(source); },
    });
    const HookEditor = defineComponent({
      setup() {
        const { editorRef } = useEditor(options);
        return () => h('div', { class: 'dm-editor' }, [h('div', { ref: editorRef })]);
      },
    });
    mount(() => h(HookEditor));
    await nextTick();
    await expectEqualValueKeepsDocument((value) => { options.content = value; }, reports, []);
  });

  it.each(['v-model', 'useEditor content'] as const)(
    'keeps a document that holds an unknown marker when %s echoes its JSON back',
    async (path) => {
      const reports: string[] = [];
      const onContentDiagnostic = ({ source }: { source: string }): void => { reports.push(source); };
      let send: (value: JSONContent) => void;
      if (path === 'v-model') {
        const model = shallowRef<Content>(storedDocument('One', null));
        mount(() => h(DomternalEditor, {
          extensions, outputFormat: 'json', modelValue: model.value, onCreate, onContentDiagnostic,
          'onUpdate:modelValue': (value: Content) => { model.value = value; },
        }));
        send = (value) => { model.value = value; };
      } else {
        const options = reactive<UseEditorOptions>({
          extensions, outputFormat: 'json', content: storedDocument('One', null), onCreate, onContentDiagnostic,
        });
        const HookEditor = defineComponent({
          setup() {
            const { editorRef } = useEditor(options);
            return () => h('div', { class: 'dm-editor' }, [h('div', { ref: editorRef })]);
          },
        });
        mount(() => h(HookEditor));
        send = (value) => { options.content = value; };
      }
      await nextTick();
      const editor = liveEditor();
      holdUnknownMarker(editor);
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 3)));
      await nextTick();
      const doc = editor.state.doc;
      const selection = editor.state.selection;

      // The document's own JSON, as an update:modelValue round trip hands it back.
      send(editor.getJSON());
      await nextTick();
      expect(editor.state.doc).toBe(doc);
      expect(editor.state.selection.eq(selection)).toBe(true);
      expect(editor.getJSON().content?.[0]?.attrs?.['listStyleType']).toBe('bogus');
      expect(reports).toEqual([]);
    },
  );
});

async function expectEqualValueKeepsDocument(send: (value: JSONContent) => void, reports: string[], changes: unknown[]): Promise<void> {
  const stored = storedDocument();
  const editor = liveEditor();
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 3)));
  const doc = editor.state.doc;
  const selection = editor.state.selection;

  // A new object with the same content, as a parent re-render produces.
  send(structuredClone(stored));
  await nextTick();
  expect(editor.state.doc).toBe(doc);
  expect(editor.state.selection.eq(selection)).toBe(true);
  expect(reports).toEqual(['content']);
  expect(changes).toEqual([]);

  // A genuine change still reaches the editor.
  send(storedDocument('Two'));
  await nextTick();
  expect(editor.getText()).toBe('Two\n\ntail');
  expect(reports).toEqual(['content', 'setContent']);
  expect(changes).toEqual([]);
  expect(editors).toHaveLength(1);
}
