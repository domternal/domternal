import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '../Editor.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Heading } from '../nodes/Heading.js';
import { Blockquote } from '../nodes/Blockquote.js';
import { findChildren } from './findChildren.js';

describe('findChildren', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) {
      editor.view.dom.remove();
      editor.destroy();
    }
  });

  it('finds all paragraphs in a document', () => {
    editor = new Editor({
      extensions: [Document, Text, Paragraph, Heading],
      content: '<p>One</p><h1>Title</h1><p>Two</p>',
    });
    const results = findChildren(editor.state.doc, (node) => node.type.name === 'paragraph');
    expect(results).toHaveLength(2);
    expect(results[0]!.node.type.name).toBe('paragraph');
    expect(results[1]!.node.type.name).toBe('paragraph');
  });

  it('finds headings in a document', () => {
    editor = new Editor({
      extensions: [Document, Text, Paragraph, Heading],
      content: '<h1>Title</h1><p>Text</p><h2>Subtitle</h2>',
    });
    const results = findChildren(editor.state.doc, (node) => node.type.name === 'heading');
    expect(results).toHaveLength(2);
    expect(results[0]!.node.attrs['level']).toBe(1);
    expect(results[1]!.node.attrs['level']).toBe(2);
  });

  it('returns empty array when no children match', () => {
    editor = new Editor({
      extensions: [Document, Text, Paragraph],
      content: '<p>No headings here</p>',
    });
    const results = findChildren(editor.state.doc, (node) => node.type.name === 'heading');
    expect(results).toHaveLength(0);
  });

  it('returns positions relative to the parent node', () => {
    editor = new Editor({
      extensions: [Document, Text, Paragraph, Blockquote],
      content: '<blockquote><p>Inside</p></blockquote>',
    });
    const bq = editor.state.doc.firstChild!;
    const results = findChildren(bq, (node) => node.type.name === 'paragraph');
    expect(results).toHaveLength(1);
    expect(results[0]!.pos).toBe(0); // relative to blockquote
  });

  it('only finds direct children, not nested descendants', () => {
    editor = new Editor({
      extensions: [Document, Text, Paragraph, Blockquote],
      content: '<blockquote><p>Nested</p></blockquote><p>Top</p>',
    });
    // findChildren on doc finds blockquote and paragraph (direct children)
    const results = findChildren(editor.state.doc, (node) => node.type.name === 'paragraph');
    // Only the top-level paragraph, not the one inside blockquote
    expect(results).toHaveLength(1);
  });
});
