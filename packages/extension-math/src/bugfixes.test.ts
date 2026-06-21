/**
 * Regression tests for the math bug-fix pass: read-only click guard, the
 * insertMathBlock code-context guard, cancel-deletes-empty, the keyboard edit
 * path (Enter on a node-selected equation), the stale-position guard in apply(),
 * and apply-on-focusout.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { MathInline } from './MathInline.js';
import { MathBlock } from './MathBlock.js';
import { mathEditPluginKey } from './MathEditing.js';
import type { MathRenderer } from './renderer.js';
import { Document, Text, Paragraph, CodeBlock, BulletList, ListItem, Editor } from '@domternal/core';
import type { ToolbarButton } from '@domternal/core';
import { NodeSelection, TextSelection } from '@domternal/pm/state';
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
    } as unknown as typeof ResizeObserver;
  }
  if (!('requestAnimationFrame' in globalThis)) {
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback): number =>
      setTimeout(() => {
        cb(0);
      }, 0) as unknown as number) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = ((id: number): void => {
      clearTimeout(id);
    }) as typeof cancelAnimationFrame;
  }
});

function mk(content: string, editable = true): Editor {
  return new Editor({
    element: document.createElement('div'),
    extensions: [
      Document,
      Text,
      Paragraph,
      CodeBlock,
      MathInline.configure({ renderer: stub }),
      MathBlock.configure({ renderer: stub }),
    ],
    content,
    editable,
  });
}

function findPos(editor: Editor, typeName: string): number {
  let pos = -1;
  editor.view.state.doc.descendants((n, p) => {
    if (n.type.name === typeName) pos = p;
  });
  return pos;
}

function count(editor: Editor, typeName: string): number {
  let n = 0;
  editor.view.state.doc.descendants((node) => {
    if (node.type.name === typeName) n++;
  });
  return n;
}

function nodeLatex(editor: Editor, typeName: string): string | null {
  let latex: string | null = null;
  editor.view.state.doc.descendants((n) => {
    if (n.type.name === typeName) latex = (n.attrs['latex'] as string | undefined) ?? null;
  });
  return latex;
}

function shownTextarea(): HTMLTextAreaElement {
  const ta = document.querySelector<HTMLTextAreaElement>('.dm-math-popover[data-show] textarea');
  expect(ta).not.toBeNull();
  return ta!;
}

function openEdit(editor: Editor, pos: number, latex: string, displayMode = false): void {
  editor.view.dispatch(editor.view.state.tr.setMeta(mathEditPluginKey, { pos, latex, displayMode }));
}

describe('read-only guard', () => {
  it('does not open the edit popover when the editor is read-only', () => {
    const editor = mk('<p><span data-type="math-inline" data-latex="a"></span></p>', false);
    const el = editor.view.dom.querySelector('.dm-math-inline')!;
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(mathEditPluginKey.getState(editor.view.state)?.edit).toBeNull();
    editor.destroy();
  });
});

describe('insertMathBlock code-context guard', () => {
  it('refuses to insert block math inside a code block', () => {
    const editor = mk('<pre><code>x = 1</code></pre>');
    editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.atEnd(editor.view.state.doc)));
    expect(editor.commands.insertMathBlock('a^2')).toBe(false);
    expect(count(editor, 'mathBlock')).toBe(0);
    editor.destroy();
  });
});

describe('cancel removes a freshly inserted empty equation', () => {
  it('Escape deletes a just-inserted empty inline equation', () => {
    const editor = mk('<p>x</p>');
    editor.commands.insertMathInline();
    expect(count(editor, 'mathInline')).toBe(1);
    shownTextarea().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(count(editor, 'mathInline')).toBe(0);
    editor.destroy();
  });

  it('Escape deletes a just-inserted empty block equation', () => {
    const editor = mk('<p>x</p>');
    editor.commands.insertMathBlock();
    expect(count(editor, 'mathBlock')).toBe(1);
    shownTextarea().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(count(editor, 'mathBlock')).toBe(0);
    editor.destroy();
  });

  it('Escape keeps an existing non-empty equation untouched', () => {
    const editor = mk('<p><span data-type="math-inline" data-latex="keep"></span></p>');
    openEdit(editor, findPos(editor, 'mathInline'), 'keep');
    shownTextarea().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(nodeLatex(editor, 'mathInline')).toBe('keep');
    editor.destroy();
  });
});

describe('keyboard edit path', () => {
  function pressEnter(view: EditorView): boolean {
    const event = new KeyboardEvent('keydown', { key: 'Enter' });
    return view.someProp('handleKeyDown', (handler) => handler(view, event)) === true;
  }

  it('Enter opens the popover for a node-selected inline equation', () => {
    const editor = mk('<p><span data-type="math-inline" data-latex="a"></span></p>');
    const pos = findPos(editor, 'mathInline');
    editor.view.dispatch(editor.view.state.tr.setSelection(NodeSelection.create(editor.view.state.doc, pos)));
    expect(pressEnter(editor.view)).toBe(true);
    expect(mathEditPluginKey.getState(editor.view.state)?.edit?.pos).toBe(pos);
    editor.destroy();
  });

  it('Enter opens the popover for a node-selected block equation', () => {
    const editor = mk('<div data-type="math-block" data-latex="y"></div>');
    const pos = findPos(editor, 'mathBlock');
    editor.view.dispatch(editor.view.state.tr.setSelection(NodeSelection.create(editor.view.state.doc, pos)));
    expect(pressEnter(editor.view)).toBe(true);
    expect(mathEditPluginKey.getState(editor.view.state)?.edit?.pos).toBe(pos);
    expect(mathEditPluginKey.getState(editor.view.state)?.edit?.displayMode).toBe(true);
    editor.destroy();
  });

  it('Enter is a no-op (returns false) for a normal text selection', () => {
    const editor = mk('<p>hello</p>');
    editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.atEnd(editor.view.state.doc)));
    expect(pressEnter(editor.view)).toBe(false);
    editor.destroy();
  });
});

describe('apply guards against a stale position', () => {
  it('does not corrupt the document when the target node is gone', () => {
    const editor = mk('<p><span data-type="math-inline" data-latex="a"></span>b</p>');
    const pos = findPos(editor, 'mathInline');
    openEdit(editor, pos, 'a');
    // Delete the math node out from under the open popover.
    editor.view.dispatch(editor.view.state.tr.delete(pos, pos + 1));
    expect(count(editor, 'mathInline')).toBe(0);
    const ta = shownTextarea();
    ta.value = 'zzz';
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(count(editor, 'mathInline')).toBe(0);
    expect(editor.getText().includes('zzz')).toBe(false);
    editor.destroy();
  });
});

describe('apply on focus loss', () => {
  it('applies the edit when focus leaves the popover', () => {
    const editor = mk('<p><span data-type="math-inline" data-latex="a"></span></p>');
    openEdit(editor, findPos(editor, 'mathInline'), 'a');
    const ta = shownTextarea();
    ta.value = 'blurred';
    ta.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: document.body }));
    expect(nodeLatex(editor, 'mathInline')).toBe('blurred');
    editor.destroy();
  });
});

describe('inline equation as a selection action (Notion-style)', () => {
  it('wraps the selected text as the equation source', () => {
    const editor = mk('<p>x^2</p>');
    editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, 1, 4)));
    editor.commands.insertMathInline();
    expect(nodeLatex(editor, 'mathInline')).toBe('x^2');
    editor.destroy();
  });

  it('keeps the radical toolbar button and is flagged for the text bubble menu; block keeps sigma', () => {
    const editor = mk('<p></p>');
    const buttons = editor.toolbarItems.filter((i): i is ToolbarButton => i.type === 'button');
    const inline = buttons.find((i) => i.name === 'mathInline');
    // Inline stays in the main toolbar (classic editor) with a distinct radical
    // icon, and is also offered as a selection action in the text bubble menu.
    expect(inline?.toolbar).not.toBe(false);
    expect(inline?.bubbleMenu).toBe('text');
    expect(inline?.icon).toBe('radical');
    // Block equation is a separate toolbar insert button with the sigma icon.
    const block = buttons.find((i) => i.name === 'mathBlock');
    expect(block?.toolbar).not.toBe(false);
    expect(block?.icon).toBe('sigma');
    editor.destroy();
  });
});

describe('insertMathBlock replaces an empty line (no dangling paragraph)', () => {
  it('replaces an empty line with the block', () => {
    const editor = mk('<p></p>');
    editor.commands.insertMathBlock('x^2');
    expect(count(editor, 'mathBlock')).toBe(1);
    expect(count(editor, 'paragraph')).toBe(0);
    editor.destroy();
  });

  it('inserts after a non-empty line and keeps the paragraph', () => {
    const editor = mk('<p>abc</p>');
    editor.commands.insertMathBlock('x^2');
    expect(count(editor, 'mathBlock')).toBe(1);
    expect(count(editor, 'paragraph')).toBe(1);
    expect(editor.getText()).toContain('abc');
    editor.destroy();
  });

  it('replaces only the empty line between content, keeping its neighbors', () => {
    const editor = mk('<p>a</p><p></p><p>b</p>');
    let emptyPos = -1;
    editor.view.state.doc.descendants((n, p) => {
      if (n.type.name === 'paragraph' && n.content.size === 0) emptyPos = p;
    });
    editor.view.dispatch(
      editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, emptyPos + 1)),
    );
    editor.commands.insertMathBlock('x^2');
    expect(count(editor, 'mathBlock')).toBe(1);
    expect(count(editor, 'paragraph')).toBe(2);
    expect(editor.getText()).toContain('a');
    expect(editor.getText()).toContain('b');
    editor.destroy();
  });

  it('inside a list item, inserts after the empty line (the leading paragraph is schema-required)', () => {
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: [
        Document,
        Text,
        Paragraph,
        BulletList,
        ListItem,
        MathBlock.configure({ renderer: stub }),
      ],
      content: '<ul><li><p></p></li></ul>',
    });
    editor.view.dispatch(
      editor.view.state.tr.setSelection(TextSelection.atStart(editor.view.state.doc)),
    );
    editor.commands.insertMathBlock('x^2');
    expect(count(editor, 'mathBlock')).toBe(1);
    // A list item is `paragraph block*`, so its leading paragraph cannot be dropped;
    // the equation lands after it inside the same item rather than replacing it.
    let children: string[] = [];
    editor.view.state.doc.descendants((n) => {
      if (n.type.name === 'listItem') {
        children = [];
        n.forEach((c) => children.push(c.type.name));
      }
    });
    expect(children).toEqual(['paragraph', 'mathBlock']);
    editor.destroy();
  });
});
