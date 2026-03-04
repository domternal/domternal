/**
 * Editor - Main editor class wrapping ProseMirror
 *
 * Manages extensions, schema, commands, and the ProseMirror EditorView/State.
 */
import type { Transaction, Plugin, PluginKey } from 'prosemirror-state';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { DOMSerializer } from 'prosemirror-model';
import type { Schema } from 'prosemirror-model';

import { EventEmitter } from './EventEmitter.js';
import { ExtensionManager } from './ExtensionManager.js';
import { CommandManager } from './CommandManager.js';
import { createDocument, isDocumentEmpty } from './helpers/index.js';
import {
  focus as focusCommand,
  blur as blurCommand,
  setContent as setContentCommand,
  clearContent as clearContentCommand,
} from './commands/index.js';
import type {
  EditorOptions,
  EditorEvents,
  Content,
  JSONContent,
  FocusPosition,
  SingleCommands,
  ChainedCommands,
  CanCommands,
  Command,
  ToolbarItem,
} from './types/index.js';

/**
 * Main editor class
 *
 * Wraps ProseMirror's EditorView and EditorState with a cleaner API.
 *
 * @example
 * ```ts
 * import { Editor } from '@domternal/core';
 * import { Schema } from 'prosemirror-model';
 *
 * const schema = new Schema({
 *   nodes: { doc: { content: 'paragraph+' }, paragraph: { content: 'text*' }, text: {} }
 * });
 *
 * const editor = new Editor({
 *   schema,
 *   element: document.getElementById('editor'),
 *   content: '<p>Hello world</p>',
 * });
 *
 * // Get content
 * const json = editor.getJSON();
 * const html = editor.getHTML();
 *
 * // Set content
 * editor.commands.setContent('<p>New content</p>');
 *
 * // Cleanup
 * editor.destroy();
 * ```
 */
export class Editor extends EventEmitter<EditorEvents> {
  /**
   * Editor configuration options
   */
  private options: EditorOptions;

  /**
   * Manages extensions and schema
   * @internal Exposed for CommandManager, not for public use
   */
  private _extensionManager!: ExtensionManager;

  /**
   * Gets the extension manager
   * @internal For CommandManager use only
   */
  get extensionManager(): ExtensionManager {
    return this._extensionManager;
  }

  /**
   * Manages commands
   */
  private commandManager!: CommandManager;


  /**
   * ProseMirror EditorView instance
   */
  public view!: EditorView;

  /**
   * Whether the editor has been destroyed
   */
  private _isDestroyed = false;

  /**
   * Timer for autofocus (cleared on destroy to prevent memory leaks)
   */
  private _autofocusTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Creates a new Editor instance
   *
   * @param options - Editor configuration
   * @throws Error if running in SSR environment (no window)
   * @throws Error if schema is not provided
   */
  constructor(options: EditorOptions) {
    super();

    // SSR Guard - Editor requires browser environment
    if (typeof window === 'undefined') {
      throw new Error(
        'Editor requires a browser environment. ' +
          'For server-side rendering, use generateHTML() and generateJSON() helpers instead.'
      );
    }

    // Validate: need either schema or extensions
    if (!options.schema && (!options.extensions || options.extensions.length === 0)) {
      throw new Error(
        'Editor requires either schema or extensions. ' +
          'Provide a ProseMirror schema directly, or use extensions like [Document, Paragraph, Text].'
      );
    }

    this.options = {
      editable: true,
      ...options,
    };

    this.createEditor();
  }

  // === Getters ===

  /**
   * Gets the current EditorState
   */
  get state(): EditorState {
    return this.view.state;
  }

  /**
   * Gets the ProseMirror schema
   */
  get schema(): Schema {
    return this._extensionManager.schema;
  }

  /**
   * Checks if the editor is editable
   */
  get isEditable(): boolean {
    return this.view.editable;
  }

  /**
   * Checks if the editor content is empty
   */
  get isEmpty(): boolean {
    return isDocumentEmpty(this.state.doc);
  }

