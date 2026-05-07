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
import { ReplaceStep } from '@domternal/pm/transform';
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
 * Returns `true` only when the transaction's effect was inserting EXACTLY
 * the trigger character as a single ReplaceStep with a single-char text
 * slice (no opening/closing depth, no surrounding inserted content).
 *
 * This is the "did the user just type `/`" heuristic that gates popup
 * activation. It distinguishes:
 *   - real typing (`/`)                      ✓
 *   - typing `/` while a range was selected  ✓ (one ReplaceStep, slice "/")
 *   - paste of `/text...`                    ✗ (slice.size > 1)
 *   - programmatic `insertContent('/foo')`   ✗ (slice.size > 1)
 *   - selection-only changes (click/arrow)   ✗ (no steps)
 *   - undo/redo creating a `/`               ✗ (multi-step / non-Replace)
 *
 * Rationale: tying activation to the typing event - not to the static
 * presence of `/` before the cursor - matches Notion. Once a slash session
 * is dismissed, the same `/` becomes plain text and doesn't reopen the
 * popup if the user later clicks back next to it.
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

        // Neither doc nor selection changed - nothing to do (popup stays as-is).
        if (!tr.docChanged && !tr.selectionSet) return prev;

        // ── Branch 1: popup was ALREADY active ─────────────────────────
        // Re-derive on every change: typing extends the query, backspace
        // shrinks it, deleting the trigger or moving the cursor out of
        // range deactivates. This is the same logic as before.
        if (prev.active) {
          // Doc-only change (collab edit) while the user's cursor stayed
          // put: just map the range through the new positions.
          if (tr.docChanged && !tr.selectionSet && prev.range) {
            const from = tr.mapping.mapResult(prev.range.from);
            const to = tr.mapping.mapResult(prev.range.to);
            if (from.deleted || to.deleted) return { ...INITIAL_STATE };
            return { ...prev, range: { from: from.pos, to: to.pos } };
          }
          const result = findSlashQuery(newState, char, invalidNodes);
          if (result) return { active: true, query: result.query, range: result.range };
          return { ...INITIAL_STATE };
        }

        // ── Branch 2: popup was INACTIVE ───────────────────────────────
        // Activation is gated to a real typing event of the trigger char.
        // Selection-only changes (mouse click into existing `/text`,
        // arrow-key navigation) and bulk doc changes (paste, programmatic
        // `insertContent` of >1 char) MUST NOT open the popup, even if
        // the cursor lands right after a `/` already in the document.
        // This keeps the slash menu tied to a typing session - matching
        // Notion: once the session is dismissed, the same `/` becomes
        // plain text and clicking back next to it doesn't reopen anything.
        if (!tr.docChanged) return prev;
        if (!justTypedTrigger(tr, char)) return prev;

        const result = findSlashQuery(newState, char, invalidNodes);
        if (result) return { active: true, query: result.query, range: result.range };
        return prev;
      },
    },

    view(editorView) {
      // Cooperative dismissal: other overlays broadcast `dm:dismiss-overlays`
      // when they open; listen and close the slash popup so two floating
      // menus never appear at once. We suppress the handler while WE are
      // the one dispatching - otherwise the slash popup would dismiss
      // itself the moment it opens (the dispatch is synchronous and reaches
      // our own listener before `update` reaches `renderer.onStart`).
      const editorEl = editorView.dom.closest<HTMLElement>('.dm-editor');
      let suppressDismissHandler = false;
      const dismissHandler = (): void => {
        if (suppressDismissHandler) return;
        const state = pluginKey.getState(editor.view.state);
        if (state?.active) dismissSlashCommand(editor.view);
      };
      editorEl?.addEventListener('dm:dismiss-overlays', dismissHandler);

      // Track whether we've already fired the open-time dismiss so we only
      // do it on transition false→true.
      let wasActive = false;

      return {
        update(view: EditorView) {
          const state = pluginKey.getState(view.state);
          if (!state) return;

          // On activation (first true after being false), broadcast dismiss
          // to close any other overlays that might be open. The local
          // suppression flag prevents our own dismissHandler from firing
          // back at us (the dispatch is synchronous and would otherwise
          // self-dismiss the popup the instant it opens).
          //
          // We MUST flip `wasActive = true` BEFORE dispatching, not after.
          // The dispatch synchronously triggers other listeners (e.g.
          // BlockHandle's `onDismissOverlays` which itself dispatches a
          // ProseMirror transaction to clear `hoveredPos`); that re-enters
          // this same `update` callback. Without flipping `wasActive` first
          // the re-entry would think the popup is still opening and dispatch
          // a *second* `dm:dismiss-overlays` whose nested `finally` would
          // reset `suppressDismissHandler` to false - letting our own
          // dismiss listener fire on the way out and tear down the popup
          // we just created. (`clientRect()` then returns null because the
          // plugin state was just cleared, so the second `onStart` paints
          // an unpositioned popup at the bottom of `.dm-editor`.)
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
              // read the latest state). Items that open a popover (Image
              // URL, Link, etc.) need the popover to claim focus - don't
              // force focus back to the editor here. Simple insert items
              // already leave focus in the editor, so no focus() call is
              // needed in either case.
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
