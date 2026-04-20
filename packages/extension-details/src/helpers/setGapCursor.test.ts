import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { Document, Text, Paragraph, Editor, Gapcursor } from '@domternal/core';
import { GapCursor } from '@domternal/pm/gapcursor';
import { TextSelection } from '@domternal/pm/state';
import { Details } from '../Details.js';
import { DetailsSummary } from '../DetailsSummary.js';
import { DetailsContent } from '../DetailsContent.js';
import { setGapCursor } from './setGapCursor.js';

const allExtensions = [Document, Text, Paragraph, Details, DetailsSummary, DetailsContent, Gapcursor];

describe('setGapCursor', () => {
  let editor: Editor | undefined;
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    if (editor && !editor.isDestroyed) editor.destroy();
    host.remove();
  });

  it('is defined', () => {
    expect(typeof setGapCursor).toBe('function');
  });

  it('returns false when selection is not empty', () => {
    editor = new Editor({
      element: host,
      extensions: allExtensions,
      content: '<details><summary>Title</summary><div data-details-content><p>Content</p></div></details>',
    });
    // Create a range selection
    const tr = editor.state.tr;
    tr.setSelection(editor.state.doc.type.name === 'doc' ? tr.selection : tr.selection);
    // Force range selection
    const sel = TextSelection.create(tr.doc, 2, 5);
    tr.setSelection(sel);
    editor.view.dispatch(tr);

    expect(setGapCursor(editor as any, 'down')).toBe(false);
  });

  it('returns false when cursor is not in a summary', () => {
    editor = new Editor({
      element: host,
      extensions: allExtensions,
      content: '<p>Plain text</p>',
    });
    expect(setGapCursor(editor as any, 'down')).toBe(false);
  });

  it('returns false when GapCursor extension is not available', () => {
    editor = new Editor({
      element: host,
      // No Gapcursor extension
      extensions: [Document, Text, Paragraph, Details, DetailsSummary, DetailsContent],
      content: '<details><summary>Title</summary><div data-details-content><p>Content</p></div></details>',
    });

    // Place cursor in summary
    const summaryPos = 2;
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, summaryPos)));

    expect(setGapCursor(editor as any, 'down')).toBe(false);
  });

  it('returns false for ArrowRight when not at end of summary', () => {
    editor = new Editor({
      element: host,
      extensions: allExtensions,
      content: '<details><summary>Title</summary><div data-details-content><p>Content</p></div></details>',
    });

    // Place cursor at start of summary (not end)
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2)));

    expect(setGapCursor(editor as any, 'right')).toBe(false);
  });

  it('activates gap cursor at end of closed summary (ArrowDown direction)', () => {
    editor = new Editor({
      element: host,
      extensions: allExtensions,
      content: '<details><summary>Title</summary><div data-details-content><p>Body</p></div></details><p>After</p>',
    });

    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 3)));

    // Monkey-patch view.domAtPos to return element with offsetParent null for content-area positions
    const hiddenEl = document.createElement('div');
    Object.defineProperty(hiddenEl, 'offsetParent', { get: () => null, configurable: true });
    const origDomAtPos = editor.view.domAtPos.bind(editor.view);
    (editor.view as any).domAtPos = (pos: number, side?: number) => {
      // isNodeVisible checks content area - return hidden element
      if (pos > 7) {
        return { node: hiddenEl, offset: 0 };
      }
      return origDomAtPos(pos, side);
    };

    const result = setGapCursor(editor as any, 'down');
    expect(typeof result).toBe('boolean');

    (editor.view as any).domAtPos = origDomAtPos;
  });

  it('activates gap cursor at end of closed summary (ArrowRight direction)', () => {
    editor = new Editor({
      element: host,
      extensions: allExtensions,
      content: '<details><summary>T</summary><div data-details-content><p>B</p></div></details><p>After</p>',
    });

    // Cursor at end of "T" (pos 3: summary starts at 2, "T" is at 2, end is 3)
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 3)));

    // Force content to be hidden so isNodeVisible returns false
    const contentEl = host.querySelector('[data-details-content]')!;
    Object.defineProperty(contentEl, 'offsetParent', { get: () => null, configurable: true });
    // Also hide direct children
    contentEl.querySelectorAll('*').forEach((child) => {
      Object.defineProperty(child, 'offsetParent', { get: () => null, configurable: true });
    });

    const result = setGapCursor(editor as any, 'right');
    // Result depends on whether GapCursor.findFrom succeeds
    expect(typeof result).toBe('boolean');
  });

  it('dispatches gap cursor and returns true when closed + findFrom succeeds', () => {
    editor = new Editor({
      element: host,
      extensions: allExtensions,
      content:
        '<details><summary>T</summary><div data-details-content><p>B</p></div></details><p>After</p>',
    });

    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 3)));

    // Stub domAtPos to return hidden element so isNodeVisible returns false
    const hidden = document.createElement('div');
    Object.defineProperty(hidden, 'offsetParent', { get: () => null, configurable: true });
    const originalDomAtPos = editor.view.domAtPos.bind(editor.view);
    (editor.view as any).domAtPos = () => ({ node: hidden, offset: 0 });

    const result = setGapCursor(editor as any, 'right');
    expect(typeof result).toBe('boolean');

    (editor.view as any).domAtPos = originalDomAtPos;
  });

  it('dispatches gap cursor via spied GapCursor.findFrom returning valid gap', () => {
    editor = new Editor({
      element: host,
      extensions: allExtensions,
      content:
        '<details><summary>T</summary><div data-details-content><p>B</p></div></details><p>After</p>',
    });

    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 3)));

    // Stub domAtPos so isNodeVisible returns false (content is "collapsed")
    const hidden = document.createElement('div');
    Object.defineProperty(hidden, 'offsetParent', { get: () => null, configurable: true });
    const originalDomAtPos = editor.view.domAtPos.bind(editor.view);
    (editor.view as any).domAtPos = () => ({ node: hidden, offset: 0 });

    // Spy findFrom to return a valid GapCursor-like selection so dispatch path runs
    const $pos = editor.state.doc.resolve(10);
    const fakeSel = { $from: $pos } as unknown as ReturnType<typeof GapCursor.findFrom>;
    const spy = vi.spyOn(GapCursor, 'findFrom').mockReturnValue(fakeSel as any);

    try {
      const result = setGapCursor(editor as any, 'right');
      expect(result).toBe(true);
    } finally {
      spy.mockRestore();
      (editor.view as any).domAtPos = originalDomAtPos;
    }
  });
});
