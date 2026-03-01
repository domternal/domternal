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
import { positionFloatingOnce } from '../utils/positionFloating.js';

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

  // Don't show if selection spans across different table cells.
  // A cross-cell TextSelection happens during mouse drag across cells —
  // the bubble menu would float over the table confusingly.
  const $from = state.doc.resolve(from);
  for (let d = $from.depth; d > 0; d--) {
    const name = $from.node(d).type.name;
    if (name === 'tableCell' || name === 'tableHeader') {
      const cellEnd = $from.before(d) + $from.node(d).nodeSize;
      if (to > cellEnd) return false;
      break;
    }
  }

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
    cleanupFloating?.();

    // For NodeSelection (images, HRs, etc.), use the actual DOM element
    // for precise alignment. coordsAtPos gives paragraph-wide coords
    // which misaligns the menu for small centered nodes.
    const sel = view.state.selection;
    let reference: Element | { getBoundingClientRect: () => DOMRect } | null = null;
    if ('node' in sel) {
      const dom = view.nodeDOM(from);
      if (dom instanceof HTMLElement) reference = dom;
    }
    reference ??= {
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

    cleanupFloating = positionFloatingOnce(reference, element, {
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

  // Suppress bubble menu during active mouse drag inside the editor.
  // Without this, the bubble menu appears mid-drag, and its DOM element
  // blocks prosemirror-tables' posAtCoords() from resolving the cell
  // under the cursor — preventing TextSelection → CellSelection conversion.
  let mouseDown = false;

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

    view: (editorView) => {
      // Move element inside .dm-editor (position:relative) so it uses
      // position:absolute — CSS compositor handles scroll, zero jitter.
      const editorEl = editorView.dom.closest('.dm-editor');
      if (editorEl && element.parentElement !== editorEl) {
        editorEl.appendChild(element);
      }

      // Track mouse drag to suppress bubble menu during active drag.
      const onEditorMousedown = (e: MouseEvent): void => {
        if (e.button !== 0) return; // only primary button
        mouseDown = true;
        hideMenu();
      };
      const onDocumentMouseup = (): void => {
        if (!mouseDown) return;
        mouseDown = false;
        // Defer to let ProseMirror finalize selection changes from the mouseup
        setTimeout(() => {
          if (mouseDown) return; // new drag started
          const currentState = pluginKey.getState(editor.view.state) as
            | BubbleMenuPluginState
            | undefined;
          if (currentState?.visible) {
            updatePosition(editor.view, currentState.from, currentState.to);
          }
        });
      };

      const onFocus = (): void => {
        // Re-evaluate after focus (selection may have settled).
        // Must re-check shouldShow with current state — plugin state may be stale
        // if blur/focus happened without a transaction (e.g. cell handle click,
        // browser extension, or external focus change).
        setTimeout(() => {
          if (suppressed) {
            hideMenu();
            return;
          }
          if (mouseDown) return; // don't show during drag
          const { selection } = editor.view.state;
          const { from, to } = selection;
          const show =
            !selection.empty &&
            shouldShow({
              editor,
              view: editor.view,
              state: editor.view.state,
              from,
              to,
            });
          if (show) {
            updatePosition(editor.view, from, to);
          } else {
            hideMenu();
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

      // Dismiss when another overlay opens (e.g. table dropdown)
      const onDismissOverlays = (): void => {
        hideMenu();
        suppressed = true;
      };

      element.addEventListener('mousedown', onMenuMousedown, { capture: true });
      document.addEventListener('mousedown', onDocumentMousedown);
      editorView.dom.addEventListener('mousedown', onEditorMousedown);
      document.addEventListener('mouseup', onDocumentMouseup);
      editorEl?.addEventListener('dm:dismiss-overlays', onDismissOverlays);
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

          // Skip if nothing changed — but reposition when the doc changed
          // while the menu is visible (e.g. image float attribute changed,
          // the DOM element moved but the selection stayed at the same pos)
          if (
            state?.visible === prevPluginState?.visible &&
            state?.from === prevPluginState?.from &&
            state?.to === prevPluginState?.to &&
            !(state?.visible && view.state.doc !== prevState.doc)
          ) {
            // Safety: ensure DOM matches state (onFocus setTimeout can race)
            if (!state?.visible && element.hasAttribute('data-show')) {
              hideMenu();
            }
            return;
          }

          // Clear pending update
          if (updateTimeout) {
            clearTimeout(updateTimeout);
            updateTimeout = null;
          }

          if (state?.visible && !mouseDown) {
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
          editorView.dom.removeEventListener('mousedown', onEditorMousedown);
          document.removeEventListener('mouseup', onDocumentMouseup);
          editorEl?.removeEventListener('dm:dismiss-overlays', onDismissOverlays);
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
