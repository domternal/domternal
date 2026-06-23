import type { Transaction } from '@domternal/pm/state';

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
 * Props passed to event handlers that include transaction
 */
export interface TransactionEventProps {
  editor: EditorInstance;
  transaction: Transaction;
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
 * Props passed to mount event handler
 */
export interface MountEventProps {
  editor: EditorInstance;
  view: unknown;
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
 */
export interface EditorEvents {
  /** Fired before editor is created - can modify options */
  beforeCreate: CreateEventProps;

  /** Fired when editor is created and ready */
  create: CreateEventProps;

  /** Fired when document content changes */
  update: TransactionEventProps;

  /** Fired when selection changes (without content change) */
  selectionUpdate: TransactionEventProps;

  /** Fired on every transaction (content or selection) */
  transaction: TransactionEventProps;

  /** Fired when editor receives focus */
  focus: FocusEventProps;

  /** Fired when editor loses focus */
  blur: FocusEventProps;

  /** Fired before editor is destroyed (no payload) */
  destroy: undefined;

  /** Fired when content doesn't match schema (AD-8) */
  contentError: ContentErrorProps;

  /** Fired when editor view is mounted to DOM */
  mount: MountEventProps;

  /** Fired when an extension throws an error (2.7: Extension Error Isolation) */
  error: ErrorEventProps;

  /** Fired when link editing UI should open (toolbar link button, Ctrl+K) */
  linkEdit: { anchorElement?: HTMLElement };

  /** Fired when the Notion color picker should open, with the trigger as anchor. */
  notionColorOpen: { anchorElement?: HTMLElement | null };
}

/**
 * Event names as a type
 */
export type EditorEventName = keyof EditorEvents;