  /**
   * Checks if the editor has focus
   */
  get isFocused(): boolean {
    return this.view.hasFocus();
  }

  /**
   * Checks if the editor has been destroyed
   */
  get isDestroyed(): boolean {
    return this._isDestroyed;
  }

  /**
   * Gets single commands for immediate execution
   * @example editor.commands.focus('end')
   */
  get commands(): SingleCommands {
    return this.commandManager.commands;
  }

  /**
   * Creates a command chain for batched execution
   * @example editor.chain().focus().insertText('Hello').run()
   */
  chain(): ChainedCommands {
    return this.commandManager.chain();
  }

  /**
   * Checks if commands can be executed (dry-run)
   * @example if (editor.can().toggleBold()) { ... }
   */
  can(): CanCommands {
    return this.commandManager.can();
  }

  /**
   * Gets extension storage
   * Access via: editor.storage.extensionName.propertyName
   */
  get storage(): Record<string, unknown> {
    return this._extensionManager.storage;
  }

  /**
   * Gets toolbar items registered by all extensions.
   * Used by framework toolbar components to auto-generate UI.
   */
  get toolbarItems(): ToolbarItem[] {
    return this._extensionManager.toolbarItems;
  }

  // === Active State Methods ===

  /**
   * Checks if a node or mark is currently active
   *
   * For toolbar button states - returns true if:
   * - For marks: the current selection has the mark applied
   * - For nodes: the cursor is inside that node type
   *
   * @param nameOrAttributes - Extension name, or object with name and attributes
   * @param attributes - Optional attributes to match (for node/mark specific states)
   *
   * @example
   * editor.isActive('bold') // → true if bold mark is active
   * editor.isActive('heading', { level: 2 }) // → true if in h2
   * editor.isActive({ name: 'textAlign', attributes: { align: 'center' } })
   */
  isActive(
    nameOrAttributes: string | { name: string; attributes?: Record<string, unknown> },
    attributes?: Record<string, unknown>
  ): boolean {
    // Normalize arguments
    const name = typeof nameOrAttributes === 'string' ? nameOrAttributes : nameOrAttributes.name;
    const attrs = typeof nameOrAttributes === 'string' ? attributes : nameOrAttributes.attributes;

    const { state } = this;
    const { selection, schema } = state;
    const { from, to, $from } = selection;

    // Check if it's a mark
    const markType = schema.marks[name];
    if (markType) {
      // For empty selection, check marks at cursor or stored marks
      if (selection.empty) {
        const storedMarks = state.storedMarks ?? $from.marks();
        const hasMark = storedMarks.some(mark => mark.type === markType);
        if (!hasMark) return false;

        // Check attributes if specified
        if (attrs) {
          const mark = storedMarks.find(m => m.type === markType);
          return mark ? this.matchAttributes(mark.attrs, attrs) : false;
        }
        return true;
      }

      // For range selection, check if entire range has the mark.
      // Uses object to track state — linter can't narrow object properties through callbacks.
      const check = { hasText: false, hasMark: true };
      state.doc.nodesBetween(from, to, (node) => {
        if (node.isText) {
          check.hasText = true;
          const nodeMark = node.marks.find(m => m.type === markType);
          if (!nodeMark) {
            check.hasMark = false;
            return false; // Stop iteration
          }
          // Check attributes if specified
          if (attrs && !this.matchAttributes(nodeMark.attrs, attrs)) {
            check.hasMark = false;
            return false;
          }
        }
        return true;
      });
      return check.hasText && check.hasMark;
    }

    // Check if it's a node
    const nodeType = schema.nodes[name];
    if (nodeType) {
      // Check both $from and $to paths — the node must be an ancestor
      // of both ends of the selection for it to be considered active.
      const { $to } = selection;

      // For list-group nodes, only the innermost list ancestor should be
      // considered active. This prevents e.g. both bulletList and orderedList
      // showing as active when a bullet list is nested inside an ordered list.
      const isListNode = nodeType.spec.group?.split(' ').includes('list') ?? false;

      const findInPath = ($pos: typeof $from): boolean => {
        for (let depth = $pos.depth; depth >= 0; depth--) {
          const node = $pos.node(depth);

          if (isListNode) {
            const inListGroup = node.type.spec.group?.split(' ').includes('list') ?? false;
            if (inListGroup) {
              // First (innermost) list ancestor — only match if it's the target type
              if (node.type !== nodeType) return false;
              return attrs ? this.matchAttributes(node.attrs, attrs) : true;
            }
          } else {
            if (node.type === nodeType) {
              return attrs ? this.matchAttributes(node.attrs, attrs) : true;
            }
          }
        }
        return false;
      };

      return findInPath($from) && findInPath($to);
    }

    return false;
  }

