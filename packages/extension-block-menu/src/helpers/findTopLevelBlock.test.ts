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
import { findTopLevelBlock, findDraggableBlock, findDeepestBlockAtY } from './findTopLevelBlock.js';
import type { EditorView } from '@domternal/pm/view';

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

/**
 * Helpers for `findDeepestBlockAtY` tests. jsdom doesn't perform layout,
 * so we hand-build rects per node-position and feed them through a
 * stub `view.nodeDOM` that returns a real HTMLElement whose
 * `getBoundingClientRect` is overridden.
 */
interface RectSpec { top: number; bottom: number; left?: number; right?: number; }

function elWithRect(spec: RectSpec): HTMLElement {
  const left = spec.left ?? 0;
  const right = spec.right ?? 1000;
  const el = document.createElement('div');
  el.getBoundingClientRect = () => new DOMRect(left, spec.top, right - left, spec.bottom - spec.top);
  return el;
}

function viewStub(editor: Editor, rects: Map<number, HTMLElement>): EditorView {
  return {
    state: editor.state,
    nodeDOM: (pos: number) => rects.get(pos) ?? null,
  } as unknown as EditorView;
}

/**
 * Walks the doc and returns the absolute position of the first node
 * whose textContent matches `text`. Used by tests to anchor rects on
 * specific blocks regardless of generated PM positions.
 */
function posOf(editor: Editor, predicate: (node: { type: { name: string }; textContent: string }) => boolean): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found !== -1) return false;
    if (predicate(node)) { found = pos; return false; }
    return true;
  });
  if (found === -1) throw new Error('node not found');
  return found;
}

