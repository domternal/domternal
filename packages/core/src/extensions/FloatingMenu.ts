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
}

export interface CreateFloatingMenuPluginOptions {
  pluginKey: PluginKey;
  editor: Editor;
  element: HTMLElement;
  shouldShow?: FloatingMenuOptions['shouldShow'];
  offset?: [number, number];
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
    offset = [0, 0],
  } = options;

  const updatePosition = (view: EditorView): void => {
    const { selection } = view.state;
    const { $from } = selection;

    // Get the DOM node for the paragraph the cursor is in
    const depth = $from.depth;
    const startPos = $from.start(depth);
    const domNode = view.nodeDOM(startPos - 1);

    if (domNode instanceof HTMLElement) {
      const rect = domNode.getBoundingClientRect();

      // Compute offset from the element's offsetParent so positioning
      // works for both position:fixed and position:absolute elements.
      const offsetParent = element.offsetParent;
      const parentRect = offsetParent
        ? offsetParent.getBoundingClientRect()
        : { top: 0, left: 0 };

      let top = rect.bottom + offset[1];
      const left = rect.left + offset[0];

      // Viewport boundary: if menu would go below viewport, show above
      const menuRect = element.getBoundingClientRect();
      const viewportHeight = window.innerHeight;

      if (top + menuRect.height > viewportHeight - 10) {
        top = rect.top - menuRect.height - offset[1];
      }

      // Convert viewport coordinates to offsetParent-relative coordinates
      element.style.top = `${String(top - parentRect.top)}px`;
      element.style.left = `${String(left - parentRect.left)}px`;
    }

    element.setAttribute('data-show', '');
  };

  const hideMenu = (): void => {
    element.removeAttribute('data-show');
  };

  // Initially hide
  hideMenu();

  return new Plugin({
    key: pluginKey,

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
  });
}

export const FloatingMenu = Extension.create<FloatingMenuOptions>({
  name: 'floatingMenu',

  addOptions() {
    return {
      element: null,
      shouldShow: defaultShouldShow,
      offset: [0, 0] as [number, number],
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
