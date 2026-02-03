/**
 * FloatingMenu Extension
 *
 * Shows a floating menu when the cursor is in an empty paragraph.
 * Useful for showing block-level insertion options.
 *
 * @example
 * ```ts
 * import { FloatingMenu } from '@domternal/core';
 *
 * // Create menu element
 * const menuElement = document.getElementById('floating-menu');
 *
 * const editor = new Editor({
 *   extensions: [
 *     // ... other extensions
 *     FloatingMenu.configure({
 *       element: menuElement,
 *       shouldShow: ({ editor, state }) => {
 *         const { $from, empty } = state.selection;
 *         // Show in empty paragraphs
 *         return empty &&
 *           $from.parent.type.name === 'paragraph' &&
 *           $from.parent.content.size === 0;
 *       },
 *     }),
 *   ],
 * });
 * ```
 *
 * ## CSS Required
 *
 * Style your menu element:
 * ```css
 * .floating-menu {
 *   background: white;
 *   border: 1px solid #ccc;
 *   border-radius: 4px;
 *   padding: 4px;
 *   box-shadow: 0 2px 8px rgba(0,0,0,0.15);
 * }
 * ```
 */
import { Extension } from '../Extension.js';
import { Plugin, PluginKey } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { EditorState } from 'prosemirror-state';
import type { Editor } from '../Editor.js';

export const floatingMenuPluginKey = new PluginKey('floatingMenu');

// Default shouldShow: empty paragraph with cursor
function defaultShouldShow({
  state,
}: {
  editor: Editor;
  view: EditorView;
  state: EditorState;
}): boolean {
  const { selection } = state;
  const { $from, empty } = selection;

  // Must be empty selection
  if (!empty) return false;

  // Must be in a paragraph
  if ($from.parent.type.name !== 'paragraph') return false;

  // Paragraph must be empty
  if ($from.parent.content.size !== 0) return false;

  // Must be at the start of the paragraph
  if ($from.parentOffset !== 0) return false;

  return true;
}

export interface FloatingMenuOptions {
  /**
   * The HTML element that contains the menu.
   * Must be provided by the user.
   */
  element: HTMLElement | null;

  /**
   * Function to determine if the menu should be shown.
   * By default, shows when the cursor is in an empty paragraph.
   */
  shouldShow: (props: {
    editor: Editor;
    view: EditorView;
    state: EditorState;
  }) => boolean;

  /**
   * Offset in pixels from the cursor position [x, y].
   * @default [0, 0]
   */
  offset: [number, number];

  /**
   * Additional options for positioning.
   */
  tippyOptions: {
    zIndex?: number;
    appendTo?: Element | (() => Element);
  };
}

export const FloatingMenu = Extension.create<FloatingMenuOptions>({
  name: 'floatingMenu',

  addOptions() {
    return {
      element: null,
      shouldShow: defaultShouldShow,
      offset: [0, 0] as [number, number],
      tippyOptions: {},
    };
  },

  addProseMirrorPlugins() {
    const { element, shouldShow, offset, tippyOptions } = this.options;

    if (!element) {
      console.warn(
        '[FloatingMenu] No element provided. Menu will not be rendered.'
      );
      return [];
    }

    const editor = this.editor as Editor;

    const updatePosition = (view: EditorView) => {
      const { from } = view.state.selection;
      const coords = view.coordsAtPos(from);

      element.style.position = 'fixed';
      element.style.top = `${coords.top + offset[1]}px`;
      element.style.left = `${coords.left + offset[0]}px`;
      element.style.zIndex = String(tippyOptions?.zIndex ?? 9999);
      element.style.visibility = 'visible';
      element.style.opacity = '1';
    };

    const hideMenu = () => {
      element.style.visibility = 'hidden';
      element.style.opacity = '0';
    };

    // Initially hide
    hideMenu();

    return [
      new Plugin({
        key: floatingMenuPluginKey,

        view: () => ({
          update: (view) => {
            const visible = shouldShow({
              editor,
              view,
              state: view.state,
            });

            if (visible) {
              updatePosition(view);
            } else {
              hideMenu();
            }
          },

          destroy: () => {
            hideMenu();
          },
        }),
      }),
    ];
  },
});
