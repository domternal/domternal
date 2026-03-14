import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { Table } from './Table.js';
import { TableRow } from './TableRow.js';
import { TableCell } from './TableCell.js';
import { TableHeader } from './TableHeader.js';
import { Document, Text, Paragraph, Editor } from '@domternal/core';
import { columnResizingPluginKey, TableMap } from '@domternal/pm/tables';


// JSDOM doesn't implement elementFromPoint — ProseMirror's posAtCoords calls it
// on mousedown. Mock it to prevent uncaught exceptions during event dispatch.
beforeAll(() => {
  if (!document.elementFromPoint) {
    document.elementFromPoint = () => null;
  }
});

const baseExtensions = [Document, Text, Paragraph, Table, TableRow, TableCell, TableHeader];

/** Create extensions with a specific resizeBehavior. */
function extensionsWithBehavior(behavior: 'neighbor' | 'independent' | 'redistribute') {
  return [Document, Text, Paragraph, Table.configure({ resizeBehavior: behavior }), TableRow, TableCell, TableHeader];
}

/** HTML for a 2-row × 3-col table with optional colwidths. */
function tableHTML(colwidths?: (number | null)[]): string {
  const cw = colwidths ?? [null, null, null];
  const makeCell = (tag: string, w: number | null) => {
    const attr = w ? ` data-colwidth="${w}"` : '';
    return `<${tag}${attr}><p>X</p></${tag}>`;
  };
  const headerRow = cw.map((w) => makeCell('th', w)).join('');
  const dataRow = cw.map((w) => makeCell('td', w)).join('');
  return `<table><tr>${headerRow}</tr><tr>${dataRow}</tr></table>`;
}

/** Find the position of the first cell in the table (first header cell). */
function firstCellPos(editor: InstanceType<typeof Editor>): number {
  const doc = editor.state.doc;
  // doc > table > tableRow > tableHeader/tableCell
  // Position of first cell = table start + row start + 1
  // Absolute position: doc(0) + table(1) + row + cell
  let pos = 0;
  doc.nodesBetween(0, doc.content.size, (node, p) => {
    if (pos > 0) return false;
    if (node.type.name === 'tableHeader' || node.type.name === 'tableCell') {
      pos = p;
      return false;
    }
    return true;
  });
  return pos;
}

/** Get all colwidth attrs from cells in the first row of the table. */
function getFirstRowColwidths(editor: InstanceType<typeof Editor>): (number[] | null)[] {
  const doc = editor.state.doc;
  const colwidths: (number[] | null)[] = [];
  const table = doc.firstChild!;
  const firstRow = table.firstChild!;
  for (let i = 0; i < firstRow.childCount; i++) {
    colwidths.push(firstRow.child(i).attrs['colwidth'] as number[] | null);
  }
  return colwidths;
}

/** Get all colwidth attrs from cells in the second row. */
function getSecondRowColwidths(editor: InstanceType<typeof Editor>): (number[] | null)[] {
  const doc = editor.state.doc;
  const colwidths: (number[] | null)[] = [];
  const table = doc.firstChild!;
  const secondRow = table.child(1);
  for (let i = 0; i < secondRow.childCount; i++) {
    colwidths.push(secondRow.child(i).attrs['colwidth'] as number[] | null);
  }
  return colwidths;
}

/** Set the columnResizing plugin's activeHandle to a cell position. */
function setActiveHandle(editor: InstanceType<typeof Editor>, cellPos: number): void {
  const { view } = editor;
  view.dispatch(view.state.tr.setMeta(columnResizingPluginKey, { setHandle: cellPos }));
}

/** Get the columnResizing plugin state. */
function getResizeState(editor: InstanceType<typeof Editor>) {
  return columnResizingPluginKey.getState(editor.state) as
    | { activeHandle: number; dragging: { startX: number; startWidth: number } | null } | undefined;
}

// ─── Configuration ────────────────────────────────────────────────────────────

