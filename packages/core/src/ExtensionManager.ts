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
import type { Plugin } from 'prosemirror-state';

import type { AnyExtension } from './types/EditorOptions.js';
import type { Extension } from './Extension.js';
import type { Node } from './Node.js';
import type { Mark } from './Mark.js';
import { callOrReturn } from './helpers/callOrReturn.js';

/**
 * Editor interface for ExtensionManager
 * Forward declaration to avoid circular dependency
 */
export interface ExtensionManagerEditor {
  readonly schema: Schema;
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
   */
  get plugins(): Plugin[] {
    // TODO: Step 2.4.5 - Implement buildPlugins()
    return [];
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
        (ext as Extension).config?.addExtensions,
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
      const priorityA = (a as Extension).config?.priority ?? 100;
      const priorityB = (b as Extension).config?.priority ?? 100;
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
      const deps = (ext as Extension).config?.dependencies;
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
      const storageFactory = (ext as Extension).config?.addStorage;
      if (storageFactory) {
        const storage = callOrReturn(storageFactory, ext);
        this._storage[ext.name] = storage;
        (ext as Extension).storage = storage;
      }
    }
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
   * Calls onDestroy on all extensions
   */
  destroy(): void {
    if (this.isDestroyed) {
      return;
    }

    // Call onDestroy on all extensions
    for (const ext of this._extensions) {
      const onDestroy = (ext as Extension).config?.onDestroy;
      if (onDestroy) {
        callOrReturn(onDestroy, ext);
      }
    }

    this.isDestroyed = true;
  }
}
