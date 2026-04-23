/**
 * SlashCommand Extension
 *
 * Notion-style `/` trigger that opens a filtered popup of insertable
 * blocks at the cursor position. Items are the same `FloatingMenuItem`s
 * collected by `addFloatingMenuItems()` in `@domternal/core`, so extensions
 * contribute once and every trigger (FloatingMenu, BlockHandle plus,
 * SlashCommand) shows the same options.
 *
 * Filter algorithm:
 * 1. Match query case-insensitively against item `label` and each entry
 *    in `keywords`.
 * 2. Rank exact label prefix matches highest, then label substring, then
 *    keyword matches (first keyword ranked higher than later ones).
 *
 * Execution:
 * 1. Delete the `/query` range from the document.
 * 2. Call `FloatingMenuController.executeItem(editor, item)` which either
 *    runs the named command (with args) or invokes the item's custom
 *    function. The command acts on the now-empty cursor position in the
 *    same block, so items like "Heading 1" transform the current block,
 *    while items like "Image" open their popover.
 */
import {
  Extension,
  FloatingMenuController,
} from '@domternal/core';
import type {
  Editor,
  FloatingMenuItem,
  FloatingMenuItemsOverride,
} from '@domternal/core';
import { Plugin, PluginKey } from '@domternal/pm/state';
import type { EditorState, Transaction } from '@domternal/pm/state';
import type { EditorView } from '@domternal/pm/view';
import { Decoration, DecorationSet } from '@domternal/pm/view';
import { createSlashSuggestionRenderer } from './createSlashSuggestionRenderer.js';

export const slashCommandPluginKey = new PluginKey<SlashCommandPluginState>('slashCommand');

// ─── Public renderer contract ─────────────────────────────────────────────

export interface SlashCommandProps {
  /** The editor instance (passed so custom renderers can read state). */
  editor: Editor;
  /** Current query string (text after the `/`). */
  query: string;
  /** Document range of the `/` + query (for replacement). */
  range: { from: number; to: number };
  /** Filtered and ranked items matching the query. */
  items: FloatingMenuItem[];
  /** Execute the selected item and close the popup. */
  command: (item: FloatingMenuItem) => void;
  /** Returns the client rect of the cursor for positioning the popup. */
  clientRect: () => DOMRect | null;
  /** The editor's ProseMirror DOM node (for portal parents etc.). */
  element: HTMLElement;
}

export interface SlashCommandRenderer {
  onStart: (props: SlashCommandProps) => void;
  onUpdate: (props: SlashCommandProps) => void;
  onExit: () => void;
  /** Return `true` to consume the key event and prevent default handling. */
  onKeyDown: (event: KeyboardEvent) => boolean;
}

// ─── Options ──────────────────────────────────────────────────────────────

export interface SlashCommandOptions {
  /**
   * The trigger character. @default '/'
   */
  char?: string;
  /**
   * Items override. When omitted, items from `editor.floatingMenuItems`
   * (collected via `addFloatingMenuItems()`) are used. An array replaces
   * defaults; a function transforms them.
   */
  items?: FloatingMenuItemsOverride;
  /**
   * Factory returning render callbacks for the popup. Default uses
   * `createSlashSuggestionRenderer()`.
   */
  render?: () => SlashCommandRenderer;
  /**
   * Node types where slash should NOT activate (e.g. `codeBlock`).
   * @default ['codeBlock']
   */
  invalidNodes?: string[];
}

export interface CreateSlashCommandPluginOptions {
  pluginKey: PluginKey<SlashCommandPluginState>;
  editor: Editor;
  char: string;
  items?: FloatingMenuItemsOverride;
  render: () => SlashCommandRenderer;
  invalidNodes: string[];
}

// ─── Internal state ───────────────────────────────────────────────────────

export interface SlashCommandPluginState {
  active: boolean;
  query: string;
  range: { from: number; to: number } | null;
}

const INITIAL_STATE: SlashCommandPluginState = {
  active: false,
  query: '',
  range: null,
};

/**
 * Resolves the current `/query` at the cursor, if any. Returns null if the
 * cursor isn't after a `/` on a qualifying line.
 */
function findSlashQuery(
  state: EditorState,
  triggerChar: string,
  invalidNodes: string[],
): { query: string; range: { from: number; to: number } } | null {
  const { selection } = state;
  if (!selection.empty) return null;

  const { $from } = selection;
  // Disallow in code blocks and any explicitly blocked node types.
  if ($from.parent.type.spec.code) return null;
  if (invalidNodes.includes($from.parent.type.name)) return null;

  const textBefore = $from.parent.textBetween(
    0,
    $from.parentOffset,
    undefined,
    '\ufffc',
  );
  const triggerIndex = textBefore.lastIndexOf(triggerChar);
  if (triggerIndex === -1) return null;

  // Trigger must be at textblock start OR preceded by whitespace.
  if (triggerIndex > 0 && !/\s/.test(textBefore[triggerIndex - 1] ?? '')) return null;

  const queryText = textBefore.slice(triggerIndex + triggerChar.length);
  // Block queries that contain newlines or tabs (they'd break display).
  if (/[\n\t]/.test(queryText)) return null;

  const from = $from.start() + triggerIndex;
  const to = $from.pos;
  return { query: queryText, range: { from, to } };
}

/**
 * Filters and ranks FloatingMenuItems against a query. Priority:
 *   1. Exact label prefix (case-insensitive)
 *   2. Label substring match
 *   3. Keyword match (preserving original keyword index for stable ranking)
 * Returns items in rank order, stable within the same rank.
 */