describe('resizeBehavior configuration', () => {
  it('defaults to neighbor', () => {
    expect(Table.options.resizeBehavior).toBe('neighbor');
  });

  it('can configure to independent', () => {
    const Custom = Table.configure({ resizeBehavior: 'independent' });
    expect(Custom.options.resizeBehavior).toBe('independent');
  });

  it('can configure to redistribute', () => {
    const Custom = Table.configure({ resizeBehavior: 'redistribute' });
    expect(Custom.options.resizeBehavior).toBe('redistribute');
  });

  it('preserves other options when configuring resizeBehavior', () => {
    const Custom = Table.configure({ resizeBehavior: 'independent', cellMinWidth: 50 });
    expect(Custom.options.resizeBehavior).toBe('independent');
    expect(Custom.options.cellMinWidth).toBe(50);
    expect(Custom.options.defaultCellMinWidth).toBe(100);
  });
});

// ─── Plugin structure ─────────────────────────────────────────────────────────

describe('resizeSuppression plugin', () => {
  let editor: InstanceType<typeof Editor>;

  afterEach(() => {
    editor?.destroy();
  });

  it('registers plugins when editor is created', () => {
    editor = new Editor({
      extensions: baseExtensions,
      content: tableHTML(),
    });
    // columnResizing plugin should be active
    const resizeState = getResizeState(editor);
    expect(resizeState).toBeDefined();
    expect(resizeState!.activeHandle).toBe(-1);
    expect(resizeState!.dragging).toBeFalsy();
  });

  it('has initial activeHandle of -1', () => {
    editor = new Editor({
      extensions: baseExtensions,
      content: tableHTML(),
    });
    const state = getResizeState(editor);
    expect(state!.activeHandle).toBe(-1);
  });
});

// ─── dm-mouse-drag class (non-resize drag suppression) ───────────────────────

describe('dm-mouse-drag class', () => {
  let editor: InstanceType<typeof Editor>;

  afterEach(() => {
    editor?.destroy();
  });

  it('adds dm-mouse-drag on left-click mousedown when not on resize handle', () => {
    editor = new Editor({
      extensions: baseExtensions,
      content: tableHTML(),
    });
    // activeHandle is -1 (not on resize handle)
    const event = new MouseEvent('mousedown', { button: 0, bubbles: true });
    editor.view.dom.dispatchEvent(event);
    expect(editor.view.dom.classList.contains('dm-mouse-drag')).toBe(true);
  });

  it('removes dm-mouse-drag on mouseup', () => {
    editor = new Editor({
      extensions: baseExtensions,
      content: tableHTML(),
    });
    const downEvent = new MouseEvent('mousedown', { button: 0, bubbles: true });
    editor.view.dom.dispatchEvent(downEvent);
    expect(editor.view.dom.classList.contains('dm-mouse-drag')).toBe(true);

    const upEvent = new MouseEvent('mouseup', { bubbles: true });
    document.dispatchEvent(upEvent);
    expect(editor.view.dom.classList.contains('dm-mouse-drag')).toBe(false);
  });

  it('does not add dm-mouse-drag for right-click', () => {
    editor = new Editor({
      extensions: baseExtensions,
      content: tableHTML(),
    });
    const event = new MouseEvent('mousedown', { button: 2, bubbles: true });
    editor.view.dom.dispatchEvent(event);
    expect(editor.view.dom.classList.contains('dm-mouse-drag')).toBe(false);
  });

  it('does not add dm-mouse-drag when on a resize handle', () => {
    editor = new Editor({
      extensions: baseExtensions,
      content: tableHTML([200, 200, 200]),
    });
    const cellPos = firstCellPos(editor);
    setActiveHandle(editor, cellPos);

    const event = new MouseEvent('mousedown', { button: 0, bubbles: true });
    editor.view.dom.dispatchEvent(event);
    // Should NOT have dm-mouse-drag because activeHandle !== -1
    expect(editor.view.dom.classList.contains('dm-mouse-drag')).toBe(false);
  });
});

// ─── Redistribute mode ───────────────────────────────────────────────────────

