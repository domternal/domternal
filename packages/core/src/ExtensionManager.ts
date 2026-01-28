/**
 * ExtensionManager - Manages extensions and schema
 *
 * Handles:
 * - Extension lifecycle (flatten, resolve, bind)
 * - Schema building from Node/Mark extensions
 * - Plugin collection from all extensions
 * - Extension storage management
 * - Conflict detection (AD-7)
 */
import { Schema } from 'prosemirror-model';
import type { NodeSpec, MarkSpec } from 'prosemirror-model';
import type { Plugin, Transaction } from 'prosemirror-state';
import { keymap } from 'prosemirror-keymap';
import { inputRules as createInputRulesPlugin } from 'prosemirror-inputrules';
import type { InputRule } from 'prosemirror-inputrules';

import type { Command as PMCommand } from 'prosemirror-state';

import type { AnyExtension } from './types/EditorOptions.js';
import type { RawCommands } from './types/Commands.js';
import type { Extension } from './Extension.js';
import type { Node } from './Node.js';
import type { Mark } from './Mark.js';
import { callOrReturn } from './helpers/callOrReturn.js';

/**
 * Error event props for safeCall
 */
interface ErrorEventProps {
  error: Error;
  context: string;
}

/**
 * Editor interface for ExtensionManager
 * Forward declaration to avoid circular dependency
 */
export interface ExtensionManagerEditor {
  readonly schema: Schema;
  emit?(event: 'error', props: ErrorEventProps): void;
}

/**
 * Options for ExtensionManager constructor
 */
export interface ExtensionManagerOptions {
  /**
   * Extensions to process
   * If provided, schema is built from extensions
   */
  extensions?: AnyExtension[] | undefined;

  /**
   * Direct schema (backward compatibility with Step 1.3)
   * If provided, extensions are ignored for schema building
   */
  schema?: Schema | undefined;
}

/**
 * Manages editor extensions and schema
 *
 * Supports two modes:
 * 1. Extensions mode: Schema built from Node/Mark extensions
 * 2. Schema mode: Direct schema passed (backward compatible)
 */
export class ExtensionManager {
  /**
   * Processed extensions (flattened, sorted by priority)
   */
  private readonly _extensions: AnyExtension[];

  /**
   * ProseMirror schema (built from extensions or passed directly)
   */
  private readonly _schema: Schema;

  /**
   * Reference to the editor instance
   */
  readonly editor: ExtensionManagerEditor;

  /**
   * Extension storage (keyed by extension name)
   */
  private readonly _storage: Record<string, unknown> = {};

  /**
   * Whether the manager has been destroyed
   */
  private isDestroyed = false;

  /**
   * Cached plugins (built lazily)
   */
  private _plugins: Plugin[] | null = null;

  /**
   * Cached commands (collected lazily)
   */
  private _commands: RawCommands | null = null;

  /**
   * Creates a new ExtensionManager
   *
   * @param options - Extensions or direct schema
   * @param editor - Editor instance
   */
  constructor(options: ExtensionManagerOptions, editor: ExtensionManagerEditor) {
    this.editor = editor;

    // Schema mode (backward compatibility)
    if (options.schema) {
      this._extensions = [];
      this._schema = options.schema;
      return;
    }

    // Extensions mode
    if (!options.extensions || options.extensions.length === 0) {
      throw new Error(
        'ExtensionManager requires either extensions or schema. ' +
          'Provide at least Document, Text, and Paragraph extensions.'
      );
    }

    // Process extensions following the pipeline:
    // 1. Flatten (expand addExtensions)
    // 2. Resolve (sort by priority)
    // 3. Detect conflicts (AD-7)
    // 4. Check dependencies
    // 5. Bind editor to extensions
    // 6. Build schema
    // 7. Initialize storage

    const flattened = this.flattenExtensions(options.extensions);
    this._extensions = this.resolveExtensions(flattened);
    this.detectConflicts();
    this.checkDependencies();
    this.bindEditorToExtensions();
    this._schema = this.buildSchema();
    this.initializeStorage();
  }

  // === Getters ===

  /**
   * Gets the processed extensions array
   */
  get extensions(): readonly AnyExtension[] {
    return this._extensions;
  }

