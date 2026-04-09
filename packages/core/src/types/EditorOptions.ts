import type { Schema } from '@domternal/pm/model';
import type { Content } from './Content.js';
import type {
  CreateEventProps,
  TransactionEventProps,
  FocusEventProps,
  ContentErrorProps,
  MountEventProps,
  ErrorEventProps,
} from './EditorEvents.js';
/**
 * Type-erased base for Extension, Node, and Mark.
 *
 * The Extension class has generic Options/Storage parameters, and methods
 * like `configure(options: Partial<Options>)` that make Options contravariant.
 * This means `Extension<MyOptions>` is not assignable to `Extension<unknown>`.
 *
 * AnyExtension uses an interface with only the properties that ExtensionManager
 * and the editor need at runtime, avoiding the generic variance issue. Every
 * Extension<O, S>, Node<O, S>, and Mark<O, S> structurally satisfies this
 * interface regardless of their generic parameters.
 */
export interface AnyExtension {
  readonly type: 'extension' | 'node' | 'mark';
  readonly name: string;
  readonly options: unknown;
  storage: unknown;
  readonly config: unknown;
  editor: unknown;
  parent?: ((...args: unknown[]) => unknown) | undefined;
}

/**
 * Autofocus options for the editor
 * - true: Focus at the end
 * - false: Don't autofocus
 * - null: Explicitly no autofocus
 * - 'start': Focus at the beginning
 * - 'end': Focus at the end
 * - 'all': Select all content
 * - number: Focus at specific position
 */
export type FocusPosition = boolean | 'start' | 'end' | 'all' | number | null;

/**
 * Configuration options for creating an Editor instance
 */
export interface EditorOptions {
  /**
   * ProseMirror Schema for the editor
   *
   * Step 1.3: Required (no extensions system yet)
   * Step 2+: Optional if extensions are provided (schema built from extensions)
   *
   * The schema must contain at least 'doc' and 'text' nodes.
   */
  schema?: Schema;

  /**
   * HTML element to mount the editor
   * If not provided, creates a detached div (useful for testing/headless mode)
   */
  element?: HTMLElement | null;

  /**
   * Initial content (JSON or HTML string)
   * @default null (empty document)
   */
  content?: Content;

  /**
   * Extensions to load
   * @default []
   */
  extensions?: AnyExtension[];

  /**
   * Whether the editor is editable
   * @default true
   */
  editable?: boolean;

  /**
   * Autofocus behavior on mount
   * @default false
   */
  autofocus?: FocusPosition;

  /**
   * Transform function applied to clipboard HTML on copy/cut.
   * Use with `inlineStyles` from core to auto-apply inline CSS on copy:
   *
   * @example
   * ```ts
   * import { inlineStyles } from '@domternal/core';
   * new Editor({ clipboardHTMLTransform: inlineStyles });
   * ```
   */
  clipboardHTMLTransform?: (html: string) => string;

  // === Event Callbacks ===

  /**
   * Called before the editor is created
   * Can be used to modify options
   */
  onBeforeCreate?: (props: CreateEventProps) => void;

  /**
   * Called when the editor is created and ready
   */
  onCreate?: (props: CreateEventProps) => void;

  /**
   * Called when editor view is mounted to DOM
   */
  onMount?: (props: MountEventProps) => void;

  /**
   * Called when the document content changes
   */
  onUpdate?: (props: TransactionEventProps) => void;

  /**
   * Called when selection changes (without content change)
   */
  onSelectionUpdate?: (props: TransactionEventProps) => void;

  /**
   * Called on every transaction
   */
  onTransaction?: (props: TransactionEventProps) => void;

  /**
   * Called when editor receives focus
   */
  onFocus?: (props: FocusEventProps) => void;

  /**
   * Called when editor loses focus
   */
  onBlur?: (props: FocusEventProps) => void;

  /**
   * Called before editor is destroyed
   */
  onDestroy?: () => void;

  /**
   * Called when content doesn't match schema (AD-8)
   * Use this to handle content validation errors gracefully
   */
  onContentError?: (props: ContentErrorProps) => void;

  /**
   * Called when an extension throws an error (2.7: Extension Error Isolation)
   * Allows graceful error handling without crashing the editor
   */
  onError?: (props: ErrorEventProps) => void;
}