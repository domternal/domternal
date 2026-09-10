/**
 * Pastes cells into tables ahead of prosemirror-tables' tableEditing, whose
 * own paste handler throws "No cell with offset" when a pasted cell spans rows
 * up to the table's right edge and then pastes nothing. See helpers/pasteCells.ts.
 *
 * A paste whose image files are the paste, one whose content has no text of
 * its own as Core decides, goes to the view's image destination first, so a
 * screenshot pasted over a cell selection is inserted whether Table or the
 * image node comes first, instead of clearing the cells and inserting nothing.
 */
import { Plugin, PluginKey } from '@domternal/pm/state';
import { pasteClipboardImageFiles } from '@domternal/core/clipboard';
import { handleTablePaste } from '../helpers/pasteCells.js';

export const tableCellPastePluginKey = new PluginKey('tableCellPaste');

export function createTableCellPastePlugin(): Plugin {
  return new Plugin({
    key: tableCellPastePluginKey,
    props: {
      handlePaste: (view, event, slice) => pasteClipboardImageFiles(view, event, slice) || handleTablePaste(view, slice),
    },
  });
}