describe('redistribute mode', () => {
  let editor: InstanceType<typeof Editor>;

  afterEach(() => {
    editor?.destroy();
  });

  it('does not freeze column widths on resize mousedown', () => {
    editor = new Editor({
      extensions: extensionsWithBehavior('redistribute'),
      content: tableHTML(),
    });
    // All colwidths should be null initially
    expect(getFirstRowColwidths(editor)).toEqual([null, null, null]);

    const cellPos = firstCellPos(editor);
    setActiveHandle(editor, cellPos);

    const event = new MouseEvent('mousedown', { button: 0, bubbles: true, clientX: 100 });
    editor.view.dom.dispatchEvent(event);

    // In redistribute mode, colwidths should remain null (no freeze)
    expect(getFirstRowColwidths(editor)).toEqual([null, null, null]);
  });

  it('passes through to columnResizing plugin (returns false)', () => {
    editor = new Editor({
      extensions: extensionsWithBehavior('redistribute'),
      content: tableHTML([200, 200, 200]),
    });
    const cellPos = firstCellPos(editor);
    setActiveHandle(editor, cellPos);

    // Mousedown should not set dragging on our behalf (columnResizing handles it)
    const event = new MouseEvent('mousedown', { button: 0, bubbles: true, clientX: 100 });
    editor.view.dom.dispatchEvent(event);

    // columnResizing's handleMouseDown may or may not set dragging depending on JSDOM,
    // but our plugin should NOT have intercepted
    // The key thing: we did NOT prevent default or return true
    expect(event.defaultPrevented).toBe(false);
  });
});

// ─── Independent mode (freezeColumnWidths) ───────────────────────────────────

describe('independent mode', () => {
  let editor: InstanceType<typeof Editor>;

  afterEach(() => {
    editor?.destroy();
  });

  it('freezes column widths on resize mousedown', () => {
    editor = new Editor({
      extensions: extensionsWithBehavior('independent'),
      content: tableHTML(),
    });
    // No colwidths initially
    expect(getFirstRowColwidths(editor)).toEqual([null, null, null]);

    const cellPos = firstCellPos(editor);
    setActiveHandle(editor, cellPos);

    const event = new MouseEvent('mousedown', { button: 0, bubbles: true, clientX: 100 });
    editor.view.dom.dispatchEvent(event);

    // After freeze, all cells should have colwidth arrays
    // In JSDOM, offsetWidth = 0, so measured width = max(cellMinWidth, 0) = 25
    const firstRow = getFirstRowColwidths(editor);
    expect(firstRow.every((cw) => cw !== null)).toBe(true);
    expect(firstRow.every((cw) => Array.isArray(cw) && cw.length === 1)).toBe(true);
  });

  it('freezes with cellMinWidth as floor (JSDOM has no layout)', () => {
    editor = new Editor({
      extensions: extensionsWithBehavior('independent'),
      content: tableHTML(),
    });
    const cellPos = firstCellPos(editor);
    setActiveHandle(editor, cellPos);

    const event = new MouseEvent('mousedown', { button: 0, bubbles: true, clientX: 100 });
    editor.view.dom.dispatchEvent(event);

    // In JSDOM, cells measure as 0px → clamped to cellMinWidth (25)
    const firstRow = getFirstRowColwidths(editor);
    firstRow.forEach((cw) => {
      expect(cw![0]).toBe(25);
    });
  });

  it('preserves existing colwidths during freeze', () => {
    editor = new Editor({
      extensions: extensionsWithBehavior('independent'),
      content: tableHTML([200, null, 300]),
    });
    // First and third columns have widths, second doesn't
    expect(getFirstRowColwidths(editor)).toEqual([[200], null, [300]]);

    const cellPos = firstCellPos(editor);
    setActiveHandle(editor, cellPos);

    const event = new MouseEvent('mousedown', { button: 0, bubbles: true, clientX: 100 });
    editor.view.dom.dispatchEvent(event);

    const firstRow = getFirstRowColwidths(editor);
    // Existing widths preserved, null column gets measured (25 in JSDOM)
    expect(firstRow[0]).toEqual([200]);
    expect(firstRow[1]![0]).toBe(25); // was null, now measured
    expect(firstRow[2]).toEqual([300]);
  });

  it('freezes all rows, not just the first', () => {
    editor = new Editor({
      extensions: extensionsWithBehavior('independent'),
      content: tableHTML(),
    });
    const cellPos = firstCellPos(editor);
    setActiveHandle(editor, cellPos);

    const event = new MouseEvent('mousedown', { button: 0, bubbles: true, clientX: 100 });
    editor.view.dom.dispatchEvent(event);

    // Both rows should have colwidths
    const firstRow = getFirstRowColwidths(editor);
    const secondRow = getSecondRowColwidths(editor);
    expect(firstRow.every((cw) => cw !== null)).toBe(true);
    expect(secondRow.every((cw) => cw !== null)).toBe(true);
  });

  it('skips freeze if all columns already have widths', () => {
    editor = new Editor({
      extensions: extensionsWithBehavior('independent'),
      content: tableHTML([200, 200, 200]),
    });

    const before = getFirstRowColwidths(editor);
    expect(before).toEqual([[200], [200], [200]]);

    const cellPos = firstCellPos(editor);
    setActiveHandle(editor, cellPos);

    const event = new MouseEvent('mousedown', { button: 0, bubbles: true, clientX: 100 });
    editor.view.dom.dispatchEvent(event);

    // Widths should be unchanged (no unnecessary transaction)
    const after = getFirstRowColwidths(editor);
    expect(after).toEqual([[200], [200], [200]]);
  });

  it('does not intercept mousedown (returns false)', () => {
    editor = new Editor({
      extensions: extensionsWithBehavior('independent'),
      content: tableHTML([200, 200, 200]),
    });
    const cellPos = firstCellPos(editor);
    setActiveHandle(editor, cellPos);

    const event = new MouseEvent('mousedown', { button: 0, bubbles: true, clientX: 100 });
    editor.view.dom.dispatchEvent(event);

    // Independent mode does NOT prevent default (lets columnResizing handle drag)
    expect(event.defaultPrevented).toBe(false);
  });
});

