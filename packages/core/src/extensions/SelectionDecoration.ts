/**
 * SelectionDecoration Extension
 *
 * Collapses the editor's range selection to a cursor when the editor loses
 * focus.  This prevents a "ghost selection" from lingering after the user
 * clicks outside the editor (approach A - same as Google Docs / Notion).
 *
 * Toolbar and bubble-menu buttons call `event.preventDefault()` on
 * `mousedown`, so they never trigger blur — the selection stays intact
 * while the user interacts with editor UI.
 */
import { Plugin, PluginKey, TextSelection } from '@domternal/pm/state';
import { Extension } from '../Extension.js';

export interface SelectionDecorationOptions {}

export const selectionDecorationPluginKey = new PluginKey(
  'selectionDecoration'
);

export const SelectionDecoration = Extension.create<SelectionDecorationOptions>(
  {
    name: 'selectionDecoration',

    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: selectionDecorationPluginKey,
          props: {
            handleDOMEvents: {
              blur(view, event) {
                // Don't collapse selection when focus moves to editor-related
                // UI (e.g. link popover input). Elements marked with
                // [data-dm-editor-ui] are treated as part of the editor.
                const related = event.relatedTarget;
                if (
                  related instanceof HTMLElement &&
                  related.closest('[data-dm-editor-ui]')
                ) {
                  return false;
                }

                const { from, to } = view.state.selection;
                if (from !== to) {
                  view.dispatch(
                    view.state.tr.setSelection(
                      TextSelection.create(view.state.doc, from)
                    )
                  );
                }
                return false;
              },
            },
          },
        }),
      ];
    },
  }
);
