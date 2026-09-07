import { act, createElement, StrictMode, useLayoutEffect } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Bold, Document, Editor, Paragraph, Text } from '@domternal/core';
import { TextSelection } from '@domternal/pm/state';
import { useEditorState } from './useEditorState.js';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });

async function flush(action: () => void): Promise<void> {
  await act(async () => {
    action();
    await Promise.resolve();
  });
}

let root: Root;
let container: HTMLDivElement;
const editors: Editor[] = [];

function makeEditor(content = '<p>Hello</p>'): Editor {
  const element = document.createElement('div');
  document.body.appendChild(element);
  const editor = new Editor({ element, extensions: [Document, Paragraph, Text, Bold], content });
  editors.push(editor);
  return editor;
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await flush(() => { root.unmount(); });
  editors.splice(0).forEach(editor => {
    const element = editor.view.dom.parentElement;
    editor.destroy();
    element?.remove();
  });
  container.remove();
  vi.restoreAllMocks();
});

describe('useEditorState selectors', () => {
  it('updates allocating command and selection snapshots on selection-only transactions without mutating state', async () => {
    const editor = makeEditor('<p><strong>Hello</strong> plain</p>');
    function Selected(): ReactNode {
      const value = useEditorState(editor, ed => ({
        range: [ed.state.selection.from, ed.state.selection.to],
        commands: { bold: ed.can().toggleBold() },
        active: ed.isActive('bold'),
      }));
      return createElement('output', null, JSON.stringify(value));
    }
    const documentBefore = editor.state.doc;
    await flush(() => { root.render(createElement(StrictMode, null, createElement(Selected))); });
    await flush(() => {
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2, 5)));
    });
    expect(JSON.parse(container.textContent)).toEqual({ range: [2, 5], commands: { bold: true }, active: true });
    await flush(() => {
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 8, 11)));
    });
    expect(JSON.parse(container.textContent)).toEqual({ range: [8, 11], commands: { bold: true }, active: false });
    expect(editor.state.doc).toBe(documentBefore);
  });

  it('keeps independent consumers subscribed when a sibling consumer unmounts', async () => {
    const editor = makeEditor();
    function Selected({ name }: { name: string }): ReactNode {
      const value = useEditorState(editor, ed => ({ text: ed.state.doc.textContent }));
      return createElement('output', { 'data-name': name }, value?.text);
    }
    function App({ both }: { both: boolean }): ReactNode {
      return createElement('div', null,
        both ? createElement(Selected, { key: 'first', name: 'first' }) : null,
        createElement(Selected, { key: 'second', name: 'second' }));
    }
    await flush(() => { root.render(createElement(App, { both: true })); });
    expect(container.querySelectorAll('output')).toHaveLength(2);
    await flush(() => { root.render(createElement(App, { both: false })); });
    await flush(() => { editor.commands.insertText('Still subscribed '); });
    expect(container.querySelector('[data-name="second"]')?.textContent).toBe('Still subscribed Hello');
    expect(container.querySelector('[data-name="first"]')).toBeNull();
  });

  it.each([
    ['array', (editor: Editor) => [editor.state.doc.textContent]],
    ['object', (editor: Editor) => ({ text: editor.state.doc.textContent })],
    ['nested object', (editor: Editor) => ({ nested: { text: editor.state.doc.textContent } })],
    ['JSON', (editor: Editor) => editor.getJSON()],
  ])('caches an allocating %s selector and updates it after edits', async (_name, selector) => {
    const editor = makeEditor();
    const errors = vi.spyOn(console, 'error');
    let renders = 0;
    function Selected(): ReactNode {
      const value = useEditorState(editor, ed => selector(ed));
      renders++;
      return createElement('output', null, JSON.stringify(value));
    }
    await flush(() => { root.render(createElement(StrictMode, null, createElement(Selected))); });
    expect(container.textContent).toContain('Hello');
    await flush(() => { editor.commands.insertText('New '); });
    expect(container.textContent).toContain('New Hello');
    expect(renders).toBeLessThan(10);
    expect(errors).not.toHaveBeenCalled();
  });

  it('uses a changed selector closure even when the editor does not change', async () => {
    const editor = makeEditor();
    function Selected({ prefix }: { prefix: string }): ReactNode {
      const value = useEditorState(editor, ed => ({ text: prefix + ed.state.doc.textContent }));
      return createElement('output', null, value?.text);
    }
    await flush(() => { root.render(createElement(Selected, { prefix: 'First: ' })); });
    await flush(() => { root.render(createElement(Selected, { prefix: 'Second: ' })); });
    expect(container.textContent).toBe('Second: Hello');
    await flush(() => { editor.commands.insertText('New '); });
    expect(container.textContent).toBe('Second: New Hello');
  });

  it('skips rerendering an unchanged primitive while still reading later changes', async () => {
    const editor = makeEditor();
    let renders = 0;
    function Selected(): ReactNode {
      renders++;
      return createElement('output', null, String(useEditorState(editor, ed => ed.isEditable)));
    }
    await flush(() => { root.render(createElement(Selected)); });
    const initialRenders = renders;
    await flush(() => { editor.commands.insertText('New '); });
    expect(renders).toBe(initialRenders);
    await flush(() => { editor.setEditable(false); });
    expect(container.textContent).toBe('false');
    expect(renders).toBe(initialRenders + 1);
  });

  it('switches between null and editors, cleans old subscriptions and handles destruction', async () => {
    const first = makeEditor();
    const second = makeEditor('<p>Second</p>');
    const selector = vi.fn((editor: Editor) => ({ text: editor.state.doc.textContent }));
    function Selected({ editor }: { editor: Editor | null }): ReactNode {
      const value = useEditorState(editor, selector);
      return createElement('output', null, value?.text ?? 'absent');
    }
    await flush(() => { root.render(createElement(Selected, { editor: null })); });
    expect(container.textContent).toBe('absent');
    expect(selector).not.toHaveBeenCalled();
    await flush(() => { root.render(createElement(Selected, { editor: first })); });
    expect(container.textContent).toBe('Hello');
    await flush(() => { root.render(createElement(Selected, { editor: second })); });
    expect(container.textContent).toBe('Second');
    selector.mockClear();
    await flush(() => { first.commands.insertText('Old '); });
    expect(selector).not.toHaveBeenCalled();
    await flush(() => { second.destroy(); });
    expect(container.textContent).toBe('absent');
    expect(selector).not.toHaveBeenCalled();
  });

  it('detects an edit between render and subscription', async () => {
    const editor = makeEditor();
    function Selected(): ReactNode {
      const value = useEditorState(editor, ed => ({ text: ed.state.doc.textContent }));
      useLayoutEffect(() => { editor.commands.insertText('Early '); }, []);
      return createElement('output', null, value?.text);
    }
    await flush(() => { root.render(createElement(Selected)); });
    expect(container.textContent).toBe('Early Hello');
  });

  it('observes focus, blur and storage changes signalled by an editor event', async () => {
    const editor = makeEditor();
    editor.storage['probe'] = { count: 0 };
    function Selected(): ReactNode {
      const value = useEditorState(editor, ed => ({
        focused: ed.isFocused,
        count: (ed.storage['probe'] as { count: number }).count,
      }));
      return createElement('output', null, JSON.stringify(value));
    }
    await flush(() => { root.render(createElement(Selected)); });
    expect(container.textContent).toBe('{"focused":false,"count":0}');
    await flush(() => { editor.view.focus(); });
    expect(container.textContent).toBe('{"focused":true,"count":0}');
    await flush(() => { editor.view.dom.blur(); });
    expect(container.textContent).toBe('{"focused":false,"count":0}');
    await flush(() => {
      (editor.storage['probe'] as { count: number }).count = 1;
      editor.emit('transaction', { editor, transaction: editor.state.tr });
    });
    expect(container.textContent).toBe('{"focused":false,"count":1}');
  });

  it('balances StrictMode subscriptions and stops observing after unmount', async () => {
    const editor = makeEditor();
    const on = vi.spyOn(editor, 'on');
    const off = vi.spyOn(editor, 'off');
    const selector = vi.fn((ed: Editor) => ({ text: ed.state.doc.textContent }));
    function Selected(): ReactNode {
      return createElement('output', null, useEditorState(editor, selector)?.text);
    }
    await flush(() => { root.render(createElement(StrictMode, null, createElement(Selected))); });
    await flush(() => { root.render(null); });
    for (const event of ['transaction', 'focus', 'blur', 'destroy']) {
      expect(on.mock.calls.filter(([name]) => name === event)).toHaveLength(
        off.mock.calls.filter(([name]) => name === event).length,
      );
    }
    selector.mockClear();
    editor.commands.insertText('After ');
    expect(selector).not.toHaveBeenCalled();
  });

  it('supports server rendering with null or a supplied editor', () => {
    const editor = makeEditor();
    function Selected({ editor }: { editor: Editor | null }): ReactNode {
      const value = useEditorState(editor, ed => ({ text: ed.state.doc.textContent }));
      return createElement('output', null, value?.text ?? 'absent');
    }
    expect(renderToString(createElement(Selected, { editor: null }))).toBe('<output>absent</output>');
    expect(renderToString(createElement(Selected, { editor }))).toBe('<output>Hello</output>');
  });

  it('preserves the full-state overload and its document updates', async () => {
    const editor = makeEditor();
    function Selected(): ReactNode {
      const value = useEditorState(editor);
      return createElement('output', null, value.htmlContent);
    }
    await flush(() => { root.render(createElement(Selected)); });
    expect(container.textContent).toBe('<p>Hello</p>');
    await flush(() => { editor.commands.insertText('New '); });
    expect(container.textContent).toBe('<p>New Hello</p>');
  });
});