  /**
   * Gets the ProseMirror schema
   */
  get schema(): Schema {
    return this._schema;
  }

  /**
   * Gets extension storage (accessed via editor.storage)
   */
  get storage(): Record<string, unknown> {
    return this._storage;
  }

  /**
   * Gets plugins from all extensions
   * Cached after first call
   */
  get plugins(): Plugin[] {
    this._plugins ??= this.buildPlugins();
    return this._plugins;
  }

  /**
   * Gets commands from all extensions
   */
  get commands(): RawCommands {
    this._commands ??= this.collectCommands();
    return this._commands;
  }

  // === Cache Invalidation ===

  /**
   * Clears the plugins cache
   * Call when plugins need to be rebuilt
   */
  clearPluginCache(): void {
    this._plugins = null;
  }

  /**
   * Clears the commands cache
   * Call when commands need to be recollected
   */
  clearCommandCache(): void {
    this._commands = null;
  }

  /**
   * Clears all caches (plugins, commands)
   * Call when extensions change dynamically
   */
  clearAllCaches(): void {
    this._plugins = null;
    this._commands = null;
  }

  // === Extension Processing ===

  /**
   * Recursively flattens extensions by expanding addExtensions()
   * This allows extension bundles like StarterKit to work
   */
  private flattenExtensions(extensions: AnyExtension[]): AnyExtension[] {
    const result: AnyExtension[] = [];

    for (const ext of extensions) {
      result.push(ext);

      // Check for nested extensions (bundles like StarterKit)
      const nested = callOrReturn(
        (ext as Extension).config.addExtensions,
        ext
      ) as AnyExtension[] | undefined;

      if (nested && nested.length > 0) {
        result.push(...this.flattenExtensions(nested));
      }
    }

    return result;
  }

  /**
   * Sorts extensions by priority (higher priority first)
   * Default priority is 100
   */
  private resolveExtensions(extensions: AnyExtension[]): AnyExtension[] {
    return [...extensions].sort((a, b) => {
      const priorityA = (a as Extension).config.priority ?? 100;
      const priorityB = (b as Extension).config.priority ?? 100;
      return priorityB - priorityA;
    });
  }

  /**
   * Detects duplicate extension names (AD-7: Schema Conflict Detection)
   * @throws Error if duplicate names found
   */
  private detectConflicts(): void {
    const names = new Map<string, string>();

    for (const ext of this._extensions) {
      const existing = names.get(ext.name);
      if (existing) {
        throw new Error(
          `Extension name conflict: "${ext.name}" is defined multiple times. ` +
            `Each extension must have a unique name.`
        );
      }
      names.set(ext.name, ext.name);
    }
  }

  /**
   * Validates that all extension dependencies are present
   * @throws Error if required dependency is missing
   */
  private checkDependencies(): void {
    const extensionNames = new Set(this._extensions.map((e) => e.name));

    for (const ext of this._extensions) {
      const deps = (ext as Extension).config.dependencies;
      if (!deps) continue;

      for (const dep of deps) {
        if (!extensionNames.has(dep)) {
          throw new Error(
            `Extension "${ext.name}" requires "${dep}" extension. ` +
              `Please add it to your extensions array.`
          );
        }
      }
    }
  }

  /**
   * Sets editor reference on all extensions
   */
  private bindEditorToExtensions(): void {
    for (const ext of this._extensions) {
      (ext as Extension).editor = this.editor as ExtensionManagerEditor &
        Extension['editor'];
    }
  }

  /**
   * Builds ProseMirror Schema from Node and Mark extensions
   */
  private buildSchema(): Schema {
    const nodes: Record<string, NodeSpec> = {};
    const marks: Record<string, MarkSpec> = {};
    let topNode: string | undefined;

    for (const ext of this._extensions) {
      if (ext.type === 'node') {
        const nodeExt = ext as Node;
        nodes[ext.name] = nodeExt.createNodeSpec();

        // Check for topNode (usually 'doc')
        if (nodeExt.config.topNode) {
          topNode = ext.name;
        }
      } else if (ext.type === 'mark') {
        const markExt = ext as Mark;
        marks[ext.name] = markExt.createMarkSpec();
      }
    }

    return new Schema({
      nodes,
      marks,
      ...(topNode && { topNode }),
    });
  }

