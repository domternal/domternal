/**
 * Suggestion Plugin for Emoji Autocomplete
 *
 * Headless ProseMirror plugin that watches for a trigger character (default: ':'),
 * tracks the query, and calls render callbacks so framework wrappers can display
 * a dropdown picker.
 *
 * This is a zero-dependency implementation — no external suggestion library needed.
 */
import { Plugin, PluginKey } from 'prosemirror-state';
import type { EditorState, Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { NodeType } from 'prosemirror-model';
import type { EmojiItem } from './emojis.js';
import type { EmojiStorage } from './Emoji.js';

/** Plugin key for external access to suggestion state. */
export const emojiSuggestionPluginKey = new PluginKey<SuggestionState>(
  'emojiSuggestion',
);

export interface SuggestionProps {
  /** Current query string (text after trigger char). */
  query: string;
  /** Document range of the trigger + query (for replacement). */
  range: { from: number; to: number };
  /** Filtered emoji items matching the query. */
  items: EmojiItem[];
  /** Call to insert an emoji and close the suggestion. */
  command: (item: EmojiItem) => void;
  /** Returns the client rect of the cursor for positioning the popup. */
  clientRect: (() => DOMRect | null) | null;
  /** The ProseMirror editor DOM element (for appending popups inside the editor tree). */
  element: HTMLElement;
}

export interface SuggestionRenderer {
  /** Called when suggestion is first activated. */
  onStart: (props: SuggestionProps) => void;
  /** Called when query or items change. */
  onUpdate: (props: SuggestionProps) => void;
  /** Called when suggestion is deactivated. */
  onExit: () => void;
  /** Called on keydown — return true to prevent default editor handling. */
  onKeyDown: (event: KeyboardEvent) => boolean;
}

export interface SuggestionOptions {
  /** Trigger character. Default: ':' */
  char?: string;
  /** Minimum query length before showing suggestions. Default: 0 */
  minQueryLength?: number;
  /** Filter/sort items for a given query. */
  items?: (props: { query: string }) => EmojiItem[];
  /** Render callbacks for the suggestion popup. */
  render?: () => SuggestionRenderer;
  /** Allow spaces in query. Default: false */
  allowSpaces?: boolean;
}

interface SuggestionPluginOptions extends SuggestionOptions {
  editor: unknown;
  nodeType: NodeType | null;
  storage: EmojiStorage;
  plainText: boolean;
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

/**
 * Extracts the suggestion query from the current text before the cursor.
 * Returns null if no active suggestion is found.
 */
function findSuggestionQuery(
  state: EditorState,
  triggerChar: string,
  allowSpaces: boolean,
): { query: string; range: { from: number; to: number } } | null {
  const { selection } = state;

  // Only work with collapsed cursor selections
  if (!selection.empty) return null;

  const { $from } = selection;

  // Don't activate inside code contexts (codeBlock node or inline code mark)
  if ($from.parent.type.spec.code) return null;
  const activeMarks = state.storedMarks ?? $from.marks();
  if (activeMarks.some((m) => m.type.name === 'code')) return null;

  const textBefore = $from.parent.textBetween(
    0,
    $from.parentOffset,
    undefined,
    '\ufffc',
  );

  // Find the last trigger character
  const triggerIndex = textBefore.lastIndexOf(triggerChar);
  if (triggerIndex === -1) return null;

  // The trigger must be at the start or preceded by a space
  if (triggerIndex > 0 && textBefore[triggerIndex - 1] !== ' ') return null;

  const queryText = textBefore.slice(triggerIndex + triggerChar.length);

  // Validate query: no spaces (unless allowed), only valid chars
  if (!allowSpaces && queryText.includes(' ')) return null;

  // Query must be alphanumeric/underscore/dash/plus
  if (!/^[a-zA-Z0-9_+\- ]*$/.test(queryText)) return null;

  const from = $from.start() + triggerIndex;
  const to = $from.pos;

  return { query: queryText, range: { from, to } };
}

/**
 * Creates a ProseMirror plugin for emoji suggestion/autocomplete.
 */
export function createSuggestionPlugin(
  options: SuggestionPluginOptions,
): Plugin {
  const triggerChar = options.char ?? ':';
  const minQueryLength = options.minQueryLength ?? 0;
  const allowSpaces = options.allowSpaces ?? false;
  const getItems = options.items;
  const getRender = options.render;
  const { nodeType, storage, plainText } = options;

  let renderer: SuggestionRenderer | null = null;

  return new Plugin<SuggestionState>({
    key: emojiSuggestionPluginKey,

    state: {
      init(): SuggestionState {
        return { ...INITIAL_STATE };
      },

      apply(tr: Transaction, prev: SuggestionState, _oldState: EditorState, newState: EditorState): SuggestionState {
        // Dismiss via Escape key (or programmatic dismiss)
        if (tr.getMeta(emojiSuggestionPluginKey) === 'dismiss') {
          return { ...INITIAL_STATE };
        }

        // Check if this transaction is from user input
        const isUserInput = tr.docChanged || tr.selectionSet;
        if (!isUserInput) return prev;

        const result = findSuggestionQuery(newState, triggerChar, allowSpaces);

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
          const state = emojiSuggestionPluginKey.getState(view.state);
          if (!state) return;

          if (state.active && state.range) {
            const items = getItems
              ? getItems({ query: state.query })
              : storage.searchEmoji(state.query);

            const command = (item: EmojiItem): void => {
              if (!state.range) return;

              const { tr } = view.state;

              if (plainText) {
                tr.replaceWith(
                  state.range.from,
                  state.range.to,
                  view.state.schema.text(item.emoji),
                );
              } else if (nodeType) {
                const node = nodeType.create({ name: item.name });
                tr.replaceWith(state.range.from, state.range.to, node);
              }

              // Add a space after the emoji
              tr.insertText(' ');
              view.dispatch(tr);

              storage.addFrequentlyUsed(item.name);
            };

            const clientRect = (): DOMRect | null => {
              if (!state.range) return null;
              try {
                const coords = view.coordsAtPos(state.range.from);
                return new DOMRect(coords.left, coords.top, 0, coords.bottom - coords.top);
              } catch {
                return null;
              }
            };

            const props: SuggestionProps = {
              query: state.query,
              range: state.range,
              items,
              command,
              clientRect,
              element: view.dom,
            };

            if (!renderer && getRender) {
              renderer = getRender();
              renderer.onStart(props);
            } else if (renderer) {
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
      // Use handleDOMEvents.keydown instead of handleKeyDown so that
      // suggestion key handling fires BEFORE keymap plugins (which use
      // handleKeyDown and would otherwise intercept Enter/ArrowUp/ArrowDown).
      handleDOMEvents: {
        keydown(view: EditorView, event: KeyboardEvent): boolean {
          const state = emojiSuggestionPluginKey.getState(view.state);
          if (!state?.active) return false;

          // Escape closes suggestion
          if (event.key === 'Escape') {
            event.preventDefault();
            const { tr } = view.state;
            tr.setMeta(emojiSuggestionPluginKey, 'dismiss');
            view.dispatch(tr);
            return true;
          }

          // Delegate to renderer for ArrowUp/Down/Enter
          if (renderer) {
            const handled = renderer.onKeyDown(event);
            if (handled) {
              event.preventDefault();
            }
            return handled;
          }

          return false;
        },
      },
    },
  });
}
