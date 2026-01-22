/**
 * ExtensionManager - Manages extensions and schema
 *
 * Step 1.3: Minimal version that holds schema
 * Step 2: Will be expanded with full extension lifecycle
 */
import type { Schema, Node as PMNode } from 'prosemirror-model';
import type { Plugin } from 'prosemirror-state';

/**
 * Editor interface for ExtensionManager
 * Forward declaration to avoid circular dependency
 */
export interface ExtensionManagerEditor {
  readonly schema: Schema;
}

/**
 * Manages editor extensions and schema
 *
 * In Step 1.3, this is a minimal implementation that:
 * - Holds the schema passed to the Editor
 * - Returns empty plugins array (no extensions yet)
 *
 * In Step 2, this will be expanded to:
 * - Build schema from extensions
 * - Collect plugins from extensions
 * - Handle extension lifecycle
 * - Detect schema conflicts (AD-7)
 */
export class ExtensionManager {
  /**
   * ProseMirror schema for the editor
   */
  private readonly _schema: Schema;

  /**
   * Reference to the editor instance
   */
  private readonly editor: ExtensionManagerEditor;

  /**
   * Whether the manager has been destroyed
   */
  private isDestroyed = false;

  /**
   * Creates a new ExtensionManager
   *
   * @param schema - ProseMirror schema to use
   * @param editor - Editor instance (for future extension access)
   */
  constructor(schema: Schema, editor: ExtensionManagerEditor) {
    this._schema = schema;
    this.editor = editor;
  }

  /**
   * Gets the ProseMirror schema
   */
  get schema(): Schema {
    return this._schema;
  }

  /**
   * Gets plugins from all extensions
   *
   * Step 1.3: Returns empty array (no extensions)
   * Step 2: Will collect plugins from extensions
   */
  get plugins(): Plugin[] {
    // Step 1.3: No extensions, no plugins
    return [];
  }

  /**
   * Validates that the schema has required nodes
   *
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

  /**
   * Cleans up the extension manager
   *
   * Step 1.3: Basic cleanup
   * Step 2: Will call destroy on all extensions
   */
  destroy(): void {
    if (this.isDestroyed) {
      return;
    }

    this.isDestroyed = true;

    // Step 2: Will iterate extensions and call onDestroy hooks
  }
}
