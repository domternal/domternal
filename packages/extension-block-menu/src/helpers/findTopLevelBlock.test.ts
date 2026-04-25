import { describe, it, expect } from 'vitest';
import {
  Document,
  Text,
  Paragraph,
  Heading,
  Blockquote,
  BulletList,
  OrderedList,
  ListItem,
  TaskList,
  TaskItem,
  Editor,
} from '@domternal/core';
import { findTopLevelBlock, findDraggableBlock } from './findTopLevelBlock.js';

const extensions = [Document, Text, Paragraph, Heading, Blockquote, BulletList, OrderedList, ListItem, TaskList, TaskItem];

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

  it('returns the first block when given position 0 (top-level boundary)', () => {
    const editor = makeEditor('<p>Hi</p>');
    const result = findTopLevelBlock(editor.state.doc, 0);
    // Pos 0 is a top-level boundary (doc start = first child start).
    expect(result?.node.type.name).toBe('paragraph');
    expect(result?.pos).toBe(0);
    expect(result?.index).toBe(0);
    editor.destroy();
  });

  it('returns the Nth block for a top-level boundary between blocks', () => {
    const editor = makeEditor('<p>A</p><p>B</p><p>C</p>');
    // Each <p>x</p> is 3 chars → boundaries at 0, 3, 6, 9
    const result = findTopLevelBlock(editor.state.doc, 3);
    expect(result?.node.textContent).toBe('B');
    expect(result?.index).toBe(1);
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

describe('findDraggableBlock', () => {
  it('returns the list item when `listItem` is in draggable types', () => {
    const editor = makeEditor('<ul><li><p>Item A</p></li><li><p>Item B</p></li></ul>');
    // Cursor inside the first list-item paragraph.
    const pos = 4;
    const result = findDraggableBlock(editor.state.doc, pos, ['listItem', 'taskItem']);
    expect(result?.node.type.name).toBe('listItem');
    // First list item, index 0 among its siblings inside the bulletList.
    expect(result?.index).toBe(0);
    editor.destroy();
  });

  it('returns the task item when `taskItem` is in draggable types', () => {
    const editor = makeEditor('<ul data-type="taskList"><li data-type="taskItem"><p>Todo</p></li></ul>');
    const pos = 4;
    const result = findDraggableBlock(editor.state.doc, pos, ['listItem', 'taskItem']);
    expect(result?.node.type.name).toBe('taskItem');
    editor.destroy();
  });

  it('falls back to the top-level block when no ancestor matches', () => {
    const editor = makeEditor('<ul><li><p>Item</p></li></ul>');
    // `heading` is in the allowed list but this doc has none.
    const pos = 4;
    const result = findDraggableBlock(editor.state.doc, pos, ['heading']);
    expect(result?.node.type.name).toBe('bulletList');
    editor.destroy();
  });

  it('prefers the deepest match when nested lists have two list items', () => {
    const editor = makeEditor(
      '<ul><li><p>Outer</p><ul><li><p>Inner</p></li></ul></li></ul>',
    );
    // Inside the inner list item's paragraph. Depth is: doc > ul(1) >
    // li(2) > ul(3) > li(4) > p(5). Deepest listItem is depth 4.
    const pos = 12;
    const result = findDraggableBlock(editor.state.doc, pos, ['listItem']);
    expect(result?.node.type.name).toBe('listItem');
    expect(result?.node.textContent).toContain('Inner');
    editor.destroy();
  });

  it('returns the paragraph itself when it is explicitly in allowed types', () => {
    const editor = makeEditor('<p>Hi</p>');
    const result = findDraggableBlock(editor.state.doc, 1, ['paragraph']);
    expect(result?.node.type.name).toBe('paragraph');
    editor.destroy();
  });

  it('returns null for out-of-bounds positions', () => {
    const editor = makeEditor('<p>Hi</p>');
    expect(findDraggableBlock(editor.state.doc, -5, ['paragraph'])).toBeNull();
    expect(findDraggableBlock(editor.state.doc, 999, ['paragraph'])).toBeNull();
    editor.destroy();
  });

  it('empty allowedTypes falls back to findTopLevelBlock behaviour', () => {
    const editor = makeEditor('<ul><li><p>Item</p></li></ul>');
    const result = findDraggableBlock(editor.state.doc, 4, []);
    expect(result?.node.type.name).toBe('bulletList');
    editor.destroy();
  });
});
