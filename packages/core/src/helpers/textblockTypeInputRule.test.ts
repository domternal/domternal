import { describe, it, expect } from 'vitest';
import { textblockTypeInputRule } from './textblockTypeInputRule.js';
import { Editor } from '../Editor.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Heading } from '../nodes/Heading.js';

describe('textblockTypeInputRule', () => {
  it('creates an InputRule', () => {
    const editor = new Editor({
      extensions: [Document, Text, Paragraph, Heading],
      content: '<p></p>',
    });
    const rule = textblockTypeInputRule({
      find: /^# /,
      type: editor.schema.nodes['heading']!,
    });
    expect(rule).toBeDefined();
    editor.destroy();
  });

  it('handler converts paragraph to target type', () => {
    const editor = new Editor({
      extensions: [Document, Text, Paragraph, Heading],
      content: '<p># </p>',
    });
    const rule = textblockTypeInputRule({
      find: /^# /,
      type: editor.schema.nodes['heading']!,
      getAttributes: () => ({ level: 1 }),
    });

    const match = ['# '] as RegExpMatchArray;
    const result = ((rule as any).handler)(editor.state, match, 1, 3);
    expect(result).not.toBeNull();
    editor.destroy();
  });

  it('handler with static attributes object', () => {
    const editor = new Editor({
      extensions: [Document, Text, Paragraph, Heading],
      content: '<p># </p>',
    });
    const rule = textblockTypeInputRule({
      find: /^# /,
      type: editor.schema.nodes['heading']!,
      getAttributes: { level: 2 },
    });

    const match = ['# '] as RegExpMatchArray;
    const result = ((rule as any).handler)(editor.state, match, 1, 3);
    expect(result).not.toBeNull();
    editor.destroy();
  });

  it('handler with no attributes', () => {
    const editor = new Editor({
      extensions: [Document, Text, Paragraph, Heading],
      content: '<p># </p>',
    });
    const rule = textblockTypeInputRule({
      find: /^# /,
      type: editor.schema.nodes['heading']!,
    });

    const match = ['# '] as RegExpMatchArray;
    const result = ((rule as any).handler)(editor.state, match, 1, 3);
    expect(result).not.toBeNull();
    editor.destroy();
  });

  it('passes undoable option', () => {
    const editor = new Editor({
      extensions: [Document, Text, Paragraph, Heading],
      content: '<p></p>',
    });
    const rule = textblockTypeInputRule({
      find: /^# /,
      type: editor.schema.nodes['heading']!,
      undoable: false,
    });
    expect(rule).toBeDefined();
    editor.destroy();
  });
});
