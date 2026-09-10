/**
 * Pastes cells into tables ahead of prosemirror-tables' tableEditing, whose
 * own paste handler throws "No cell with offset" when a pasted cell spans rows
 * up to the table's right edge and then pastes nothing. See helpers/pasteCells.ts.
 */
import { Plugin, PluginKey } from '@domternal/pm/state';
import { handleTablePaste } from '../helpers/pasteCells.js';

export const tableCellPastePluginKey = new PluginKey('tableCellPaste');

export function createTableCellPastePlugin(): Plugin {
  return new Plugin({
    key: tableCellPastePluginKey,
    props: {
      handlePaste: (view, _event, slice) => handleTablePaste(view, slice),
    },
  });
}
