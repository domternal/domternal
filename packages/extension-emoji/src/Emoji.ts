/**
 * Emoji Node Extension
 *
 * Inline atom node for emoji with shortcode input rules, emoticon support,
 * and a headless suggestion plugin for autocomplete pickers.
 *
 * @example
 * ```ts
 * import { Emoji, emojis } from '@domternal/extension-emoji';
 *
 * const editor = new Editor({
 *   extensions: [
 *     Emoji.configure({
 *       emojis,
 *       enableEmoticons: true,
 *     }),
 *   ],
 * });
 *
 * // Insert emoji by name
 * editor.commands.insertEmoji('smile');
 *
 * // Programmatically open suggestion picker
 * editor.commands.suggestEmoji();
 * ```
 */
import { Node } from '@domternal/core';
import type { CommandSpec, ToolbarItem } from '@domternal/core';
import { InputRule } from 'prosemirror-inputrules';
import type { EditorState } from 'prosemirror-state';
import { emojis as defaultEmojis } from './emojis.js';
import type { EmojiItem } from './emojis.js';
import { emoticons } from './emoticons.js';
import { createSuggestionPlugin } from './suggestionPlugin.js';
import type { SuggestionOptions } from './suggestionPlugin.js';

declare module '@domternal/core' {
  interface RawCommands {
    insertEmoji: CommandSpec<[name: string]>;
    suggestEmoji: CommandSpec;
  }
}

export interface EmojiOptions {
  /** Emoji dataset. Default: built-in ~200 popular emoji. */
  emojis: EmojiItem[];
  /** Enable emoticon shortcuts like :) and <3. Default: false. */
  enableEmoticons: boolean;
  /** Render emoji as plain text instead of atom nodes. Default: false. */
  plainText: boolean;
  /** HTML attributes for the emoji span element. */
  HTMLAttributes: Record<string, unknown>;
  /** Suggestion plugin config for autocomplete picker. Default: null (disabled). */
  suggestion: SuggestionOptions | null;
}

export interface EmojiStorage {
  /** Get frequently used emoji names, sorted by usage count descending. */
  getFrequentlyUsed: () => string[];
  /** Record a usage of an emoji name. */
  addFrequentlyUsed: (name: string) => void;
  /** Find an emoji item by name. */
  findEmoji: (name: string) => EmojiItem | undefined;
  /** Search emoji by query (matches name, shortcodes, and tags). */
  searchEmoji: (query: string) => EmojiItem[];
  /** @internal Name → EmojiItem lookup map (set in onCreate). */
  _nameMap?: Map<string, EmojiItem>;
  /** @internal Shortcode → EmojiItem lookup map (set in onCreate). */
  _shortcodeMap?: Map<string, EmojiItem>;
}

/** Builds a shortcode → EmojiItem lookup map for fast resolution. */
function buildShortcodeMap(items: EmojiItem[]): Map<string, EmojiItem> {
  const map = new Map<string, EmojiItem>();
  for (const item of items) {
    for (const code of item.shortcodes) {
      map.set(code, item);
    }
  }
  return map;
}

/** Builds a name → EmojiItem lookup map for fast resolution. */
function buildNameMap(items: EmojiItem[]): Map<string, EmojiItem> {
  const map = new Map<string, EmojiItem>();
  for (const item of items) {
    map.set(item.name, item);
  }
  return map;
}

