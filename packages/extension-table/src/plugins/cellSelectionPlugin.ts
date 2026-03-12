/**
 * Cell-selection UI plugin.
 *
 * Responsibilities:
 * 1. Focused-cell decoration — adds `dm-cell-focused` class on the cell
 *    containing the cursor (not during CellSelection).
 * 2. Cell toolbar visibility — shows/hides the floating cell toolbar strip
 *    when CellSelection is active.
 * 3. Cell handle visibility — shows/hides the small circle handle when the
 *    cursor rests inside a single table cell.
 * 4. Column-resize coordination — hides all handles/menus during active
 *    column resize drag.
 */

import { Plugin, PluginKey, type PluginView } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import { CellSelection } from 'prosemirror-tables';
import { type TableView, tableViewMap } from '../TableView.js';

const pluginKey = new PluginKey<DecorationSet>('cellSelection');

/** Resolve the DOM element at a ProseMirror position (text nodes → parentElement). */
function domElementAt(view: EditorView, pos: number): HTMLElement | null {
  const { node } = view.domAtPos(pos);
  return node instanceof HTMLElement ? node : node.parentElement;
}

export function createCellSelectionPlugin(): Plugin {
  return new Plugin({
    key: pluginKey,
    state: {
      init() { return DecorationSet.empty; },
      apply(_tr, _set, _oldState, newState) {
        const sel = newState.selection;
        if (sel instanceof CellSelection) return DecorationSet.empty;
        const $from = sel.$from;
        for (let d = $from.depth; d > 0; d--) {
          const name = $from.node(d).type.name;
          if (name === 'tableCell' || name === 'tableHeader') {
            const pos = $from.before(d);
            const deco = Decoration.node(pos, pos + $from.node(d).nodeSize, { class: 'dm-cell-focused' });
            return DecorationSet.create(newState.doc, [deco]);
          }
        }
        return DecorationSet.empty;
      },
    },
    props: {
      decorations(state) { return pluginKey.getState(state); },
    },
    view: (): PluginView => {
      let lastToolbarView: TableView | null = null;
      let lastHandleView: TableView | null = null;
      let resizingView: TableView | null = null;
      return {
        update: (view: EditorView) => {
          // Detect column resize drag (prosemirror-tables adds column-resize-dragging
          // decoration only during active drag, not on mere hover near border)
          const draggingCell = view.dom.querySelector('.column-resize-dragging');
          if (draggingCell) {
            const container = draggingCell.closest<HTMLElement>('.dm-table-container');
            const tv = container ? tableViewMap.get(container) : undefined;
            if (tv && tv !== resizingView) {
              tv.hideForResize();
              resizingView = tv;
            }
            return; // skip all handle/toolbar logic during resize
          } else if (resizingView) {
            resizingView.showAfterResize();
            resizingView = null;
          }

          const sel = view.state.selection;
          if (sel instanceof CellSelection) {
            // CellSelection → show toolbar (unless suppressed by row/col handle), hide cell handle
            const anchorPos = sel.$anchorCell.pos;
            const el = domElementAt(view, anchorPos + 1);
            const container = el?.closest<HTMLElement>('.dm-table-container');
            const tv = container ? tableViewMap.get(container) : undefined;
            if (tv) {
              if (!tv.suppressCellToolbar) {
                tv.updateCellHandle(true);
              }
              tv.hideCellHandle();
              lastToolbarView = tv;
            }
            if (lastHandleView && lastHandleView !== tv) {
              lastHandleView.hideCellHandle();
            }
            lastHandleView = null;
          } else {
            // Not CellSelection → hide toolbar
            if (lastToolbarView) {
              lastToolbarView.updateCellHandle(false);
              lastToolbarView = null;
            }

            // Check if TextSelection is inside a table cell → show cell handle
            const $from = sel.$from;
            let inCell = false;
            for (let d = $from.depth; d > 0; d--) {
              const name = $from.node(d).type.name;
              if (name === 'tableCell' || name === 'tableHeader') {
                inCell = true;
                break;
              }
            }

            if (inCell && sel.empty) {
              // Only show cell handle for cursor (empty selection).
              // During text selection the handle would be distracting.
              const domEl = domElementAt(view, $from.pos);
              const cellEl = domEl?.closest<HTMLTableCellElement>('td, th');
              const container = cellEl?.closest<HTMLElement>('.dm-table-container');
              const tv = container ? tableViewMap.get(container) : undefined;
              if (tv && cellEl) {
                tv.showCellHandle(cellEl);
                if (lastHandleView && lastHandleView !== tv) {
                  lastHandleView.hideCellHandle();
                }
                lastHandleView = tv;
              }
            } else {
              if (lastHandleView) {
                lastHandleView.hideCellHandle();
                lastHandleView = null;
              }
            }
          }
        },
      };
    },
  });
}