export function filterSlashItems(items: FloatingMenuItem[], query: string): FloatingMenuItem[] {
  if (query.length === 0) return items;
  const q = query.toLowerCase();

  const ranked: Array<{ item: FloatingMenuItem; score: number }> = [];
  for (const item of items) {
    const label = item.label.toLowerCase();
    if (label.startsWith(q)) {
      ranked.push({ item, score: 0 });
      continue;
    }
    if (label.includes(q)) {
      ranked.push({ item, score: 1 });
      continue;
    }
    const keywords = item.keywords ?? [];
    const kwIndex = keywords.findIndex((k) => k.toLowerCase().includes(q));
    if (kwIndex !== -1) {
      ranked.push({ item, score: 2 + kwIndex * 0.01 });
    }
  }
  ranked.sort((a, b) => a.score - b.score);
  return ranked.map((r) => r.item);
}

// ─── Plugin factory ───────────────────────────────────────────────────────

export function createSlashCommandPlugin(
  options: CreateSlashCommandPluginOptions,
): Plugin<SlashCommandPluginState> {
  const { pluginKey, editor, char, items: itemsOverride, render, invalidNodes } = options;
  let renderer: SlashCommandRenderer | null = null;

  return new Plugin<SlashCommandPluginState>({
    key: pluginKey,

    state: {
      init: (): SlashCommandPluginState => ({ ...INITIAL_STATE }),
      apply(tr: Transaction, prev, _oldState, newState): SlashCommandPluginState {
        if (tr.getMeta(pluginKey) === 'dismiss') return { ...INITIAL_STATE };

        const isUserInput = tr.docChanged || tr.selectionSet;
        if (!isUserInput) return prev;

        const result = findSlashQuery(newState, char, invalidNodes);
        if (result) {
          return { active: true, query: result.query, range: result.range };
        }
        return prev.active ? { ...INITIAL_STATE } : prev;
      },
    },

    view() {
      return {
        update(view: EditorView) {
          const state = pluginKey.getState(view.state);
          if (!state) return;

          if (state.active && state.range) {
            const items = FloatingMenuController.resolveItems(editor, itemsOverride);
            const filtered = filterSlashItems(items, state.query);

            const command = (item: FloatingMenuItem): void => {
              const current = pluginKey.getState(view.state);
              if (!current?.range) return;

              // Delete the `/query` range first so item's command runs on
              // the now-clean cursor position. Close popup state in the
              // same transaction to avoid a stale-render flash.
              const tr = view.state.tr;
              tr.delete(current.range.from, current.range.to);
              tr.setMeta(pluginKey, 'dismiss');
              view.dispatch(tr);

              // Execute the item on a fresh transaction (its command will
              // read the latest state).
              FloatingMenuController.executeItem(editor, item);
              view.focus();
            };

            const clientRect = (): DOMRect | null => {
              const current = pluginKey.getState(view.state);
              if (!current?.range) return null;
              try {
                const coords = view.coordsAtPos(current.range.from);
                return new DOMRect(
                  coords.left,
                  coords.top,
                  0,
                  coords.bottom - coords.top,
                );
              } catch {
                return null;
              }
            };

            const props: SlashCommandProps = {
              editor,
              query: state.query,
              range: state.range,
              items: filtered,
              command,
              clientRect,
              element: view.dom,
            };

            if (!renderer) {
              renderer = render();
              renderer.onStart(props);
            } else {
              renderer.onUpdate(props);
            }
          } else if (renderer) {
            renderer.onExit();
            renderer = null;
          }
        },

        destroy() {
          if (renderer) {
            renderer.onExit();
            renderer = null;
          }
        },
      };
    },

    props: {
      // Use handleDOMEvents.keydown (not handleKeyDown) so we intercept
      // keys BEFORE other keymap plugins claim them (same trick as Mention).
      handleDOMEvents: {
        keydown(view, event): boolean {
          const state = pluginKey.getState(view.state);
          if (!state?.active) return false;

          if (event.key === 'Escape') {
            event.preventDefault();
            const tr = view.state.tr;
            tr.setMeta(pluginKey, 'dismiss');
            view.dispatch(tr);
            return true;
          }

          if (renderer) {
            const handled = renderer.onKeyDown(event);
            if (handled) event.preventDefault();
            return handled;
          }
          return false;
        },
      },

      decorations(state): DecorationSet {
        const pluginState = pluginKey.getState(state);
        if (!pluginState?.active || !pluginState.range) return DecorationSet.empty;
        return DecorationSet.create(state.doc, [
          Decoration.inline(pluginState.range.from, pluginState.range.to, {
            class: 'dm-slash-command-query',
            nodeName: 'span',
          }),
        ]);
      },
    },
  });
}

export const SlashCommand = Extension.create<SlashCommandOptions>({
  name: 'slashCommand',

  addOptions() {
    return {
      char: '/',
      invalidNodes: ['codeBlock'],
    };
  },

  addProseMirrorPlugins() {
    const editor = this.editor as Editor | null;
    if (!editor) return [];
    return [
      createSlashCommandPlugin({
        pluginKey: slashCommandPluginKey,
        editor,
        char: this.options.char ?? '/',
        ...(this.options.items !== undefined && { items: this.options.items }),
        render: this.options.render ?? createSlashSuggestionRenderer,
        invalidNodes: this.options.invalidNodes ?? ['codeBlock'],
      }),
    ];
  },
});

/**
 * Programmatically dismisses the slash suggestion.
 */
export function dismissSlashCommand(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta(slashCommandPluginKey, 'dismiss'));
}
