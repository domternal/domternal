import type { Content } from './Content.js';
import type {
  CreateEventProps,
  TransactionEventProps,
  FocusEventProps,
  ContentErrorProps,
} from './EditorEvents.js';

/**
 * Extension type (forward declaration to avoid circular dependency)
 * Will be properly typed when Extension class is implemented
 */
export interface AnyExtension {
  name: string;
  type: 'extension' | 'node' | 'mark';
}

/**
 * Autofocus options for the editor
 * - true: Focus at the end
 * - false: Don't autofocus
 * - 'start': Focus at the beginning
 * - 'end': Focus at the end
 * - 'all': Select all content
 * - number: Focus at specific position
 */
export type FocusPosition = boolean | 'start' | 'end' | 'all' | number;

/**
 * Configuration options for creating an Editor instance
 */
export interface EditorOptions {
  /**
   * HTML element to mount the editor
   * If not provided, editor runs in "headless" mode
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
   * HTML attributes to add to the editor element
   */
  editorProps?: Record<string, unknown>;

  /**
   * Parse options for HTML content
   */
  parseOptions?: Record<string, unknown>;

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
}

/**
 * Required options that must be resolved before creating the editor
 */
export interface ResolvedEditorOptions extends EditorOptions {
  extensions: AnyExtension[];
  editable: boolean;
  enableInputRules: boolean;
  enablePasteRules: boolean;
  enableContentCheck: boolean;
}