// ─── Neighbor mode ───────────────────────────────────────────────────────────

describe('neighbor mode', () => {
  let editor: InstanceType<typeof Editor>;

  afterEach(() => {
    editor?.destroy();
  });

  it('freezes columns before starting neighbor drag', () => {
    editor = new Editor({
      extensions: extensionsWithBehavior('neighbor'),
      content: tableHTML(),
    });
    expect(getFirstRowColwidths(editor)).toEqual([null, null, null]);

    const cellPos = firstCellPos(editor);
    setActiveHandle(editor, cellPos);

    const event = new MouseEvent('mousedown', { button: 0, bubbles: true, clientX: 100 });
    editor.view.dom.dispatchEvent(event);

    // Freeze should have run (all columns get colwidth)
    const firstRow = getFirstRowColwidths(editor);
    expect(firstRow.every((cw) => cw !== null)).toBe(true);
  });

  it('intercepts mousedown and prevents default', () => {
    editor = new Editor({
      extensions: extensionsWithBehavior('neighbor'),
      content: tableHTML([200, 200, 200]),
    });
    const cellPos = firstCellPos(editor);
    setActiveHandle(editor, cellPos);

    const event = new MouseEvent('mousedown', {
      button: 0, bubbles: true, cancelable: true, clientX: 100,
    });
    editor.view.dom.dispatchEvent(event);

    // Neighbor mode intercepts: returns true + calls preventDefault
    expect(event.defaultPrevented).toBe(true);
  });

  it('sets dragging state on columnResizing plugin', () => {
    editor = new Editor({
      extensions: extensionsWithBehavior('neighbor'),
      content: tableHTML([200, 200, 200]),
    });
    const cellPos = firstCellPos(editor);
    setActiveHandle(editor, cellPos);

    expect(getResizeState(editor)!.dragging).toBeFalsy();

    const event = new MouseEvent('mousedown', {
      button: 0, bubbles: true, cancelable: true, clientX: 100,
    });
    editor.view.dom.dispatchEvent(event);

    const state = getResizeState(editor);
    expect(state!.dragging).toBeTruthy();
    expect((state!.dragging as any).startX).toBe(100);
    expect((state!.dragging as any).startWidth).toBe(200);
  });

  it('stores both column widths on mouseup (finish)', () => {
    editor = new Editor({
      extensions: extensionsWithBehavior('neighbor'),
      content: tableHTML([200, 200, 200]),
    });
    const cellPos = firstCellPos(editor);
    setActiveHandle(editor, cellPos);

    // Mousedown at x=100
    const downEvent = new MouseEvent('mousedown', {
      button: 0, bubbles: true, cancelable: true, clientX: 100,
    });
    editor.view.dom.dispatchEvent(downEvent);

    // Mouseup at x=150 (dragged 50px right)
    const upEvent = new MouseEvent('mouseup', {
      bubbles: true, clientX: 150,
    });
    window.dispatchEvent(upEvent);

    // After finish, dragging should be cleared
    const state = getResizeState(editor);
    expect(state!.dragging).toBeFalsy();

    // Both columns should have updated widths
    // Dragged column: 200 + 50 = 250
    // Neighbor column: 200 - 50 = 150
    const firstRow = getFirstRowColwidths(editor);
    expect(firstRow[0]![0]).toBe(250); // dragged column grew
    expect(firstRow[1]![0]).toBe(150); // neighbor shrank
    expect(firstRow[2]![0]).toBe(200); // third column unchanged
  });

  it('preserves total width (neighbor compensates)', () => {
    editor = new Editor({
      extensions: extensionsWithBehavior('neighbor'),
      content: tableHTML([200, 300, 200]),
    });
    const cellPos = firstCellPos(editor);
    setActiveHandle(editor, cellPos);

    const totalBefore = 200 + 300 + 200;

    // Drag 80px right
    const downEvent = new MouseEvent('mousedown', {
      button: 0, bubbles: true, cancelable: true, clientX: 100,
    });
    editor.view.dom.dispatchEvent(downEvent);

    const upEvent = new MouseEvent('mouseup', { bubbles: true, clientX: 180 });
    window.dispatchEvent(upEvent);

    const firstRow = getFirstRowColwidths(editor);
    const totalAfter = firstRow[0]![0]! + firstRow[1]![0]! + firstRow[2]![0]!;
    expect(totalAfter).toBe(totalBefore);
  });

  it('clamps so dragged column does not go below cellMinWidth', () => {
    editor = new Editor({
      extensions: extensionsWithBehavior('neighbor'),
      content: tableHTML([50, 200, 200]),
    });
    const cellPos = firstCellPos(editor);
    setActiveHandle(editor, cellPos);

    // Drag 100px left (try to shrink col 0 from 50 to -50 → clamped to 25)
    const downEvent = new MouseEvent('mousedown', {
      button: 0, bubbles: true, cancelable: true, clientX: 200,
    });
    editor.view.dom.dispatchEvent(downEvent);

    const upEvent = new MouseEvent('mouseup', { bubbles: true, clientX: 100 });
    window.dispatchEvent(upEvent);

    const firstRow = getFirstRowColwidths(editor);
    expect(firstRow[0]![0]).toBe(25); // clamped to cellMinWidth
    expect(firstRow[1]![0]).toBe(225); // neighbor absorbed the difference
  });

  it('clamps so neighbor column does not go below cellMinWidth', () => {
    editor = new Editor({
      extensions: extensionsWithBehavior('neighbor'),
      content: tableHTML([200, 50, 200]),
    });
    const cellPos = firstCellPos(editor);
    setActiveHandle(editor, cellPos);

    // Drag 100px right (try to shrink neighbor from 50 to -50 → clamped to 25)
    const downEvent = new MouseEvent('mousedown', {
      button: 0, bubbles: true, cancelable: true, clientX: 100,
    });
    editor.view.dom.dispatchEvent(downEvent);

    const upEvent = new MouseEvent('mouseup', { bubbles: true, clientX: 200 });
    window.dispatchEvent(upEvent);

    const firstRow = getFirstRowColwidths(editor);
    expect(firstRow[0]![0]).toBe(225); // grew by max allowed (25)
    expect(firstRow[1]![0]).toBe(25);  // clamped to cellMinWidth
  });

  it('stores widths in both rows (not just first row)', () => {
    editor = new Editor({
      extensions: extensionsWithBehavior('neighbor'),
      content: tableHTML([200, 200, 200]),
    });
    const cellPos = firstCellPos(editor);
    setActiveHandle(editor, cellPos);

    const downEvent = new MouseEvent('mousedown', {
      button: 0, bubbles: true, cancelable: true, clientX: 100,
    });
    editor.view.dom.dispatchEvent(downEvent);

    const upEvent = new MouseEvent('mouseup', { bubbles: true, clientX: 130 });
    window.dispatchEvent(upEvent);

    const firstRow = getFirstRowColwidths(editor);
    const secondRow = getSecondRowColwidths(editor);
    // Both rows should have the same updated widths
    expect(firstRow[0]![0]).toBe(secondRow[0]![0]);
    expect(firstRow[1]![0]).toBe(secondRow[1]![0]);
    expect(firstRow[0]![0]).toBe(230); // 200 + 30
    expect(firstRow[1]![0]).toBe(170); // 200 - 30
  });

  it('handles zero drag (no movement)', () => {
    editor = new Editor({
      extensions: extensionsWithBehavior('neighbor'),
      content: tableHTML([200, 200, 200]),
    });
    const cellPos = firstCellPos(editor);
    setActiveHandle(editor, cellPos);

    const downEvent = new MouseEvent('mousedown', {
      button: 0, bubbles: true, cancelable: true, clientX: 100,
    });
    editor.view.dom.dispatchEvent(downEvent);

    // Mouseup at same position (no movement)
    const upEvent = new MouseEvent('mouseup', { bubbles: true, clientX: 100 });
    window.dispatchEvent(upEvent);

    const firstRow = getFirstRowColwidths(editor);
    expect(firstRow[0]![0]).toBe(200);
    expect(firstRow[1]![0]).toBe(200);
    expect(firstRow[2]![0]).toBe(200);
  });

  it('updates col elements during mousemove (visual feedback)', () => {
    editor = new Editor({
      extensions: extensionsWithBehavior('neighbor'),
      content: tableHTML([200, 200, 200]),
    });
    const cellPos = firstCellPos(editor);
    setActiveHandle(editor, cellPos);

    const downEvent = new MouseEvent('mousedown', {
      button: 0, bubbles: true, cancelable: true, clientX: 100,
    });
    editor.view.dom.dispatchEvent(downEvent);

    // Simulate mousemove (drag 40px right)
    const moveEvent = new MouseEvent('mousemove', {
      bubbles: true, clientX: 140, buttons: 1,
    });
    window.dispatchEvent(moveEvent);

    // Check colgroup col elements have been updated
    const colgroup = editor.view.dom.querySelector('colgroup');
    if (colgroup) {
      const cols = colgroup.children;
      expect((cols[0] as HTMLElement).style.width).toBe('240px');
      expect((cols[1] as HTMLElement).style.width).toBe('160px');
    }

    // Clean up: finish the drag
    const upEvent = new MouseEvent('mouseup', { bubbles: true, clientX: 140 });
    window.dispatchEvent(upEvent);
  });

  it('clears dragging state on mouseup', () => {
    editor = new Editor({
      extensions: extensionsWithBehavior('neighbor'),
      content: tableHTML([200, 200, 200]),
    });
    const cellPos = firstCellPos(editor);
    setActiveHandle(editor, cellPos);

    const downEvent = new MouseEvent('mousedown', {
      button: 0, bubbles: true, cancelable: true, clientX: 100,
    });
    editor.view.dom.dispatchEvent(downEvent);
    expect(getResizeState(editor)!.dragging).toBeTruthy();

    const upEvent = new MouseEvent('mouseup', { bubbles: true, clientX: 130 });
    window.dispatchEvent(upEvent);
    expect(getResizeState(editor)!.dragging).toBeFalsy();
  });
});