  /**
   * Gets attributes of the currently active node or mark
   *
   * Returns empty object if the node/mark is not found or not active.
   *
   * @param name - Extension name (node or mark)
   *
   * @example
   * editor.getAttributes('heading') // → { level: 2 }
   * editor.getAttributes('link') // → { href: 'https://...', target: '_blank' }
   */
  getAttributes(name: string): Record<string, unknown> {
    const { state } = this;
    const { selection, schema } = state;
    const { $from } = selection;

    // Check if it's a mark
    const markType = schema.marks[name];
    if (markType) {
      // Get marks at cursor position or stored marks
      const marks = state.storedMarks ?? $from.marks();
      const mark = marks.find(m => m.type === markType);
      return mark ? { ...mark.attrs } : {};
    }

    // Check if it's a node
    const nodeType = schema.nodes[name];
    if (nodeType) {
      // Find node in selection path
      for (let depth = $from.depth; depth >= 0; depth--) {
        const node = $from.node(depth);
        if (node.type === nodeType) {
          return { ...node.attrs };
        }
      }
      return {};
    }

    return {};
  }

  /**
   * Helper to match attributes
   * Returns true if target contains all key/value pairs from source
   */
  private matchAttributes(
    target: Record<string, unknown>,
    source: Record<string, unknown>
  ): boolean {
    for (const [key, value] of Object.entries(source)) {
      if (target[key] !== value) {
        return false;
      }
    }
    return true;
  }

  // === Content Methods ===

  /**
   * Gets the document content as JSON
   */
  getJSON(): JSONContent {
    return this.state.doc.toJSON() as JSONContent;
  }

