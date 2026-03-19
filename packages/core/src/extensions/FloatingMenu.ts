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
 * Styles are included automatically via `@domternal/theme` (`_floating-menu.scss`).
 */
import { Extension } from '../Extension.js';
import { Plugin, PluginKey } from '@domternal/pm/state';
import type { EditorView } from '@domternal/pm/view';
import type { EditorState } from '@domternal/pm/state';
import type { Editor } from '../Editor.js';
import { positionFloatingOnce } from '../utils/positionFloating.js';

export const floatingMenuPluginKey = new PluginKey('floatingMenu');

// Default shouldShow: empty paragraph with cursor in editable editor
function defaultShouldShow({
  editor,
  state,
}: {
  editor: Editor;
  view: EditorView;
  state: EditorState;
}): boolean {
  // Don't show if editor is not editable
  if (!editor.isEditable) return false;

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
   * Offset in pixels from the cursor position.
   * @default 0
   */
  offset: number;
}

export interface CreateFloatingMenuPluginOptions {
  pluginKey: PluginKey;
  editor: Editor;
  element: HTMLElement;
  shouldShow?: FloatingMenuOptions['shouldShow'];
  offset?: number;
}

/**
 * Creates a standalone FloatingMenu ProseMirror plugin.
 * Can be used by framework wrappers (Angular, React, Vue) to create the plugin
 * independently of the extension system.
 */
export function createFloatingMenuPlugin(options: CreateFloatingMenuPluginOptions): Plugin {
  const {
    pluginKey,
    editor,
    element,
    shouldShow = defaultShouldShow,
    offset = 0,
  } = options;

  let cleanupFloating: (() => void) | null = null;

  const updatePosition = (view: EditorView): void => {
    const { selection } = view.state;
    const { $from } = selection;

    const depth = $from.depth;
    const startPos = $from.start(depth);
    const domNode = view.nodeDOM(startPos - 1);

    if (domNode instanceof HTMLElement) {
      cleanupFloating?.();
      cleanupFloating = positionFloatingOnce(domNode, element, {
        placement: 'bottom-start',
        offsetValue: offset,
      });
      element.setAttribute('data-show', '');
    }
  };

  const hideMenu = (): void => {
    cleanupFloating?.();
    cleanupFloating = null;
    element.removeAttribute('data-show');
  };

  // Initially hide
  hideMenu();

  return new Plugin({
    key: pluginKey,

    view: (editorView) => {
      // Move element inside .dm-editor (position:relative) so it uses
      // position:absolute — CSS compositor handles scroll, zero jitter.
      const editorEl = editorView.dom.closest('.dm-editor');
      if (editorEl && element.parentElement !== editorEl) {
        editorEl.appendChild(element);
      }

      const onFocus = (): void => {
        const visible = shouldShow({
          editor,
          view: editor.view,
          state: editor.view.state,
        });
        if (visible) {
          updatePosition(editor.view);
        } else {
          hideMenu();
        }
      };

      const onBlur = ({ event }: { event: FocusEvent }): void => {
        if (event.relatedTarget && element.contains(event.relatedTarget as Node)) {
          return;
        }
        hideMenu();
      };

      editor.on('focus', onFocus);
      editor.on('blur', onBlur);

      return {
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
          editor.off('focus', onFocus);
          editor.off('blur', onBlur);
        },
      };
    },
  });
}

export const FloatingMenu = Extension.create<FloatingMenuOptions>({
  name: 'floatingMenu',

  addOptions() {
    return {
      element: null,
      shouldShow: defaultShouldShow,
      offset: 0,
    };
  },

  addProseMirrorPlugins() {
    const { element, shouldShow, offset } = this.options;

    if (!element) {
      return [];
    }

    const editor = this.editor as Editor | null;
    if (!editor) {
      return [];
    }

    return [
      createFloatingMenuPlugin({
        pluginKey: floatingMenuPluginKey,
        editor,
        element,
        shouldShow,
        offset,
      }),
    ];
  },
});
