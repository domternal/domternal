import { describe, it, expect } from 'vitest';
import { wrappingInputRule, notInsideList } from './wrappingInputRule.js';
import { Editor } from '../Editor.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Blockquote } from '../nodes/Blockquote.js';
import { BulletList } from '../nodes/BulletList.js';
import { ListItem } from '../nodes/ListItem.js';
import { TextSelection } from '@domternal/pm/state';

describe('wrappingInputRule', () => {
  it('creates an InputRule', () => {
    const editor = new Editor({
      extensions: [Document, Text, Paragraph, Blockquote],
      content: '<p></p>',
    });
    const rule = wrappingInputRule({
      find: /^>\s$/,
      type: editor.schema.nodes['blockquote']!,
    });
    expect(rule).toBeDefined();
    editor.destroy();
  });

  it('handler returns null when guard returns false', () => {
    const editor = new Editor({
      extensions: [Document, Text, Paragraph, Blockquote],
      content: '<p>> </p>',
    });
    const rule = wrappingInputRule({
      find: /^>\s$/,
      type: editor.schema.nodes['blockquote']!,
      guard: () => false,
    });
    const match = ['> '] as RegExpMatchArray;
    const result = ((rule as any).handler)(editor.state, match, 1, 3);
    expect(result).toBeNull();
    editor.destroy();
  });

  it('handler wraps range when guard returns true', () => {
    const editor = new Editor({
      extensions: [Document, Text, Paragraph, Blockquote],
      content: '<p>> </p>',
    });
    const rule = wrappingInputRule({
      find: /^>\s$/,
      type: editor.schema.nodes['blockquote']!,
      guard: () => true,
    });
    const match = ['> '] as RegExpMatchArray;
    const result = ((rule as any).handler)(editor.state, match, 1, 3);
    expect(result).not.toBeNull();
    editor.destroy();
  });

  it('handler with static attributes object', () => {
    const editor = new Editor({
      extensions: [Document, Text, Paragraph, Blockquote],
      content: '<p>> </p>',
    });
    const rule = wrappingInputRule({
      find: /^>\s$/,
      type: editor.schema.nodes['blockquote']!,
      getAttributes: {},
    });
    const match = ['> '] as RegExpMatchArray;
    const result = ((rule as any).handler)(editor.state, match, 1, 3);
    expect(result).not.toBeNull();
    editor.destroy();
  });

  it('handler with function attributes returning null', () => {
    const editor = new Editor({
      extensions: [Document, Text, Paragraph, Blockquote],
      content: '<p>> </p>',
    });
    const rule = wrappingInputRule({
      find: /^>\s$/,
      type: editor.schema.nodes['blockquote']!,
      getAttributes: () => null,
    });
    const match = ['> '] as RegExpMatchArray;
    const result = ((rule as any).handler)(editor.state, match, 1, 3);
    expect(result).not.toBeNull();
    editor.destroy();
  });

  it('joinPredicate returning false skips join', () => {
    const editor = new Editor({
      extensions: [Document, Text, Paragraph, Blockquote],
      content: '<p>> </p>',
    });
    const rule = wrappingInputRule({
      find: /^>\s$/,
      type: editor.schema.nodes['blockquote']!,
      joinPredicate: () => false,
    });
    const match = ['> '] as RegExpMatchArray;
    const result = ((rule as any).handler)(editor.state, match, 1, 3);
    expect(result).not.toBeNull();
    editor.destroy();
  });

  it('returns null when wrapping is not possible', () => {
    const editor = new Editor({
      extensions: [Document, Text, Paragraph, Blockquote],
      content: '<p>> </p>',
    });
    // Create a rule but with a type that can't wrap a paragraph
    const rule = wrappingInputRule({
      find: /^>\s$/,
      type: editor.schema.nodes['paragraph']!, // paragraph can't wrap paragraph
    });
    const match = ['> '] as RegExpMatchArray;
    const result = ((rule as any).handler)(editor.state, match, 1, 3);
    expect(result).toBeNull();
    editor.destroy();
  });

  it('undoable option passed to InputRule', () => {
    const editor = new Editor({
      extensions: [Document, Text, Paragraph, Blockquote],
      content: '<p></p>',
    });
    const rule = wrappingInputRule({
      find: /^>\s$/,
      type: editor.schema.nodes['blockquote']!,
      undoable: false,
    });
    expect(rule).toBeDefined();
    editor.destroy();
  });
});

describe('forward join (lists merge in both directions; others do not)', () => {
  /** Fire input rules for typing `lastChar` at the caret (after `before` text). */
  function fireInputRule(editor: Editor, caret: number, lastChar: string): void {
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, caret)));
    for (const pl of editor.view.state.plugins) {
      const handle = pl.props?.handleTextInput as
        | ((view: unknown, from: number, to: number, text: string) => boolean)
        | undefined;
      if (handle && handle(editor.view, caret, caret, lastChar)) break;
    }
  }

  function caretAfterText(editor: Editor, text: string): number {
    let pos = -1;
    editor.state.doc.descendants((n, p) => {
      if (pos !== -1) return false;
      if (n.isText && n.text === text) { pos = p + text.length; return false; }
      return true;
    });
    if (pos === -1) throw new Error(`text "${text}" not found`);
    return pos;
  }

  function topTypes(editor: Editor): string[] {
    const out: string[] = [];
    editor.state.doc.forEach((n) => out.push(n.type.name));
    return out;
  }

  it('bullet "- " between two bullet lists merges all into ONE list', () => {
    // The middle paragraph holds the trigger marker "-"; typing the trailing
    // space fires the bullet input rule on it.
    const editor = new Editor({
      extensions: [Document, Text, Paragraph, BulletList, ListItem],
      content: '<ul><li><p>A</p></li></ul><p>-</p><ul><li><p>C</p></li></ul>',
    });
    fireInputRule(editor, caretAfterText(editor, '-'), ' ');
    // One list with three items (A, the wrapped marker line, C) - the trailing
    // list is no longer orphaned.
    expect(topTypes(editor)).toEqual(['bulletList']);
    expect(editor.state.doc.firstChild?.childCount).toBe(3);
    editor.destroy();
  });

  it('blockquote "> " does NOT forward-join (adjacent quotes stay separate)', () => {
    const editor = new Editor({
      extensions: [Document, Text, Paragraph, Blockquote],
      content: '<blockquote><p>A</p></blockquote><p>&gt;</p><blockquote><p>C</p></blockquote>',
    });
    fireInputRule(editor, caretAfterText(editor, '>'), ' ');
    // Backward join still merges the marker line into the first quote (existing
    // behaviour), but the trailing quote is left separate (no forward join).
    expect(topTypes(editor)).toEqual(['blockquote', 'blockquote']);
    editor.destroy();
  });
});

describe('notInsideList', () => {
  it('returns true when cursor is not in a list', () => {
    const editor = new Editor({
      extensions: [Document, Text, Paragraph, BulletList, ListItem],
      content: '<p>plain</p>',
    });
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2)));
    expect(notInsideList(editor.state)).toBe(true);
    editor.destroy();
  });

  it('returns false when cursor is inside listItem', () => {
    const editor = new Editor({
      extensions: [Document, Text, Paragraph, BulletList, ListItem],
      content: '<ul><li><p>Inside</p></li></ul>',
    });
    // Cursor inside list item text
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 4)));
    expect(notInsideList(editor.state)).toBe(false);
    editor.destroy();
  });
});