  /**
   * Initializes storage for all extensions
   */
  private initializeStorage(): void {
    for (const ext of this._extensions) {
      const storageFactory = (ext as Extension).config.addStorage;
      if (storageFactory) {
        const storage = this.safeCall(
          () => callOrReturn(storageFactory, ext),
          `${ext.name}.addStorage`
        );
        if (storage !== undefined) {
          this._storage[ext.name] = storage;
          (ext as Extension).storage = storage;
        }
      }
    }
  }

  // === Plugin Collection ===

  /**
   * Builds all ProseMirror plugins from extensions
   */
  private buildPlugins(): Plugin[] {
    const plugins: Plugin[] = [];

    // Collect keyboard shortcuts and create keymap plugin
    const shortcuts = this.collectKeyboardShortcuts();
    if (Object.keys(shortcuts).length > 0) {
      plugins.push(keymap(shortcuts));
    }

    // Collect input rules and create inputRules plugin
    const rules = this.collectInputRules();
    if (rules.length > 0) {
      plugins.push(createInputRulesPlugin({ rules }));
    }

    // Collect custom plugins from extensions
    for (const ext of this._extensions) {
      const addPlugins = (ext as Extension).config.addProseMirrorPlugins;
      if (addPlugins) {
        const extPlugins = this.safeCall(
          () => callOrReturn(addPlugins, ext) as Plugin[] | undefined,
          `${ext.name}.addProseMirrorPlugins`
        );
        if (extPlugins && extPlugins.length > 0) {
          plugins.push(...extPlugins);
        }
      }
    }

    return plugins;
  }

  /**
   * Collects keyboard shortcuts from all extensions
   * Returns ProseMirror-compatible commands for keymap plugin
   *
   * Note: Extensions should return PM-compatible commands from addKeyboardShortcuts()
   */
  private collectKeyboardShortcuts(): Record<string, PMCommand> {
    const shortcuts: Record<string, PMCommand> = {};

    for (const ext of this._extensions) {
      const addShortcuts = (ext as Extension).config.addKeyboardShortcuts;
      if (addShortcuts) {
        const extShortcuts = this.safeCall(
          () => callOrReturn(addShortcuts, ext),
          `${ext.name}.addKeyboardShortcuts`
        );
        if (extShortcuts) {
          // Cast needed: KeyboardShortcutCommand should be PM-compatible in practice
          Object.assign(shortcuts, extShortcuts as unknown as Record<string, PMCommand>);
        }
      }
    }

    return shortcuts;
  }

  /**
   * Collects input rules from all extensions
   */
  private collectInputRules(): InputRule[] {
    const rules: InputRule[] = [];

    for (const ext of this._extensions) {
      const addRules = (ext as Extension).config.addInputRules;
      if (addRules) {
        const extRules = this.safeCall(
          () => callOrReturn(addRules, ext) as InputRule[] | undefined,
          `${ext.name}.addInputRules`
        );
        if (extRules && extRules.length > 0) {
          rules.push(...extRules);
        }
      }
    }

    return rules;
  }

  /**
   * Collects commands from all extensions
   */
  private collectCommands(): RawCommands {
    const commands: RawCommands = {};

    for (const ext of this._extensions) {
      const addCommands = (ext as Extension).config.addCommands;
      if (addCommands) {
        const extCommands = this.safeCall(
          () => callOrReturn(addCommands, ext) as RawCommands | undefined,
          `${ext.name}.addCommands`
        );
        if (extCommands) {
          Object.assign(commands, extCommands);
        }
      }
    }

    return commands;
  }

  // === Validation ===

  /**
   * Validates that the schema has required nodes
   * @throws Error if schema is missing 'doc' or 'text' nodes
   */
  validateSchema(): void {
    if (this.isDestroyed) {
      throw new Error('ExtensionManager has been destroyed');
    }

    const { nodes } = this._schema.spec;

    if (!nodes.get('doc')) {
      throw new Error(
        'Invalid schema: missing required "doc" node. ' +
          'The schema must define a "doc" node as the document root.'
      );
    }

    if (!nodes.get('text')) {
      throw new Error(
        'Invalid schema: missing required "text" node. ' +
          'The schema must define a "text" node for inline text content.'
      );
    }
  }

