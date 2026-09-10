/**
 * prosemirror-tables' tableEditing and columnResizing plugins, held back from
 * tables that hold a span loading would replace.
 *
 * prosemirror-tables reads colspan and rowspan as stored and builds a table
 * map from them, cell by cell for every spanned row and column. On a span
 * that is not a whole number from 1 to 1,000, such as one a collaborative
 * document holds from an older client or a crafted update, fixTables deletes
 * cells (`-1`), multiplies columns (`"2"`) or makes clients disagree (`1.5`,
 * `"abc"`), a cell paste deletes a neighbouring cell or throws "No cell with
 * offset", and a colspan of a million builds a map of gigabytes, all without
 * a diagnostic. Such a table is left to text editing until
 * normalizeContentAttributes replaces the span: no fixTables, no cell
 * selection from the mouse or the keyboard, no column resize, and the table
 * commands refuse it (see Table.ts). The next change after the migration lets
 * fixTables repair the structure as usual.
 */
import { NodeSelection, Plugin, Selection, TextSelection } from '@domternal/pm/state';
import type { EditorState, Transaction } from '@domternal/pm/state';
import type { EditorProps, EditorView } from '@domternal/pm/view';
import type { Node as PMNode, ResolvedPos } from '@domternal/pm/model';
import { columnResizing, columnResizingPluginKey, tableEditing } from '@domternal/pm/tables';
import { MAX_SPAN } from './cellAttributes.js';

type TableEditingOptions = NonNullable<Parameters<typeof tableEditing>[0]>;

const supported = (value: unknown): boolean =>
  Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= MAX_SPAN;

// Rows are shared between document versions, so typing in one cell rescans one row.
const rowsHoldingUnsupportedSpans = new WeakMap<PMNode, boolean>();

function rowHoldsUnsupportedSpan(row: PMNode): boolean {
  let holds = rowsHoldingUnsupportedSpans.get(row);
  if (holds === undefined) {
    holds = false;
    row.forEach(cell => {
      if (!supported(cell.attrs['colspan']) || !supported(cell.attrs['rowspan'])) holds = true;
    });
    rowsHoldingUnsupportedSpans.set(row, holds);
  }
  return holds;
}

/** Whether a table holds a cell whose span loading would replace. */
export function tableHoldsUnsupportedSpan(table: PMNode): boolean {
  let holds = false;
  table.forEach(row => { if (!holds && rowHoldsUnsupportedSpan(row)) holds = true; });
  return holds;
}

/** Whether `found` returns true for a descendant of the node, stopping at the first. */
function someDescendant(node: PMNode, found: (node: PMNode) => boolean): boolean {
  const result = { hit: false };
  node.descendants(child => {
    if (!result.hit) result.hit = found(child);
    return !result.hit;
  });
  return result.hit;
}

/**
 * Calls `found` for every node of `current` that is not shared with `previous`,
 * the way fixTables walks a changed document (after prosemirror-tables'
 * changedDescendants, MIT License, see THIRD-PARTY-LICENSES.md), and stops
 * once `found` returns true.
 */
function someChangedDescendant(previous: PMNode, current: PMNode, found: (node: PMNode) => boolean): boolean {
  const oldSize = previous.childCount;
  outer: for (let i = 0, j = 0; i < current.childCount; i++) {
    const child = current.child(i);
    for (let scan = j, end = Math.min(oldSize, i + 3); scan < end; scan++) {
      if (previous.child(scan) === child) {
        j = scan + 1;
        continue outer;
      }
    }
    if (found(child)) return true;
    if (j < oldSize && previous.child(j).sameMarkup(child)) {
      if (someChangedDescendant(previous.child(j), child, found)) return true;
    } else if (someDescendant(child, found)) {
      return true;
    }
  }
  return false;
}

/** Whether a table that changed between the documents holds a span loading would replace. */
export function changedTableHoldsUnsupportedSpan(previous: PMNode, current: PMNode): boolean {
  if (previous === current) return false;
  return someChangedDescendant(previous, current, node => node.type.spec['tableRole'] === 'table' && tableHoldsUnsupportedSpan(node));
}

