/**
 * Unit coverage for `computeDropPlacement` under the gap-first slot model.
 *
 * The exhaustive gap/depth resolution lives in `helpers/dropSlots.test.ts`;
 * this file locks the THIN mapping `computeDropPlacement` adds on top:
 *   - a sibling option -> `mode: 'sibling'` + absolute `insertPos` + `indicatorLine`
 *   - a nested option  -> `mode: 'nested'` + `targetItemPos`/`wrapperPos`,
 *     with `childIndex`/`nestedGapRect` refined by Y via `resolveChildSlot`
 *   - nested disabled (Mode A) / `nestThreshold === 0` -> sibling only
 *
 * jsdom performs no layout, so rects are hand-built and fed through a mocked
 * `view.nodeDOM` (mirrors `helpers/dropSlots.test.ts`).
 */
import { describe, it, expect } from 'vitest';
import {
  Document, Text, Paragraph, Heading, BulletList, OrderedList, ListItem, TaskList, TaskItem, Editor,
} from '@domternal/core';
import type { EditorView } from '@domternal/pm/view';
import { computeDropPlacement, resolveNestedConfig } from './BlockHandle.js';

const extensions = [Document, Text, Paragraph, Heading, BulletList, OrderedList, ListItem, TaskList, TaskItem];

function makeEditor(html: string): Editor {
  return new Editor({ extensions, content: html });
}

interface RectSpec { top: number; bottom: number; left?: number; right?: number }

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

function listItemPos(editor: Editor, text: string): number {
  return posOf(editor, (n) => (n.type.name === 'listItem' || n.type.name === 'taskItem') && n.textContent.startsWith(text));
}

/** Set both the item rect (left/right + extent) and its label-row rect. */
function setItem(rects: Map<number, HTMLElement>, itemPos: number, left: number, top: number, bottom: number, itemBottom = bottom): void {
  rects.set(itemPos, elWithRect({ left, top, bottom: itemBottom }));
  rects.set(itemPos + 1, elWithRect({ left, top, bottom }));
}

const NESTED_DISABLED = resolveNestedConfig(false);
const NESTED_LIST = resolveNestedConfig({ allowedNodes: ['listItem', 'taskItem'] });

