import { describe, it, expect } from 'vitest';
import {
  Document, Text, Paragraph, BulletList, OrderedList, ListItem, TaskList, TaskItem, Editor,
} from '@domternal/core';
import type { EditorView } from '@domternal/pm/view';
import { resolveDropDepth } from './resolveDropDepth.js';

const extensions = [Document, Text, Paragraph, BulletList, OrderedList, ListItem, TaskList, TaskItem];

function makeEditor(html: string): Editor {
  return new Editor({ extensions, content: html });
}

interface RectSpec { top?: number; bottom?: number; left: number; right?: number }

function elWithRect(spec: RectSpec): HTMLElement {
  const el = document.createElement('div');
  const top = spec.top ?? 0;
  const bottom = spec.bottom ?? 20;
  const right = spec.right ?? spec.left + 500;
  el.getBoundingClientRect = () => new DOMRect(spec.left, top, right - spec.left, bottom - top);
  return el;
}

function viewStub(editor: Editor, rects: Map<number, HTMLElement>): EditorView {
  return {
    state: editor.state,
    nodeDOM: (pos: number) => rects.get(pos) ?? null,
  } as unknown as EditorView;
}

function posOf(editor: Editor, predicate: (n: { type: { name: string }; textContent: string }) => boolean): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found !== -1) return false;
    if (predicate(node)) { found = pos; return false; }
    return true;
  });
  if (found === -1) throw new Error('node not found');
  return found;
}

/**
 * Three-level nesting: Groceries (L1) > Fruit (L2) > Apples (L3). Ancestor
 * lefts at 10 / 30 / 50; indentStep 24 => child boundary at Apples.left+24=74.
 */
function fixture(): {
  editor: Editor; view: EditorView; groceries: number; fruit: number; apples: number;
} {
  const editor = makeEditor(
    '<ul><li><p>Groceries</p><ul><li><p>Fruit</p><ul><li><p>Apples</p></li></ul></li></ul></li></ul>',
  );
  const groceries = posOf(editor, (n) => n.type.name === 'listItem' && n.textContent.startsWith('Groceries'));
  const fruit = posOf(editor, (n) => n.type.name === 'listItem' && n.textContent.startsWith('Fruit'));
  const apples = posOf(editor, (n) => n.type.name === 'listItem' && n.textContent === 'Apples');
  const rects = new Map<number, HTMLElement>([
    [groceries, elWithRect({ left: 10 })],
    [fruit, elWithRect({ left: 30 })],
    [apples, elWithRect({ left: 50 })],
  ]);
  return { editor, view: viewStub(editor, rects), groceries, fruit, apples };
}

function afterOf(editor: Editor, itemPos: number): number {
  const node = editor.state.doc.nodeAt(itemPos);
  if (!node) throw new Error('no node');
  return itemPos + node.nodeSize;
}

describe('resolveDropDepth', () => {
  it('X past the resolved item indent nests as a CHILD (level L+1)', () => {
    const { editor, view, apples } = fixture();
    const r = resolveDropDepth({ view, itemPos: apples, clientX: 80, indentStep: 24 });
    expect(r?.kind).toBe('child');
    expect(r?.level).toBe(4); // Apples is L3 -> child L4
    expect(r?.itemPos).toBe(apples);
    editor.destroy();
  });

  it('X at the resolved item indent is a SIBLING at the deepest level', () => {
    const { editor, view, apples } = fixture();
    const r = resolveDropDepth({ view, itemPos: apples, clientX: 60, indentStep: 24 }); // [50,74)
    expect(r?.kind).toBe('sibling');
    expect(r?.level).toBe(3);
    expect(r?.itemPos).toBe(apples);
    expect(r?.afterPos).toBe(afterOf(editor, apples));
    editor.destroy();
  });

  it('moving X left outdents one level (sibling after the middle ancestor)', () => {
    const { editor, view, apples, fruit } = fixture();
    const r = resolveDropDepth({ view, itemPos: apples, clientX: 40, indentStep: 24 }); // [30,50)
    expect(r?.kind).toBe('sibling');
    expect(r?.level).toBe(2);
    expect(r?.itemPos).toBe(fruit);
    expect(r?.afterPos).toBe(afterOf(editor, fruit));
    editor.destroy();
  });

  it('moving X further left reaches the top-level list (level 1)', () => {
    const { editor, view, apples, groceries } = fixture();
    const r = resolveDropDepth({ view, itemPos: apples, clientX: 20, indentStep: 24 }); // [10,30)
    expect(r?.kind).toBe('sibling');
    expect(r?.level).toBe(1);
    expect(r?.itemPos).toBe(groceries);
    expect(r?.afterPos).toBe(afterOf(editor, groceries));
    editor.destroy();
  });

  it('X left of the top-level indent floors at level 1', () => {
    const { editor, view, apples, groceries } = fixture();
    const r = resolveDropDepth({ view, itemPos: apples, clientX: 2, indentStep: 24 });
    expect(r?.level).toBe(1);
    expect(r?.itemPos).toBe(groceries);
    editor.destroy();
  });

  it('a top-level item only offers sibling (L1) and child (L2)', () => {
    const editor = makeEditor('<ul><li><p>Solo</p></li></ul>');
    const solo = posOf(editor, (n) => n.type.name === 'listItem');
    const rects = new Map<number, HTMLElement>([[solo, elWithRect({ left: 10 })]]);
    const view = viewStub(editor, rects);
    expect(resolveDropDepth({ view, itemPos: solo, clientX: 12, indentStep: 24 })?.level).toBe(1); // sibling
    expect(resolveDropDepth({ view, itemPos: solo, clientX: 40, indentStep: 24 })?.kind).toBe('child'); // L2
    editor.destroy();
  });

  it('level dead-band keeps the incumbent within band px of a boundary, flips past it', () => {
    const { editor, view, apples } = fixture();
    // Boundary into child = childBoundary = 74. X=71 is 3px below it.
    const stateless = resolveDropDepth({ view, itemPos: apples, clientX: 71, indentStep: 24 });
    expect(stateless?.level).toBe(3); // sibling, not child
    const sticky = resolveDropDepth({ view, itemPos: apples, clientX: 71, indentStep: 24, incumbentLevel: 4, band: 6 });
    expect(sticky?.level).toBe(4); // incumbent child held within band
    const flipped = resolveDropDepth({ view, itemPos: apples, clientX: 60, indentStep: 24, incumbentLevel: 4, band: 6 });
    expect(flipped?.level).toBe(3); // > band away -> flips to sibling
    editor.destroy();
  });

  it('returns null when the resolved position has no list-item ancestor', () => {
    const editor = makeEditor('<p>Plain</p>');
    const p = posOf(editor, (n) => n.type.name === 'paragraph');
    const view = viewStub(editor, new Map());
    expect(resolveDropDepth({ view, itemPos: p, clientX: 50, indentStep: 24 })).toBeNull();
    editor.destroy();
  });
});