/** Whether the nearest table around a position holds an unsupported span. */
export function inUnsupportedTable($pos: ResolvedPos): boolean {
  for (let depth = $pos.depth; depth >= 0; depth--) {
    const node = $pos.node(depth);
    if (node.type.spec['tableRole'] === 'table') return tableHoldsUnsupportedSpan(node);
  }
  return false;
}

/**
 * Whether a selection touches a table that holds an unsupported span: its ends
 * sit in such a table, or it selects such a table.
 */
export function selectionInUnsupportedTable(state: EditorState): boolean {
  const { selection } = state;
  if (selection instanceof NodeSelection && selection.node.type.spec['tableRole'] === 'table' && tableHoldsUnsupportedSpan(selection.node)) return true;
  return inUnsupportedTable(selection.$from) || inUnsupportedTable(selection.$to);
}

/** The depth of the nearest cell around a position, when its table holds an unsupported span. */
function unsupportedCellDepth($pos: ResolvedPos): number | undefined {
  for (let depth = $pos.depth; depth >= 2; depth--) {
    const role = $pos.node(depth).type.spec['tableRole'] as string | undefined;
    if (role === 'cell' || role === 'header_cell') return tableHoldsUnsupportedSpan($pos.node(depth - 2)) ? depth : undefined;
  }
  return undefined;
}

/** The depth of the nearest table around a position, when it holds an unsupported span. */
function unsupportedTableDepth($pos: ResolvedPos): number | undefined {
  for (let depth = $pos.depth; depth >= 1; depth--) {
    const node = $pos.node(depth);
    if (node.type.spec['tableRole'] === 'table') return tableHoldsUnsupportedSpan(node) ? depth : undefined;
  }
  return undefined;
}

/**
 * A text selection that crosses a cell of a table that holds an unsupported span, as a mouse drag
 * makes where no cell selection can be made, reduced so that typing over it, deleting it or
 * pasting over it cannot join or delete cells, which fixTables would not repair: one that starts
 * in such a cell ends in that cell, and one that starts outside such a table ends before it.
 * Null when the selection needs no change.
 */
export function selectionWithinCells(state: EditorState): Selection | null {
  const { selection, doc } = state;
  if (!(selection instanceof TextSelection) || selection.empty) return null;
  const { $anchor, $head } = selection;
  const cell = unsupportedCellDepth($anchor);
  if (cell !== undefined) {
    const start = $anchor.start(cell);
    const end = $anchor.end(cell);
    if ($head.pos >= start && $head.pos <= end) return null;
    const edge = $head.pos > end ? Selection.findFrom(doc.resolve(end), -1, true) : Selection.findFrom(doc.resolve(start), 1, true);
    return TextSelection.create(doc, $anchor.pos, edge?.head ?? $anchor.pos);
  }
  const table = unsupportedTableDepth($head);
  if (table === undefined) return null;
  const outside = $anchor.pos < $head.before(table)
    ? Selection.findFrom(doc.resolve($head.before(table)), -1, true)
    : Selection.findFrom(doc.resolve($head.after(table)), 1, true);
  return TextSelection.create(doc, $anchor.pos, outside?.head ?? $anchor.pos);
}

/** Whether a mouse event targets a cell of a table that holds an unsupported span. */
function eventInUnsupportedTable(view: EditorView, event: Event): boolean {
  const target = event.target;
  const cell = target instanceof Element ? target.closest('td, th') : null;
  if (cell === null || !view.dom.contains(cell)) return false;
  let pos: number;
  try {
    pos = view.posAtDOM(cell, 0);
  } catch {
    return false;
  }
  return inUnsupportedTable(view.state.doc.resolve(pos));
}

/** Whether the column resize handle sits in a table that holds an unsupported span. */
export function resizeHandleInUnsupportedTable(state: EditorState): boolean {
  const handle = (columnResizingPluginKey.getState(state) as { activeHandle: number } | undefined)?.activeHandle ?? -1;
  return handle > -1 && handle <= state.doc.content.size && inUnsupportedTable(state.doc.resolve(handle));
}

