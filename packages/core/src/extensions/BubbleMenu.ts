/**
 * BubbleMenu Extension
 *
 * Shows a floating menu when text is selected in the editor.
 * Useful for formatting toolbars that appear contextually.
 *
 * @example
 * ```ts
 * import { BubbleMenu } from '@domternal/core';
 *
 * // Create menu element
 * const menuElement = document.getElementById('bubble-menu');
 *
 * const editor = new Editor({
 *   extensions: [
 *     // ... other extensions
 *     BubbleMenu.configure({
 *       element: menuElement,
 *       shouldShow: ({ editor, state, from, to }) => {
 *         // Only show for text selections
 *         return !state.selection.empty;
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
 * .bubble-menu {
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

export const bubbleMenuPluginKey = new PluginKey('bubbleMenu');

export interface BubbleMenuOptions {
  /**
   * The HTML element that contains the menu.
   * Must be provided by the user.
   */
  element: HTMLElement | null;

  /**
   * Duration in ms to wait before showing the menu.
   * @default 0
   */
  updateDelay: number;

  /**
   * Function to determine if the menu should be shown.
   * @default () => true (shows when selection is not empty)
   */
  shouldShow: (props: {
    editor: Editor;
    view: EditorView;
    state: EditorState;
    from: number;
    to: number;
  }) => boolean;

  /**
   * Placement of the menu relative to the selection.
   * @default 'top'
   */
  placement: 'top' | 'bottom';

  /**
   * Offset in pixels from the selection [x, y].
   * @default [0, 8]
   */
  offset: [number, number];
}

interface BubbleMenuPluginState {
  visible: boolean;
  from: number;
  to: number;
}

export const BubbleMenu = Extension.create<BubbleMenuOptions>({
  name: 'bubbleMenu',

  addOptions() {
    return {
      element: null,
      updateDelay: 0,
      shouldShow: ({ state }) => !state.selection.empty,
      placement: 'top' as const,
      offset: [0, 8] as [number, number],
    };
  },

  addProseMirrorPlugins() {
    const { element, updateDelay, shouldShow, placement, offset } =
      this.options;

    if (!element) {
      return [];
    }

    const editor = this.editor as Editor | null;
    let updateTimeout: ReturnType<typeof setTimeout> | null = null;

    const updatePosition = (view: EditorView, from: number, to: number): void => {
      // coordsAtPos returns viewport-relative (screen) coordinates
      const start = view.coordsAtPos(from);
      const end = view.coordsAtPos(to);

      const centerX = (start.left + end.left) / 2;
      const menuRect = element.getBoundingClientRect();

      // Compute offset from the element's offsetParent so positioning
      // works for both position:fixed and position:absolute elements.
      const offsetParent = element.offsetParent;
      const parentRect = offsetParent
        ? offsetParent.getBoundingClientRect()
        : { top: 0, left: 0 };

      let top: number;
      let left: number;

      if (placement === 'top') {
        top = start.top - menuRect.height - offset[1];
      } else {
        top = end.bottom + offset[1];
      }

      left = centerX - menuRect.width / 2 + offset[0];

      // Viewport boundary checks (in screen coordinates)
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      if (left < 10) left = 10;
      if (left + menuRect.width > viewportWidth - 10) {
        left = viewportWidth - menuRect.width - 10;
      }

      // Flip placement if menu would go off-screen
      if (placement === 'top' && top < 10) {
        top = end.bottom + offset[1];
      } else if (
        placement === 'bottom' &&
        top + menuRect.height > viewportHeight - 10
      ) {
        top = start.top - menuRect.height - offset[1];
      }

      // Convert viewport coordinates to offsetParent-relative coordinates
      element.style.top = `${String(top - parentRect.top)}px`;
      element.style.left = `${String(left - parentRect.left)}px`;
      element.setAttribute('data-show', '');
    };

    const hideMenu = (): void => {
      element.removeAttribute('data-show');
    };

    // Initially hide
    hideMenu();

    return [
      new Plugin({
        key: bubbleMenuPluginKey,

        state: {
          init: (): BubbleMenuPluginState => ({
            visible: false,
            from: 0,
            to: 0,
          }),
          apply: (_tr, _value, _oldState, newState): BubbleMenuPluginState => {
            if (!editor) {
              return { visible: false, from: 0, to: 0 };
            }

            const { selection } = newState;
            const { from, to } = selection;

            // Determine visibility
            const visible =
              !selection.empty &&
              shouldShow({
                editor,
                view: editor.view,
                state: newState,
                from,
                to,
              });

            return { visible, from, to };
          },
        },

        view: () => ({
          update: (view, prevState) => {
            const state = bubbleMenuPluginKey.getState(view.state) as
              | BubbleMenuPluginState
              | undefined;
            const prevPluginState = bubbleMenuPluginKey.getState(prevState) as
              | BubbleMenuPluginState
              | undefined;

            // Skip if nothing changed
            if (
              state?.visible === prevPluginState?.visible &&
              state?.from === prevPluginState?.from &&
              state?.to === prevPluginState?.to
            ) {
              return;
            }

            // Clear pending update
            if (updateTimeout) {
              clearTimeout(updateTimeout);
              updateTimeout = null;
            }

            if (state?.visible) {
              // Show menu with delay
              if (updateDelay > 0) {
                updateTimeout = setTimeout(() => {
                  updatePosition(view, state.from, state.to);
                }, updateDelay);
              } else {
                updatePosition(view, state.from, state.to);
              }
            } else {
              hideMenu();
            }
          },

          destroy: () => {
            if (updateTimeout) {
              clearTimeout(updateTimeout);
            }
            hideMenu();
          },
        }),
      }),
    ];
  },
});
