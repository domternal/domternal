import type { Transaction } from '@domternal/pm/state';
import type { EditorView } from '@domternal/pm/view';
import type { ContentDiagnostic } from './Content.js';

/**
 * Editor instance type (forward declaration to avoid circular dependency)
 * Will be properly typed when Editor class is implemented
 */
export interface EditorInstance {
  // Minimal interface - will be extended when Editor is implemented
  readonly view: unknown;
  readonly state: unknown;
}

/**
 * Props passed to the `transaction`, `selectionUpdate` and `update` handlers.
 *
 * A dispatch applies the root transaction and the transactions plugins append
 * to it (`appendTransaction`). The handlers run once per accepted root, after
 * the view shows the new state; see `EditorEvents` for the full contract.
 */
export interface TransactionEventProps {
  editor: EditorInstance;
  /**
   * The dispatched root transaction. In `update` its `docChanged` can be
   * false when only an appended transaction changed the document.
   */
  transaction: Transaction;
  /**
   * The accepted transactions plugins appended to the root, in the order they
   * were applied; empty when there are none. The editor always sets it; it is
   * optional only so that code emitting these events itself keeps compiling.
   */
  appendedTransactions?: readonly Transaction[];
}

/**
 * Props passed to focus/blur event handlers
 */
export interface FocusEventProps {
  editor: EditorInstance;
  event: FocusEvent;
}

/**
 * Props passed to create event handler
 */
export interface CreateEventProps {
  editor: EditorInstance;
}

/**
 * Props passed to content error handler (AD-8: Content Validation)
 */
export interface ContentErrorProps {
  editor: EditorInstance;
  /** The validation error that occurred */
  error: Error;
  /** The original content that failed validation */
  content: unknown;
}

/**
 * Props passed to content diagnostic handlers. Emitted when the editor
 * replaced values, such as unknown list markers or heading levels its
 * configuration lacks: in JSON content it loaded, or in its document through
 * the normalizeContentAttributes command.
 */
export interface ContentDiagnosticProps {
  editor: EditorInstance;
  /**
   * Where the content came from; in a command chain, the first command that
   * reported. The list is open: a minor release can add an entry point, so
   * keep a default branch when you switch on it.
   */
  source: 'content' | 'setContent' | 'insertContent' | 'normalizeContentAttributes';
  /** The first 100 diagnostics. */
  diagnostics: readonly ContentDiagnostic[];
  /** How many values were replaced, including any beyond `diagnostics`. */
  total: number;
}

/**
 * Props passed to mount event handler
 */
export interface MountEventProps {
  editor: EditorInstance;
  view: unknown;
}

/** The editor view has moved to a different DOM mounting context. */
export interface AdoptEventProps {
  editor: EditorInstance;
  view: EditorView;
  element: HTMLElement;
  /** The closest editor UI host, if the consumer provides one. */
  host: HTMLElement | null;
  previousHost: HTMLElement | null;
}

/**
 * Props passed to error event handler (2.7: Extension Error Isolation)
 */
export interface ErrorEventProps {
  editor: EditorInstance;
  /** The error that was thrown */
  error: Error;
  /** Context describing where the error occurred (e.g., 'Bold.onUpdate', 'History.addProseMirrorPlugins') */
  context: string;
}

/**
 * All editor events with their payload types.
 *
 * Transaction callback contract. `editor.view.dispatch(tr)` applies the root
 * transaction and every transaction plugins append to it:
 *
 * - When a plugin's `filterTransaction` rejects the root, nothing changes and
 *   nothing runs: no view update, event, option callback or extension hook,
 *   and no `contentDiagnostic`. When it rejects only an appended transaction,
 *   the root and the other appended transactions still apply.
 * - For an accepted root, in this order: plugin views update with the new
 *   state; `transaction` (event, then the `onTransaction` option, then
 *   extension `onTransaction` hooks) once per root, never per appended
 *   transaction; `contentDiagnostic` when the root reported replaced values;
 *   then either `selectionUpdate` or `update`, each as event, option and
 *   extension hook.
 * - `update` runs when any accepted transaction, root or appended, changed the
 *   document, unless the root carries the `skipUpdate` meta. `selectionUpdate`
 *   runs when none changed the document and at least one set the selection.
 * - A listener that dispatches runs the nested transaction's whole sequence
 *   before the outer one continues, so later listeners can see a newer
 *   `editor.state` than their payload: read `editor.state`, not
 *   `transaction.doc`, for the current document.
 * - A listener that destroys the editor ends the sequence.
 * - Event listeners and option callbacks are not isolated: an error thrown
 *   there reaches the caller of `dispatch` and ends the sequence, with the new
 *   state already installed. Extension hooks are isolated and report through
 *   `error`.
 * - Transactions plugin views dispatch while the editor is constructed are
 *   applied without any callback; they are initial state.
 * - Commands and `chain().run()` return true when they dispatched, even when
 *   a plugin vetoed the transaction. An accepted dispatch always installs a
 *   new `editor.state` object, so the same object before and after a call
 *   means nothing was applied.
 */
export interface EditorEvents {
  /** Fired before editor is created - can modify options */
  beforeCreate: CreateEventProps;

  /** Fired when editor is created and ready */
  create: CreateEventProps;

  /**
   * Fired after an accepted dispatch in which the root or an appended
   * transaction changed the document, unless the root has the `skipUpdate`
   * meta (programmatic writes such as `setContent(content, { emitUpdate: false })`).
   */
  update: TransactionEventProps;

  /**
   * Fired after an accepted dispatch that set the selection without any
   * accepted transaction changing the document.
   */
  selectionUpdate: TransactionEventProps;

  /**
   * Fired once for every accepted root transaction, whatever it changed;
   * never for a transaction a plugin vetoed.
   */
  transaction: TransactionEventProps;

  /** Fired when editor receives focus */
  focus: FocusEventProps;

  /** Fired when editor loses focus */
  blur: FocusEventProps;

  /** Fired before editor is destroyed (no payload) */
  destroy: undefined;

  /** Fired when content doesn't match schema (AD-8) */
  contentError: ContentErrorProps;

  /**
   * Fired when content loaded with replaced values: after the initial
   * document is built, or after an accepted transaction from setContent,
   * insertContent or normalizeContentAttributes. Dry runs never fire it.
   */
  contentDiagnostic: ContentDiagnosticProps;

  /** Fired when editor view is mounted to DOM */
  mount: MountEventProps;

  /** Fired after adopting the existing view into a different DOM context. */
  adopt: AdoptEventProps;

  /** Fired when an extension throws an error (2.7: Extension Error Isolation) */
  error: ErrorEventProps;

  /** Fired when link editing UI should open (toolbar link button, Ctrl+K) */
  linkEdit: { anchorElement?: HTMLElement };

  /** Fired when the Notion color picker should open, with the trigger as anchor. */
  notionColorOpen: { anchorElement?: HTMLElement | null };

  /**
   * Fired after the document has been marked for printing and before the
   * browser's print dialog opens. Listeners run synchronously: this is the
   * last moment to add page rules or set `document.title`.
   */
  beforePrint: { root: HTMLElement };

  /** Fired once the print dialog is done and the print marks are removed. */
  afterPrint: undefined;
}

/**
 * Event names as a type
 */
export type EditorEventName = keyof EditorEvents;