/** Escapes special regex characters in a string. */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const Emoji = Node.create<EmojiOptions, EmojiStorage>({
  name: 'emoji',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addOptions() {
    return {
      emojis: defaultEmojis,
      enableEmoticons: false,
      plainText: false,
      HTMLAttributes: {},
      suggestion: null,
    };
  },

  addStorage() {
    return {
      getFrequentlyUsed: () => [],
      addFrequentlyUsed: () => undefined,
      findEmoji: () => undefined,
      searchEmoji: () => [],
    };
  },

  onCreate() {
    const { emojis: emojiData } = this.options;

    // Maps may have already been built by addInputRules() (which runs first).
    // Only build if not already present.
    const nameMap = this.storage._nameMap ?? buildNameMap(emojiData);
    const shortcodeMap = this.storage._shortcodeMap ?? buildShortcodeMap(emojiData);
    const frequencyMap = new Map<string, number>();

    this.storage.findEmoji = (name: string) => nameMap.get(name);

    this.storage.searchEmoji = (query: string) => {
      const q = query.toLowerCase();
      return emojiData.filter(
        (item) =>
          item.name.includes(q) ||
          item.shortcodes.some((sc) => sc.includes(q)) ||
          item.tags.some((t) => t.includes(q)),
      );
    };

    this.storage.addFrequentlyUsed = (name: string) => {
      frequencyMap.set(name, (frequencyMap.get(name) ?? 0) + 1);
    };

    this.storage.getFrequentlyUsed = () =>
      [...frequencyMap.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([name]) => name);

    // Ensure maps are on storage for renderHTML / leafText access
    this.storage._shortcodeMap = shortcodeMap;
    this.storage._nameMap = nameMap;
  },

  addAttributes() {
    return {
      name: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute('data-name') ?? element.getAttribute('data-emoji-name'),
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes['name']) return {};
          return { 'data-name': attributes['name'] as string };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-type="emoji"]',
      },
      {
        tag: 'span[data-emoji-name]',
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const name = node.attrs['name'] as string | null;
    const nameMap = this.storage._nameMap;
    const item = name ? nameMap?.get(name) : undefined;
    const emoji = item?.emoji ?? '';

    return [
      'span',
      {
        ...this.options.HTMLAttributes,
        ...HTMLAttributes,
        'data-type': 'emoji',
        'data-name': name ?? '',
        class: [
          this.options.HTMLAttributes['class'] as string | undefined,
          HTMLAttributes['class'] as string | undefined,
          'emoji',
        ]
          .filter(Boolean)
          .join(' '),
      },
      emoji,
    ];
  },

  // leafText: emoji char for getText() and clipboard
  leafText(node) {
    const name = node.attrs['name'] as string | null;
    const nameMap = this.storage._nameMap;
    const item = name ? nameMap?.get(name) : undefined;
    return item?.emoji ?? '';
  },

  addToolbarItems(): ToolbarItem[] {
    return [
      {
        type: 'button',
        name: 'emoji',
        command: 'insertEmoji',
        commandArgs: ['smile'],
        icon: 'smiley',
        label: 'Insert Emoji',
        group: 'insert',
        priority: 50,
        emitEvent: 'insertEmoji',
      },
    ];
  },

  addCommands() {
    return {
      insertEmoji:
        (name: string) =>
        ({ tr, dispatch }) => {
          // Refuse insertion inside code blocks
          if (tr.selection.$from.parent.type.spec.code) return false;

          if (!this.options.plainText && !this.nodeType) return false;

          const item = this.storage._nameMap?.get(name);

          if (dispatch) {
            if (!item) return false;

            if (this.options.plainText) {
              tr.insertText(item.emoji);
            } else {
              const node = this.nodeType!.create({ name });
              tr.replaceSelectionWith(node);
            }
            dispatch(tr);
            this.storage.addFrequentlyUsed(name);
          } else if (!item) {
            // Dry-run: unknown name but context is valid — report as capable
            return true;
          }

          return true;
        },

      suggestEmoji:
        () =>
        ({ tr, dispatch }) => {
          const suggestion = this.options.suggestion;
          if (!suggestion) return false;

          const char = suggestion.char ?? ':';

          if (dispatch) {
            tr.insertText(char);
            dispatch(tr);
          }

          return true;
        },
    };
  },

  addInputRules() {
    const rules: InputRule[] = [];
    const { emojis: emojiData, plainText, enableEmoticons } = this.options;

    // Build maps eagerly — addInputRules() runs before onCreate(),
    // so we must build and store maps now for the input rule callbacks.
    this.storage._shortcodeMap ??= buildShortcodeMap(emojiData);
    this.storage._nameMap ??= buildNameMap(emojiData);

    const nodeType = this.nodeType;
    const storage = this.storage;

    // Shortcode input rule: :shortcode: → emoji
    rules.push(
      new InputRule(
        /:([a-zA-Z0-9_+-]+):$/,
        (state: EditorState, match: RegExpMatchArray, start: number, end: number) => {
          // Don't convert inside code contexts (codeBlock or inline code mark)
          const { $from } = state.selection;
          if ($from.parent.type.spec.code) return null;
          const activeMarks = state.storedMarks ?? $from.marks();
          if (activeMarks.some((m) => m.type.name === 'code')) return null;

          const shortcode = match[1];
          if (!shortcode) return null;

          const item = storage._shortcodeMap?.get(shortcode);
          if (!item) return null;

          const { tr } = state;

          if (plainText) {
            tr.replaceWith(start, end, state.schema.text(item.emoji));
          } else if (nodeType) {
            const node = nodeType.create({ name: item.name });
            tr.replaceWith(start, end, node);
          } else {
            return null;
          }

          storage.addFrequentlyUsed(item.name);
          return tr;
        },
      ),
    );

    // Emoticon input rules (if enabled)
    if (enableEmoticons) {
      const emoticonEntries = Object.entries(emoticons);
      const nameMap = this.storage._nameMap;

      // Sort by length descending so longer emoticons match first
      emoticonEntries.sort((a, b) => b[0].length - a[0].length);

      for (const [emoticon, emojiName] of emoticonEntries) {
        const item = nameMap.get(emojiName);
        if (!item) continue;

        // Match emoticon preceded by space or start of text, followed by space
        const pattern = new RegExp(`(?:^|\\s)(${escapeRegex(emoticon)})\\s$`);

        rules.push(
          new InputRule(
            pattern,
            (state: EditorState, match: RegExpMatchArray, start: number) => {
              // Don't convert inside code contexts (codeBlock or inline code mark)
              const { $from } = state.selection;
              if ($from.parent.type.spec.code) return null;
              const activeMarks = state.storedMarks ?? $from.marks();
              if (activeMarks.some((m) => m.type.name === 'code')) return null;

              const { tr } = state;

              // Calculate the actual emoticon position (after the optional leading space)
              const fullMatch = match[0];
              const emoticonText = match[1];
              if (!emoticonText) return null;

              const emoticonStart = start + fullMatch.indexOf(emoticonText);
              const emoticonEnd = emoticonStart + emoticonText.length;

              if (plainText) {
                tr.replaceWith(emoticonStart, emoticonEnd, state.schema.text(item.emoji));
              } else if (nodeType) {
                const node = nodeType.create({ name: item.name });
                tr.replaceWith(emoticonStart, emoticonEnd, node);
              } else {
                return null;
              }

              storage.addFrequentlyUsed(item.name);
              return tr;
            },
          ),
        );
      }
    }

    return rules;
  },

  addProseMirrorPlugins() {
    const { suggestion } = this.options;
    if (!suggestion) return [];

    return [
      createSuggestionPlugin({
        ...suggestion,
        editor: this.editor,
        nodeType: this.nodeType,
        storage: this.storage,
        plainText: this.options.plainText,
      }),
    ];
  },
});
