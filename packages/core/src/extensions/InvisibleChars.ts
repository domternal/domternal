/**
 * InvisibleChars Extension
 *
 * Shows invisible characters like spaces, paragraph marks, and hard breaks.
 * Useful for document editing where whitespace matters.
 *
 * @example
 * ```ts
 * import { InvisibleChars } from '@domternal/core';
 *
 * const editor = new Editor({
 *   extensions: [
 *     // ... other extensions
 *     InvisibleChars.configure({
 *       visible: false, // Start hidden
 *       paragraph: true,
 *       hardBreak: true,
 *       space: true,
 *     }),
 *   ],
 * });
 *
 * // Toggle visibility
 * editor.commands.toggleInvisibleChars();
 *
 * // Check current state
 * const isVisible = editor.storage.invisibleChars.isVisible();
 * ```
 *
 * ## CSS Required
 *
 * Add styles to your application:
 * ```css
 * .invisible-char {
 *   color: #999;
 *   font-size: 0.8em;
 *   pointer-events: none;
 *   user-select: none;
 * }
 * ```
 */
import { Extension } from '../Extension.js';
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { Editor } from '../Editor.js';

export const invisibleCharsPluginKey = new PluginKey('invisibleChars');

// Unicode characters for display
const CHARS = {
  paragraph: '¶',
  hardBreak: '↵',
  space: '·',
  nbsp: '°',
};

export interface InvisibleCharsOptions {
  /**
   * Whether invisible characters are shown.
   * @default false
   */
  visible: boolean;

  /**
   * Show paragraph markers (¶).
   * @default true
   */
  paragraph: boolean;

  /**
   * Show hard break markers (↵).
   * @default true
   */
  hardBreak: boolean;

  /**
   * Show space markers (·).
   * @default true
   */
  space: boolean;

  /**
   * Show non-breaking space markers (°).
   * @default true
   */
  nbsp: boolean;

  /**
   * Custom CSS class for invisible char decorations.
   * @default 'invisible-char'
   */
  className: string;
}

export interface InvisibleCharsStorage {
  /**
   * Toggle visibility of invisible characters.
   */
  toggle: () => void;

  /**
   * Current visibility state.
   */
  isVisible: () => boolean;
}

export const InvisibleChars = Extension.create<
  InvisibleCharsOptions,
  InvisibleCharsStorage
>({
  name: 'invisibleChars',

  addOptions() {
    return {
      visible: false,
      paragraph: true,
      hardBreak: true,
      space: true,
      nbsp: true,
      className: 'invisible-char',
    };
  },

  addStorage() {
    return {
      toggle: () => {},
      isVisible: () => false,
    };
  },

  onCreate() {
    const editor = this.editor as Editor | null;
    const options = this.options;

    // Initialize toggle function
    this.storage.toggle = () => {
      const state = editor?.state;
      if (!state) return;

      const currentVisible =
        invisibleCharsPluginKey.getState(state)?.visible ?? options.visible;

      // Trigger a view update by dispatching transaction with meta
      const tr = state.tr.setMeta(invisibleCharsPluginKey, {
        visible: !currentVisible,
      });
      editor?.view.dispatch(tr);
    };

    this.storage.isVisible = () => {
      const state = editor?.state;
      if (!state) return options.visible;
      return invisibleCharsPluginKey.getState(state)?.visible ?? options.visible;
    };
  },

  addCommands() {
    return {
      toggleInvisibleChars:
        () =>
        () => {
          this.storage.toggle();
          return true;
        },

      showInvisibleChars:
        () =>
        () => {
          if (!this.storage.isVisible()) {
            this.storage.toggle();
          }
          return true;
        },

      hideInvisibleChars:
        () =>
        () => {
          if (this.storage.isVisible()) {
            this.storage.toggle();
          }
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    const options = this.options;

    return [
      new Plugin({
        key: invisibleCharsPluginKey,

        state: {
          init: () => ({ visible: options.visible }),
          apply: (tr, value) => {
            const meta = tr.getMeta(invisibleCharsPluginKey) as
              | { visible: boolean }
              | undefined;
            if (meta?.visible !== undefined) {
              return { visible: meta.visible };
            }
            return value;
          },
        },

        props: {
          decorations: (state) => {
            const pluginState = invisibleCharsPluginKey.getState(state) as
              | { visible: boolean }
              | undefined;
            if (!pluginState?.visible) {
              return DecorationSet.empty;
            }

            const decorations: Decoration[] = [];
            const { doc } = state;

            doc.descendants((node, pos) => {
              // Paragraph end markers
              if (options.paragraph && node.type.name === 'paragraph') {
                const endPos = pos + node.nodeSize - 1;
                decorations.push(
                  Decoration.widget(
                    endPos,
                    () => {
                      const span = document.createElement('span');
                      span.className = options.className;
                      span.textContent = CHARS.paragraph;
                      return span;
                    },
                    { side: -1 }
                  )
                );
              }

              // Hard break markers
              if (options.hardBreak && node.type.name === 'hardBreak') {
                decorations.push(
                  Decoration.widget(
                    pos,
                    () => {
                      const span = document.createElement('span');
                      span.className = options.className;
                      span.textContent = CHARS.hardBreak;
                      return span;
                    },
                    { side: -1 }
                  )
                );
              }

              // Text content - spaces and nbsp
              if (node.isText && node.text) {
                const text = node.text;
                for (let i = 0; i < text.length; i++) {
                  const char = text[i];
                  const charPos = pos + i;

                  // Regular space
                  if (options.space && char === ' ') {
                    decorations.push(
                      Decoration.inline(charPos, charPos + 1, {
                        class: options.className,
                        'data-char': 'space',
                      })
                    );
                  }

                  // Non-breaking space (U+00A0)
                  if (options.nbsp && char === '\u00A0') {
                    decorations.push(
                      Decoration.inline(charPos, charPos + 1, {
                        class: `${options.className} ${options.className}--nbsp`,
                        'data-char': 'nbsp',
                      })
                    );
                  }
                }
              }
            });

            return DecorationSet.create(doc, decorations);
          },
        },
      }),
    ];
  },
});
