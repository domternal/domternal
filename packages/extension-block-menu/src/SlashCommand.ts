/**
 * `/` trigger that opens a filtered popup of insertable blocks. Items are
 * shared with FloatingMenu and BlockHandle via `addFloatingMenuItems()`.
 * On select, the `/query` range is deleted and the item's command runs at
 * the now-empty cursor (so "Heading 1" transforms the block, "Image" opens
 * its popover, etc.).
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
import { ReplaceStep } from '@domternal/pm/transform';
import { createSlashSuggestionRenderer } from './createSlashSuggestionRenderer.js';

export const slashCommandPluginKey = new PluginKey<SlashCommandPluginState>('slashCommand');

// Object Replacement Character (U+FFFC). ProseMirror uses it as the placeholder
// for leaf nodes when flattening a range to a string.
const PM_LEAF_PLACEHOLDER = '￼';

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
 * "Did the user just type the trigger char?" heuristic that gates popup
 * activation. True only for a single ReplaceStep inserting exactly the trigger
 * char (single-char slice, no depth). Rejects paste / programmatic insert
 * (slice.size > 1), selection-only changes (no steps), and undo/redo.
 *
 * Tying activation to the typing event, not the static presence of `/`,
 * matches Notion: a dismissed `/` becomes plain text and won't reopen the
 * popup when the user later clicks next to it.
 */
function justTypedTrigger(tr: Transaction, char: string): boolean {
  if (tr.steps.length !== 1) return false;
  const step = tr.steps[0];
  if (!(step instanceof ReplaceStep)) return false;
  const slice = step.slice;
  if (slice.size !== 1 || slice.openStart !== 0 || slice.openEnd !== 0) return false;
  const node = slice.content.firstChild;
  return !!(node && node.isText && node.text === char);
}

/** Resolves the current `/query` at the cursor, or null if not on a qualifying line. */
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
    PM_LEAF_PLACEHOLDER,
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
 * Removes items whose `hideWhenInside` matches the cursor's wrapping list type,
 * but ONLY when the cursor is in the label paragraph (first-child slot) of a
 * list item: picking the same list type there would lift the user out of the
 * list (`liftListItem` semantics), which is surprising.
 *
 * In the children zone (non-first paragraph) it's kept on purpose: picking the
 * same list type creates a nested sublist, which is useful and Notion-like.
 */
