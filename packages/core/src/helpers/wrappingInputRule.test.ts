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
