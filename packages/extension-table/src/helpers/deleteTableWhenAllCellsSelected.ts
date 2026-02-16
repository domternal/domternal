/**
 * Keyboard handler that deletes the table when all cells are selected.
 *
 * Used for Backspace, Delete, Mod-Backspace, Mod-Delete.
 * When a CellSelection covers all cells in a table, delete the entire table.
 */

import { CellSelection, findTable } from 'prosemirror-tables';
import { TextSelection } from 'prosemirror-state';
import type { EditorState, Transaction } from 'prosemirror-state';

export function deleteTableWhenAllCellsSelected({
  state,
  dispatch,
}: {
  state: EditorState;
  dispatch?: (tr: Transaction) => void;
}): boolean {
  const { selection } = state;

  if (!(selection instanceof CellSelection)) {
    return false;
  }

  // Check: is the full table selected?
  let cellCount = 0;
  const table = findTable(selection.$anchorCell);

  if (!table) {
    return false;
  }

  table.node.descendants((node) => {
    const role = (node.type.spec as Record<string, unknown>)['tableRole'];
    if (role === 'cell' || role === 'header_cell') {
      cellCount++;
    }
  });

  const selectionCellCount = selection.ranges.length;

  if (cellCount !== selectionCellCount) {
    return false;
  }

  if (dispatch) {
    const tr = state.tr;
    tr.delete(table.pos, table.pos + table.node.nodeSize);

    // Place cursor at the position where the table was
    const $pos = tr.doc.resolve(Math.min(table.pos, tr.doc.content.size));
    const newSelection = TextSelection.near($pos);
    tr.setSelection(newSelection);

    dispatch(tr);
  }

  return true;
}