type DOMEventHandler = (view: EditorView, event: Event) => unknown;

/**
 * tableEditing, left out of a table that holds an unsupported span: fixTables
 * and selection normalization skip it, and its mouse, triple click, key and
 * paste handlers leave events in it to the editor's text handling.
 */
export function guardedTableEditing(options: TableEditingOptions = {}): Plugin {
  const editing = tableEditing(options);
  const append = editing.spec.appendTransaction;
  const props: EditorProps<Plugin> = editing.spec.props ?? {};
  const mousedown = props.handleDOMEvents?.mousedown as DOMEventHandler | undefined;
  const { handleTripleClick, handleKeyDown, handlePaste } = props;
  return new Plugin({
    ...editing.spec,
    props: {
      ...props,
      handleDOMEvents: {
        ...props.handleDOMEvents,
        mousedown: (view, event) => {
          if (eventInUnsupportedTable(view, event) || selectionInUnsupportedTable(view.state)) return false;
          return mousedown?.(view, event) === true;
        },
      },
      handleTripleClick(this: Plugin, view, pos, event) {
        return !inUnsupportedTable(view.state.doc.resolve(pos)) && (handleTripleClick?.call(this, view, pos, event) ?? false);
      },
      handleKeyDown(this: Plugin, view, event) {
        return !selectionInUnsupportedTable(view.state) && (handleKeyDown?.call(this, view, event) ?? false);
      },
      handlePaste(this: Plugin, view, event, slice) {
        return !selectionInUnsupportedTable(view.state) && (handlePaste?.call(this, view, event, slice) ?? false);
      },
    },
    appendTransaction(this: Plugin, transactions: readonly Transaction[], oldState: EditorState, newState: EditorState) {
      if (!append) return null;
      // A selection there is not normalized, which can build that table's map; a text selection
      // across its cells is kept within one cell instead.
      if (selectionInUnsupportedTable(newState)) {
        const within = selectionWithinCells(newState);
        return within === null ? null : newState.tr.setSelection(within);
      }
      // Handing the new state over as the old one leaves fixTables nothing changed to fix.
      const skip = changedTableHoldsUnsupportedSpan(oldState.doc, newState.doc);
      return append.call(this, transactions, skip ? newState : oldState, newState);
    },
  });
}

type ColumnResizingOptions = NonNullable<Parameters<typeof columnResizing>[0]>;

/**
 * columnResizing, left out of a table that holds an unsupported span: hovering
 * its cell borders offers no handle, a handle set before it came to hold one
 * draws and drags nothing, and moving into it clears the handle.
 */
export function guardedColumnResizing(options: ColumnResizingOptions = {}): Plugin {
  const resizing = columnResizing(options);
  const props: EditorProps<Plugin> = resizing.spec.props ?? {};
  const events = props.handleDOMEvents ?? {};
  const mousemove = events.mousemove as DOMEventHandler | undefined;
  const mousedown = events.mousedown as DOMEventHandler | undefined;
  const decorations = props.decorations;
  return new Plugin({
    ...resizing.spec,
    props: {
      ...props,
      handleDOMEvents: {
        ...events,
        mousemove: (view, event) => {
          if (!eventInUnsupportedTable(view, event)) return mousemove?.(view, event) === true;
          if (((columnResizingPluginKey.getState(view.state) as { activeHandle: number } | undefined)?.activeHandle ?? -1) > -1) {
            view.dispatch(view.state.tr.setMeta(columnResizingPluginKey, { setHandle: -1 }));
          }
          return false;
        },
        mousedown: (view, event) => !resizeHandleInUnsupportedTable(view.state) && mousedown?.(view, event) === true,
      },
      decorations(this: Plugin, state: EditorState) {
        if (resizeHandleInUnsupportedTable(state)) return null;
        return decorations?.call(this, state) ?? null;
      },
    },
  });
}
