/**
 * Command Props Builder - Shared utility for building CommandProps
 *
 * Provides a factory for creating CommandProps objects with configurable
 * dispatch behavior, used by both ChainBuilder and CanChecker.
 */
import type { EditorState, Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
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
 * If a command creates a new transaction, its steps are copied to the shared one.
 */
export function createAccumulatingDispatch(sharedTr: Transaction): (tr: Transaction) => void {
  return (transaction: Transaction): void => {
    if (transaction !== sharedTr) {
      for (const step of transaction.steps) {
        sharedTr.step(step);
      }
    }
  };
}