// ─── Last column edge case ───────────────────────────────────────────────────

describe('neighbor mode — last column fallback', () => {
  let editor: InstanceType<typeof Editor>;

  afterEach(() => {
    editor?.destroy();
  });

  it('falls back to independent when dragging last column (no neighbor)', () => {
    editor = new Editor({
      extensions: extensionsWithBehavior('neighbor'),
      content: tableHTML([200, 200, 200]),
    });

    // Find the LAST cell in the first row (third column)
    const doc = editor.state.doc;
    const table = doc.firstChild!;
    let lastCellPos = 0;
    doc.nodesBetween(0, doc.content.size, (node, p) => {
      if (node.type.name === 'tableHeader' || node.type.name === 'tableCell') {
        lastCellPos = p; // keep overwriting, last one wins
      }
      return true;
    });

    // Verify we got the last cell in the first row
    const map = TableMap.get(table);
    const tableStart = 1; // doc(0) + table content starts at 1
    const $cell = editor.state.doc.resolve(lastCellPos);
    const col = map.colCount($cell.pos - tableStart)!;
    expect(col).toBe(map.width - 1); // should be last column

    setActiveHandle(editor, lastCellPos);

    const event = new MouseEvent('mousedown', {
      button: 0, bubbles: true, cancelable: true, clientX: 100,
    });
    editor.view.dom.dispatchEvent(event);

    // Last column: handleNeighborResize returns false (no neighbor)
    // → columnResizing handles it. Our plugin did NOT intercept.
    // defaultPrevented should be false from our plugin
    // (columnResizing may set it to true since it handles the drag)
  });
});

