import { describe, it, expect, afterEach } from 'vitest';
import { TextSelection } from '@domternal/pm/state';
import { Editor } from '../Editor.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Heading } from '../nodes/Heading.js';
import { Blockquote } from '../nodes/Blockquote.js';
import { BulletList } from '../nodes/BulletList.js';
import { ListItem } from '../nodes/ListItem.js';
import { findParentNode } from './findParentNode.js';

describe('findParentNode', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) {
      editor.view.dom.remove();
      editor.destroy();
    }
  });

  function setSelection(ed: Editor, from: number, to?: number): void {
    const tr = ed.state.tr.setSelection(
      TextSelection.create(ed.state.doc, from, to ?? from)
    );
    ed.view.dispatch(tr);
  }

  it('finds parent blockquote when cursor is inside', () => {
    editor = new Editor({
      extensions: [Document, Text, Paragraph, Blockquote],
      content: '<blockquote><p>Inside quote</p></blockquote>',
    });
    // Position cursor inside the paragraph within blockquote
    setSelection(editor, 3);
    const result = findParentNode((n) => n.type.name === 'blockquote')(editor.state.selection);
    expect(result).toBeDefined();
    expect(result!.node.type.name).toBe('blockquote');
  });

  it('returns undefined when no parent matches', () => {
    editor = new Editor({
      extensions: [Document, Text, Paragraph],
      content: '<p>No blockquote</p>',
    });
    setSelection(editor, 2);
    const result = findParentNode((n) => n.type.name === 'blockquote')(editor.state.selection);
    expect(result).toBeUndefined();
  });

  it('finds nearest matching parent (not ancestor)', () => {
    editor = new Editor({
      extensions: [Document, Text, Paragraph, Blockquote],
      content: '<blockquote><p>Text</p></blockquote>',
    });
    setSelection(editor, 3);
    // Looking for paragraph should find the paragraph, not skip to blockquote
    const result = findParentNode((n) => n.type.name === 'paragraph')(editor.state.selection);
    expect(result).toBeDefined();
    expect(result!.node.type.name).toBe('paragraph');
  });

  it('returns correct pos, start, and depth', () => {
    editor = new Editor({
      extensions: [Document, Text, Paragraph, Blockquote],
      content: '<blockquote><p>Text</p></blockquote>',
    });
    setSelection(editor, 3);
    const result = findParentNode((n) => n.type.name === 'blockquote')(editor.state.selection);
    expect(result).toBeDefined();
    expect(result!.depth).toBeGreaterThan(0);
    expect(result!.start).toBeGreaterThan(result!.pos);
  });

  it('finds list item parent in nested list', () => {
    editor = new Editor({
      extensions: [Document, Text, Paragraph, BulletList, ListItem],
      content: '<ul><li><p>Item 1</p></li><li><p>Item 2</p></li></ul>',
    });
    // Position cursor inside second list item
    setSelection(editor, 12);
    const result = findParentNode((n) => n.type.name === 'listItem')(editor.state.selection);
    expect(result).toBeDefined();
    expect(result!.node.type.name).toBe('listItem');
  });
});
