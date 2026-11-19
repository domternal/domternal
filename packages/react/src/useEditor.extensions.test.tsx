import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Bold, Italic, Link, type AnyExtension, type Content, type Editor } from '@domternal/core';
import { undoNoScroll } from '@domternal/pm/history';
import { Domternal } from './Domternal.js';
import { DomternalEditor } from './DomternalEditor.js';
import { EditorContent } from './EditorContent.js';
import { useEditor } from './useEditor.js';

const NONE: AnyExtension[] = [];
const BOLD = [Bold];
const BOLD_LINK = [Bold, Link];
const BOLD_ITALIC = [Bold, Italic];
const ITALIC_BOLD = [Italic, Bold];
const CLASSED_BOLD_ITALIC = [Bold.configure({ HTMLAttributes: { class: 'strong' } }), Italic];

let container: HTMLDivElement;
let root: Root;
let editors: Editor[];
const onCreate = (editor: Editor): void => { editors.push(editor); };

async function update(action: () => void): Promise<void> {
  await act(async () => { action(); await Promise.resolve(); });
}

function liveEditor(): Editor {
  const editor = editors.at(-1);
  if (!editor || editor.isDestroyed) throw new Error('Expected a live editor.');
  return editor;
}

/**
 * Comparing only the array identity recreated the editor for every new inline
 * array, and in the hook pattern each recreation rendered a new array again,
 * so act() never returned. Once this many editors exist, the test components
 * pass a hoisted array with the same items instead, which ends such a loop: a
 * regression then fails the editor count rather than hanging the run.
 */
const LOOP_LIMIT = 10;

function inlineUntilLoop(inline: AnyExtension[], hoisted: AnyExtension[]): AnyExtension[] {
  return editors.length < LOOP_LIMIT ? inline : hoisted;
}

