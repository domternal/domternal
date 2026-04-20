import { describe, it, expect } from 'vitest';
import { nodeInputRule } from './nodeInputRule.js';
import { Editor } from '../Editor.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { HorizontalRule } from '../nodes/HorizontalRule.js';

describe('nodeInputRule', () => {
  it('creates an InputRule instance', () => {
    const editor = new Editor({
      extensions: [Document, Text, Paragraph, HorizontalRule],
      content: '<p></p>',
    });
    const rule = nodeInputRule({
      find: /---/,
      type: editor.schema.nodes['horizontalRule']!,
    });
    expect(rule).toBeDefined();
    expect((rule as any).handler).toBeDefined();
    editor.destroy();
  });

  it('inserts a node when matched with static attributes', () => {
    const editor = new Editor({
      extensions: [Document, Text, Paragraph, HorizontalRule],
      content: '<p>---</p>',
    });
    const rule = nodeInputRule({
      find: /---/,
      type: editor.schema.nodes['horizontalRule']!,
    });

    const match = ['---'] as RegExpMatchArray;
    const result = ((rule as any).handler)(editor.state, match, 1, 4);
    expect(result).not.toBeNull();
    editor.destroy();
  });

  it('inserts a node with attributes from function', () => {
    const editor = new Editor({
      extensions: [Document, Text, Paragraph, HorizontalRule],
      content: '<p>---</p>',
    });
    const getAttributes = (match: RegExpMatchArray): { text: string } => ({ text: match[0] });
    const rule = nodeInputRule({
      find: /---/,
      type: editor.schema.nodes['horizontalRule']!,
      getAttributes,
    });

    const match = ['---'] as RegExpMatchArray;
    const result = ((rule as any).handler)(editor.state, match, 1, 4);
    expect(result).not.toBeNull();
    editor.destroy();
  });

  it('returns null when getAttributes function returns null', () => {
    const editor = new Editor({
      extensions: [Document, Text, Paragraph, HorizontalRule],
      content: '<p>---</p>',
    });
    const rule = nodeInputRule({
      find: /---/,
      type: editor.schema.nodes['horizontalRule']!,
      getAttributes: () => null,
    });

    const match = ['---'] as RegExpMatchArray;
    const result = ((rule as any).handler)(editor.state, match, 1, 4);
    expect(result).toBeNull();
    editor.destroy();
  });

  it('passes undoable option through', () => {
    const editor = new Editor({
      extensions: [Document, Text, Paragraph, HorizontalRule],
      content: '<p></p>',
    });
    const rule = nodeInputRule({
      find: /---/,
      type: editor.schema.nodes['horizontalRule']!,
      undoable: false,
    });
    expect(rule).toBeDefined();
    editor.destroy();
  });

  it('uses static attributes object', () => {
    const editor = new Editor({
      extensions: [Document, Text, Paragraph, HorizontalRule],
      content: '<p>---</p>',
    });
    const rule = nodeInputRule({
      find: /---/,
      type: editor.schema.nodes['horizontalRule']!,
      getAttributes: { id: 'x' },
    });

    const match = ['---'] as RegExpMatchArray;
    const result = ((rule as any).handler)(editor.state, match, 1, 4);
    expect(result).not.toBeNull();
    editor.destroy();
  });
});
