import { describe, it, expect } from 'vitest';
import { MathInline } from './MathInline.js';
import { MathBlock } from './MathBlock.js';
import { MATH_PLACEHOLDER } from './createMathNodeView.js';
import type { MathRenderer } from './renderer.js';
import { Document, Text, Paragraph, Editor } from '@domternal/core';

/** Stub renderer that marks inline vs block so the test can assert displayMode. */
const stub: MathRenderer = {
  renderToString: (latex, { displayMode }) =>
    `<em data-r="${displayMode ? 'block' : 'inline'}">${latex}</em>`,
};

function inlineEditor(content: string, renderer: MathRenderer | null = stub): Editor {
  return new Editor({
    element: document.createElement('div'),
    extensions: [Document, Text, Paragraph, MathInline.configure({ renderer })],
    content,
  });
}

describe('createMathNodeView', () => {
  it('renders inline latex through the renderer (displayMode false)', () => {
    const editor = inlineEditor('<p><span data-type="math-inline" data-latex="a^2"></span></p>');
    const el = editor.view.dom.querySelector('.dm-math-inline');
    expect(el).not.toBeNull();
    expect(el?.innerHTML).toContain('a^2');
    expect(el?.querySelector('[data-r="inline"]')).not.toBeNull();
    editor.destroy();
  });

  it('renders a placeholder for empty latex', () => {
    const editor = inlineEditor('<p><span data-type="math-inline"></span></p>');
    const el = editor.view.dom.querySelector('.dm-math-inline');
    expect(el?.classList.contains('dm-math-empty')).toBe(true);
    expect(el?.textContent).toBe(MATH_PLACEHOLDER);
    editor.destroy();
  });

  it('shows raw latex when no renderer is provided', () => {
    const editor = inlineEditor('<p><span data-type="math-inline" data-latex="z_1"></span></p>', null);
    const el = editor.view.dom.querySelector('.dm-math-inline');
    expect(el?.textContent).toBe('z_1');
    editor.destroy();
  });

  it('renders block latex with displayMode true', () => {
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: [Document, Text, Paragraph, MathBlock.configure({ renderer: stub })],
      content: '<div data-type="math-block" data-latex="x^2"></div>',
    });
    const el = editor.view.dom.querySelector('.dm-math-block');
    expect(el).not.toBeNull();
    expect(el?.querySelector('[data-r="block"]')).not.toBeNull();
    editor.destroy();
  });

  it('re-renders when the latex attribute changes', () => {
    const editor = inlineEditor('<p><span data-type="math-inline" data-latex="a"></span></p>');
    const el = editor.view.dom.querySelector('.dm-math-inline');
    let mathPos = -1;
    editor.view.state.doc.descendants((n, pos) => {
      if (n.type.name === 'mathInline') mathPos = pos;
    });
    expect(mathPos).toBeGreaterThanOrEqual(0);
    editor.view.dispatch(
      editor.view.state.tr.setNodeMarkup(mathPos, undefined, { latex: 'b' }),
    );
    expect(el?.innerHTML).toContain('b');
    editor.destroy();
  });
});
