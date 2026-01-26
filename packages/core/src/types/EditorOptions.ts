import type { Schema } from 'prosemirror-model';
import type { Content } from './Content.js';
import type {
  CreateEventProps,
  TransactionEventProps,
  FocusEventProps,
  ContentErrorProps,
  PasteEventProps,
  DropEventProps,
  MountEventProps,
  DeleteEventProps,
  ErrorEventProps,
} from './EditorEvents.js';
import type { Extension } from '../Extension.js';
import type { Node } from '../Node.js';
import type { Mark } from '../Mark.js';

/**
 * Union type for all extension types
 * - Extension: Pure functionality (History, Placeholder)
 * - Node: Schema nodes (Paragraph, Heading)
 * - Mark: Schema marks (Bold, Italic)
 */
export type AnyExtension = Extension | Node | Mark;

/**
 * Text direction for the editor
 */
export type TextDirection = 'ltr' | 'rtl';

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
   * Enable input rules (markdown shortcuts like **bold**)
   * @default true
   */
  enableInputRules?: boolean;

  /**
   * Enable paste rules (auto-linking URLs, etc.)
   * @default true
   */
  enablePasteRules?: boolean;

  /**
   * Validate content against schema (AD-8: Content Validation)
   * When true, warns about content that doesn't match the schema
   * @default true
   */
  enableContentCheck?: boolean;

  /**
   * Inject custom CSS into the editor
   */
  injectCSS?: boolean;

  /**
   * Nonce for CSP (Content Security Policy) compliance
   * Added to injected style tags
   */
  injectNonce?: string;

  /**
   * HTML attributes to add to the editor element
   */
  editorProps?: Record<string, unknown>;

  /**
   * Parse options for HTML content
   */
  parseOptions?: Record<string, unknown>;

  /**
   * Text direction for RTL language support
   * @default 'ltr'
   */
  textDirection?: TextDirection;

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
   * Called when editor view is unmounted from DOM
   */
  onUnmount?: (props: MountEventProps) => void;

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
   * Called when content is pasted
   * Return true to prevent default paste handling
   */
  onPaste?: (props: PasteEventProps) => boolean | undefined;

  /**
   * Called when content is dropped
   * Return true to prevent default drop handling
   */
  onDrop?: (props: DropEventProps) => boolean | undefined;

  /**
   * Called when content is deleted
   */
  onDelete?: (props: DeleteEventProps) => void;

  /**
   * Called when an extension throws an error (2.7: Extension Error Isolation)
   * Allows graceful error handling without crashing the editor
   */
  onError?: (props: ErrorEventProps) => void;
}

/**
 * Required options that must be resolved before creating the editor
 *
 * Step 1.3: schema is required
 * Step 2+: schema OR extensions must be provided
 */
export interface ResolvedEditorOptions extends EditorOptions {
  schema: Schema;
  extensions: AnyExtension[];
  editable: boolean;
  enableInputRules: boolean;
  enablePasteRules: boolean;
  enableContentCheck: boolean;
}