describe('findDeepestBlockAtY', () => {
  it('returns the listItem at the cursor row in a top-level list', () => {
    const editor = makeEditor('<ul><li><p>Apple</p></li><li><p>Banana</p></li></ul>');
    const ulPos = posOf(editor, (n) => n.type.name === 'bulletList');
    const liApple = posOf(editor, (n) => n.type.name === 'listItem' && n.textContent === 'Apple');
    const liBanana = posOf(editor, (n) => n.type.name === 'listItem' && n.textContent === 'Banana');

    const rects = new Map<number, HTMLElement>([
      [ulPos, elWithRect({ top: 100, bottom: 200 })],
      [liApple, elWithRect({ top: 100, bottom: 150 })],
      [liBanana, elWithRect({ top: 150, bottom: 200 })],
    ]);

    const result = findDeepestBlockAtY(viewStub(editor, rects), 125, ['listItem']);
    expect(result?.node.type.name).toBe('listItem');
    expect(result?.node.textContent).toBe('Apple');
    editor.destroy();
  });

  it('returns the INNER list item when hovering its row in a nested list', () => {
    // Notion-parity: gutter X resolves to outer in posAtCoords, but the
    // spatial walk picks the deepest (innermost) match at this Y row.
    const editor = makeEditor(
      '<ul><li><p>Outer</p><ul><li><p>Inner</p></li></ul></li></ul>',
    );
    const outerPos = posOf(editor, (n) => n.type.name === 'listItem' && n.textContent.startsWith('Outer'));
    const innerPos = posOf(editor, (n) => n.type.name === 'listItem' && n.textContent === 'Inner');

    // Outer rect spans the whole structure (height 200); inner spans the
    // bottom half (height 50). Cursor Y=170 is inside both.
    const rects = new Map<number, HTMLElement>([
      [outerPos, elWithRect({ top: 100, bottom: 300 })],
      [innerPos, elWithRect({ top: 150, bottom: 200 })],
    ]);

    const result = findDeepestBlockAtY(viewStub(editor, rects), 170, ['listItem']);
    expect(result?.node.textContent).toBe('Inner');
    expect(result?.pos).toBe(innerPos);
    editor.destroy();
  });

  it('returns the OUTER taskItem when cursor is in its paragraph row above the nested list', () => {
    const editor = makeEditor(
      '<ul data-type="taskList">' +
        '<li data-type="taskItem"><p>Outer paragraph text</p>' +
          '<ul data-type="taskList">' +
            '<li data-type="taskItem"><p>Inner sub</p></li>' +
          '</ul>' +
        '</li>' +
      '</ul>',
    );
    const outerPos = posOf(editor, (n) => n.type.name === 'taskItem' && n.textContent.startsWith('Outer'));
    const innerPos = posOf(editor, (n) => n.type.name === 'taskItem' && n.textContent === 'Inner sub');

    // Outer Y range 100-300; Inner only 200-260. Cursor Y=130 is above
    // the inner item — only outer contains it, so outer wins.
    const rects = new Map<number, HTMLElement>([
      [outerPos, elWithRect({ top: 100, bottom: 300 })],
      [innerPos, elWithRect({ top: 200, bottom: 260 })],
    ]);

    const result = findDeepestBlockAtY(viewStub(editor, rects), 130, ['taskItem']);
    // `taskItem.textContent` includes nested children's text, so anchor
    // the assertion on the resolved position instead of substring match.
    expect(result?.pos).toBe(outerPos);
    expect(result?.node.type.name).toBe('taskItem');
    editor.destroy();
  });

  it('returns null when no allowed type contains the cursor Y', () => {
    const editor = makeEditor('<p>Standalone paragraph</p>');
    const pPos = posOf(editor, (n) => n.type.name === 'paragraph');
    const rects = new Map<number, HTMLElement>([
      [pPos, elWithRect({ top: 100, bottom: 150 })],
    ]);
    // Paragraph contains Y=120, but allowedTypes excludes paragraph.
    const result = findDeepestBlockAtY(viewStub(editor, rects), 120, ['listItem', 'taskItem']);
    expect(result).toBeNull();
    editor.destroy();
  });

  it('returns null when cursor is above all blocks', () => {
    const editor = makeEditor('<ul><li><p>Item</p></li></ul>');
    const ulPos = posOf(editor, (n) => n.type.name === 'bulletList');
    const liPos = posOf(editor, (n) => n.type.name === 'listItem');
    const rects = new Map<number, HTMLElement>([
      [ulPos, elWithRect({ top: 100, bottom: 200 })],
      [liPos, elWithRect({ top: 100, bottom: 200 })],
    ]);
    const result = findDeepestBlockAtY(viewStub(editor, rects), 50, ['listItem']);
    expect(result).toBeNull();
    editor.destroy();
  });

  it('returns null for empty allowedTypes', () => {
    const editor = makeEditor('<ul><li><p>Item</p></li></ul>');
    const liPos = posOf(editor, (n) => n.type.name === 'listItem');
    const rects = new Map<number, HTMLElement>([
      [liPos, elWithRect({ top: 100, bottom: 200 })],
    ]);
    const result = findDeepestBlockAtY(viewStub(editor, rects), 150, []);
    expect(result).toBeNull();
    editor.destroy();
  });

  it('handles three-level deep nesting and returns the deepest match', () => {
    const editor = makeEditor(
      '<ul><li><p>L1</p>' +
        '<ul><li><p>L2</p>' +
          '<ul><li><p>L3</p></li></ul>' +
        '</li></ul>' +
      '</li></ul>',
    );
    const l1 = posOf(editor, (n) => n.type.name === 'listItem' && n.textContent.startsWith('L1'));
    const l2 = posOf(editor, (n) => n.type.name === 'listItem' && n.textContent.startsWith('L2'));
    const l3 = posOf(editor, (n) => n.type.name === 'listItem' && n.textContent === 'L3');

    const rects = new Map<number, HTMLElement>([
      [l1, elWithRect({ top: 100, bottom: 400 })],
      [l2, elWithRect({ top: 150, bottom: 350 })],
      [l3, elWithRect({ top: 200, bottom: 250 })],
    ]);

    // Y=220 is inside all three; deepest (smallest height) wins.
    const result = findDeepestBlockAtY(viewStub(editor, rects), 220, ['listItem']);
    expect(result?.node.textContent).toBe('L3');
    expect(result?.pos).toBe(l3);
    editor.destroy();
  });

  it('returns null when nodeDOM returns null for every block', () => {
    const editor = makeEditor('<ul><li><p>Item</p></li></ul>');
    const result = findDeepestBlockAtY(viewStub(editor, new Map()), 150, ['listItem']);
    expect(result).toBeNull();
    editor.destroy();
  });

  it('skips a subtree whose container does not vertically contain the cursor', () => {
    // Outer list at Y 100-200; nested list at Y 100-150 (above cursor).
    // Cursor at Y=180 must NOT match the inner item (which is inside the
    // pruned subtree) — even if its synthetic rect happened to contain Y.
    const editor = makeEditor(
      '<ul><li><p>Outer</p><ul><li><p>Inner</p></li></ul></li></ul>',
    );
    const outerLi = posOf(editor, (n) => n.type.name === 'listItem' && n.textContent.startsWith('Outer'));
    const outerUl = posOf(editor, (n) => n.type.name === 'bulletList' && n.textContent.startsWith('Outer'));
    const innerUl = posOf(editor, (n) => n.type.name === 'bulletList' && n.textContent === 'Inner');
    const innerLi = posOf(editor, (n) => n.type.name === 'listItem' && n.textContent === 'Inner');

    // Cursor Y=180 inside outer (100-200) but NOT inside the inner ul
    // (100-150). Pruning at innerUl prevents innerLi from matching.
    const rects = new Map<number, HTMLElement>([
      [outerUl, elWithRect({ top: 100, bottom: 200 })],
      [outerLi, elWithRect({ top: 100, bottom: 200 })],
      [innerUl, elWithRect({ top: 100, bottom: 150 })],
      [innerLi, elWithRect({ top: 100, bottom: 150 })],
    ]);

    const result = findDeepestBlockAtY(viewStub(editor, rects), 180, ['listItem']);
    expect(result?.pos).toBe(outerLi);
    expect(result?.node.type.name).toBe('listItem');
    editor.destroy();
  });
});
