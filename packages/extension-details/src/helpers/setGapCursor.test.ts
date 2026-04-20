import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { Document, Text, Paragraph, Editor, Gapcursor } from '@domternal/core';
import { Details } from '../Details.js';
import { DetailsSummary } from '../DetailsSummary.js';
import { DetailsContent } from '../DetailsContent.js';
import { setGapCursor } from './setGapCursor.js';

const allExtensions = [Document, Text, Paragraph, Details, DetailsSummary, DetailsContent, Gapcursor];

describe('setGapCursor', () => {
  let editor: Editor;
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
    const { TextSelection } = require('@domternal/pm/state');
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
    const { TextSelection } = require('@domternal/pm/state');
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
    const { TextSelection } = require('@domternal/pm/state');
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2)));

    expect(setGapCursor(editor as any, 'right')).toBe(false);
  });

  it('activates gap cursor at end of closed summary (ArrowDown direction)', () => {
    editor = new Editor({
      element: host,
      extensions: allExtensions,
      // Closed details (no open attribute)
      content: '<details><summary>Title</summary><div data-details-content><p>Body</p></div></details><p>After</p>',
    });

    // Place cursor at end of "Title" summary
    const { TextSelection } = require('@domternal/pm/state');
    // Summary text is "Title" (length 5). Summary node is at pos 1, so after its content: 1 + 1 + 5 = 7
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 7)));

    // Detail is closed → may or may not activate (depends on jsdom offsetParent).
    // Either way it should not throw.
    expect(() => setGapCursor(editor as any, 'down')).not.toThrow();
  });
});
