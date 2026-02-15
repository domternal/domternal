/**
 * Mention Suggestion Plugin
 *
 * Headless ProseMirror plugin that watches for trigger characters (e.g. '@', '#'),
 * tracks the query, supports async item fetching with debounce, and calls render
 * callbacks so framework wrappers can display a dropdown picker.
 *
 * Adapted from the emoji suggestion plugin with additions:
 * - Async items support with 150ms debounce
 * - Multiple plugin instances (one per trigger, unique PluginKey)
 * - Inline decoration on active trigger+query range
 * - invalidNodes context check
 * - appendText after insertion
 */
import { Plugin, PluginKey } from 'prosemirror-state';
import type { EditorState, Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { NodeType } from 'prosemirror-model';
import { Decoration, DecorationSet } from 'prosemirror-view';

// ─── Public Types ────────────────────────────────────────────────────────────

/** A single mention item returned by the items() callback. */
export interface MentionItem {
  /** Unique identifier (e.g., user ID, tag slug). */
  id: string;
  /** Display text (e.g., "John Doe", "feature-request"). */
  label: string;
  /** Allow extra data (avatar URL, email, role, etc.). */
  [key: string]: unknown;
}

/** Configuration for a single mention trigger. */
export interface MentionTrigger {
  /** Trigger character. Default: '@' */
  char: string;
  /** Unique name for this trigger type (e.g., 'user', 'tag'). */
  name: string;
  /** Fetch items matching a query. Supports sync and async (Promise). */
  items: (props: { query: string; trigger: MentionTrigger }) => MentionItem[] | Promise<MentionItem[]>;
  /** Render callbacks for the suggestion popup. */
  render?: () => MentionSuggestionRenderer;
  /** Minimum query length before showing suggestions. Default: 0 */
  minQueryLength?: number;
  /** Allow spaces in query. Default: false */
  allowSpaces?: boolean;
  /** Text to append after mention insertion. Default: ' ' (space) */
  appendText?: string;
  /** Node types where suggestion should NOT activate (e.g. ['codeBlock']). Default: [] */
  invalidNodes?: string[];
  /** Debounce delay in ms for items() calls. Use >0 for async/API-backed items. Default: 0 (immediate) */
  debounce?: number;
}

/** Props passed to suggestion renderer callbacks. */
export interface MentionSuggestionProps {
  /** Current query string (text after trigger char). */
  query: string;
  /** Document range of the trigger + query (for replacement). */
  range: { from: number; to: number };
  /** Filtered mention items matching the query. */
  items: MentionItem[];
  /** Call to insert a mention and close the suggestion. */
  command: (item: MentionItem) => void;
  /** Returns the client rect of the cursor for positioning the popup. */
  clientRect: (() => DOMRect | null) | null;
}

/** Render callbacks for the suggestion popup. */
export interface MentionSuggestionRenderer {
  /** Called when suggestion is first activated. */
  onStart: (props: MentionSuggestionProps) => void;
  /** Called when query or items change. */
  onUpdate: (props: MentionSuggestionProps) => void;
  /** Called when suggestion is deactivated. */
  onExit: () => void;
  /** Called on keydown — return true to prevent default editor handling. */
  onKeyDown: (event: KeyboardEvent) => boolean;
}

// ─── Internal Types ──────────────────────────────────────────────────────────

interface SuggestionPluginOptions {
  trigger: MentionTrigger;
  nodeType: NodeType | null;
}

interface SuggestionState {
  active: boolean;
  query: string;
  range: { from: number; to: number } | null;
}

const INITIAL_STATE: SuggestionState = {
  active: false,
  query: '',
  range: null,
};

// ─── Plugin Key Registry ─────────────────────────────────────────────────────

const pluginKeyCache = new Map<string, PluginKey<SuggestionState>>();

/** Get or create a PluginKey for a given trigger name. */
function getPluginKey(triggerName: string): PluginKey<SuggestionState> {
  let key = pluginKeyCache.get(triggerName);
  if (!key) {
    key = new PluginKey<SuggestionState>(`mentionSuggestion_${triggerName}`);
    pluginKeyCache.set(triggerName, key);
  }
  return key;
}

// ─── Query Detection ─────────────────────────────────────────────────────────

/**
 * Extracts the suggestion query from the current text before the cursor.
 * Returns null if no active suggestion is found.
 */
function findMentionQuery(
  state: EditorState,
  triggerChar: string,
  allowSpaces: boolean,
  invalidNodes: string[],
): { query: string; range: { from: number; to: number } } | null {
  const { selection } = state;

  // Only work with collapsed cursor selections
  if (!selection.empty) return null;

  const { $from } = selection;

  // Check if cursor is in an invalid node
  if (invalidNodes.length > 0) {
    const parentNodeType = $from.parent.type.name;
    if (invalidNodes.includes(parentNodeType)) return null;
  }

  const textBefore = $from.parent.textBetween(
    0,
    $from.parentOffset,
    undefined,
    '\ufffc',
  );

  // Find the last trigger character
  const triggerIndex = textBefore.lastIndexOf(triggerChar);
  if (triggerIndex === -1) return null;

  // The trigger must be at the start of the textblock or preceded by a space
  if (triggerIndex > 0 && textBefore[triggerIndex - 1] !== ' ') return null;

  const queryText = textBefore.slice(triggerIndex + triggerChar.length);

  // Query must contain only valid chars (alphanumeric, underscore, dash, dot, plus; spaces if allowed)
  const validPattern = allowSpaces
    ? /^[a-zA-Z0-9_.\-+ ]*$/
    : /^[a-zA-Z0-9_.\-+]*$/;
  if (!validPattern.test(queryText)) return null;

  const from = $from.start() + triggerIndex;
  const to = $from.pos;

  return { query: queryText, range: { from, to } };
}

// ─── Plugin Factory ──────────────────────────────────────────────────────────

/**
 * Creates a ProseMirror plugin for mention suggestion/autocomplete.
 * One plugin instance per trigger.
 */
export function createMentionSuggestionPlugin(
  options: SuggestionPluginOptions,
): Plugin {
  const { trigger, nodeType } = options;
  const triggerChar = trigger.char;
  const minQueryLength = trigger.minQueryLength ?? 0;
  const allowSpaces = trigger.allowSpaces ?? false;
  const appendText = trigger.appendText ?? ' ';
  const invalidNodes = trigger.invalidNodes ?? [];
  const getItems = trigger.items;
  const getRender = trigger.render;

  const key = getPluginKey(trigger.name);
  let renderer: MentionSuggestionRenderer | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const debounceMs = trigger.debounce ?? 0;

  function cleanup(): void {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  }

  function notifyRenderer(props: MentionSuggestionProps): void {
    if (!renderer && getRender) {
      renderer = getRender();
      renderer.onStart(props);
    } else if (renderer) {
      renderer.onUpdate(props);
    }
  }

  return new Plugin<SuggestionState>({
    key,

    state: {
      init(): SuggestionState {
        return { ...INITIAL_STATE };
      },

      apply(
        tr: Transaction,
        prev: SuggestionState,
        _oldState: EditorState,
        newState: EditorState,
      ): SuggestionState {
        // Dismiss via Escape key (or programmatic dismiss)
        if (tr.getMeta(key) === 'dismiss') {
          return { ...INITIAL_STATE };
        }

        // Check if this transaction is from user input
        const isUserInput = tr.docChanged || tr.selectionSet;
        if (!isUserInput) return prev;

        const result = findMentionQuery(newState, triggerChar, allowSpaces, invalidNodes);

        if (result && result.query.length >= minQueryLength) {
          return {
            active: true,
            query: result.query,
            range: result.range,
          };
        }

        // If was active and now no match, deactivate
        if (prev.active) {
          return { ...INITIAL_STATE };
        }

        return prev;
      },
    },

    view() {
      return {
        update(view: EditorView) {
          const pluginState = key.getState(view.state);
          if (!pluginState) return;

          if (pluginState.active && pluginState.range) {
            // Command reads current plugin state when invoked, not stale closure
            const command = (item: MentionItem): void => {
              const currentState = key.getState(view.state);
              if (!currentState?.range || !nodeType) return;

              const { tr } = view.state;
              const node = nodeType.create({
                id: item.id,
                label: item.label,
                type: trigger.name,
              });

              tr.replaceWith(currentState.range.from, currentState.range.to, node);

              if (appendText) {
                tr.insertText(appendText);
              }

              view.dispatch(tr);
            };

            const clientRect = (): DOMRect | null => {
              const currentState = key.getState(view.state);
              if (!currentState?.range) return null;
              try {
                const coords = view.coordsAtPos(currentState.range.from);
                return new DOMRect(coords.left, coords.top, 0, coords.bottom - coords.top);
              } catch {
                return null;
              }
            };

            // Fetch items and notify renderer
            const fetchAndRender = (): void => {
              const cur = key.getState(view.state);
              if (!cur?.active || !cur.range) return;

              const result = getItems({ query: cur.query, trigger });

              if (result instanceof Promise) {
                void result.then((items) => {
                  const latest = key.getState(view.state);
                  if (!latest?.active || !latest.range) return;
                  notifyRenderer({ query: latest.query, range: latest.range, items, command, clientRect });
                }).catch(() => {
                  // Swallow — suggestion stays active with no items
                });
              } else {
                notifyRenderer({ query: cur.query, range: cur.range, items: result, command, clientRect });
              }
            };

            cleanup();

            if (debounceMs > 0) {
              // Debounced: delay the entire items() call to avoid hammering APIs
              debounceTimer = setTimeout(fetchAndRender, debounceMs);
            } else {
              // Immediate: call items() now
              fetchAndRender();
            }
          } else if (renderer) {
            cleanup();
            renderer.onExit();
            renderer = null;
          }
        },

        destroy() {
          cleanup();
          if (renderer) {
            renderer.onExit();
            renderer = null;
          }
        },
      };
    },

    props: {
      handleKeyDown(view: EditorView, event: KeyboardEvent): boolean {
        const state = key.getState(view.state);
        if (!state?.active) return false;

        // Escape closes suggestion
        if (event.key === 'Escape') {
          const { tr } = view.state;
          tr.setMeta(key, 'dismiss');
          view.dispatch(tr);
          return true;
        }

        // Delegate to renderer for ArrowUp/Down/Enter
        if (renderer) {
          return renderer.onKeyDown(event);
        }

        return false;
      },

      decorations(state: EditorState): DecorationSet {
        const pluginState = key.getState(state);
        if (!pluginState?.active || !pluginState.range) {
          return DecorationSet.empty;
        }

        return DecorationSet.create(state.doc, [
          Decoration.inline(pluginState.range.from, pluginState.range.to, {
            class: 'mention-suggestion',
            nodeName: 'span',
          }),
        ]);
      },
    },
  });
}

// ─── Utilities ───────────────────────────────────────────────────────────────

/**
 * Programmatically dismiss the mention suggestion for a given trigger.
 * Dispatches a meta transaction to reset the plugin state.
 */
export function dismissMentionSuggestion(
  view: EditorView,
  triggerName: string,
): void {
  const key = getPluginKey(triggerName);
  const { tr } = view.state;
  tr.setMeta(key, 'dismiss');
  view.dispatch(tr);
}
