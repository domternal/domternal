import { act, StrictMode, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Editor, ListItem, OrderedList, type JSONContent } from '@domternal/core';
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

type DiagnosticCallback = NonNullable<UseEditorOptions['onContentDiagnostic']>;

let container: HTMLDivElement;
let root: Root;
let editors: Editor[];
const onCreate = (editor: Editor): void => { editors.push(editor); };

async function update(action: () => void): Promise<void> {
  await act(async () => { action(); await Promise.resolve(); });
}

function liveEditor(): Editor {
  const editor = [...editors].reverse().find(value => !value.isDestroyed);
  if (!editor) throw new Error('Expected a live editor.');
  return editor;
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

describe('React content reports', () => {
  it('reports the initial content once the editor is ready, and later reports to the latest callback', async () => {
    const stored = storedDocument();
    const first: unknown[] = [];
    const latest: unknown[] = [];
    const render = (onContentDiagnostic: DiagnosticCallback): ReactNode => (
      <DomternalEditor extensions={extensions} content={stored} onCreate={onCreate} onContentDiagnostic={onContentDiagnostic} />
    );

    await update(() => {
      root.render(render(({ editor, source, total, diagnostics }) => {
        first.push({ source, total, diagnostics, created: editors.length, marker: editor.getJSON().content?.[0]?.attrs?.['listStyleType'] });
      }));
    });
    expect(first).toEqual([{
      source: 'content',
      total: 1,
      diagnostics: [{ code: 'unknown-list-marker', nodeType: 'orderedList', attribute: 'listStyleType', path: [0], value: 'bogus' }],
      created: 0,
      marker: null,
    }]);

    await update(() => { root.render(render(({ source, total }) => { latest.push({ source, total }); })); });
    await update(() => { liveEditor().commands.setContent(stored); });
    expect(latest).toEqual([{ source: 'setContent', total: 1 }]);
    expect(first).toHaveLength(1);
  });

  it('delivers the initial report of an immediately rendered editor after render, before onCreate', async () => {
    const stored = storedDocument();
    let rendering = false;
    const received: unknown[] = [];
    function HookEditor(): ReactNode {
      rendering = true;
      const { editorRef } = useEditor({
        extensions,
        content: stored,
        immediatelyRender: true,
        onCreate,
        onContentDiagnostic: ({ editor, source }) => {
          received.push({ source, rendering, created: editors.length, text: editor.getText() });
        },
      });
      rendering = false;
      return <div className="dm-editor"><div ref={editorRef} /></div>;
    }

    await update(() => { root.render(<StrictMode><HookEditor /></StrictMode>); });
    expect(received).toEqual([{ source: 'content', rendering: false, created: 0, text: 'One\n\ntail' }]);
  });

  it('reports initial content the schema rejects to onContentError', async () => {
    const content = { type: 'doc', content: [{ type: 'missingNode' }] };
    const received: unknown[] = [];
    await update(() => {
      root.render(
        <Domternal content={content} outputFormat="json" onCreate={onCreate}
          onContentError={({ editor, error, content: rejected }) => {
            received.push({ rejected, isError: error instanceof Error, empty: editor.isEmpty, created: editors.length });
          }}>
          <Domternal.Content />
        </Domternal>,
      );
    });
    expect(received).toEqual([{ rejected: content, isError: true, empty: true, created: 0 }]);
  });

  it.each(['value', 'content'] as const)(
    'keeps the document and selection when an equal JSON %s with an unknown marker is passed again',
    async (prop) => {
      const stored = storedDocument();
      const reports: string[] = [];
      const changes: unknown[] = [];
      const render = (json: JSONContent): ReactNode => (
        <DomternalEditor extensions={extensions} outputFormat="json" onCreate={onCreate}
          {...(prop === 'value' ? { value: json, onChange: (value: unknown) => { changes.push(value); } } : { content: json })}
          onContentDiagnostic={({ source }) => { reports.push(source); }} />
      );

      await update(() => { root.render(render(structuredClone(stored))); });
      const editor = liveEditor();
      await update(() => { editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 3))); });
      const doc = editor.state.doc;
      const selection = editor.state.selection;

      // A new object with the same content, as a parent re-render produces.
      await update(() => { root.render(render(structuredClone(stored))); });
      expect(editor.state.doc).toBe(doc);
      expect(editor.state.selection.eq(selection)).toBe(true);
      expect(reports).toEqual(['content']);
      expect(changes).toEqual([]);

      // A genuine change still reaches the editor.
      await update(() => { root.render(render(storedDocument('Two'))); });
      expect(editor.getText()).toBe('Two\n\ntail');
      expect(reports).toEqual(['content', 'setContent']);
      expect(changes).toEqual([]);
      expect(editors).toHaveLength(1);
    },
  );

  it.each(['value', 'content'] as const)(
    'keeps a document that holds an unknown marker when a JSON %s echoes it back',
    async (prop) => {
      const reports: string[] = [];
      const render = (json: JSONContent): ReactNode => (
        <DomternalEditor extensions={extensions} outputFormat="json" onCreate={onCreate}
          {...(prop === 'value' ? { value: json, onChange: () => undefined } : { content: json })}
          onContentDiagnostic={({ source }) => { reports.push(source); }} />
      );

      await update(() => { root.render(render(storedDocument('One', null))); });
      const editor = liveEditor();
      await update(() => {
        holdUnknownMarker(editor);
        editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 3)));
      });
      const doc = editor.state.doc;
      const selection = editor.state.selection;

      // The document's own JSON, as an onChange round trip hands it back.
      await update(() => { root.render(render(editor.getJSON())); });
      expect(editor.state.doc).toBe(doc);
      expect(editor.state.selection.eq(selection)).toBe(true);
      expect(editor.getJSON().content?.[0]?.attrs?.['listStyleType']).toBe('bogus');
      expect(reports).toEqual([]);
    },
  );
});
