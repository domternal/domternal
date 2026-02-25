/**
 * BubbleMenu Extension
 *
 * Shows a floating menu when text is selected in the editor.
 * Useful for formatting toolbars that appear contextually.
 *
 * Styles are included automatically via `@domternal/theme` (`_bubble-menu.scss`).
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
 */
import { Extension } from '../Extension.js';
import { Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { EditorState } from 'prosemirror-state';
import type { Editor } from '../Editor.js';
import { positionFloating } from '../utils/positionFloating.js';

export const bubbleMenuPluginKey = new PluginKey('bubbleMenu');

// Default shouldShow: text selection with actual content in an editable editor
function defaultShouldShow({
  editor,
  state,
  from,
  to,
}: {
  editor: Editor;
  view: EditorView;
  state: EditorState;
  from: number;
  to: number;
}): boolean {
  const { selection } = state;

  // Must have a non-empty selection
  if (selection.empty) return false;

  // Must be a text selection (not NodeSelection for images/HR)
  if (!(selection instanceof TextSelection)) return false;

  // Must have actual text content (double-click empty paragraph produces from!=to but no text)
  if (!state.doc.textBetween(from, to).length) return false;

  // Don't show if editor is not editable
  if (!editor.isEditable) return false;

  return true;
}

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
   * By default, shows for text selections with actual content in an editable editor.
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

export interface CreateBubbleMenuPluginOptions {
  pluginKey: PluginKey;
  editor: Editor;
  element: HTMLElement;
  shouldShow?: BubbleMenuOptions['shouldShow'];
  placement?: 'top' | 'bottom';
  offset?: [number, number];
  updateDelay?: number;
}

/**
 * Creates a standalone BubbleMenu ProseMirror plugin.
 * Can be used by framework wrappers (Angular, React, Vue) to create the plugin
 * independently of the extension system.
 */
export function createBubbleMenuPlugin(options: CreateBubbleMenuPluginOptions): Plugin {
  const {
    pluginKey,
    editor,
    element,
    shouldShow = defaultShouldShow,
    placement = 'top',
    offset = [0, 8],
    updateDelay = 0,
  } = options;

  let updateTimeout: ReturnType<typeof setTimeout> | null = null;
  let cleanupFloating: (() => void) | null = null;

  const updatePosition = (view: EditorView, from: number, to: number): void => {
    // Clean up previous auto-update listeners
    cleanupFloating?.();

    // Virtual element with lazy getBoundingClientRect — re-computes
    // coordsAtPos on every call so autoUpdate tracks scroll correctly.
    const virtualEl = {
      getBoundingClientRect: () => {
        const start = view.coordsAtPos(from);
        const end = view.coordsAtPos(to);
        return new DOMRect(
          start.left,
          start.top,
          end.right - start.left,
          end.bottom - start.top,
        );
      },
    };

    cleanupFloating = positionFloating(virtualEl, element, {
      placement,
      offsetValue: offset[1],
    });

    element.setAttribute('data-show', '');
  };

  const hideMenu = (): void => {
    cleanupFloating?.();
    cleanupFloating = null;
    element.removeAttribute('data-show');
  };

  // When the user clicks outside the bubble menu and outside the editor
  // (e.g. on the toolbar), suppress the menu until the selection changes.
  let suppressed = false;

  const onDocumentMousedown = (e: MouseEvent): void => {
    const target = e.target as Node | null;
    if (!target) return;
    // Click inside bubble menu — ignore (handled by onMenuMousedown)
    if (element.contains(target)) return;
    // Click inside editor — let ProseMirror handle selection change
    if (editor.view.dom.contains(target)) return;
    // Outside both — hide and suppress until selection changes
    hideMenu();
    suppressed = true;
  };

  // Prevent blur when clicking inside the bubble menu
  const onMenuMousedown = (e: Event): void => {
    e.preventDefault();
  };

  // Initially hide
  hideMenu();

  return new Plugin({
    key: pluginKey,

    state: {
      init: (): BubbleMenuPluginState => ({
        visible: false,
        from: 0,
        to: 0,
      }),
      apply: (_tr, prevValue, _oldState, newState): BubbleMenuPluginState => {
        const { selection } = newState;
        const { from, to } = selection;

        // Reset suppression when the selection range changes
        if (from !== prevValue.from || to !== prevValue.to) {
          suppressed = false;
        }

        // Determine visibility
        const visible =
          !suppressed &&
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

    view: () => {
      const onFocus = (): void => {
        // Re-evaluate after focus (selection may have settled)
        setTimeout(() => {
          const pluginState = pluginKey.getState(editor.view.state) as
            | BubbleMenuPluginState
            | undefined;
          if (pluginState?.visible) {
            updatePosition(editor.view, pluginState.from, pluginState.to);
          }
        });
      };

      const onBlur = ({ event }: { event: FocusEvent }): void => {
        // Don't hide if focus moved to the bubble menu itself
        if (
          event.relatedTarget &&
          element.contains(event.relatedTarget as Node)
        ) {
          return;
        }
        hideMenu();
      };

      element.addEventListener('mousedown', onMenuMousedown, { capture: true });
      document.addEventListener('mousedown', onDocumentMousedown);
      editor.on('focus', onFocus);
      editor.on('blur', onBlur);

      return {
        update: (view, prevState) => {
          // Skip during IME composition
          if (view.composing) return;

          const state = pluginKey.getState(view.state) as
            | BubbleMenuPluginState
            | undefined;
          const prevPluginState = pluginKey.getState(prevState) as
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
          editor.off('focus', onFocus);
          editor.off('blur', onBlur);
          element.removeEventListener('mousedown', onMenuMousedown, {
            capture: true,
          });
          document.removeEventListener('mousedown', onDocumentMousedown);
          if (updateTimeout) {
            clearTimeout(updateTimeout);
          }
          hideMenu();
        },
      };
    },
  });
}

export const BubbleMenu = Extension.create<BubbleMenuOptions>({
  name: 'bubbleMenu',

  addOptions() {
    return {
      element: null,
      updateDelay: 0,
      shouldShow: defaultShouldShow,
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
    if (!editor) {
      return [];
    }

    return [
      createBubbleMenuPlugin({
        pluginKey: bubbleMenuPluginKey,
        editor,
        element,
        shouldShow,
        placement,
        offset,
        updateDelay,
      }),
    ];
  },
});
