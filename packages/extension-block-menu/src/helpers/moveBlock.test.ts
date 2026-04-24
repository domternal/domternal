import { describe, it, expect } from 'vitest';
import {
  Document,
  Text,
  Paragraph,
  Heading,
  Editor,
} from '@domternal/core';
import { moveBlock } from './moveBlock.js';
import { findTopLevelBlock } from './findTopLevelBlock.js';

const extensions = [Document, Text, Paragraph, Heading];

function makeEditor(html: string): Editor {
  return new Editor({ extensions, content: html });
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
});