function hasHistory(editor: Editor): boolean {
  return editor.extensionManager.extensions.some(extension => extension.name === 'history');
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

describe('useEditor extensions comparison', () => {
  it.each([
    { mount: 'editorRef', immediate: false },
    { mount: 'EditorContent', immediate: false },
    { mount: 'editorRef', immediate: true },
  ])(
    'creates one editor when the hook gets a new inline extensions array on every render: %j',
    async ({ mount, immediate }) => {
      function HookEditor({ label }: { label: string }): ReactNode {
        const { editor, editorRef } = useEditor({
          extensions: inlineUntilLoop([Bold], BOLD),
          content: '<p>Hello</p>',
          immediatelyRender: immediate,
          onCreate,
        });
        return (
          <>
            <output>{label}: {editor ? 'ready' : 'loading'}</output>
            {mount === 'EditorContent'
              ? <EditorContent editor={editor} className="dm-editor" />
              : <div className="dm-editor"><div ref={editorRef} /></div>}
          </>
        );
      }

      await update(() => { root.render(<HookEditor label="first" />); });
      expect(editors).toHaveLength(1);
      const editor = liveEditor();
      for (const label of ['second', 'third', 'fourth']) {
        await update(() => { root.render(<HookEditor label={label} />); });
      }

      expect(editors).toHaveLength(1);
      expect(editor.isDestroyed).toBe(false);
      expect(editor.view.dom.isConnected).toBe(true);
      expect(container.querySelector('output')?.textContent).toBe('fourth: ready');
    },
  );

  it('creates one editor for an inline empty extensions array', async () => {
    function EmptyEditor({ label }: { label: string }): ReactNode {
      const { editorRef } = useEditor({ extensions: inlineUntilLoop([], NONE), onCreate });
      return <div className="dm-editor" data-label={label}><div ref={editorRef} /></div>;
    }

    await update(() => { root.render(<EmptyEditor label="first" />); });
    await update(() => { root.render(<EmptyEditor label="second" />); });

    expect(editors).toHaveLength(1);
    expect(liveEditor().view.dom.isConnected).toBe(true);
  });

  it('keeps the editor, caret, focus and undo history in controlled mode with an inline extensions array', async () => {
    function Controlled(): ReactNode {
      const [html, setHtml] = useState<Content>('<p>Hello</p>');
      return (
        <>
          <DomternalEditor extensions={inlineUntilLoop([Bold], BOLD)} value={html} onChange={setHtml} onCreate={onCreate} />
          <output>{typeof html === 'string' ? html : ''}</output>
        </>
      );
    }

    await update(() => { root.render(<Controlled />); });
    const editor = liveEditor();
    await update(() => { editor.commands.focus('end'); });
    expect(editor.state.selection.from).toBe(6);

    await update(() => { editor.commands.insertText('a'); });
    expect(editors).toHaveLength(1);
    await update(() => { editor.commands.insertText('b'); });

    expect(editors).toHaveLength(1);
    expect(editor.isDestroyed).toBe(false);
    expect(container.querySelector('output')?.textContent).toBe('<p>Helloab</p>');
    expect(editor.getText()).toBe('Helloab');
    expect(editor.state.selection.from).toBe(8);
    expect(document.activeElement).toBe(editor.view.dom);
    expect(editor.can().undo()).toBe(true);

    // The undo command also scrolls to the selection, which jsdom cannot lay out.
    await update(() => { undoNoScroll(editor.state, (tr) => { editor.view.dispatch(tr); }); });
    expect(editor.getText()).toBe('Hello');
  });

  it('keeps the Domternal editor, its focus and undo history when an unrelated parent state changes', async () => {
    function App(): ReactNode {
      const [saved, setSaved] = useState(false);
      return (
        <>
          <Domternal extensions={inlineUntilLoop([Bold], BOLD)} content="<p>Hello</p>" onCreate={onCreate}>
            <Domternal.Content />
          </Domternal>
          <button type="button" onClick={() => { setSaved(true); }}>{saved ? 'Saved' : 'Unsaved'}</button>
        </>
      );
    }

    await update(() => { root.render(<App />); });
    const editor = liveEditor();
    await update(() => { editor.commands.focus('end'); });
    await update(() => { editor.commands.insertText('a'); });
    await update(() => { container.querySelector('button')?.click(); });

    expect(container.querySelector('button')?.textContent).toBe('Saved');
    expect(editors).toHaveLength(1);
    expect(editor.isDestroyed).toBe(false);
    expect(document.activeElement).toBe(editor.view.dom);
    expect(editor.state.selection.from).toBe(7);
    expect(editor.can().undo()).toBe(true);
  });

  it.each([
    { change: 'added', from: BOLD, to: BOLD_ITALIC, marks: ['bold', 'italic'], html: '<p>Saved Hello <strong>world</strong></p>' },
    { change: 'removed', from: BOLD_ITALIC, to: BOLD, marks: ['bold'], html: '<p>Saved Hello <strong>world</strong></p>' },
    { change: 'reordered', from: BOLD_ITALIC, to: ITALIC_BOLD, marks: ['italic', 'bold'], html: '<p>Saved Hello <strong>world</strong></p>' },
    { change: 'configured', from: BOLD_ITALIC, to: CLASSED_BOLD_ITALIC, marks: ['bold', 'italic'], html: '<p>Saved Hello <strong class="strong">world</strong></p>' },
  ])('recreates the editor once and keeps its content when an extension is $change', async ({ from, to, marks, html }) => {
    const render = (extensions: AnyExtension[]): ReactNode => (
      <Domternal extensions={extensions} content="<p>Hello <strong>world</strong></p>" onCreate={onCreate}>
        <Domternal.Content />
      </Domternal>
    );
    await update(() => { root.render(render(from)); });
    const first = liveEditor();
    await update(() => { first.view.dispatch(first.state.tr.insertText('Saved ')); });

    await update(() => { root.render(render(to)); });
    expect(editors).toHaveLength(2);
    expect(first.isDestroyed).toBe(true);
    const second = liveEditor();
    expect(Object.keys(second.schema.marks)).toEqual(marks);
    expect(second.getHTML()).toBe(html);
    expect(second.view.dom.isConnected).toBe(true);

    // The same items in a new array, as the next parent render passes them.
    await update(() => { root.render(render([...to])); });
    expect(editors).toHaveLength(2);
    expect(second.isDestroyed).toBe(false);
  });

  it('recreates once when deps change with an inline array, and once more for a real inline change', async () => {
    function DepsEditor({ version, linked }: { version: number; linked: boolean }): ReactNode {
      const { editorRef } = useEditor({
        extensions: linked ? inlineUntilLoop([Bold, Link], BOLD_LINK) : inlineUntilLoop([Bold], BOLD),
        content: '<p>Hi</p>',
        onCreate,
      }, [version]);
      return <div className="dm-editor"><div ref={editorRef} /></div>;
    }

    await update(() => { root.render(<DepsEditor version={0} linked={false} />); });
    expect(editors).toHaveLength(1);
    await update(() => { liveEditor().commands.insertText('Saved '); });

    await update(() => { root.render(<DepsEditor version={1} linked={false} />); });
    expect(editors).toHaveLength(2);
    expect(liveEditor().schema.marks['link']).toBeUndefined();

    await update(() => { root.render(<DepsEditor version={1} linked />); });
    expect(editors).toHaveLength(3);
    const linked = liveEditor();
    expect(linked.schema.marks['link']).toBeDefined();
    expect(linked.getText()).toBe('Saved Hi');

    await update(() => { root.render(<DepsEditor version={1} linked />); });
    expect(editors).toHaveLength(3);
    expect(linked.isDestroyed).toBe(false);
  });

  it('recreates the editor when the array it was built from is changed in place and a copy is passed', async () => {
    const list: AnyExtension[] = [Bold];
    const render = (extensions: AnyExtension[]): ReactNode => (
      <Domternal extensions={extensions} content="<p>Hello</p>" onCreate={onCreate}>
        <Domternal.Content />
      </Domternal>
    );
    await update(() => { root.render(render(list)); });
    list.push(Italic);

    // The same array object again: React reports no change, as before.
    await update(() => { root.render(render(list)); });
    expect(editors).toHaveLength(1);

    // A copy holds an item the editor was not built with.
    await update(() => { root.render(render([...list])); });
    expect(editors).toHaveLength(2);
    expect(liveEditor().schema.marks['italic']).toBeDefined();
    expect(liveEditor().getText()).toBe('Hello');
  });

  it('reads the history option when the editor is created, so a new array with the same items does not apply a change', async () => {
    const render = (history: boolean, version: number): ReactNode => (
      <Domternal extensions={[Bold]} history={history} deps={[version]} content="<p>Hello</p>" onCreate={onCreate}>
        <Domternal.Content />
      </Domternal>
    );
    await update(() => { root.render(render(true, 0)); });
    await update(() => { root.render(render(false, 0)); });
    expect(editors).toHaveLength(1);
    expect(hasHistory(liveEditor())).toBe(true);

    await update(() => { root.render(render(false, 1)); });
    expect(editors).toHaveLength(2);
    expect(hasHistory(liveEditor())).toBe(false);
  });
});
