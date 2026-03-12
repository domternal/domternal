/**
 * Mention Node Extension
 *
 * Inline atom node for @mentions with multi-trigger support,
 * headless suggestion plugin, async item fetching, and configurable rendering.
 *
 * @example
 * ```ts
 * import { Mention } from '@domternal/extension-mention';
 *
 * const editor = new Editor({
 *   extensions: [
 *     Mention.configure({
 *       suggestion: {
 *         char: '@',
 *         name: 'user',
 *         items: ({ query }) => users.filter(u => u.label.includes(query)),
 *         render: createMentionRenderer,
 *       },
 *     }),
 *   ],
 * });
 *
 * // Insert mention programmatically
 * editor.commands.insertMention({ id: '1', label: 'Alice' });
 * ```
 */
import { Node } from '@domternal/core';
import type { CommandSpec } from '@domternal/core';
import type { Node as PMNode, DOMOutputSpec } from '@domternal/pm/model';
import { createMentionSuggestionPlugin } from './mentionSuggestionPlugin.js';
import type { MentionTrigger } from './mentionSuggestionPlugin.js';

declare module '@domternal/core' {
  interface RawCommands {
    insertMention: CommandSpec<[attrs: { id: string; label: string; type?: string }]>;
    deleteMention: CommandSpec<[id?: string]>;
  }
}

export interface MentionOptions {
  /** Single trigger config (shorthand). Ignored if `triggers` is non-empty. */
  suggestion: MentionTrigger | null;
  /** Multiple trigger configs. Takes precedence over `suggestion`. */
  triggers: MentionTrigger[];
  /** Delete trigger char alongside mention on Backspace. Default: false */
  deleteTriggerWithBackspace: boolean;
  /** Custom render for HTML output (e.g. render as <a>). */
  renderHTML:
    | ((props: {
        node: PMNode;
        options: MentionOptions;
        HTMLAttributes: Record<string, unknown>;
      }) => DOMOutputSpec)
    | null;
  /** Custom render for plain text output. */
  renderText:
    | ((props: { node: PMNode; options: MentionOptions }) => string)
    | null;
  /** HTML attributes for the mention element. */
  HTMLAttributes: Record<string, unknown>;
}

export interface MentionStorage {
  /** Find all mention nodes in the document. */
  findMentions: () => {
    id: string;
    label: string;
    type: string;
    pos: number;
  }[];
  /** @internal Trigger name → char lookup map. */
  _triggerCharMap: Map<string, string>;
}

/** Resolve trigger char + label into display text (e.g. "@Alice", "#feature"). */
function getMentionText(node: PMNode, charMap: Map<string, string>): string {
  const label = (node.attrs['label'] ?? '') as string;
  const typeName = (node.attrs['type'] ?? 'mention') as string;
  const triggerChar = charMap.get(typeName) ?? '@';
  return `${triggerChar}${label}`;
}

/** Resolve the effective triggers array from options. */
function resolveTriggers(options: MentionOptions): MentionTrigger[] {
  if (options.triggers.length > 0) return options.triggers;
  if (options.suggestion) return [options.suggestion];
  return [];
}

