import { describe, it, expect } from 'vitest';
import {
  Document, Text, Paragraph, BulletList, OrderedList, ListItem, TaskList, TaskItem, Editor,
} from '@domternal/core';
import type { EditorView } from '@domternal/pm/view';
import { collectRows, resolveDropSlot } from './dropSlots.js';

const extensions = [Document, Text, Paragraph, BulletList, OrderedList, ListItem, TaskList, TaskItem];

function makeEditor(html: string): Editor {
  return new Editor({ extensions, content: html });
}

interface RectSpec { top: number; bottom: number; left: number; right?: number }

function elWithRect(spec: RectSpec): HTMLElement {
  const el = document.createElement('div');
  const right = spec.right ?? 500;
  el.getBoundingClientRect = () => new DOMRect(spec.left, spec.top, right - spec.left, spec.bottom - spec.top);
  return el;
}

function viewStub(editor: Editor, rects: Map<number, HTMLElement>): EditorView {
  return {
    state: editor.state,
    nodeDOM: (pos: number) => rects.get(pos) ?? null,
  } as unknown as EditorView;
}

function posOfItem(editor: Editor, text: string): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found !== -1) return false;
    if ((node.type.name === 'listItem' || node.type.name === 'taskItem') && node.textContent.startsWith(text)) {
      found = pos;
      return false;
    }
    return true;
  });
  if (found === -1) throw new Error(`item ${text} not found`);
  return found;
}

function posOfTopParagraph(editor: Editor, text: string): number {
  let found = -1;
  editor.state.doc.forEach((node, offset) => {
    if (found === -1 && node.type.name === 'paragraph' && node.textContent === text) found = offset;
  });
  if (found === -1) throw new Error(`top paragraph ${text} not found`);
  return found;
}

/**
 * Groceries-style fixture:
 *   A1            (L1, label y 0-20,   left 10)
 *   A2            (L1, label y 20-40,  left 10)
 *     B1          (L2, label y 40-60,  left 30)
 *     B2          (L2, label y 60-80,  left 30)
 *   A3            (L1, label y 80-100, left 10)
 *   Para          (top-level block, y 100-120, left 10)
 */
interface PosMap { A1: number; A2: number; B1: number; B2: number; A3: number; Para: number }

function fixture(): { editor: Editor; view: EditorView; pos: PosMap } {
  const editor = makeEditor(
    '<ul>'
    + '<li><p>A1</p></li>'
    + '<li><p>A2</p><ul><li><p>B1</p></li><li><p>B2</p></li></ul></li>'
    + '<li><p>A3</p></li>'
    + '</ul>'
    + '<p>Para</p>',
  );
  const pos: PosMap = {
    A1: posOfItem(editor, 'A1'),
    A2: posOfItem(editor, 'A2'),
    B1: posOfItem(editor, 'B1'),
    B2: posOfItem(editor, 'B2'),
    A3: posOfItem(editor, 'A3'),
    Para: posOfTopParagraph(editor, 'Para'),
  };
  const rects = new Map<number, HTMLElement>();
  const item = (p: number, left: number, top: number, bottom: number, itemBottom = bottom): void => {
    rects.set(p, elWithRect({ left, top, bottom: itemBottom }));   // item rect (left/right + full extent)
    rects.set(p + 1, elWithRect({ left, top, bottom }));           // label rect (own row Y)
  };
  item(pos.A1, 10, 0, 20);
  item(pos.A2, 10, 20, 40, 80); // item spans label + nested
  item(pos.B1, 30, 40, 60);
  item(pos.B2, 30, 60, 80);
  item(pos.A3, 10, 80, 100);
  rects.set(pos.Para, elWithRect({ left: 10, top: 100, bottom: 120 }));
  return { editor, view: viewStub(editor, rects), pos };
}

describe('collectRows', () => {
  it('emits rows in document order with label-row Y and item indent', () => {
    const { editor, view, pos } = fixture();
    const rows = collectRows(view);
    expect(rows.map((r) => r.pos)).toEqual([pos.A1, pos.A2, pos.B1, pos.B2, pos.A3, pos.Para]);
    expect(rows.map((r) => r.level)).toEqual([1, 1, 2, 2, 1, 0]);
    const b1 = rows[2];
    expect(b1?.top).toBe(40);
    expect(b1?.left).toBe(30);
    editor.destroy();
  });
});