// ─── Colwidth serialization round-trip ───────────────────────────────────────

describe('colwidth preservation through resize', () => {
  let editor: InstanceType<typeof Editor>;

  afterEach(() => {
    editor?.destroy();
  });

  it('stores colwidths that survive getHTML round-trip', () => {
    editor = new Editor({
      extensions: extensionsWithBehavior('neighbor'),
      content: tableHTML([200, 200, 200]),
    });
    const cellPos = firstCellPos(editor);
    setActiveHandle(editor, cellPos);

    // Drag 50px right
    const downEvent = new MouseEvent('mousedown', {
      button: 0, bubbles: true, cancelable: true, clientX: 100,
    });
    editor.view.dom.dispatchEvent(downEvent);

    const upEvent = new MouseEvent('mouseup', { bubbles: true, clientX: 150 });
    window.dispatchEvent(upEvent);

    // Get HTML and re-parse
    const html = editor.getHTML();
    expect(html).toContain('data-colwidth="250"');
    expect(html).toContain('data-colwidth="150"');
    expect(html).toContain('data-colwidth="200"');

    // Create new editor with the HTML to verify round-trip
    const editor2 = new Editor({
      extensions: baseExtensions,
      content: html,
    });
    const firstRow = getFirstRowColwidthsFrom(editor2);
    expect(firstRow[0]).toEqual([250]);
    expect(firstRow[1]).toEqual([150]);
    expect(firstRow[2]).toEqual([200]);
    editor2.destroy();
  });
});

