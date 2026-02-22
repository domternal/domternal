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

  // Prevent blur when clicking inside the bubble menu
  const onMenuMousedown = (e: Event): void => {
    e.preventDefault();
  };

  // Initially hide
  hideMenu();
  element.addEventListener('mousedown', onMenuMousedown, { capture: true });

  return new Plugin({
    key: pluginKey,

    state: {
      init: (): BubbleMenuPluginState => ({
        visible: false,
        from: 0,
        to: 0,
      }),
      apply: (_tr, _value, _oldState, newState): BubbleMenuPluginState => {
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
