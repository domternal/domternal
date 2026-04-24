import { describe, it, expect } from 'vitest';
import {
  Document,
  Text,
  Paragraph,
  Heading,
  Blockquote,
  BulletList,
  Editor,
} from '@domternal/core';
import { findTopLevelBlock } from './findTopLevelBlock.js';

const extensions = [Document, Text, Paragraph, Heading, Blockquote, BulletList];

function makeEditor(html: string): Editor {
  return new Editor({ extensions, content: html });
}

describe('findTopLevelBlock', () => {
  it('returns the paragraph block for a position inside a paragraph', () => {
    const editor = makeEditor('<p>Hello world</p>');
    const pos = 3; // inside "Hello"
    const result = findTopLevelBlock(editor.state.doc, pos);
    expect(result).not.toBeNull();
    expect(result?.node.type.name).toBe('paragraph');
    expect(result?.pos).toBe(0);
    expect(result?.index).toBe(0);
    editor.destroy();
  });

  it('returns heading block when cursor is inside a heading', () => {
    const editor = makeEditor('<p>First</p><h2>Title</h2>');
    // Paragraph spans 0..7, heading 7..14
    const pos = 10; // inside heading text
    const result = findTopLevelBlock(editor.state.doc, pos);
    expect(result?.node.type.name).toBe('heading');
    expect(result?.index).toBe(1);
    editor.destroy();
  });

  it('walks up from nested list item to the top-level list', () => {
    const editor = makeEditor('<ul><li><p>Item</p></li></ul>');
    // Deep inside the list item
    const pos = 4;
    const result = findTopLevelBlock(editor.state.doc, pos);
    expect(result?.node.type.name).toBe('bulletList');
    expect(result?.index).toBe(0);
    editor.destroy();
  });

  it('walks up from a blockquote child to the blockquote itself', () => {
    const editor = makeEditor('<blockquote><p>Quote</p></blockquote>');
    const pos = 3;
    const result = findTopLevelBlock(editor.state.doc, pos);
    expect(result?.node.type.name).toBe('blockquote');
    expect(result?.index).toBe(0);
    editor.destroy();
  });

  it('returns null for position 0 (document root, depth 0)', () => {
    const editor = makeEditor('<p>Hi</p>');
    const result = findTopLevelBlock(editor.state.doc, 0);
    // Pos 0 resolves with depth === 0 (doc level) → helper bails.
    expect(result).toBeNull();
    editor.destroy();
  });

  it('returns null for out-of-bounds negative position', () => {
    const editor = makeEditor('<p>Hi</p>');
    const result = findTopLevelBlock(editor.state.doc, -5);
    expect(result).toBeNull();
    editor.destroy();
  });

  it('returns null for position beyond document size', () => {
    const editor = makeEditor('<p>Hi</p>');
    const result = findTopLevelBlock(editor.state.doc, 999);
    expect(result).toBeNull();
    editor.destroy();
  });

  it('provides `end` = pos + nodeSize for the resolved block', () => {
    const editor = makeEditor('<p>Hi</p><p>There</p>');
    const result = findTopLevelBlock(editor.state.doc, 5);
    expect(result).not.toBeNull();
    expect(result?.end).toBe((result?.pos ?? 0) + (result?.node.nodeSize ?? 0));
    editor.destroy();
  });

  it('computes `index` correctly for the Nth doc child', () => {
    const editor = makeEditor('<p>a</p><p>b</p><p>c</p>');
    // <p>a</p> spans 0..3, <p>b</p> spans 3..6, <p>c</p> spans 6..9
    const posInThirdParagraph = 7;
    const result = findTopLevelBlock(editor.state.doc, posInThirdParagraph);
    expect(result?.node.textContent).toBe('c');
    expect(result?.index).toBe(2);
    editor.destroy();
  });
});