describe('resolveDropSlot', () => {
  it('gap before the first nested child: gutter X stays nested (no jump to list end)', () => {
    const { editor, view, pos } = fixture();
    // Y in the top half of B1 -> "before B1" gap; X in the gutter.
    const slot = resolveDropSlot({ view, clientX: 0, clientY: 42 });
    expect(slot?.gapY).toBe(40);
    expect(slot?.option.insert.kind).toBe('sibling');
    expect(slot?.option.insert.pos).toBe(pos.B1);
    expect(slot?.option.level).toBe(2);
    editor.destroy();
  });

  it('gap before the first nested child: dragging right nests INTO that child', () => {
    const { editor, view, pos } = fixture();
    const slot = resolveDropSlot({ view, clientX: 60, clientY: 42 }); // past B1.left(30)+24=54
    expect(slot?.option.insert.kind).toBe('nested');
    expect(slot?.option.insert.targetItemPos).toBe(pos.B1);
    expect(slot?.option.insert.childIndex).toBe(1);
    expect(slot?.option.level).toBe(3);
    editor.destroy();
  });

  it('gap after the last nested child: gutter X outdents to top level, line stays near cursor', () => {
    const { editor, view, pos } = fixture();
    // Y in the bottom half of B2 -> "after B2" gap (== bottom of A2's sublist).
    const slot = resolveDropSlot({ view, clientX: 0, clientY: 78 });
    expect(slot?.gapY).toBe(80); // near the cursor, not jumping elsewhere
    expect(slot?.option.insert.kind).toBe('sibling');
    expect(slot?.option.insert.pos).toBe(pos.A3); // after A2 == before A3 (top level)
    expect(slot?.option.level).toBe(1);
    editor.destroy();
  });

  it('gap after the last nested child: mid X keeps it a nested sibling at level 2', () => {
    const { editor, view, pos } = fixture();
    const slot = resolveDropSlot({ view, clientX: 35, clientY: 78 }); // >= B2.left(30), < nest guide(54)
    expect(slot?.option.insert.kind).toBe('sibling');
    expect(slot?.option.insert.pos).toBe(pos.B2 + (view.state.doc.nodeAt(pos.B2)?.nodeSize ?? 0)); // after B2
    expect(slot?.option.level).toBe(2);
    editor.destroy();
  });

  it('flat gap between two top-level items: gutter sibling, right nests into the upper', () => {
    const { editor, view, pos } = fixture();
    const sib = resolveDropSlot({ view, clientX: 0, clientY: 18 }); // after A1
    expect(sib?.gapY).toBe(20);
    expect(sib?.option.insert.kind).toBe('sibling');
    expect(sib?.option.insert.pos).toBe(pos.A2); // after A1 == before A2
    expect(sib?.option.level).toBe(1);

    const nest = resolveDropSlot({ view, clientX: 40, clientY: 18 }); // past A1.left(10)+24=34
    expect(nest?.option.insert.kind).toBe('nested');
    expect(nest?.option.insert.targetItemPos).toBe(pos.A1);
    editor.destroy();
  });

  it('before the first row anchors at the top, sibling at top level', () => {
    const { editor, view, pos } = fixture();
    const slot = resolveDropSlot({ view, clientX: 0, clientY: -5 });
    expect(slot?.gapY).toBe(0);
    expect(slot?.option.insert.pos).toBe(pos.A1);
    expect(slot?.option.level).toBe(1);
    editor.destroy();
  });

  it('after the last row anchors at the bottom, top-level block sibling', () => {
    const { editor, view, pos } = fixture();
    const para = view.state.doc.nodeAt(pos.Para);
    const slot = resolveDropSlot({ view, clientX: 0, clientY: 130 });
    expect(slot?.gapY).toBe(120);
    expect(slot?.option.insert.kind).toBe('sibling');
    expect(slot?.option.insert.pos).toBe(pos.Para + (para?.nodeSize ?? 0));
    expect(slot?.option.level).toBe(0);
    editor.destroy();
  });

  it('returns null for an empty row set', () => {
    const { editor, view } = fixture();
    expect(resolveDropSlot({ view, clientX: 0, clientY: 0, rows: [] })).toBeNull();
    editor.destroy();
  });

  it('Y dead-band holds the incumbent gap near a row mid (no flip on a wobble)', () => {
    const { editor, view, pos } = fixture();
    // A1 spans 0-20 (mid 10). Y=8 is just above mid -> stateless picks "before A1".
    const stateless = resolveDropSlot({ view, clientX: 0, clientY: 8 });
    expect(stateless?.option.insert.pos).toBe(pos.A1); // before A1
    // Incumbent was the "after A1" gap; within band it stays there.
    const sticky = resolveDropSlot({
      view, clientX: 0, clientY: 8, bandY: 6,
      incumbent: { upperPos: pos.A1, lowerPos: pos.A2, level: 1 },
    });
    expect(sticky?.option.insert.pos).toBe(pos.A2); // after A1 == before A2
    editor.destroy();
  });

  it('X dead-band holds the incumbent depth near a guide boundary (no flicker)', () => {
    const { editor, view, pos } = fixture();
    const afterB2 = pos.B2 + (view.state.doc.nodeAt(pos.B2)?.nodeSize ?? 0);
    // At the after-B2 gap, X=28 is just below the L2 guide (B2.left=30).
    const stateless = resolveDropSlot({ view, clientX: 28, clientY: 78 });
    expect(stateless?.option.level).toBe(1); // outdented to top level
    const sticky = resolveDropSlot({
      view, clientX: 28, clientY: 78, bandX: 8,
      incumbent: { upperPos: pos.B2, lowerPos: pos.A3, level: 2 },
    });
    expect(sticky?.option.level).toBe(2); // held at the nested sibling level
    expect(sticky?.option.insert.pos).toBe(afterB2);
    editor.destroy();
  });
});