  /**
   * Gets the document content as HTML string
   */
  getHTML(): string {
    const fragment = DOMSerializer.fromSchema(this.schema).serializeFragment(
      this.state.doc.content
    );

    const div = document.createElement('div');
    div.appendChild(fragment);

    // Browser DOM normalizes hex colors to rgb() — convert back to hex within style attrs
    return div.innerHTML.replace(/style="([^"]*)"/g, (_match, style: string) =>
      'style="' +
        style.replace(
          /rgb\((\d+),\s*(\d+),\s*(\d+)\)/g,
          (_, r: string, g: string, b: string) =>
            '#' + [r, g, b].map(c => Number(c).toString(16).padStart(2, '0')).join(''),
        ) +
        '"',
    );
  }

  /**
   * Gets the document content as plain text
   *
   * @param options - Options for text extraction
   * @param options.blockSeparator - String to insert between blocks (default: '\n\n')
   */
  getText(options: { blockSeparator?: string } = {}): string {
    const { blockSeparator = '\n\n' } = options;
    return this.state.doc.textBetween(
      0,
      this.state.doc.content.size,
      blockSeparator
    );
  }

  /**
   * Executes a command with proper CommandProps
   * @internal
   */
  private runCommand(command: Command): boolean {
    const tr = this.state.tr;
    return command({
      editor: this,
      state: this.state,
      tr,
      dispatch: (t) => { this.view.dispatch(t); },
      chain: () => this.chain(),
      can: () => this.can(),
      commands: this.commands,
    });
  }

  /**
   * Sets the editor content
   *
   * @param content - JSON or HTML content
   * @param emitUpdate - Whether to emit update event (default: true)
   * @returns true if content was set successfully, false if content was invalid
   */
  setContent(content: Content, emitUpdate = true): boolean {
    return this.runCommand(setContentCommand(content, { emitUpdate }));
  }

  /**
   * Clears the editor content
   *
   * @param emitUpdate - Whether to emit update event (default: true)
   * @returns true if content was cleared successfully
   */
  clearContent(emitUpdate = true): boolean {
    return this.runCommand(clearContentCommand({ emitUpdate }));
  }

  // === Lifecycle Methods ===

  /**
   * Sets whether the editor is editable
   *
   * @param editable - Whether the editor should be editable
   */
  setEditable(editable: boolean): this {
    this.options.editable = editable;

    // ProseMirror rechecks editable on each transaction
    // Dispatch empty transaction to trigger re-evaluation
    this.view.dispatch(this.state.tr);

    return this;
  }

  /**
   * Focuses the editor
   *
   * @param position - Where to place cursor (default: null = just focus)
   */
  focus(position: FocusPosition = null): this {
    this.runCommand(focusCommand(position));
    return this;
  }

  /**
   * Removes focus from the editor
   */
  blur(): this {
    this.runCommand(blurCommand());
    return this;
  }

  // === Dynamic Plugin Management ===

  /**
   * Registers a ProseMirror plugin dynamically at runtime.
   * Used by framework wrappers (e.g. Angular BubbleMenu component) to add
   * plugins after the editor is created.
   */
  registerPlugin(plugin: Plugin): void {
    // Prevent duplicate registration (same plugin key)
    if (plugin.spec.key?.get(this.view.state)) return;

    const newState = this.view.state.reconfigure({
      plugins: [...this.view.state.plugins, plugin],
    });
    this.view.updateState(newState);
  }

  /**
   * Unregisters a ProseMirror plugin by its PluginKey.
   * Uses PluginKey.get() to identify the plugin to remove.
   */
  unregisterPlugin(key: PluginKey): void {
    const pluginToRemove = key.get(this.view.state);
    if (!pluginToRemove) return;

    const newState = this.view.state.reconfigure({
      plugins: this.view.state.plugins.filter((p) => p !== pluginToRemove),
    });
    this.view.updateState(newState);
  }

  /**
   * Destroys the editor and cleans up resources
   *
   * After calling destroy(), the editor instance should not be used.
   */
  destroy(): void {
    if (this._isDestroyed) {
      return;
    }

    // Clear autofocus timer if pending
    if (this._autofocusTimer) {
      clearTimeout(this._autofocusTimer);
      this._autofocusTimer = null;
    }

    this.emit('destroy');
    this.options.onDestroy?.();

    // Destroy ProseMirror view
    this.view.destroy();

    // Destroy managers
    this._extensionManager.destroy();

    // Clear all event listeners
    this.removeAllListeners();

    this._isDestroyed = true;
  }

  // === Private Methods ===

  /**
   * Creates the editor instance
   */
  private createEditor(): void {
    // 1. Emit beforeCreate - extensions can modify options in Step 2
    this.emit('beforeCreate', { editor: this });
    this.options.onBeforeCreate?.({ editor: this });
    // Note: Extension onBeforeCreate is called after ExtensionManager is created (step 2)

    // 2. Initialize ExtensionManager with extensions or schema
    this._extensionManager = new ExtensionManager(
      {
        extensions: this.options.extensions,
        schema: this.options.schema,
      },
      this
    );

    // 2.1 Call onBeforeCreate on all extensions (now that they have editor reference)
    this._extensionManager.callOnBeforeCreate();

    this._extensionManager.validateSchema();

    // 3. Create initial document from content (with graceful error handling)
    let doc;
    try {
      doc = createDocument(
        this.options.content ?? null,
        this._extensionManager.schema
      );
    } catch (error) {
      // Emit content error event for invalid content
      const contentError = error instanceof Error ? error : new Error(String(error));
      this.emit('contentError', {
        editor: this,
        error: contentError,
        content: this.options.content,
      });
      this.options.onContentError?.({
        editor: this,
        error: contentError,
        content: this.options.content,
      });

      // Fall back to empty document
      doc = createDocument(null, this._extensionManager.schema);
    }

    // 4. Get plugins from extensions (empty in Step 1.3)
    const plugins = this._extensionManager.plugins;

    // 5. Create EditorState
    const state = EditorState.create({
      schema: this._extensionManager.schema,
      doc,
      plugins,
    });

    // 6. Resolve element - use provided or create detached div
    const element = this.options.element ?? document.createElement('div');

    // 7. Create EditorView
    const nodeViews = this._extensionManager.nodeViews;
    this.view = new EditorView(element, {
      state,
      dispatchTransaction: this.dispatchTransaction.bind(this),
      editable: () => this.options.editable ?? true,
      ...(Object.keys(nodeViews).length > 0 ? { nodeViews } : {}),
      // Handle focus/blur events
      handleDOMEvents: {
        focus: (_view, event) => {
          this.emit('focus', { editor: this, event: event });
          this.options.onFocus?.({ editor: this, event: event });
          this._extensionManager.callOnFocus({ event });
          return false;
        },
        blur: (_view, event) => {
          this.emit('blur', { editor: this, event: event });
          this.options.onBlur?.({ editor: this, event: event });
          this._extensionManager.callOnBlur({ event });
          return false;
        },
      },
    });

    // 8. Emit mount event - view is now attached to DOM element
    this.emit('mount', { editor: this, view: this.view });
    this.options.onMount?.({ editor: this, view: this.view });

    // 9. Initialize CommandManager
    this.commandManager = new CommandManager(this);

    // 10. Handle autofocus
    if (this.options.autofocus) {
      // Use setTimeout to ensure DOM is ready
      // Store reference for cleanup on destroy
      this._autofocusTimer = setTimeout(() => {
        this._autofocusTimer = null;
        if (!this._isDestroyed) {
          this.focus(this.options.autofocus);
        }
      }, 0);
    }

    // 11. Set up error event handler for onError callback
    this.on('error', (props) => {
      this.options.onError?.(props);
    });

    // 12. Emit create event and call extension onCreate hooks
    this.emit('create', { editor: this });
    this.options.onCreate?.({ editor: this });
    this._extensionManager.callOnCreate();
  }

  /**
   * Handles ProseMirror transactions
   */
  private dispatchTransaction(transaction: Transaction): void {
    if (this._isDestroyed) {
      return;
    }

    // 1. Apply transaction to state
    const newState = this.view.state.apply(transaction);

    // 2. Update view
    this.view.updateState(newState);

    // 3. Emit transaction event (fires for EVERY transaction)
    this.emit('transaction', { editor: this, transaction });
    this.options.onTransaction?.({ editor: this, transaction });
    this._extensionManager.callOnTransaction({ transaction });

    // 4. Check if we should skip update event
    const skipUpdate = transaction.getMeta('skipUpdate') as boolean | undefined;

    // 5. Emit selectionUpdate if selection changed (without doc change)
    if (!transaction.docChanged && transaction.selectionSet) {
      this.emit('selectionUpdate', { editor: this, transaction });
      this.options.onSelectionUpdate?.({ editor: this, transaction });
      this._extensionManager.callOnSelectionUpdate();
    }

    // 6. Emit update if document changed
    if (transaction.docChanged && !skipUpdate) {
      this.emit('update', { editor: this, transaction });
      this.options.onUpdate?.({ editor: this, transaction });
      this._extensionManager.callOnUpdate();
    }
  }

  /**
   * Emit method - needed for CommandManager interface
   */
  override emit<E extends keyof EditorEvents>(
    event: E,
    ...args: EditorEvents[E] extends undefined ? [] : [EditorEvents[E]]
  ): this {
    return super.emit(event, ...args);
  }
}
