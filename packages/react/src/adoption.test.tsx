import { act, StrictMode, useState, type ReactNode } from 'react';
import { createRoot, hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAdoptablePluginView, Extension, type Editor } from '@domternal/core';
import { Plugin } from '@domternal/pm/state';
import { Domternal } from './Domternal.js';
import { DomternalEditor } from './DomternalEditor.js';
import { useCurrentEditor } from './EditorContext.js';
import { EditorContent } from './EditorContent.js';
import { useEditor } from './useEditor.js';

const HostControl = Extension.create({
  name: 'adoptionTestControl',
  addProseMirrorPlugins() {
    const editor = this.editor as Editor;
    return [new Plugin({
      view: view => createAdoptablePluginView(editor, view, current => {
        const host = current.dom.closest('.dm-editor');
        const control = document.createElement('button');
        control.className = 'test-host-control';
        control.textContent = 'Insert';
        const insert = (): void => {
          editor.view.dispatch(editor.state.tr.insertText('!'));
        };
        control.addEventListener('click', insert);
        host?.appendChild(control);
        return { destroy() {
          control.removeEventListener('click', insert);
          control.remove();
        } };
      }),
    })];
  },
});
const extensions = [HostControl];

let container: HTMLDivElement;
let root: Root;
let editors: Editor[];

const onCreate = (editor: Editor): void => { editors.push(editor); };

async function update(action: () => void): Promise<void> {
  await act(async () => {
    action();
    await Promise.resolve();
  });
}

