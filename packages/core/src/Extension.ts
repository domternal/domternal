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

import type { ExtensionConfig, ExtensionConfigBase, ExtensionContext } from './types/ExtensionConfig.js';
import type { SingleCommands } from './types/Commands.js';
import type { EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { callOrReturn } from './helpers/callOrReturn.js';

/**
 * Merges extension config with parent binding support.
 *
 * For each function in `extendedConfig` that overrides a function in `parentConfig`,
 * wraps the override so that `this.parent` temporarily points to the parent's version.
 * This enables the `this.parent?.()` pattern in extend():
 *
 * ```typescript
 * Paragraph.extend({
 *   addAttributes() {
 *     return { ...this.parent?.(), align: { default: 'left' } };
 *   },
 * });
 * ```
 */
export function mergeConfigWithParentBinding(
  parentConfig: object,
  extendedConfig: object,
): object {
  const parent = parentConfig as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...parent };

  for (const [key, value] of Object.entries(extendedConfig)) {
    if (typeof value === 'function' && typeof parent[key] === 'function') {
      const parentFn = parent[key] as (...args: unknown[]) => unknown;
      const childFn = value as (...args: unknown[]) => unknown;

      merged[key] = function (this: Extension, ...args: unknown[]) {
        const previousParent = this.parent;
        this.parent = (...pArgs: unknown[]) => parentFn.call(this, ...pArgs);
        const result = childFn.call(this, ...args);
        this.parent = previousParent;
        return result;
      };
    } else {
      merged[key] = value;
    }
  }

  return merged;
}

/**
 * Editor interface for Extension
 * Forward declaration to avoid circular dependency
 */
export interface ExtensionEditorInterface {
  readonly state: EditorState;
  readonly view: EditorView;
  readonly schema: unknown;
  readonly commands: SingleCommands;
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
   * Reference to the parent config method when using extend().
   * Set temporarily during config method execution so overridden
   * methods can call `this.parent?.()` to invoke the original.
   */
  parent?: ((...args: unknown[]) => unknown) | undefined;

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
    extendedConfig: Partial<ExtensionConfigBase<ExtendedOptions, ExtendedStorage>> &
      ThisType<ExtensionContext<ExtendedOptions, ExtendedStorage>>
  ): Extension<ExtendedOptions, ExtendedStorage> {
    const newConfig = mergeConfigWithParentBinding(this.config, extendedConfig);

    return new Extension(newConfig as ExtensionConfig<ExtendedOptions, ExtendedStorage>);
  }
}
