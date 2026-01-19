import type { Transaction } from 'prosemirror-state';

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
  error: Error;
  disableCollaboration: () => void;
}

/**
 * Props passed to paste event handler
 */
export interface PasteEventProps {
  editor: EditorInstance;
  event: ClipboardEvent;
  /** ProseMirror Slice of pasted content */
  slice: unknown;
}

/**
 * Props passed to drop event handler
 */
export interface DropEventProps {
  editor: EditorInstance;
  event: DragEvent;
  /** ProseMirror Slice of dropped content */
  slice: unknown;
  /** Whether the content was moved (true) or copied (false) */
  moved: boolean;
}

/**
 * Props passed to mount event handler
 */
export interface MountEventProps {
  editor: EditorInstance;
}

/**
 * Props passed to delete event handler
 */
export interface DeleteEventProps {
  editor: EditorInstance;
  /** Start position of deleted content */
  from: number;
  /** End position of deleted content */
  to: number;
}

/**
 * All editor events with their payload types
 * Used by EventEmitter for type-safe event handling
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

  /** Fired when content is pasted */
  paste: PasteEventProps;

  /** Fired when content is dropped */
  drop: DropEventProps;

  /** Fired when editor view is mounted to DOM */
  mount: MountEventProps;

  /** Fired when editor view is unmounted from DOM */
  unmount: MountEventProps;

  /** Fired when content is deleted */
  delete: DeleteEventProps;
}

/**
 * Event names as a type
 */
export type EditorEventName = keyof EditorEvents;
