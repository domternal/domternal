import { describe, it, expect, beforeAll } from 'vitest';
import { MathInline } from './MathInline.js';
import { mathEditPluginKey } from './MathEditing.js';
import type { MathRenderer } from './renderer.js';
import { Document, Text, Paragraph, Editor } from '@domternal/core';

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

function makeEditor(latex = 'a^2'): { editor: Editor; pos: number } {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [Document, Text, Paragraph, MathInline.configure({ renderer: stub })],
    content: `<p><span data-type="math-inline" data-latex="${latex}"></span></p>`,
  });
  let pos = -1;
  editor.view.state.doc.descendants((n, p) => {
    if (n.type.name === 'mathInline') pos = p;
  });
  return { editor, pos };
}

function open(editor: Editor, pos: number, latex: string): void {
  editor.view.dispatch(
    editor.view.state.tr.setMeta(mathEditPluginKey, { pos, latex, displayMode: false }),
  );
}

function mathLatex(editor: Editor): string | null {
  let latex: string | null = null;
  editor.view.state.doc.descendants((n) => {
    if (n.type.name === 'mathInline') latex = (n.attrs['latex'] as string | undefined) ?? null;
  });
  return latex;
}

function popoverTextarea(): HTMLTextAreaElement {
  const ta = document.querySelector('.dm-math-popover textarea');
  expect(ta).not.toBeNull();
  return ta as HTMLTextAreaElement;
}

describe('MathEditing', () => {
  it('is auto-included by the math node (companion extension)', () => {
    const { editor } = makeEditor();
    expect(mathEditPluginKey.getState(editor.view.state)).toBeDefined();
    editor.destroy();
  });

  it('records the edit signal in plugin state', () => {
    const { editor, pos } = makeEditor();
    open(editor, pos, 'a^2');
    const state = mathEditPluginKey.getState(editor.view.state);
    expect(state?.edit?.pos).toBe(pos);
    expect(state?.edit?.latex).toBe('a^2');
    editor.destroy();
  });

  it('opens the popover with the latex prefilled', () => {
    const { editor, pos } = makeEditor('x+1');
    open(editor, pos, 'x+1');
    const popover = document.querySelector('.dm-math-popover');
    expect(popover?.hasAttribute('data-show')).toBe(true);
    expect(popoverTextarea().value).toBe('x+1');
    editor.destroy();
  });

  it('applies the edited latex on Enter', () => {
    const { editor, pos } = makeEditor('a');
    open(editor, pos, 'a');
    const input = popoverTextarea();
    input.value = 'b^2';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(mathLatex(editor)).toBe('b^2');
    editor.destroy();
  });

  it('cancels on Escape without changing the node', () => {
    const { editor, pos } = makeEditor('a');
    open(editor, pos, 'a');
    const input = popoverTextarea();
    input.value = 'changed';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(mathLatex(editor)).toBe('a');
    editor.destroy();
  });

  it('deletes the node when applied empty', () => {
    const { editor, pos } = makeEditor('a');
    open(editor, pos, 'a');
    const input = popoverTextarea();
    input.value = '   ';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(mathLatex(editor)).toBeNull();
    editor.destroy();
  });
});