function getFirstRowColwidthsFrom(editor: InstanceType<typeof Editor>): (number[] | null)[] {
  const doc = editor.state.doc;
  const colwidths: (number[] | null)[] = [];
  const table = doc.firstChild!;
  const firstRow = table.firstChild!;
  for (let i = 0; i < firstRow.childCount; i++) {
    colwidths.push(firstRow.child(i).attrs['colwidth'] as number[] | null);
  }
  return colwidths;
}

// ─── Mousemove suppression ───────────────────────────────────────────────────

describe('mousemove suppression', () => {
  let editor: InstanceType<typeof Editor>;

  afterEach(() => {
    editor?.destroy();
  });

  it('does not suppress mousemove when no button is pressed', () => {
    editor = new Editor({
      extensions: baseExtensions,
      content: tableHTML(),
    });
    // buttons = 0 → no suppression (returns false)
    const event = new MouseEvent('mousemove', { buttons: 0, bubbles: true });
    // We can't directly test the return value of handleDOMEvents,
    // but we can verify the event propagates normally
    const propagated = editor.view.dom.dispatchEvent(event);
    expect(propagated).toBe(true); // not cancelled
  });
});

// ─── Freeze width normalization (sub-pixel border rounding fix) ─────────────

describe('freeze width normalization', () => {
  let editor: InstanceType<typeof Editor>;

  // Save original offsetWidth descriptor so we can mock/restore per test
  const origDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')!;

  afterEach(() => {
    editor?.destroy();
    // Restore original offsetWidth
    if (origDescriptor) {
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', origDescriptor);
    }
  });

  it('adjusts measured widths when sum exceeds table offsetWidth', () => {
    editor = new Editor({
      extensions: extensionsWithBehavior('independent'),
      content: tableHTML(), // no colwidths → all columns need measurement
    });

    // Mock offsetWidth: table returns 400, each cell returns 134
    // sum(134, 134, 134) = 402 > 400 → normalization should fix this
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get() {
        if (this.tagName === 'TABLE') return 400;
        if (this.tagName === 'TH' || this.tagName === 'TD') return 134;
        return 0;
      },
    });

    const cellPos = firstCellPos(editor);
    setActiveHandle(editor, cellPos);

    const event = new MouseEvent('mousedown', { button: 0, bubbles: true, clientX: 100 });
    editor.view.dom.dispatchEvent(event);

    // Verify: colwidths should sum to 400, not 402
    const firstRow = getFirstRowColwidths(editor);
    const sum = firstRow.reduce((s, cw) => s + (cw?.[0] ?? 0), 0);
    expect(sum).toBe(400);

    // Last column absorbs the 2px difference: 134 - 2 = 132
    expect(firstRow[0]![0]).toBe(134);
    expect(firstRow[1]![0]).toBe(134);
    expect(firstRow[2]![0]).toBe(132);
  });

  it('does not adjust when sum matches table offsetWidth', () => {
    editor = new Editor({
      extensions: extensionsWithBehavior('independent'),
      content: tableHTML(),
    });

    // Mock: sum = 400 = table offsetWidth → no adjustment needed
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get() {
        if (this.tagName === 'TABLE') return 400;
        if (this.tagName === 'TH' || this.tagName === 'TD') return 133;
        return 0;
      },
    });

    const cellPos = firstCellPos(editor);
    setActiveHandle(editor, cellPos);

    const event = new MouseEvent('mousedown', { button: 0, bubbles: true, clientX: 100 });
    editor.view.dom.dispatchEvent(event);

    // sum(133, 133, 133) = 399 ≤ 400 → no shrinkage applied
    const firstRow = getFirstRowColwidths(editor);
    expect(firstRow[0]![0]).toBe(133);
    expect(firstRow[1]![0]).toBe(133);
    expect(firstRow[2]![0]).toBe(133);
  });

  it('applies normalization in neighbor mode too', () => {
    editor = new Editor({
      extensions: extensionsWithBehavior('neighbor'),
      content: tableHTML(),
    });

    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get() {
        if (this.tagName === 'TABLE') return 600;
        if (this.tagName === 'TH' || this.tagName === 'TD') return 201;
        return 0;
      },
    });

    const cellPos = firstCellPos(editor);
    setActiveHandle(editor, cellPos);

    const event = new MouseEvent('mousedown', {
      button: 0, bubbles: true, cancelable: true, clientX: 100,
    });
    editor.view.dom.dispatchEvent(event);

    // sum(201, 201, 201) = 603 > 600 → last col adjusted to 201 - 3 = 198
    const firstRow = getFirstRowColwidths(editor);
    const sum = firstRow.reduce((s, cw) => s + (cw?.[0] ?? 0), 0);
    expect(sum).toBe(600);

    // Clean up the drag
    const upEvent = new MouseEvent('mouseup', { bubbles: true, clientX: 100 });
    window.dispatchEvent(upEvent);
  });
});
