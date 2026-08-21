import { describe, it, expect, beforeAll } from 'vitest';
import { MathInline } from './MathInline.js';
import { MathBlock } from './MathBlock.js';
import { mathEditPluginKey } from './MathEditing.js';
import type { MathRenderer } from './renderer.js';
import { Document, Text, Paragraph, Editor } from '@domternal/core';
import { TextSelection } from '@domternal/pm/state';
import type { EditorView } from '@domternal/pm/view';

const stub: MathRenderer = { renderToString: (latex) => `<em>${latex}</em>` };

beforeAll(() => {
  if (!('ResizeObserver' in globalThis)) {
    globalThis.ResizeObserver = class {
      observe(): void {
        /* no-op stub for jsdom */
      }
      unobserve(): void {
        /* no-op stub for jsdom */
      }
      disconnect(): void {
        /* no-op stub for jsdom */
      }
    };
  }
  if (!('requestAnimationFrame' in globalThis)) {
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback): number =>
      setTimeout(() => { cb(0); }, 0));
    globalThis.cancelAnimationFrame = ((id: number): void => { clearTimeout(id); });
  }
});

function inlineEditor(content: string): Editor {
  return new Editor({
    element: document.createElement('div'),
    extensions: [Document, Text, Paragraph, MathInline.configure({ renderer: stub })],
    content,
  });
}

function blockEditor(content: string): Editor {
  return new Editor({
    element: document.createElement('div'),
    extensions: [Document, Text, Paragraph, MathBlock.configure({ renderer: stub })],
    content,
  });
}

function nodeLatex(editor: Editor, typeName: string): string | null {
  let latex: string | null = null;
  editor.view.state.doc.descendants((n) => {
    if (n.type.name === typeName) latex = (n.attrs['latex'] as string | undefined) ?? null;
  });
  return latex;
}

function selectEnd(editor: Editor): void {
  editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.atEnd(editor.view.state.doc)));
}

function typeChar(editor: Editor, char: string): boolean {
  const { from, to } = editor.view.state.selection;
  const handler = editor.view.someProp('handleTextInput') as
    | ((view: EditorView, from: number, to: number, text: string) => boolean)
    | undefined;
  return handler ? handler(editor.view, from, to, char) : false;
}

describe('math authoring', () => {
  it('insertMathInline inserts a node with the given latex', () => {
    const editor = inlineEditor('<p>x</p>');
    editor.commands.insertMathInline('a^2');
    expect(nodeLatex(editor, 'mathInline')).toBe('a^2');
    editor.destroy();
  });

  it('insertMathInline with no latex opens the editor', () => {
    const editor = inlineEditor('<p>x</p>');
    editor.commands.insertMathInline();
    const state = mathEditPluginKey.getState(editor.view.state);
    expect(state?.edit).not.toBeNull();
    expect(state?.edit?.displayMode).toBe(false);
    editor.destroy();
  });

  it('insertMathBlock inserts a block node with the given latex', () => {
    const editor = blockEditor('<p>x</p>');
    editor.commands.insertMathBlock('y^2');
    expect(nodeLatex(editor, 'mathBlock')).toBe('y^2');
    editor.destroy();
  });

  it('converts $...$ to inline math via input rule', () => {
    const editor = inlineEditor('<p>$a^2</p>');
    selectEnd(editor);
    const handled = typeChar(editor, '$');
    expect(handled).toBe(true);
    expect(nodeLatex(editor, 'mathInline')).toBe('a^2');
    editor.destroy();
  });

  it('converts $$ to a block equation via input rule', () => {
    const editor = blockEditor('<p>$</p>');
    selectEnd(editor);
    const handled = typeChar(editor, '$');
    expect(handled).toBe(true);
    let hasBlock = false;
    editor.view.state.doc.descendants((n) => {
      if (n.type.name === 'mathBlock') hasBlock = true;
    });
    expect(hasBlock).toBe(true);
    editor.destroy();
  });
});