export function filterByCursorAncestors(
  items: FloatingMenuItem[],
  editor: Editor,
): FloatingMenuItem[] {
  const { $from } = editor.view.state.selection;

  // Find the nearest list-item ancestor; if the cursor is in its label slot,
  // record the wrapping list's type name.
  let wrappingListType: string | null = null;
  for (let d = $from.depth; d >= 1; d--) {
    const t = $from.node(d).type.name;
    if (t === 'listItem' || t === 'taskItem') {
      if ($from.index(d) === 0 && d >= 1) {
        wrappingListType = $from.node(d - 1).type.name;
      }
      break;
    }
  }

  return items.filter((item) => {
    if (!item.hideWhenInside || item.hideWhenInside.length === 0) return true;
    if (!wrappingListType) return true;
    return !item.hideWhenInside.includes(wrappingListType);
  });
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

  const ranked: { item: FloatingMenuItem; score: number }[] = [];
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

        // Neither doc nor selection changed: popup stays as-is.
        if (!tr.docChanged && !tr.selectionSet) return prev;

        // Branch 1: popup already active.
        // The query is the text between the trigger (`range.from`) and the
        // typed-end (`range.to`). `range.to` tracks WHAT THE USER TYPED, not
        // the cursor, so arrowing past existing text doesn't swallow chars
        // into the query.
        if (prev.active && prev.range) {
          let { from, to } = prev.range;

          if (tr.docChanged) {
            // Default bias (right): an insertion at the trigger position
            // pushes `/` forward and `from` follows; same for `to` so a char
            // typed at the query end extends the range.
            const fromResult = tr.mapping.mapResult(from);
            const toResult = tr.mapping.mapResult(to);
            if (fromResult.deleted) return { ...INITIAL_STATE };
            from = fromResult.pos;
            to = toResult.pos;

            // If the trigger char was replaced (autocomplete inserting at
            // `from`, paste over it), the session is gone.
            if (
              newState.doc.textBetween(from, from + 1, undefined, PM_LEAF_PLACEHOLDER) !== char
            ) {
              return { ...INITIAL_STATE };
            }
          }

          // Range selections make no sense for a single-cursor popup.
          if (!newState.selection.empty) return { ...INITIAL_STATE };
          const cursor = newState.selection.from;

          // Cursor must stay at or after the first query char (just past `/`).
          if (cursor < from + 1) return { ...INITIAL_STATE };

          if (cursor > to) {
            // Past the typed end is only legal as a side-effect of typing more
            // chars; a pure selection move past `to` means the user left the session.
            if (!tr.docChanged) return { ...INITIAL_STATE };
            to = cursor;
          }

          // Defensive: a collab edit may have turned the block into a code
          // block / invalidNodes type, where the session shouldn't survive.
          const $cursor = newState.doc.resolve(cursor);
          if ($cursor.parent.type.spec.code) return { ...INITIAL_STATE };
          if (invalidNodes.includes($cursor.parent.type.name)) {
            return { ...INITIAL_STATE };
          }

          const query = newState.doc.textBetween(
            from + 1,
            to,
            undefined,
            PM_LEAF_PLACEHOLDER,
          );
          if (/[\n\t]/.test(query)) return { ...INITIAL_STATE };

          return { active: true, query, range: { from, to } };
        }

        // Branch 2: popup inactive. Activation is gated to a real typing event
        // of the trigger char. Selection-only changes and bulk doc changes
        // (paste, programmatic insert) must NOT open the popup even when the
        // cursor lands right after an existing `/` (see justTypedTrigger).
        if (!tr.docChanged) return prev;
        if (!justTypedTrigger(tr, char)) return prev;

        const result = findSlashQuery(newState, char, invalidNodes);
        if (result) return { active: true, query: result.query, range: result.range };
        return prev;
      },
    },

    view(editorView) {
      // Cooperative dismissal: overlays broadcast `dm:dismiss-overlays` when
      // they open, so two floating menus never coexist. Suppress the handler
      // while WE dispatch, else the synchronous event would self-dismiss the
      // popup before `update` reaches `renderer.onStart`.
      const editorEl = editorView.dom.closest<HTMLElement>('.dm-editor');
      let suppressDismissHandler = false;
      const dismissHandler = (): void => {
        if (suppressDismissHandler) return;
        const state = pluginKey.getState(editor.view.state);
        if (state?.active) dismissSlashCommand(editor.view);
      };
      editorEl?.addEventListener('dm:dismiss-overlays', dismissHandler);

      // Fire the open-time dismiss only on the false->true transition.
      let wasActive = false;

      return {
        update(view: EditorView) {
          const state = pluginKey.getState(view.state);
          if (!state) return;

          // On activation, broadcast dismiss to close other overlays;
          // `suppressDismissHandler` keeps our own listener from self-dismissing.
          //
          // Flip `wasActive = true` BEFORE dispatching: the synchronous
          // dispatch re-enters this `update` (e.g. BlockHandle's
          // `onDismissOverlays` dispatches its own transaction). If `wasActive`
          // were still false the re-entry would fire a second
          // `dm:dismiss-overlays` whose nested `finally` clears
          // `suppressDismissHandler`, letting our listener tear down the popup
          // we just created (and a null `clientRect()` then paints it unpositioned).
          const becameActive = state.active && !wasActive;
          wasActive = state.active;
          if (becameActive) {
            suppressDismissHandler = true;
            try {
              editorEl?.dispatchEvent(new Event('dm:dismiss-overlays', { bubbles: false }));
            } finally {
              suppressDismissHandler = false;
            }
          }

          if (state.active && state.range) {
            const items = FloatingMenuController.resolveItems(editor, itemsOverride);
            const contextual = filterByCursorAncestors(items, editor);
            const filtered = filterSlashItems(contextual, state.query);

            const command = (item: FloatingMenuItem): void => {
              const current = pluginKey.getState(view.state);
              if (!current?.range) return;

              // Delete the `/query` range first so the item's command runs on
              // a clean cursor. Close popup state in the same tr to avoid a flash.
              const tr = view.state.tr;
              tr.delete(current.range.from, current.range.to);
              tr.setMeta(pluginKey, 'dismiss');
              view.dispatch(tr);

              // Execute on a fresh transaction (reads latest state). No focus()
              // call: items that open a popover need it to claim focus, and
              // simple inserts already leave focus in the editor.
              FloatingMenuController.executeItem(editor, item);
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
          editorEl?.removeEventListener('dm:dismiss-overlays', dismissHandler);
          if (renderer) {
            try {
              renderer.onExit();
            } finally {
              renderer = null;
            }
          }
        },
      };
    },

    props: {
      // handleDOMEvents.keydown (not handleKeyDown) so we intercept keys before
      // other keymap plugins claim them (same trick as Mention).
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

/** Programmatically dismisses the slash suggestion. */
export function dismissSlashCommand(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta(slashCommandPluginKey, 'dismiss'));
}
