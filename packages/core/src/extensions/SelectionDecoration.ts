/**
 * SelectionDecoration Extension
 *
 * Shows a visible highlight on the editor's selection when the editor loses focus.
 * By default, browsers remove the selection highlight on blur, but ProseMirror keeps
 * the selection internally. This extension adds inline decorations so the user can
 * still see what's selected while interacting with toolbar buttons or other UI.
 */
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { Extension } from '../Extension.js';

export interface SelectionDecorationOptions {
  /**
   * CSS class applied to the blur-selection decoration.
   * @default 'dm-blur-selection'
   */
  className: string;
}

export const selectionDecorationPluginKey = new PluginKey(
  'selectionDecoration'
);

export const SelectionDecoration = Extension.create<SelectionDecorationOptions>(
  {
    name: 'selectionDecoration',

    addOptions() {
      return {
        className: 'dm-blur-selection',
      };
    },

    addProseMirrorPlugins() {
      const className = this.options.className;
      const pluginKey = selectionDecorationPluginKey;

      return [
        new Plugin({
          key: pluginKey,
          state: {
            init: () => DecorationSet.empty,
            apply(tr, decorationSet, _oldState, newState) {
              const meta = tr.getMeta(pluginKey);

              if (meta === 'focus') return DecorationSet.empty;

              if (meta === 'blur') {
                const { from, to } = newState.selection;
                if (from === to) return DecorationSet.empty;
                return DecorationSet.create(newState.doc, [
                  Decoration.inline(from, to, { class: className }),
                ]);
              }

              return tr.docChanged
                ? decorationSet.map(tr.mapping, tr.doc)
                : decorationSet;
            },
          },
          props: {
            decorations(state) {
              return this.getState(state) ?? DecorationSet.empty;
            },
            handleDOMEvents: {
              blur(view) {
                view.dispatch(view.state.tr.setMeta(pluginKey, 'blur'));
                return false;
              },
              focus(view) {
                view.dispatch(view.state.tr.setMeta(pluginKey, 'focus'));
                return false;
              },
            },
          },
        }),
      ];
    },
  }
);