  // === Lifecycle ===

  /**
   * Cleans up the extension manager
   * Calls onDestroy on all extensions and clears all caches
   */
  destroy(): void {
    if (this.isDestroyed) {
      return;
    }

    // Call onDestroy on all extensions (wrapped in safeCall)
    for (const ext of this._extensions) {
      const onDestroy = (ext as Extension).config.onDestroy;
      if (onDestroy) {
        this.safeCall(() => {
          callOrReturn(onDestroy, ext);
        }, `${ext.name}.onDestroy`);
      }
    }

    // Clear all caches to prevent memory leaks
    // Note: ProseMirror's EditorView.destroy() handles plugin view cleanup
    this.clearAllCaches();

    // Clear storage
    for (const key of Object.keys(this._storage)) {
      delete this._storage[key];
    }

    this.isDestroyed = true;
  }

  // === Error Handling (2.7: Extension Error Isolation) ===

  /**
   * Safely executes a function, catching and reporting errors
   * Prevents a single extension error from crashing the entire editor
   *
   * @param fn - Function to execute
   * @param context - Context for error reporting (e.g., 'Bold.onUpdate')
   * @returns The function result, or undefined if an error occurred
   */
  safeCall<T>(fn: () => T, context: string): T | undefined {
    try {
      return fn();
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));

      // Emit error event (Editor will call onError callback via event listener)
      this.editor.emit?.('error', { error: errorObj, context });

      return undefined;
    }
  }

  // === Extension Lifecycle Hook Calls ===

  /**
   * Calls onBeforeCreate on all extensions
   */
  callOnBeforeCreate(): void {
    for (const ext of this._extensions) {
      const hook = (ext as Extension).config.onBeforeCreate;
      if (hook) {
        this.safeCall(() => {
          callOrReturn(hook, ext);
        }, `${ext.name}.onBeforeCreate`);
      }
    }
  }

  /**
   * Calls onCreate on all extensions
   */
  callOnCreate(): void {
    for (const ext of this._extensions) {
      const hook = (ext as Extension).config.onCreate;
      if (hook) {
        this.safeCall(() => {
          callOrReturn(hook, ext);
        }, `${ext.name}.onCreate`);
      }
    }
  }

  /**
   * Calls onUpdate on all extensions
   */
  callOnUpdate(): void {
    for (const ext of this._extensions) {
      const hook = (ext as Extension).config.onUpdate;
      if (hook) {
        this.safeCall(() => {
          callOrReturn(hook, ext);
        }, `${ext.name}.onUpdate`);
      }
    }
  }

  /**
   * Calls onSelectionUpdate on all extensions
   */
  callOnSelectionUpdate(): void {
    for (const ext of this._extensions) {
      const hook = (ext as Extension).config.onSelectionUpdate;
      if (hook) {
        this.safeCall(() => {
          callOrReturn(hook, ext);
        }, `${ext.name}.onSelectionUpdate`);
      }
    }
  }

  /**
   * Calls onTransaction on all extensions
   * @param props - Transaction props
   */
  callOnTransaction(props: { transaction: Transaction }): void {
    for (const ext of this._extensions) {
      const hook = (ext as Extension).config.onTransaction;
      if (hook) {
        this.safeCall(() => {
          hook.call(ext, props);
        }, `${ext.name}.onTransaction`);
      }
    }
  }

  /**
   * Calls onFocus on all extensions
   * @param props - Focus event props
   */
  callOnFocus(props: { event: FocusEvent }): void {
    for (const ext of this._extensions) {
      const hook = (ext as Extension).config.onFocus;
      if (hook) {
        this.safeCall(() => {
          hook.call(ext, props);
        }, `${ext.name}.onFocus`);
      }
    }
  }

  /**
   * Calls onBlur on all extensions
   * @param props - Blur event props
   */
  callOnBlur(props: { event: FocusEvent }): void {
    for (const ext of this._extensions) {
      const hook = (ext as Extension).config.onBlur;
      if (hook) {
        this.safeCall(() => {
          hook.call(ext, props);
        }, `${ext.name}.onBlur`);
      }
    }
  }
}
