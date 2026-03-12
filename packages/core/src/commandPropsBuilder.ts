/**
 * Command Props Builder - Shared utility for building CommandProps
 *
 * Provides a factory for creating CommandProps objects with configurable
 * dispatch behavior, used by both ChainBuilder and CanChecker.
 */
import { TextSelection } from '@domternal/pm/state';
import type { EditorState, Transaction } from '@domternal/pm/state';
import type { EditorView } from '@domternal/pm/view';
import type {
  CommandProps,
  ChainedCommands,
  CanCommands,
  SingleCommands,
} from './types/Commands.js';

/**
 * Minimal editor interface for command props building
 */
export interface CommandPropsEditor {
  readonly view: EditorView;
  readonly state: EditorState;
}

/**
 * Options for building CommandProps
 */
export interface BuildCommandPropsOptions {
  /** The editor instance */
  editor: CommandPropsEditor;

  /** The transaction to use */
  tr: Transaction;

  /**
   * Dispatch function - undefined for dry-run mode
   * In chain mode, this accumulates changes on shared transaction
   */
  dispatch: ((tr: Transaction) => void) | undefined;

  /** Function to create chain commands */
  chain: () => ChainedCommands;

  /** Function to create can commands */
  can: () => CanCommands;

  /** Function to create single commands */
  commands: () => SingleCommands;
}

/**
 * Builds a CommandProps object with the given options
 *
 * @example
 * // For chain mode with dispatch
 * const props = buildCommandProps({
 *   editor,
 *   tr,
 *   dispatch: (transaction) => { ... },
 *   chain: () => this.proxy(),
 *   can: () => this.buildCanCommands(),
 *   commands: () => this.buildSingleCommands(),
 * });
 *
 * @example
 * // For dry-run mode (can check)
 * const props = buildCommandProps({
 *   editor,
 *   tr,
 *   dispatch: undefined,
 *   chain: () => createChainBuilder(),
 *   can: () => this.proxy(),
 *   commands: () => this.buildSingleCommands(tr),
 * });
 */
export function buildCommandProps(options: BuildCommandPropsOptions): CommandProps {
  const { editor, tr, dispatch, chain, can, commands } = options;

  return {
    // Cast required: CommandPropsEditor is a minimal interface, but CommandProps
    // expects full Editor. Callers ensure the actual editor instance is passed.
    editor: editor as CommandProps['editor'],
    state: editor.view.state,
    tr,
    dispatch,
    chain,
    can,
    commands: commands(),
  };
}

/**
 * Creates a dispatch function that accumulates steps on a shared transaction
 *
 * Used in chain mode where multiple commands share the same transaction.
 * If a command creates a new transaction, its steps and metadata are copied
 * to the shared one.
 *
 * Metadata propagation is critical for commands like undo/redo:
 * prosemirror-history sets metadata (addToHistory, plugin state) on its
 * transactions. Without copying this metadata, the shared transaction
 * would be recorded as a new history entry, causing undo to oscillate.
 */
export function createAccumulatingDispatch(sharedTr: Transaction): (tr: Transaction) => void {
  return (transaction: Transaction): void => {
    if (transaction !== sharedTr) {
      for (const step of transaction.steps) {
        sharedTr.step(step);
      }

      // Copy metadata from accumulated transaction to shared transaction.
      // ProseMirror stores metadata as a plain object (tr.meta) accessed
      // via getMeta/setMeta. We access it directly to iterate all entries.
      // Critical for undo/redo: prosemirror-history sets addToHistory and
      // plugin state metadata that must be on the dispatched transaction.
      const meta = (transaction as unknown as { meta: Record<string, unknown> }).meta;
      for (const key of Object.keys(meta)) {
        sharedTr.setMeta(key, meta[key]);
      }

      // Copy selection if the accumulated transaction explicitly set one.
      // This ensures commands like undo/redo restore the cursor to the
      // correct position (mapped back through inverted steps).
      // We must re-create the selection against sharedTr.doc because
      // ResolvedPos objects are bound to their document instance.
      if (transaction.selectionSet) {
        const { from, to } = transaction.selection;
        try {
          sharedTr.setSelection(TextSelection.create(sharedTr.doc, from, to));
        } catch {
          // Positions may be invalid if documents diverged - skip
        }
      }
    }
  };
}
