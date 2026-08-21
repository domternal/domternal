/**
 * Extra coverage for branches not exercised by the focused suites: toolbar /
 * floating-menu items, empty leafText, the inline code-context guard, node-view
 * error / selection / click paths, and the edit popover's preview, apply-unchanged,
 * and click-outside paths.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { MathInline } from './MathInline.js';
import { MathBlock } from './MathBlock.js';
import { mathEditPluginKey } from './MathEditing.js';
import type { MathRenderer } from './renderer.js';
import { Document, Text, Paragraph, CodeBlock, Editor } from '@domternal/core';
import { NodeSelection, TextSelection } from '@domternal/pm/state';

const stub: MathRenderer = { renderToString: (latex) => `<em>${latex}</em>` };
const throwing: MathRenderer = {
  renderToString: () => {
    throw new Error('bad latex');
  },
};

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

function mk(content: string, renderer: MathRenderer | null = stub): Editor {
  return new Editor({
    element: document.createElement('div'),
    extensions: [
      Document,
      Text,
      Paragraph,
      CodeBlock,
      MathInline.configure({ renderer }),
      MathBlock.configure({ renderer }),
    ],
    content,
  });
}

function findPos(editor: Editor, typeName: string): number {
  let pos = -1;
  editor.view.state.doc.descendants((n, p) => {
    if (n.type.name === typeName) pos = p;
  });
  return pos;
}

function open(editor: Editor, pos: number, latex: string, displayMode = false): void {
  editor.view.dispatch(editor.view.state.tr.setMeta(mathEditPluginKey, { pos, latex, displayMode }));
}

function mathLatex(editor: Editor, typeName = 'mathInline'): string | null {
  let latex: string | null = null;
  editor.view.state.doc.descendants((n) => {
    if (n.type.name === typeName) latex = (n.attrs['latex'] as string | undefined) ?? null;
  });
  return latex;
}

describe('math menus and guards', () => {
  it('exposes math toolbar buttons', () => {
    const editor = mk('<p></p>');
    const names = editor.toolbarItems.map((i) => i.name);
    expect(names).toContain('mathInline');
    expect(names).toContain('mathBlock');
    editor.destroy();
  });

  it('exposes math floating-menu items', () => {
    const editor = mk('<p></p>');
    const names = editor.floatingMenuItems.map((i) => i.name);
    expect(names).toContain('mathInline');
    expect(names).toContain('mathBlock');
    editor.destroy();
  });

  it('leafText is empty for empty math nodes', () => {
    const editor = mk('<p><span data-type="math-inline"></span></p>');
    expect(editor.getText().includes('$')).toBe(false);
    editor.destroy();
  });

  it('refuses to insert inline math inside a code block', () => {
    const editor = mk('<pre><code>x = 1</code></pre>');
    editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.atEnd(editor.view.state.doc)));
    expect(editor.commands.insertMathInline('a^2')).toBe(false);
    expect(findPos(editor, 'mathInline')).toBe(-1);
    editor.destroy();
  });
});

describe('math node view paths', () => {
  it('renders an error state when the renderer throws', () => {
    const editor = mk('<p><span data-type="math-inline" data-latex="\\bad"></span></p>', throwing);
    const el = editor.view.dom.querySelector('.dm-math-inline');
    expect(el?.classList.contains('dm-math-error')).toBe(true);
    editor.destroy();
  });

  it('toggles the selected class via NodeSelection', () => {
    const editor = mk('<p><span data-type="math-inline" data-latex="a"></span></p>');
    const pos = findPos(editor, 'mathInline');
    editor.view.dispatch(
      editor.view.state.tr.setSelection(NodeSelection.create(editor.view.state.doc, pos)),
    );
    const el = editor.view.dom.querySelector('.dm-math-inline');
    expect(el?.classList.contains('ProseMirror-selectednode')).toBe(true);
    editor.view.dispatch(
      editor.view.state.tr.setSelection(TextSelection.atEnd(editor.view.state.doc)),
    );
    expect(el?.classList.contains('ProseMirror-selectednode')).toBe(false);
    editor.destroy();
  });

  it('opens the editor when a math node is clicked', () => {
    const editor = mk('<p><span data-type="math-inline" data-latex="a"></span></p>');
    const el = editor.view.dom.querySelector('.dm-math-inline')!;
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(mathEditPluginKey.getState(editor.view.state)?.edit).not.toBeNull();
    editor.destroy();
  });
});

describe('math edit popover paths', () => {
  function popoverPreview(): Element {
    const p = document.querySelector('.dm-math-popover .dm-math-popover-preview');
    expect(p).not.toBeNull();
    return p!;
  }

  it('shows raw latex in the preview without a renderer', () => {
    const editor = mk('<p><span data-type="math-inline" data-latex="a"></span></p>', null);
    open(editor, findPos(editor, 'mathInline'), 'a');
    expect(popoverPreview().textContent).toBe('a');
    editor.destroy();
  });

  it('shows an error state in the preview when the renderer throws', () => {
    const editor = mk('<p><span data-type="math-inline" data-latex="a"></span></p>', throwing);
    open(editor, findPos(editor, 'mathInline'), 'x');
    expect(popoverPreview().classList.contains('dm-math-error')).toBe(true);
    editor.destroy();
  });

  it('updates the preview on input', () => {
    const editor = mk('<p><span data-type="math-inline" data-latex="a"></span></p>');
    open(editor, findPos(editor, 'mathInline'), 'a');
    const ta = document.querySelector<HTMLTextAreaElement>('.dm-math-popover textarea')!;
    ta.value = 'zzz';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    expect(popoverPreview().innerHTML).toContain('zzz');
    editor.destroy();
  });

  it('applying unchanged latex keeps the node', () => {
    const editor = mk('<p><span data-type="math-inline" data-latex="keep"></span></p>');
    open(editor, findPos(editor, 'mathInline'), 'keep');
    const ta = document.querySelector<HTMLTextAreaElement>('.dm-math-popover textarea')!;
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(mathLatex(editor)).toBe('keep');
    editor.destroy();
  });

  it('clicking outside the popover applies the edit', () => {
    const editor = mk('<p><span data-type="math-inline" data-latex="a"></span></p>');
    open(editor, findPos(editor, 'mathInline'), 'a');
    const ta = document.querySelector<HTMLTextAreaElement>('.dm-math-popover textarea')!;
    ta.value = 'newv';
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(mathLatex(editor)).toBe('newv');
    editor.destroy();
  });

  it('renders the preview in display mode for block math', () => {
    const dm: MathRenderer = {
      renderToString: (latex, { displayMode }) => `<em data-dm="${String(displayMode)}">${latex}</em>`,
    };
    const editor = mk('<div data-type="math-block" data-latex="x"></div>', dm);
    open(editor, findPos(editor, 'mathBlock'), 'x', true);
    expect(popoverPreview().querySelector('[data-dm="true"]')).not.toBeNull();
    editor.destroy();
  });
});
