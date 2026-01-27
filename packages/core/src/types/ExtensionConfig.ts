/**
 * Extension configuration types
 *
 * These types define the configuration object passed to Extension.create(),
 * Node.create(), and Mark.create() factory methods.
 */

import type { Plugin, Transaction } from 'prosemirror-state';
import type { InputRule } from 'prosemirror-inputrules';
import type { Command, KeyboardShortcutCommand } from './Commands.js';

/**
 * Editor instance type (forward declaration)
 * Will be properly typed when Extension class is implemented
 */
export interface ExtensionEditor {
  readonly state: unknown;
  readonly view: unknown;
  readonly schema: unknown;
}

/**
 * Any extension type (forward declaration)
 */
export interface AnyExtensionConfig {
  name: string;
  type?: 'extension' | 'node' | 'mark';
}

/**
 * Context interface that describes what `this` will be in config methods.
 * This enables proper typing of `this.options`, `this.editor`, etc.
 * without creating circular dependencies.
 *
 * @typeParam Options - Extension options type
 * @typeParam Storage - Extension storage type
 */
export interface ExtensionContext<Options = unknown, Storage = unknown> {
  /** Extension type identifier */
  readonly type: 'extension' | 'node' | 'mark';
  /** Unique extension name */
  readonly name: string;
  /** Extension options (immutable after creation) */
  readonly options: Options;
  /** Extension storage (mutable state) */
  storage: Storage;
  /** Editor instance (null until bound by ExtensionManager) */
  editor: ExtensionEditor | null;
}

/**
 * Base configuration properties for all extension types.
 * This interface contains just the properties without ThisType,
 * allowing Node and Mark configs to use their own context types.
 *
 * @typeParam Options - Extension options type
 * @typeParam Storage - Extension storage type
 */
export interface ExtensionConfigBase<Options = unknown, Storage = unknown> {
  /**
   * Unique extension name
   * Used for identification, storage access, and error messages
   */
  name: string;

  /**
   * Extension priority (higher = loaded first)
   *
   * Reserved ranges:
   * - 900-1000: Core nodes (Document, Text, Paragraph)
   * - 500-899: Standard extensions (Heading, Bold, etc.)
   * - 100-499: Default range for user extensions
   * - 0-99: Low priority extensions (run after everything)
   *
   * @default 100
   */
  priority?: number;

  /**
   * Required extensions that must be present
   * ExtensionManager throws if any dependency is missing
   *
   * @example
   * dependencies: ['bulletList', 'orderedList']
   */
  dependencies?: string[];

  /**
   * Default options for this extension
   * Called during extension creation with `this` bound to the extension
   */
  addOptions?: () => Options;

  /**
   * Initial storage state for this extension
   * Storage is mutable and accessible via editor.storage[extensionName]
   */
  addStorage?: () => Storage;

  /**
   * Commands this extension provides
   * Commands are accessible via editor.commands.commandName()
   *
   * @example
   * addCommands() {
   *   return {
   *     toggleBold: () => ({ commands }) => commands.toggleMark('bold'),
   *   };
   * }
   */
  addCommands?: () => Record<string, (...args: never[]) => Command>;

  /**
   * Keyboard shortcuts for this extension
   * Keys are shortcut strings (e.g., 'Mod-b'), values are handler functions
   *
   * @example
   * addKeyboardShortcuts() {
   *   return {
   *     'Mod-b': () => this.editor.commands.toggleBold(),
   *   };
   * }
   */
  addKeyboardShortcuts?: () => Record<string, KeyboardShortcutCommand>;

  /**
   * Input rules (markdown-style shortcuts)
   * Triggered when user types matching patterns
   *
   * @example
   * addInputRules() {
   *   return [
   *     textblockTypeInputRule(/^## $/, this.type),
   *   ];
   * }
   */
  addInputRules?: () => InputRule[];

  /**
   * ProseMirror plugins for this extension
   */
  addProseMirrorPlugins?: () => Plugin[];

  /**
   * Nested extensions (for extension bundles like StarterKit)
   * These extensions are flattened and processed like top-level extensions
   */
  addExtensions?: () => AnyExtensionConfig[];

  // === Lifecycle Hooks ===

  /**
   * Called before editor is created
   * Can be used to modify editor options
   */
  onBeforeCreate?: () => void;

  /**
   * Called when editor is fully initialized and ready
   */
  onCreate?: () => void;

  /**
   * Called when document content changes
   */
  onUpdate?: () => void;

  /**
   * Called when selection changes (without content change)
   */
  onSelectionUpdate?: () => void;

  /**
   * Called on every transaction
   * Can be used to intercept or modify transactions
   */
  onTransaction?: (props: { transaction: Transaction }) => void;

  /**
   * Called when editor receives focus
   */
  onFocus?: (props: { event: FocusEvent }) => void;

  /**
   * Called when editor loses focus
   */
  onBlur?: (props: { event: FocusEvent }) => void;

  /**
   * Called when editor is being destroyed
   * Use for cleanup (remove event listeners, etc.)
   */
  onDestroy?: () => void;
}

/**
 * Full configuration type for Extension.create()
 * Combines base properties with ThisType for proper `this` typing.
 *
 * @typeParam Options - Extension options type
 * @typeParam Storage - Extension storage type
 */
export type ExtensionConfig<Options = unknown, Storage = unknown> =
  ExtensionConfigBase<Options, Storage> &
  ThisType<ExtensionContext<Options, Storage>>;
