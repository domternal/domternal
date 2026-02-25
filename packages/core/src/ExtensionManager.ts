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
import type { NodeViewConstructor } from 'prosemirror-view';
import { keymap } from 'prosemirror-keymap';
import { inputRules as createInputRulesPlugin } from 'prosemirror-inputrules';
import type { InputRule } from 'prosemirror-inputrules';

import type { Command as PMCommand } from 'prosemirror-state';

import type { AnyExtension } from './types/EditorOptions.js';
import type { CommandMap } from './types/Commands.js';
import type { GlobalAttributes, GlobalAttributeSpec } from './types/ExtensionConfig.js';
import type { ToolbarItem } from './types/Toolbar.js';
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
/**
 * Merge HTML attribute objects, concatenating 'style' and 'class' values
 * instead of overwriting them.
 */
function mergeHTMLAttrs(
  target: Record<string, unknown>,
  source: Record<string, unknown>
): Record<string, unknown> {
  const result = { ...target };

  for (const [key, value] of Object.entries(source)) {
    if (key === 'style' && typeof result[key] === 'string' && typeof value === 'string') {
      result[key] = `${result[key]}; ${value}`;
    } else if (key === 'class' && typeof result[key] === 'string' && typeof value === 'string') {
      result[key] = `${result[key]} ${value}`;
    } else {
      result[key] = value;
    }
  }

  return result;
}

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
  private _commands: CommandMap | null = null;

  /**
   * Cached toolbar items (collected lazily)
   */
  private _toolbarItems: ToolbarItem[] | null = null;

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
  get commands(): CommandMap {
    this._commands ??= this.collectCommands();
    return this._commands;
  }

  /**
   * Gets toolbar items from all extensions
   * Cached after first call
   */
  get toolbarItems(): ToolbarItem[] {
    this._toolbarItems ??= this.collectToolbarItems();
    return this._toolbarItems;
  }

  /**
   * Gets node views from all Node extensions that define addNodeView
   */
  get nodeViews(): Record<string, NodeViewConstructor> {
    return this.collectNodeViews();
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
    this._toolbarItems = null;
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
    const names = new Set<string>();

    for (const ext of this._extensions) {
      if (names.has(ext.name)) {
        throw new Error(
          `Extension name conflict: "${ext.name}" is defined multiple times. ` +
            `Each extension must have a unique name.`
        );
      }
      names.add(ext.name);
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
   * Collects global attributes from all extensions.
   * Returns a map of type name -> attribute specs to merge.
   */
  private collectGlobalAttributes(): Map<string, Record<string, GlobalAttributeSpec>> {
    const globalAttrs = new Map<string, Record<string, GlobalAttributeSpec>>();

    for (const ext of this._extensions) {
      const addGlobalAttributes = (ext as Extension).config.addGlobalAttributes;
      if (!addGlobalAttributes) continue;

      const attrs = this.safeCall(
        () => callOrReturn(addGlobalAttributes, ext) as GlobalAttributes[] | undefined,
        `${ext.name}.addGlobalAttributes`
      );

      if (!attrs) continue;

      for (const { types, attributes } of attrs) {
        for (const typeName of types) {
          const existing = globalAttrs.get(typeName) ?? {};
          globalAttrs.set(typeName, { ...existing, ...attributes });
        }
      }
    }

    return globalAttrs;
  }

  /**
   * Converts GlobalAttributeSpec to ProseMirror-compatible attribute spec
   */
  private convertGlobalAttrToNodeAttr(
    spec: GlobalAttributeSpec
  ): { default?: unknown } {
    return { default: spec.default };
  }

  /**
   * Builds ProseMirror Schema from Node and Mark extensions
   */
  private buildSchema(): Schema {
    // First, collect global attributes from all extensions
    const globalAttrs = this.collectGlobalAttributes();

    const nodes: Record<string, NodeSpec> = {};
    const marks: Record<string, MarkSpec> = {};
    let topNode: string | undefined;

    for (const ext of this._extensions) {
      if (ext.type === 'node') {
        const nodeExt = ext as Node;
        const spec = nodeExt.createNodeSpec();

        // Merge global attributes into this node's attrs
        const extraAttrs = globalAttrs.get(ext.name);
        if (extraAttrs) {
          const convertedAttrs: Record<string, { default?: unknown }> = {};
          for (const [attrName, attrSpec] of Object.entries(extraAttrs)) {
            convertedAttrs[attrName] = this.convertGlobalAttrToNodeAttr(attrSpec);
          }
          spec.attrs = { ...spec.attrs, ...convertedAttrs };

          // Merge parseDOM handlers to include global attribute parsing
          if (spec.parseDOM) {
            spec.parseDOM = spec.parseDOM.map((rule) => {
              const originalGetAttrs = rule.getAttrs;
              return {
                ...rule,
                getAttrs: (dom: HTMLElement) => {
                  const baseAttrs = originalGetAttrs
                    ? originalGetAttrs(dom)
                    : rule.attrs ?? {};

                  if (baseAttrs === false) return false;

                  // Parse global attributes from DOM
                  const globalParsed: Record<string, unknown> = {};
                  for (const [name, attrSpec] of Object.entries(extraAttrs)) {
                    if (attrSpec.parseHTML) {
                      globalParsed[name] = attrSpec.parseHTML(dom);
                    }
                  }

                  return { ...baseAttrs, ...globalParsed };
                },
              };
            });
          }

          // Merge toDOM to include global attribute rendering
          const originalToDOM = spec.toDOM;
          if (originalToDOM) {
            spec.toDOM = (node) => {
              const result = originalToDOM(node);
              if (!Array.isArray(result)) return result;

              // Get extra HTML attributes from global attrs
              let extraHtmlAttrs: Record<string, string> = {};
              for (const [, attrSpec] of Object.entries(extraAttrs)) {
                if (attrSpec.renderHTML) {
                  const rendered = attrSpec.renderHTML(node.attrs);
                  if (rendered) {
                    extraHtmlAttrs = mergeHTMLAttrs(extraHtmlAttrs, rendered) as Record<string, string>;
                  }
                }
              }

              // Merge into result[1] if it's an attributes object
              if (
                result.length >= 2 &&
                typeof result[1] === 'object' &&
                result[1] !== null &&
                !Array.isArray(result[1])
              ) {
                const existingAttrs = result[1] as Record<string, unknown>;
                result[1] = { ...existingAttrs, ...extraHtmlAttrs };
              } else if (Object.keys(extraHtmlAttrs).length > 0) {
                // Insert attributes object at position 1
                const rest = result.slice(1) as unknown[];
                return [result[0], extraHtmlAttrs, ...rest];
              }

              return result;
            };
          }
        }

        nodes[ext.name] = spec;

        // Check for topNode (usually 'doc')
        if (nodeExt.config.topNode) {
          topNode = ext.name;
        }
      } else if (ext.type === 'mark') {
        const markExt = ext as Mark;
        const spec = markExt.createMarkSpec();

        // Merge global attributes into this mark's attrs
        const extraAttrs = globalAttrs.get(ext.name);
        if (extraAttrs) {
          const convertedAttrs: Record<string, { default?: unknown }> = {};
          for (const [attrName, attrSpec] of Object.entries(extraAttrs)) {
            convertedAttrs[attrName] = this.convertGlobalAttrToNodeAttr(attrSpec);
          }
          spec.attrs = { ...spec.attrs, ...convertedAttrs };

          // Merge parseDOM handlers for marks
          if (spec.parseDOM) {
            spec.parseDOM = spec.parseDOM.map((rule) => {
              const originalGetAttrs = rule.getAttrs as
                | ((dom: HTMLElement | string) => Record<string, unknown> | false | null)
                | undefined;
              return {
                ...rule,
                getAttrs: (dom: HTMLElement | string) => {
                  const baseAttrs = originalGetAttrs
                    ? originalGetAttrs(dom)
                    : rule.attrs ?? {};

                  if (baseAttrs === false) return false;

                  // Parse global attributes from DOM (only if element, not style string)
                  const globalParsed: Record<string, unknown> = {};
                  if (typeof dom !== 'string') {
                    for (const [name, attrSpec] of Object.entries(extraAttrs)) {
                      if (attrSpec.parseHTML) {
                        globalParsed[name] = attrSpec.parseHTML(dom);
                      }
                    }
                  }

                  return { ...baseAttrs, ...globalParsed };
                },
              };
            });
          }

          // Merge toDOM for marks
          const originalToDOM = spec.toDOM;
          if (originalToDOM) {
            spec.toDOM = (mark, inline) => {
              const result = originalToDOM(mark, inline);
              if (!Array.isArray(result)) return result;

              let extraHtmlAttrs: Record<string, string> = {};
              for (const [, attrSpec] of Object.entries(extraAttrs)) {
                if (attrSpec.renderHTML) {
                  const rendered = attrSpec.renderHTML(mark.attrs);
                  if (rendered) {
                    extraHtmlAttrs = mergeHTMLAttrs(extraHtmlAttrs, rendered) as Record<string, string>;
                  }
                }
              }

              if (
                result.length >= 2 &&
                typeof result[1] === 'object' &&
                result[1] !== null &&
                !Array.isArray(result[1])
              ) {
                const existingAttrs = result[1] as Record<string, unknown>;
                result[1] = { ...existingAttrs, ...extraHtmlAttrs };
              } else if (Object.keys(extraHtmlAttrs).length > 0) {
                const rest = result.slice(1) as unknown[];
                return [result[0], extraHtmlAttrs, ...rest];
              }

              return result;
            };
          }
        }

        marks[ext.name] = spec;
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
      // Always expose ext.storage via editor.storage[name], even for
      // extensions without addStorage(). The Extension constructor
      // initialises storage to {} by default — make it accessible.
      if (!(ext.name in this._storage)) {
        this._storage[ext.name] = (ext as Extension).storage;
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
          const cast = extShortcuts as unknown as Record<string, PMCommand>;
          for (const [key, handler] of Object.entries(cast)) {
            if (shortcuts[key]) {
              // Chain: try new handler first, fall back to previous
              const prev = shortcuts[key];
              shortcuts[key] = (state, dispatch, view) => {
                return handler(state, dispatch, view) || prev(state, dispatch, view);
              };
            } else {
              shortcuts[key] = handler;
            }
          }
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
   *
   * Note: Commands with the same name will be overwritten by later extensions
   * (lower priority extensions override higher priority). This is intentional
   * to allow customization of built-in commands.
   */
  private collectCommands(): CommandMap {
    const commands: CommandMap = {};

    for (const ext of this._extensions) {
      const addCommands = (ext as Extension).config.addCommands;
      if (addCommands) {
        const extCommands = this.safeCall(
          () => callOrReturn(addCommands, ext) as CommandMap | undefined,
          `${ext.name}.addCommands`
        );
        if (extCommands) {
          // Later extensions override earlier ones (intentional for customization)
          Object.assign(commands, extCommands);
        }
      }
    }

    return commands;
  }

  /**
   * Collects toolbar items from all extensions
   */
  private collectToolbarItems(): ToolbarItem[] {
    const items: ToolbarItem[] = [];

    for (const ext of this._extensions) {
      const addItems = (ext as Extension).config.addToolbarItems;
      if (addItems) {
        const extItems = this.safeCall(
          () => callOrReturn(addItems, ext) as ToolbarItem[] | undefined,
          `${ext.name}.addToolbarItems`
        );
        if (extItems && extItems.length > 0) {
          items.push(...extItems);
        }
      }
    }

    return items;
  }

  /**
   * Collects node views from all Node extensions
   * Returns a map of node name → NodeViewConstructor for EditorView
   */
  private collectNodeViews(): Record<string, NodeViewConstructor> {
    const nodeViews: Record<string, NodeViewConstructor> = {};

    for (const ext of this._extensions) {
      if (ext.type !== 'node') continue;
      const nodeExt = ext as Node;
      const addNodeView = nodeExt.config.addNodeView;
      if (addNodeView) {
        const nodeView = this.safeCall(
          () => callOrReturn(addNodeView, nodeExt) as NodeViewConstructor | undefined,
          `${ext.name}.addNodeView`
        );
        if (nodeView) {
          nodeViews[ext.name] = nodeView;
        }
      }
    }

    return nodeViews;
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
    // Storage is not cleared explicitly - it will be garbage collected
    // when the ExtensionManager instance is no longer referenced
    this.clearAllCaches();

    this.isDestroyed = true;
  }

  // === Error Handling (2.7: Extension Error Isolation) ===

  /**
   * Safely executes a function, catching and reporting errors
   * Prevents a single extension error from crashing the entire editor
   *
   * Handles both synchronous errors and async promise rejections.
   *
   * @param fn - Function to execute
   * @param context - Context for error reporting (e.g., 'Bold.onUpdate')
   * @returns The function result, or undefined if an error occurred
   */
  safeCall<T>(fn: () => T, context: string): T | undefined {
    try {
      const result = fn();

      // Handle async functions - catch promise rejections
      if (result instanceof Promise) {
        result.catch((error: unknown) => {
          const errorObj = error instanceof Error ? error : new Error(String(error));
          this.editor.emit?.('error', { error: errorObj, context });
        });
      }

      return result;
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