function getEditor(index = 0): Editor {
  const editor = editors[index];
  if (!editor) throw new Error('The editor has not been created.');
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

function Compound({ immediate = false, show = true }: { immediate?: boolean; show?: boolean }): ReactNode {
  return (
    <Domternal extensions={extensions} content="<p>Hello</p>" immediatelyRender={immediate} onCreate={onCreate}>
      {show && <Domternal.Content />}
    </Domternal>
  );
}

function HookEditor({ immediate, standalone }: { immediate: boolean; standalone: boolean }): ReactNode {
  const { editor, editorRef } = useEditor({
    extensions, content: '<p>Hello</p>', immediatelyRender: immediate, onCreate,
  });
  return (
    <div className="dm-editor">
      {standalone ? <EditorContent editor={editor} /> : <div ref={editorRef} />}
    </div>
  );
}

describe('React editor DOM adoption', () => {
  it('keeps all-in-one children before the editor and preserves their state during reconciliation', async () => {
    function Child({ label }: { label: string }): ReactNode {
      const [count, setCount] = useState(0);
      const { editor } = useCurrentEditor();
      return <section data-testid="child">
        <button type="button" onClick={() => { setCount(value => value + 1); }}>{count}</button>
        <output>{label}: {editor ? 'provided' : 'loading'}</output>
      </section>;
    }
    const render = (label: string, editable = true): ReactNode => (
      <DomternalEditor extensions={extensions} content="<p>Hello</p>" onCreate={onCreate} editable={editable}>
        <Child label={label} />
        <footer>Application footer</footer>
      </DomternalEditor>
    );
    await update(() => { root.render(render('Initial')); });
    const editor = getEditor();
    const child = container.querySelector('[data-testid="child"]');
    const host = container.querySelector('.dm-editor');
    if (!child || !host) throw new Error('The editor and application child must render.');
    expect(child.parentElement).toBe(host.parentElement);
    expect(child.compareDocumentPosition(host) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(editor.view.dom.querySelector('[data-testid="child"]')).toBeNull();
    expect(child.textContent).toContain('Initial: provided');
    await update(() => { child.querySelector('button')?.click(); });
    await update(() => { editor.view.dispatch(editor.state.tr.insertText('Saved ')); });
    const documentBefore = editor.state.doc;
    const selectionBefore = editor.state.selection;
    await update(() => { root.render(render('Updated', false)); });
    expect(editors).toHaveLength(1);
    expect(editor.state.doc).toBe(documentBefore);
    expect(editor.state.selection.eq(selectionBefore)).toBe(true);
    expect(editor.isEditable).toBe(false);
    expect(child.querySelector('button')?.textContent).toBe('1');
    expect(child.textContent).toContain('Updated: provided');
    expect(container.querySelector('footer')?.nextElementSibling).toBe(host);
    expect(editor.getHTML()).not.toContain('Application footer');
  });

  it.each([false, true])('mounts compound UI through StrictMode with immediatelyRender=%s', async (immediate) => {
    await update(() => { root.render(<StrictMode><Compound immediate={immediate} /></StrictMode>); });
    const activeEditors = editors.filter(editor => !editor.isDestroyed);
    expect(new Set(activeEditors).size).toBe(1);
    expect(container.querySelectorAll('.test-host-control')).toHaveLength(1);
    const editor = activeEditors[0];
    if (!editor) throw new Error('The live editor has not been created.');
    expect(editor.view.dom.isConnected).toBe(true);
    await update(() => { container.querySelector<HTMLButtonElement>('.test-host-control')?.click(); });
    expect(editor.state.doc.textContent).toContain('!');
    await update(() => { root.render(null); });
    expect(editors.every(editor => editor.isDestroyed)).toBe(true);
    expect(document.querySelector('.test-host-control')).toBeNull();
  });

  it('adopts conditionally mounted content and preserves the editor through a content remount', async () => {
    await update(() => { root.render(<Compound show={false} />); });
    const editor = getEditor();
    expect(editor.view.dom.isConnected).toBe(false);
    await update(() => { root.render(<Compound />); });
    expect(editor.view.dom.isConnected).toBe(true);
    await update(() => { editor.view.dispatch(editor.state.tr.insertText('Saved ')); });
    const state = editor.state;

    await update(() => { root.render(<Compound show={false} />); });
    expect(editor.isDestroyed).toBe(false);
    expect(editor.view.dom.isConnected).toBe(false);
    expect(document.querySelector('.test-host-control')).toBeNull();
    await update(() => { root.render(<Compound />); });
    expect(editors).toHaveLength(1);
    expect(editor.state).toBe(state);
    expect(editor.view.dom.isConnected).toBe(true);
    expect(container.querySelectorAll('.test-host-control')).toHaveLength(1);
  });

  it.each([
    { immediate: false, standalone: false },
    { immediate: true, standalone: false },
    { immediate: false, standalone: true },
    { immediate: true, standalone: true },
  ])('supports direct-ref and standalone hooks: %j', async (options) => {
    await update(() => { root.render(<StrictMode><HookEditor {...options} /></StrictMode>); });
    expect(container.querySelector('.ProseMirror')?.isConnected).toBe(true);
    expect(container.querySelectorAll('.test-host-control')).toHaveLength(1);
  });

  it('does not create editor resources during default server rendering', () => {
    const html = renderToString(<Compound />);
    expect(html).toContain('dm-editor');
    expect(html).not.toContain('test-host-control');
    expect(editors).toHaveLength(0);
  });

  it('hydrates the default server markup before adopting one live editor', async () => {
    const html = renderToString(<Compound />);
    expect(editors).toHaveLength(0);
    await update(() => { root.unmount(); });
    container.innerHTML = html;
    const recoverableErrors: unknown[] = [];
    await update(() => {
      root = hydrateRoot(container, <Compound />, {
        onRecoverableError: error => { recoverableErrors.push(error); },
      });
    });
    expect(recoverableErrors).toEqual([]);
    expect(editors).toHaveLength(1);
    expect(getEditor().view.dom.isConnected).toBe(true);
    expect(container.querySelectorAll('.ProseMirror')).toHaveLength(1);
    expect(container.querySelectorAll('.test-host-control')).toHaveLength(1);
    expect(getEditor().state.doc.textContent).toBe('Hello');
  });

  it('keeps two editors and their adopted controls isolated', async () => {
    await update(() => { root.render(<><Compound /><Compound /></>); });
    const controls = container.querySelectorAll<HTMLButtonElement>('.test-host-control');
    expect(controls).toHaveLength(2);
    expect(editors).toHaveLength(2);
    await update(() => { controls[0]?.click(); });
    expect(getEditor().state.doc.textContent).toBe('!Hello');
    expect(getEditor(1).state.doc.textContent).toBe('Hello');
  });
});
