import { describe, it, expect } from 'vitest';
import {
  Document,
  Text,
  Paragraph,
  Heading,
  BulletList,
  OrderedList,
  ListItem,
  Editor,
} from '@domternal/core';
import { moveBlock } from './moveBlock.js';
import { findTopLevelBlock } from './findTopLevelBlock.js';

const extensions = [Document, Text, Paragraph, Heading];
const listExtensions = [Document, Text, Paragraph, Heading, BulletList, OrderedList, ListItem];

function makeEditor(html: string): Editor {
  return new Editor({ extensions, content: html });
}

function makeListEditor(html: string): Editor {
  return new Editor({ extensions: listExtensions, content: html });
}

/** Resolves the absolute pos of the first node matching the predicate. */
function findPos(
  editor: Editor,
  predicate: (node: { type: { name: string }; textContent: string }) => boolean,
): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found !== -1) return false;
    if (predicate(node)) { found = pos; return false; }
    return true;
  });
  if (found === -1) throw new Error('node not found');
  return found;
}

describe('moveBlock', () => {
  it('moves a block upward by swapping with the previous sibling', () => {
    const editor = makeEditor('<p>A</p><p>B</p><p>C</p>');
    const second = findTopLevelBlock(editor.state.doc, 5); // inside <p>B</p>
    expect(second?.node.textContent).toBe('B');
    const firstStart = 0;
    const tr = editor.state.tr;
    moveBlock(tr, second?.pos ?? 0, firstStart);
    editor.view.dispatch(tr);
    // Expect order: B, A, C
    const textBlocks: string[] = [];
    editor.state.doc.forEach((node) => { textBlocks.push(node.textContent); });
    expect(textBlocks).toEqual(['B', 'A', 'C']);
    editor.destroy();
  });

  it('moves a block downward with correct position adjustment', () => {
    const editor = makeEditor('<p>A</p><p>B</p><p>C</p>');
    const first = findTopLevelBlock(editor.state.doc, 1); // <p>A</p>
    // Target: end of doc (after last paragraph)
    const target = editor.state.doc.content.size;
    const tr = editor.state.tr;
    moveBlock(tr, first?.pos ?? 0, target);
    editor.view.dispatch(tr);
    // Expect order: B, C, A
    const textBlocks: string[] = [];
    editor.state.doc.forEach((node) => { textBlocks.push(node.textContent); });
    expect(textBlocks).toEqual(['B', 'C', 'A']);
    editor.destroy();
  });

  it('is a no-op when source and target positions are identical', () => {
    const editor = makeEditor('<p>A</p><p>B</p>');
    const first = findTopLevelBlock(editor.state.doc, 1);
    const originalDoc = editor.state.doc.toString();
    const tr = editor.state.tr;
    moveBlock(tr, first?.pos ?? 0, first?.pos ?? 0);
    // No steps → unchanged doc
    expect(tr.steps.length).toBe(0);
    expect(tr.doc.toString()).toBe(originalDoc);
    editor.destroy();
  });

  it('rejects self-drop (target inside source range)', () => {
    const editor = makeEditor('<p>First paragraph here</p>');
    const first = findTopLevelBlock(editor.state.doc, 1);
    const tr = editor.state.tr;
    // Target inside the source paragraph
    const targetInsideSource = (first?.pos ?? 0) + 5;
    moveBlock(tr, first?.pos ?? 0, targetInsideSource);
    expect(tr.steps.length).toBe(0);
    editor.destroy();
  });

  it('returns the same transaction (chainable)', () => {
    const editor = makeEditor('<p>A</p><p>B</p>');
    const first = findTopLevelBlock(editor.state.doc, 1);
    const tr = editor.state.tr;
    const result = moveBlock(tr, first?.pos ?? 0, editor.state.doc.content.size);
    expect(result).toBe(tr);
    editor.destroy();
  });

  it('preserves the source node type and attributes across move', () => {
    const editor = makeEditor('<p>p1</p><h2>Title</h2><p>p2</p>');
    const heading = findTopLevelBlock(editor.state.doc, 7);
    expect(heading?.node.type.name).toBe('heading');
    const tr = editor.state.tr;
    // Move heading to position 0 (above first paragraph)
    moveBlock(tr, heading?.pos ?? 0, 0);
    editor.view.dispatch(tr);
    const firstChild = editor.state.doc.firstChild;
    expect(firstChild?.type.name).toBe('heading');
    expect(firstChild?.textContent).toBe('Title');
    expect(firstChild?.attrs['level']).toBe(2);
    editor.destroy();
  });

  it('is a no-op when source position has no node', () => {
    const editor = makeEditor('<p>A</p>');
    const tr = editor.state.tr;
    moveBlock(tr, 999, 0);
    expect(tr.steps.length).toBe(0);
    editor.destroy();
  });

  // ── Empty-wrapper expansion (nested list with single child) ──

  it('removes the parent UL when moving its ONLY listItem out (no empty placeholder left behind)', () => {
    // Outer LI contains paragraph + nested UL with a single LI. Moving
    // that lone inner LI to a top-level position must NOT leave an empty
    // <li> behind (which is what `tr.delete` alone produces because PM's
    // schema fitter retains it to satisfy `listItem+`).
    const editor = makeListEditor(
      '<ul><li><p>Outer</p>'
      + '<ul><li><p>Inner solo</p></li></ul>'
      + '</li></ul>'
      + '<p>After</p>',
    );
    const innerPos = findPos(editor, (n) => n.type.name === 'listItem' && n.textContent === 'Inner solo');
    const target = editor.state.doc.content.size; // after the trailing <p>
    const tr = editor.state.tr;
    moveBlock(tr, innerPos, target);
    editor.view.dispatch(tr);

    // The outer LI now has only the paragraph "Outer" - the nested UL
    // is gone (no empty <li> ghost).
    const outerLi = findPos(editor, (n) => n.type.name === 'listItem' && n.textContent === 'Outer');
    const outerLiNode = editor.state.doc.nodeAt(outerLi);
    expect(outerLiNode?.childCount).toBe(1);
    expect(outerLiNode?.firstChild?.type.name).toBe('paragraph');
    expect(outerLiNode?.firstChild?.textContent).toBe('Outer');

    // The moved item lives wherever PM's schema fitter chose to place it
    // (a sliced LI inserted at top level may get rewrapped). Either way,
    // the doc still contains the text "Inner solo".
    expect(editor.state.doc.textContent).toContain('Inner solo');
    editor.destroy();
  });

  it('walks up multiple single-child wrappers in one go', () => {
    // Two stacked wrappers: top UL > LI > nested UL > LI(source). The
    // outer li uses an empty paragraph as the (Notion-strict) label so
    // the parser preserves nesting; the helper's single-meaningful-
    // child branch then walks through that filler when moving the
    // source out, leaving no empty LI placeholders behind.
    const editor = makeListEditor(
      '<ul><li><p></p>'
      + '<ul><li><p>Solo deeply nested</p></li></ul>'
      + '</li></ul>'
      + '<p>After</p>',
    );
    const source = findPos(editor, (n) => n.type.name === 'listItem' && n.textContent === 'Solo deeply nested');
    const tr = editor.state.tr;
    moveBlock(tr, source, editor.state.doc.content.size);
    editor.view.dispatch(tr);

    // No listItem in the surviving doc has empty-or-placeholder content
    // (the `tr.delete`-only behaviour would leave back-to-back wrapper
    // LIs whose paragraphs are blank).
    let emptyLiCount = 0;
    editor.state.doc.descendants((n) => {
      if (n.type.name === 'listItem' && n.textContent === '') emptyLiCount++;
      return true;
    });
    expect(emptyLiCount).toBe(0);

    // Source's text preserved.
    expect(editor.state.doc.textContent).toContain('Solo deeply nested');
    editor.destroy();
  });

  it('does NOT expand when the source has siblings (sibling stays as-is)', () => {
    // Two inner LIs: dragging one must NOT remove the parent UL (the
    // other sibling still needs it).
    const editor = makeListEditor(
      '<ul><li><p>Outer</p>'
      + '<ul><li><p>First inner</p></li><li><p>Second inner</p></li></ul>'
      + '</li></ul>'
      + '<p>After</p>',
    );
    const firstInner = findPos(editor, (n) => n.type.name === 'listItem' && n.textContent === 'First inner');
    const tr = editor.state.tr;
    moveBlock(tr, firstInner, editor.state.doc.content.size);
    editor.view.dispatch(tr);

    // Outer LI still has paragraph + nested UL containing "Second inner".
    const outer = findPos(editor, (n) => n.type.name === 'listItem' && n.textContent.startsWith('Outer'));
    const outerNode = editor.state.doc.nodeAt(outer);
    expect(outerNode?.childCount).toBe(2);
    expect(outerNode?.lastChild?.type.name).toBe('bulletList');
    expect(outerNode?.lastChild?.childCount).toBe(1);
    expect(outerNode?.lastChild?.firstChild?.textContent).toBe('Second inner');
    editor.destroy();
  });

  // ── Non-list block dropped into a list: split, keep type (Notion) ──

  /** Top-level child node type names, in document order. */
  function topTypes(editor: Editor): string[] {
    const types: string[] = [];
    editor.state.doc.forEach((n) => { types.push(n.type.name); });
    return types;
  }

  it('paragraph dropped between two bullets splits the list and stays a paragraph', () => {
    const editor = makeListEditor(
      '<ul><li><p>A</p></li><li><p>B</p></li><li><p>C</p></li></ul><p>DRAG</p>',
    );
    const drag = findPos(editor, (n) => n.type.name === 'paragraph' && n.textContent === 'DRAG');
    const beforeB = findPos(editor, (n) => n.type.name === 'listItem' && n.textContent === 'B');
    const tr = editor.state.tr;
    moveBlock(tr, drag, beforeB);
    editor.view.dispatch(tr);

    expect(topTypes(editor)).toEqual(['bulletList', 'paragraph', 'bulletList']);
    expect(editor.state.doc.child(0).childCount).toBe(1); // [A]
    expect(editor.state.doc.child(0).textContent).toBe('A');
    expect(editor.state.doc.child(1).textContent).toBe('DRAG');
    expect(editor.state.doc.child(2).childCount).toBe(2); // [B, C]
    expect(editor.state.doc.child(2).textContent).toBe('BC');
    editor.destroy();
  });

  it('heading dropped between two bullets splits the list and keeps its level', () => {
    const editor = makeListEditor(
      '<ul><li><p>A</p></li><li><p>B</p></li></ul><h2>Title</h2>',
    );
    const heading = findPos(editor, (n) => n.type.name === 'heading');
    const beforeB = findPos(editor, (n) => n.type.name === 'listItem' && n.textContent === 'B');
    const tr = editor.state.tr;
    moveBlock(tr, heading, beforeB);
    editor.view.dispatch(tr);

    expect(topTypes(editor)).toEqual(['bulletList', 'heading', 'bulletList']);
    expect(editor.state.doc.child(1).type.name).toBe('heading');
    expect(editor.state.doc.child(1).attrs['level']).toBe(2);
    expect(editor.state.doc.child(1).textContent).toBe('Title');
    editor.destroy();
  });

  it('block dropped before the first item lands above the whole list (no empty leading list)', () => {
    const editor = makeListEditor(
      '<ul><li><p>A</p></li><li><p>B</p></li></ul><p>DRAG</p>',
    );
    const drag = findPos(editor, (n) => n.type.name === 'paragraph' && n.textContent === 'DRAG');
    const beforeA = findPos(editor, (n) => n.type.name === 'listItem' && n.textContent === 'A');
    const tr = editor.state.tr;
    moveBlock(tr, drag, beforeA);
    editor.view.dispatch(tr);

    expect(topTypes(editor)).toEqual(['paragraph', 'bulletList']);
    expect(editor.state.doc.child(0).textContent).toBe('DRAG');
    expect(editor.state.doc.child(1).childCount).toBe(2); // [A, B] intact
    editor.destroy();
  });

  it('block dropped after the last item lands below the whole list (no empty trailing list)', () => {
    const editor = makeListEditor(
      '<p>DRAG</p><ul><li><p>A</p></li><li><p>B</p></li></ul>',
    );
    const drag = findPos(editor, (n) => n.type.name === 'paragraph' && n.textContent === 'DRAG');
    const liB = findPos(editor, (n) => n.type.name === 'listItem' && n.textContent === 'B');
    const afterB = liB + (editor.state.doc.nodeAt(liB)?.nodeSize ?? 0);
    const tr = editor.state.tr;
    moveBlock(tr, drag, afterB);
    editor.view.dispatch(tr);

    expect(topTypes(editor)).toEqual(['bulletList', 'paragraph']);
    expect(editor.state.doc.child(0).childCount).toBe(2); // [A, B] intact
    expect(editor.state.doc.child(1).textContent).toBe('DRAG');
    editor.destroy();
  });

  it('paragraph dropped between two NESTED bullets becomes a child of the parent item, splitting the sublist', () => {
    const editor = makeListEditor(
      '<ul><li><p>Parent</p>'
      + '<ul><li><p>X</p></li><li><p>Y</p></li></ul>'
      + '</li></ul><p>DRAG</p>',
    );
    const drag = findPos(editor, (n) => n.type.name === 'paragraph' && n.textContent === 'DRAG');
    const beforeY = findPos(editor, (n) => n.type.name === 'listItem' && n.textContent === 'Y');
    const tr = editor.state.tr;
    moveBlock(tr, drag, beforeY);
    editor.view.dispatch(tr);

    // Single top-level list; the parent item now holds the split sublist with
    // the paragraph wedged between the two halves.
    expect(topTypes(editor)).toEqual(['bulletList']);
    const parentPos = findPos(editor, (n) => n.type.name === 'listItem' && n.textContent.startsWith('Parent'));
    const parent = editor.state.doc.nodeAt(parentPos);
    expect(parent?.childCount).toBe(4);
    expect(Array.from({ length: parent?.childCount ?? 0 }, (_, i) => parent?.child(i).type.name))
      .toEqual(['paragraph', 'bulletList', 'paragraph', 'bulletList']);
    expect(parent?.child(2).textContent).toBe('DRAG');
    expect(parent?.child(1).textContent).toBe('X');
    expect(parent?.child(3).textContent).toBe('Y');
    editor.destroy();
  });

  it('splitting an ordered list keeps the numbering continuous (start bumped on the trailing half)', () => {
    const editor = makeListEditor(
      '<ol><li><p>A</p></li><li><p>B</p></li><li><p>C</p></li></ol><p>DRAG</p>',
    );
    const drag = findPos(editor, (n) => n.type.name === 'paragraph' && n.textContent === 'DRAG');
    const beforeB = findPos(editor, (n) => n.type.name === 'listItem' && n.textContent === 'B');
    const tr = editor.state.tr;
    moveBlock(tr, drag, beforeB);
    editor.view.dispatch(tr);

    expect(topTypes(editor)).toEqual(['orderedList', 'paragraph', 'orderedList']);
    // First half keeps the default start (1); the trailing [B, C] continues at 2.
    expect(editor.state.doc.child(0).attrs['start']).toBe(1);
    expect(editor.state.doc.child(2).attrs['start']).toBe(2);
    editor.destroy();
  });

  it('a list-item source still JOINS the target list (no split, stays a listItem)', () => {
    const editor = makeListEditor(
      '<ul><li><p>A</p></li><li><p>B</p></li></ul><ul><li><p>C</p></li></ul>',
    );
    const liC = findPos(editor, (n) => n.type.name === 'listItem' && n.textContent === 'C');
    const beforeB = findPos(editor, (n) => n.type.name === 'listItem' && n.textContent === 'B');
    const tr = editor.state.tr;
    moveBlock(tr, liC, beforeB);
    editor.view.dispatch(tr);

    // C migrates into the first list between A and B; no list split.
    expect(topTypes(editor)).toEqual(['bulletList']);
    const list = editor.state.doc.child(0);
    expect(list.childCount).toBe(3);
    expect(Array.from({ length: list.childCount }, (_, i) => list.child(i).textContent)).toEqual(['A', 'C', 'B']);
    editor.destroy();
  });

  it('rejects self-drop when target falls inside the EXPANDED wrapper range', () => {
    // Source = inner solo LI; expanded range covers its parent UL.
    // Target inside the parent UL (e.g. between the LI and the closing
    // </ul>) must still be rejected as self-drop.
    const editor = makeListEditor(
      '<ul><li><p>Outer</p>'
      + '<ul><li><p>Inner solo</p></li></ul>'
      + '</li></ul>',
    );
    const innerPos = findPos(editor, (n) => n.type.name === 'listItem' && n.textContent === 'Inner solo');
    const innerNode = editor.state.doc.nodeAt(innerPos);
    if (!innerNode) throw new Error('inner not found');
    // Target right after the inner LI (still inside the parent UL).
    const target = innerPos + innerNode.nodeSize;
    const tr = editor.state.tr;
    moveBlock(tr, innerPos, target);
    expect(tr.steps.length).toBe(0);
    editor.destroy();
  });
});
