/**
 * Extension - Base class for all extensions
 *
 * Extensions provide functionality without contributing to the schema.
 * For schema contributions, use Node (for block/inline nodes) or Mark (for inline formatting).
 *
 * Three-tier model:
 * - Extension (type: 'extension') → Pure functionality (History, Placeholder, etc.)
 * - Node (type: 'node') → Schema nodes (Paragraph, Heading, etc.)
 * - Mark (type: 'mark') → Schema marks (Bold, Italic, etc.)
 *
 * @example
 * const History = Extension.create({
 *   name: 'history',
 *   addOptions() {
 *     return { depth: 100 };
 *   },
 *   addKeyboardShortcuts() {
 *     return {
 *       'Mod-z': () => this.editor.commands.undo(),
 *       'Mod-Shift-z': () => this.editor.commands.redo(),
 *     };
 *   },
 * });
 */

import type { ExtensionConfig } from './types/ExtensionConfig.js';
import { callOrReturn } from './helpers/callOrReturn.js';

/**
 * Editor interface for Extension
 * Forward declaration to avoid circular dependency
 */
export interface ExtensionEditorInterface {
  readonly state: unknown;
  readonly view: unknown;
  readonly schema: unknown;
}

/**
 * Base class for all extensions
 *
 * @typeParam Options - Extension options type
 * @typeParam Storage - Extension storage type
 */
export class Extension<Options = unknown, Storage = unknown> {
  /**
   * Extension type identifier
   * Used to distinguish between Extension, Node, and Mark
   * Subclasses override this to 'node' or 'mark'
   */
  readonly type: 'extension' | 'node' | 'mark' = 'extension';

  /**
   * Unique extension name
   */
  readonly name: string;

  /**
   * Extension options (immutable after creation)
   */
  readonly options: Options;

  /**
   * Extension storage (mutable state)
   * Accessible via editor.storage[extensionName]
   */
  storage: Storage;

  /**
   * The original configuration object
   */
  readonly config: ExtensionConfig<Options, Storage>;

  /**
   * Editor instance (set by ExtensionManager after creation)
   * null! indicates it will be set before use
   */
  editor: ExtensionEditorInterface = null!;

  /**
   * Protected constructor - use Extension.create() instead
   */
  protected constructor(config: ExtensionConfig<Options, Storage>) {
    this.config = config;
    this.name = config.name;

    // Initialize options using addOptions() with `this` context
    // If addOptions is not defined, default to empty object
    const defaultOptions = callOrReturn(config.addOptions, this);
    this.options = (defaultOptions ?? {}) as Options;

    // Initialize storage using addStorage() with `this` context
    // If addStorage is not defined, default to empty object
    const defaultStorage = callOrReturn(config.addStorage, this);
    this.storage = (defaultStorage ?? {}) as Storage;
  }

  /**
   * Creates a new extension instance
   *
   * @param config - Extension configuration
   * @returns New extension instance
   *
   * @example
   * const MyExtension = Extension.create({
   *   name: 'myExtension',
   *   addOptions() {
   *     return { enabled: true };
   *   },
   * });
   */
  static create<O = unknown, S = unknown>(
    config: ExtensionConfig<O, S>
  ): Extension<O, S> {
    return new Extension(config);
  }

  /**
   * Creates a new extension with merged options
   * Original extension is not modified
   *
   * @param options - Options to merge with existing options
   * @returns New extension instance with merged options
   *
   * @example
   * const configured = MyExtension.configure({ enabled: false });
   */
  configure(options: Partial<Options>): Extension<Options, Storage> {
    // Create new config with merged options
    const newConfig: ExtensionConfig<Options, Storage> = {
      ...this.config,
      // Override addOptions to return merged options
      addOptions: () => ({
        ...this.options,
        ...options,
      }),
    };

    return new Extension(newConfig);
  }

  /**
   * Creates a new extension with extended configuration
   * Original extension is not modified
   *
   * @param extendedConfig - Configuration to extend/override
   * @returns New extension instance with extended config
   *
   * @example
   * const Extended = MyExtension.extend({
   *   name: 'extendedExtension',
   *   addCommands() {
   *     return { customCommand: () => ({ tr }) => true };
   *   },
   * });
   */
  extend<ExtendedOptions = Options, ExtendedStorage = Storage>(
    extendedConfig: Partial<ExtensionConfig<ExtendedOptions, ExtendedStorage>>
  ): Extension<ExtendedOptions, ExtendedStorage> {
    // Merge base config with extended config
    const newConfig = {
      ...this.config,
      ...extendedConfig,
    } as ExtensionConfig<ExtendedOptions, ExtendedStorage>;

    return new Extension(newConfig);
  }
}