export const Mention = Node.create<MentionOptions, MentionStorage>({
  name: 'mention',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,
  draggable: false,

  addOptions() {
    return {
      suggestion: null,
      triggers: [],
      deleteTriggerWithBackspace: false,
      renderHTML: null,
      renderText: null,
      HTMLAttributes: {},
    };
  },

  addStorage() {
    return {
      findMentions: () => [],
      _triggerCharMap: new Map(),
    };
  },

  onCreate() {
    const triggers = resolveTriggers(this.options);
    const charMap = new Map<string, string>();
    for (const t of triggers) {
      charMap.set(t.name, t.char);
    }
    this.storage._triggerCharMap = charMap;

    // Set up findMentions to scan the document
    this.storage.findMentions = () => {
      const editor = this.editor;
      if (!editor) return [];

      const mentions: {
        id: string;
        label: string;
        type: string;
        pos: number;
      }[] = [];
      const { doc } = editor.state;
      const mentionType = this.nodeType;
      if (!mentionType) return [];

      doc.descendants((node, pos) => {
        if (node.type === mentionType) {
          mentions.push({
            id: node.attrs['id'] as string,
            label: node.attrs['label'] as string,
            type: node.attrs['type'] as string,
            pos,
          });
        }
      });

      return mentions;
    };
  },

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute('data-id'),
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes['id']) return {};
          return { 'data-id': attributes['id'] as string };
        },
      },
      label: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute('data-label'),
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes['label']) return {};
          return { 'data-label': attributes['label'] as string };
        },
      },
      type: {
        default: 'mention',
        parseHTML: (element: HTMLElement) =>
          element.getAttribute('data-mention-type') ?? 'mention',
        renderHTML: (attributes: Record<string, unknown>) => {
          return { 'data-mention-type': attributes['type'] as string };
        },
      },
    };
  },

  parseHTML() {
    return [
      { tag: 'span[data-type="mention"]' },
      { tag: 'span[data-mention]' },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    // Custom renderHTML takes precedence
    if (this.options.renderHTML) {
      return this.options.renderHTML({
        node,
        options: this.options,
        HTMLAttributes,
      });
    }

    return [
      'span',
      {
        ...this.options.HTMLAttributes,
        ...HTMLAttributes,
        'data-type': 'mention',
        class: [
          this.options.HTMLAttributes['class'] as string | undefined,
          HTMLAttributes['class'] as string | undefined,
          'mention',
        ]
          .filter(Boolean)
          .join(' '),
      },
      getMentionText(node, this.storage._triggerCharMap),
    ];
  },

  leafText(node) {
    if (this.options.renderText) {
      return this.options.renderText({ node, options: this.options });
    }

    return getMentionText(node, this.storage._triggerCharMap);
  },

  addCommands() {
    return {
      insertMention:
        (attrs: { id: string; label: string; type?: string }) =>
        ({ tr, dispatch }) => {
          if (!attrs.id || !attrs.label) return false;
          if (!this.nodeType) return false;

          if (dispatch) {
            const mentionNode = this.nodeType.create({
              id: attrs.id,
              label: attrs.label,
              type: attrs.type ?? 'mention',
            });
            tr.replaceSelectionWith(mentionNode);
            dispatch(tr);
          }

          return true;
        },

      deleteMention:
        (id?: string) =>
        ({ tr, dispatch, state }) => {
          // If id is provided, find and delete first mention with that id
          if (id) {
            const mentionType = this.nodeType;
            if (!mentionType) return false;

            let foundPos = -1;
            let foundSize = 0;
            state.doc.descendants((node, pos) => {
              if (foundPos >= 0) return false;
              if (node.type === mentionType && node.attrs['id'] === id) {
                foundPos = pos;
                foundSize = node.nodeSize;
                return false;
              }
              return undefined;
            });

            if (foundPos < 0) return false;

            if (dispatch) {
              tr.delete(foundPos, foundPos + foundSize);
              dispatch(tr);
            }

            return true;
          }

          // No id: delete mention at cursor (nodeBefore)
          const { $from } = state.selection;
          if (!state.selection.empty) return false;

          const nodeBefore = $from.nodeBefore;
          if (nodeBefore?.type.name !== 'mention') return false;

          if (dispatch) {
            const from = $from.pos - nodeBefore.nodeSize;
            tr.delete(from, $from.pos);
            dispatch(tr);
          }

          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      Backspace: () => {
        const editor = this.editor;
        if (!editor) return false;

        const { state } = editor;
        const { selection } = state;
        const { empty, $from } = selection;

        if (!empty) return false;

        const nodeBefore = $from.nodeBefore;
        if (nodeBefore?.type.name !== 'mention') return false;

        // Delete the mention node
        const from = $from.pos - nodeBefore.nodeSize;
        const { tr } = state;

        if (this.options.deleteTriggerWithBackspace) {
          // Also delete the trigger char if it precedes the mention
          const triggerType = (nodeBefore.attrs['type'] ?? 'mention') as string;
          const triggerChar = this.storage._triggerCharMap.get(triggerType);

          if (triggerChar && from > 0) {
            const $before = state.doc.resolve(from);
            const charBefore = $before.parent.textBetween(
              Math.max(0, $before.parentOffset - triggerChar.length),
              $before.parentOffset,
              undefined,
              '\ufffc',
            );

            if (charBefore === triggerChar) {
              tr.delete(from - triggerChar.length, $from.pos);
              editor.view.dispatch(tr);
              return true;
            }
          }
        }

        tr.delete(from, $from.pos);
        editor.view.dispatch(tr);
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    const triggers = resolveTriggers(this.options);
    if (triggers.length === 0) return [];

    return triggers.map((trigger) =>
      createMentionSuggestionPlugin({
        trigger,
        nodeType: this.nodeType,
      }),
    );
  },
});
