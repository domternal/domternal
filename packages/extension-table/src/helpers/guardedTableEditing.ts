/**
 * prosemirror-tables' tableEditing plugin with fixTables held back for
 * tables that hold a span loading would replace.
 *
 * After every document change, tableEditing runs fixTables on the tables that
 * changed. fixTables reads colspan and rowspan as stored, so on a span that
 * is not a whole number from 1 to 1,000, such as one a collaborative document
 * holds from an older client, it deletes cells (`-1`), multiplies columns
 * (`"2"`), makes clients disagree (`1.5`, `"abc"`) or builds a table map of
 * millions of entries (`1e6`), without a diagnostic. Such a table is left to
 * normalizeContentAttributes, which replaces the span; the next change then
 * lets fixTables repair the structure as usual. Selection normalization still
 * runs.
 */
import { Plugin } from '@domternal/pm/state';
import type { EditorState, Transaction } from '@domternal/pm/state';
import type { Node as PMNode } from '@domternal/pm/model';
import { tableEditing } from '@domternal/pm/tables';
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

/** tableEditing, whose fixTables leaves a table that holds an unsupported span alone. */
export function guardedTableEditing(options: TableEditingOptions = {}): Plugin {
  const editing = tableEditing(options);
  const append = editing.spec.appendTransaction;
  return new Plugin({
    ...editing.spec,
    appendTransaction(this: Plugin, transactions: readonly Transaction[], oldState: EditorState, newState: EditorState) {
      if (!append) return null;
      // Handing the new state over as the old one leaves fixTables nothing changed to fix.
      const skip = changedTableHoldsUnsupportedSpan(oldState.doc, newState.doc);
      return append.call(this, transactions, skip ? newState : oldState, newState);
    },
  });
}
