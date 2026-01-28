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
   * null until ExtensionManager binds it
   */
  editor: ExtensionEditorInterface | null = null;

  /**
   * Protected constructor - use Extension.create() instead
   */
  protected constructor(config: ExtensionConfig<Options, Storage>) {
    // Validate extension name (must be camelCase starting with lowercase letter)
    if (!/^[a-z][a-zA-Z0-9]*$/.test(config.name)) {
      throw new Error(
        `Extension name '${config.name}' is invalid. ` +
          `Names must be camelCase starting with a lowercase letter (e.g., 'myExtension').`
      );
    }

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
   * **Note:** Options are merged shallowly using object spread (`...`).
   * Nested objects are replaced entirely, not deeply merged.
   *
   * @param options - Options to merge with existing options
   * @returns New extension instance with merged options
   *
   * @example
   * const configured = MyExtension.configure({ enabled: false });
   *
   * @example
   * // Shallow merge behavior with nested objects:
   * // Given: options = { nested: { a: 1, b: 2 } }
   * // configure({ nested: { b: 3 } })
   * // Result: { nested: { b: 3 } } — 'a' is lost!
   * // To preserve nested values, spread manually:
   * // configure({ nested: { ...original.options.nested, b: 3 } })
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
   * **Note:** Config is merged shallowly using object spread (`...`).
   * Config properties (like `addCommands`, `addKeyboardShortcuts`) are
   * replaced entirely, not combined with the base extension's config.
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
   *
   * @example
   * // To preserve base extension's commands while adding new ones:
   * const Extended = BaseExtension.extend({
   *   addCommands() {
   *     const baseCommands = BaseExtension.config.addCommands?.call(this) ?? {};
   *     return {
   *       ...baseCommands,
   *       newCommand: () => ({ tr }) => true,
   *     };
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