describe('computeDropPlacement (slot model)', () => {
  it('returns null for an empty doc', () => {
    const editor = new Editor({ extensions, content: '' });
    expect(computeDropPlacement(viewStub(editor, new Map()), 100, 50, NESTED_DISABLED)).toBeNull();
    editor.destroy();
  });

  describe('Mode A (nested disabled) - top-level sibling reorder', () => {
    it('sibling drop carries an absolute insertPos and an explicit indicatorLine, no nested fields', () => {
      const editor = makeEditor('<p>P1</p><p>P2</p>');
      const p1 = posOf(editor, (n) => n.type.name === 'paragraph' && n.textContent === 'P1');
      const p2 = posOf(editor, (n) => n.type.name === 'paragraph' && n.textContent === 'P2');
      const rects = new Map<number, HTMLElement>([
        [p1, elWithRect({ top: 0, bottom: 20 })],
        [p2, elWithRect({ top: 20, bottom: 40 })],
      ]);
      // Lower half of P1 -> gap after P1 (== before P2).
      const r = computeDropPlacement(viewStub(editor, rects), 50, 16, NESTED_DISABLED);
      expect(r?.mode).toBe('sibling');
      expect(r?.insertPos).toBe(p1 + (editor.state.doc.nodeAt(p1)?.nodeSize ?? 0)); // after P1 == before P2
      expect(r?.targetItemPos).toBeUndefined();
      expect(r?.wrapperPos).toBeUndefined();
      expect(r?.indicatorLine?.top).toBe(20);
      editor.destroy();
    });

    it('upper half of the first block anchors before it at the top', () => {
      const editor = makeEditor('<p>P1</p><p>P2</p>');
      const p1 = posOf(editor, (n) => n.type.name === 'paragraph' && n.textContent === 'P1');
      const rects = new Map<number, HTMLElement>([
        [p1, elWithRect({ top: 0, bottom: 20 })],
        [posOf(editor, (n) => n.type.name === 'paragraph' && n.textContent === 'P2'), elWithRect({ top: 20, bottom: 40 })],
      ]);
      const r = computeDropPlacement(viewStub(editor, rects), 50, 4, NESTED_DISABLED);
      expect(r?.mode).toBe('sibling');
      expect(r?.insertPos).toBe(p1);
      expect(r?.indicatorLine?.top).toBe(0);
      editor.destroy();
    });
  });

  describe('nested lists - gap-first placement', () => {
    /** A2 has a sublist [B1, B2]; A3 follows; layout per dropSlots fixture. */
    function nestedFixture(): { editor: Editor; view: EditorView; pos: { A1: number; A2: number; B1: number; B2: number; A3: number } } {
      const editor = makeEditor(
        '<ul><li><p>A1</p></li>'
        + '<li><p>A2</p><ul><li><p>B1</p></li><li><p>B2</p></li></ul></li>'
        + '<li><p>A3</p></li></ul>',
      );
      const pos = {
        A1: listItemPos(editor, 'A1'),
        A2: listItemPos(editor, 'A2'),
        B1: listItemPos(editor, 'B1'),
        B2: listItemPos(editor, 'B2'),
        A3: listItemPos(editor, 'A3'),
      };
      const rects = new Map<number, HTMLElement>();
      setItem(rects, pos.A1, 10, 0, 20);
      setItem(rects, pos.A2, 10, 20, 40, 80);
      setItem(rects, pos.B1, 30, 40, 60);
      setItem(rects, pos.B2, 30, 60, 80);
      setItem(rects, pos.A3, 10, 80, 100);
      return { editor, view: viewStub(editor, rects), pos };
    }

    it('gutter drag at the TOP of a nested list nests before the first child, line near the cursor (no jump)', () => {
      const { editor, view, pos } = nestedFixture();
      const r = computeDropPlacement(view, 0, 42, NESTED_LIST);
      expect(r?.mode).toBe('sibling');
      expect(r?.insertPos).toBe(pos.B1); // before B1, stays in the nested list
      expect(r?.indicatorLine?.top).toBe(40); // near the cursor, not at the list bottom
      editor.destroy();
    });

    it('gutter drag at the BOTTOM of a nested list outdents to top level, line near the cursor', () => {
      const { editor, view, pos } = nestedFixture();
      const r = computeDropPlacement(view, 0, 78, NESTED_LIST);
      expect(r?.mode).toBe('sibling');
      expect(r?.insertPos).toBe(pos.A3); // after A2 == before A3 (top level)
      expect(r?.indicatorLine?.top).toBe(80);
      editor.destroy();
    });

    it('dragging right nests into the item as a child (nested mode, indented indicator)', () => {
      const { editor, view, pos } = nestedFixture();
      const r = computeDropPlacement(view, 60, 42, NESTED_LIST); // past B1.left(30)+nestThreshold
      expect(r?.mode).toBe('nested');
      expect(r?.targetItemPos).toBe(pos.B1);
      expect(typeof r?.wrapperPos).toBe('number');
      expect(r?.indicatorLine?.left).toBeGreaterThan(30); // indented past the item left
      editor.destroy();
    });

    it('a sibling placement never carries nested fields', () => {
      const { editor, view } = nestedFixture();
      const r = computeDropPlacement(view, 0, 42, NESTED_LIST);
      expect(r?.mode).toBe('sibling');
      expect(r?.targetItemPos).toBeUndefined();
      expect(r?.wrapperPos).toBeUndefined();
      expect(r?.childIndex).toBeUndefined();
      editor.destroy();
    });
  });

  describe('position-aware childIndex inside an item', () => {
    /** Item with label + two extra paragraph children. */
    function fixture(): { editor: Editor; view: EditorView; itemPos: number } {
      const editor = makeEditor('<ul><li><p>Label</p><p>X1</p><p>X2</p></li></ul>');
      const itemPos = listItemPos(editor, 'Label');
      const item = editor.state.doc.nodeAt(itemPos);
      if (!item) throw new Error('no item');
      const rects = new Map<number, HTMLElement>();
      rects.set(itemPos, elWithRect({ left: 10, top: 0, bottom: 60 }));
      // children: label (0), X1 (1), X2 (2) via posAtIndex
      const $item = editor.state.doc.resolve(itemPos + 1);
      rects.set($item.posAtIndex(0, $item.depth), elWithRect({ left: 30, top: 0, bottom: 20 }));
      rects.set($item.posAtIndex(1, $item.depth), elWithRect({ left: 30, top: 20, bottom: 40 }));
      rects.set($item.posAtIndex(2, $item.depth), elWithRect({ left: 30, top: 40, bottom: 60 }));
      return { editor, view: viewStub(editor, rects), itemPos };
    }

    it('nesting with the cursor low in the item appends as the last child', () => {
      const { editor, view, itemPos } = fixture();
      const item = editor.state.doc.nodeAt(itemPos);
      const r = computeDropPlacement(view, 60, 58, NESTED_LIST); // X right -> nested, Y at the bottom
      expect(r?.mode).toBe('nested');
      expect(r?.targetItemPos).toBe(itemPos);
      expect(r?.childIndex).toBe(item?.childCount); // append
      editor.destroy();
    });

    it('nesting with the cursor high in the item lands at an earlier child slot', () => {
      const { editor, view } = fixture();
      const r = computeDropPlacement(view, 60, 22, NESTED_LIST); // Y near the first extra child
      expect(r?.mode).toBe('nested');
      expect(r?.childIndex).toBeLessThan(3);
      expect(r?.childIndex).toBeGreaterThanOrEqual(1);
      editor.destroy();
    });
  });

  it('nestThreshold 0 disables nesting (every drop is a sibling)', () => {
    const editor = makeEditor('<ul><li><p>Solo</p></li></ul>');
    const itemPos = listItemPos(editor, 'Solo');
    const rects = new Map<number, HTMLElement>();
    setItem(rects, itemPos, 10, 0, 20);
    // X far right would normally nest; with threshold 0 it must stay sibling.
    const r = computeDropPlacement(viewStub(editor, rects), 400, 18, NESTED_LIST, 0);
    expect(r?.mode).toBe('sibling');
    editor.destroy();
  });
});
