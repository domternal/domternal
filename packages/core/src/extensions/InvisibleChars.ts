/**
 * InvisibleChars Extension
 *
 * Shows invisible characters like spaces, paragraph marks, and hard breaks.
 * Useful for document editing where whitespace matters.
 *
 * Styles are included automatically via `@domternal/theme` (`_invisible-chars.scss`).
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
 *       nbsp: true,
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
 */
import { Extension } from '../Extension.js';
import { Plugin, PluginKey } from '@domternal/pm/state';
import { Decoration, DecorationSet } from '@domternal/pm/view';
import type { Node as ProseMirrorNode } from '@domternal/pm/model';
import type { Editor } from '../Editor.js';
import type { CommandSpec } from '../types/Commands.js';
import type { ToolbarItem } from '../types/Toolbar.js';

declare module '../types/Commands.js' {
  interface RawCommands {
    toggleInvisibleChars: CommandSpec;
    showInvisibleChars: CommandSpec;
    hideInvisibleChars: CommandSpec;
  }
}

export const invisibleCharsPluginKey = new PluginKey('invisibleChars');

// Unicode characters for display
const CHARS = {
  paragraph: '¶',
  hardBreak: '↵',
  space: '·',
  nbsp: '°',
};

interface InvisibleCharsPluginState {
  visible: boolean;
  decorations: DecorationSet;
}

function buildDecorations(
  doc: ProseMirrorNode,
  options: InvisibleCharsOptions,
): DecorationSet {
  const decorations: Decoration[] = [];

  doc.descendants((node, pos) => {
    if (options.paragraph && node.type.name === 'paragraph') {
      const endPos = pos + node.nodeSize - 1;
      decorations.push(
        Decoration.widget(
          endPos,
          () => {
            const span = document.createElement('span');
            span.className = `${options.className} ${options.className}--paragraph`;
            span.textContent = CHARS.paragraph;
            return span;
          },
          { side: -1 }
        )
      );
    }

    if (options.hardBreak && node.type.name === 'hardBreak') {
      decorations.push(
        Decoration.widget(
          pos,
          () => {
            const span = document.createElement('span');
            span.className = `${options.className} ${options.className}--hardBreak`;
            span.textContent = CHARS.hardBreak;
            return span;
          },
          { side: -1 }
        )
      );
    }

    if (node.isText && node.text) {
      const text = node.text;
      for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const charPos = pos + i;

        if (options.space && char === ' ') {
          decorations.push(
            Decoration.inline(charPos, charPos + 1, {
              class: `${options.className} ${options.className}--space`,
              'data-char': 'space',
            })
          );
        }

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
}

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
      toggle: (): void => {
        // Initialized in onCreate
      },
      isVisible: () => false,
    };
  },

  onCreate() {
    const editor = this.editor as Editor | null;
    const options = this.options;

    this.storage.toggle = (): void => {
      const state = editor?.state;
      if (!state) return;

      const pluginState = invisibleCharsPluginKey.getState(state) as
        | InvisibleCharsPluginState
        | undefined;
      const currentVisible = pluginState?.visible ?? options.visible;

      const tr = state.tr.setMeta(invisibleCharsPluginKey, {
        visible: !currentVisible,
      });
      editor.view.dispatch(tr);
    };

    this.storage.isVisible = (): boolean => {
      const state = editor?.state;
      if (!state) return options.visible;
      const pluginState = invisibleCharsPluginKey.getState(state) as
        | InvisibleCharsPluginState
        | undefined;
      return pluginState?.visible ?? options.visible;
    };
  },

  addCommands() {
    return {
      toggleInvisibleChars:
        () =>
        ({ dispatch }) => {
          if (dispatch) {
            this.storage.toggle();
          }
          return true;
        },

      showInvisibleChars:
        () =>
        ({ dispatch }) => {
          if (dispatch && !this.storage.isVisible()) {
            this.storage.toggle();
          }
          return true;
        },

      hideInvisibleChars:
        () =>
        ({ dispatch }) => {
          if (dispatch && this.storage.isVisible()) {
            this.storage.toggle();
          }
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Shift-i': () => {
        return this.editor?.commands.toggleInvisibleChars() ?? false;
      },
    };
  },

  addToolbarItems(): ToolbarItem[] {
    return [
      {
        type: 'button',
        name: 'invisibleChars',
        command: 'toggleInvisibleChars',
        icon: 'paragraph',
        label: 'Invisible Characters',
        shortcut: 'Mod-Shift-I',
        group: 'utility',
        priority: 100,
        isActiveFn: (editor) => {
          const storage = editor.storage['invisibleChars'] as
            | { isVisible?: () => boolean }
            | undefined;
          return storage?.isVisible?.() ?? false;
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    const options = this.options;

    return [
      new Plugin({
        key: invisibleCharsPluginKey,

        state: {
          init: (_, state): InvisibleCharsPluginState => ({
            visible: options.visible,
            decorations: options.visible
              ? buildDecorations(state.doc, options)
              : DecorationSet.empty,
          }),
          apply: (tr, prev: InvisibleCharsPluginState, _oldState, newState): InvisibleCharsPluginState => {
            const meta = tr.getMeta(invisibleCharsPluginKey) as
              | { visible: boolean }
              | undefined;
            const visible = meta?.visible ?? prev.visible;

            if (!visible) {
              if (!prev.visible) return prev;
              return { visible, decorations: DecorationSet.empty };
            }

            // Visibility just toggled on — full rebuild
            if (!prev.visible) {
              return { visible, decorations: buildDecorations(newState.doc, options) };
            }

            // Doc changed — rebuild
            if (tr.docChanged) {
              return { visible, decorations: buildDecorations(newState.doc, options) };
            }

            // No change — reuse cached
            return prev;
          },
        },

        props: {
          decorations: (state) => {
            const pluginState = invisibleCharsPluginKey.getState(state) as
              | InvisibleCharsPluginState
              | undefined;
            return pluginState?.decorations ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});
