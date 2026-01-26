/**
 * Editor - Main editor class wrapping ProseMirror
 *
 * Step 1.3: Basic editor with schema-based initialization
 * Step 2: Will support extensions for schema building
 */
import type { Transaction } from 'prosemirror-state';
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
  FocusPosition,
  SingleCommands,
  ChainedCommands,
  CanCommands,
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

  // === Content Methods ===

  /**
   * Gets the document content as JSON
   */
  getJSON(): Record<string, unknown> {
    return this.state.doc.toJSON() as Record<string, unknown>;
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

    return div.innerHTML;
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
   * Sets the editor content
   *
   * @param content - JSON or HTML content
   * @param emitUpdate - Whether to emit update event (default: true)
   */
  setContent(content: Content, emitUpdate = true): this {
    const tr = this.state.tr;
    setContentCommand(content, { emitUpdate })({
      editor: this,
      state: this.state,
      tr,
      dispatch: (t) => { this.view.dispatch(t); },
      chain: () => this.chain(),
      can: () => this.can(),
      commands: this.commands,
    });
    return this;
  }

  /**
   * Clears the editor content
   *
   * @param emitUpdate - Whether to emit update event (default: true)
   */
  clearContent(emitUpdate = true): this {
    const tr = this.state.tr;
    clearContentCommand({ emitUpdate })({
      editor: this,
      state: this.state,
      tr,
      dispatch: (t) => { this.view.dispatch(t); },
      chain: () => this.chain(),
      can: () => this.can(),
      commands: this.commands,
    });
    return this;
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
    const tr = this.state.tr;
    focusCommand(position)({
      editor: this,
      state: this.state,
      tr,
      dispatch: (t) => { this.view.dispatch(t); },
      chain: () => this.chain(),
      can: () => this.can(),
      commands: this.commands,
    });
    return this;
  }

  /**
   * Removes focus from the editor
   */
  blur(): this {
    const tr = this.state.tr;
    blurCommand()({
      editor: this,
      state: this.state,
      tr,
      dispatch: (t) => { this.view.dispatch(t); },
      chain: () => this.chain(),
      can: () => this.can(),
      commands: this.commands,
    });
    return this;
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

    // 2. Initialize ExtensionManager with extensions or schema
    this._extensionManager = new ExtensionManager(
      {
        extensions: this.options.extensions,
        schema: this.options.schema,
      },
      this
    );
    this._extensionManager.validateSchema();

    // 3. Create initial document from content
    const doc = createDocument(
      this.options.content ?? null,
      this._extensionManager.schema
    );

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
    this.view = new EditorView(element, {
      state,
      dispatchTransaction: this.dispatchTransaction.bind(this),
      editable: () => this.options.editable ?? true,
      // Handle focus/blur events
      handleDOMEvents: {
        focus: (_view, event) => {
          this.emit('focus', { editor: this, event: event });
          this.options.onFocus?.({ editor: this, event: event });
          return false;
        },
        blur: (_view, event) => {
          this.emit('blur', { editor: this, event: event });
          this.options.onBlur?.({ editor: this, event: event });
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
      setTimeout(() => {
        this.focus(this.options.autofocus);
      }, 0);
    }

    // 11. Set up error event handler for onError callback
    this.on('error', (props) => {
      this.options.onError?.(props);
    });

    // 12. Emit create event
    this.emit('create', { editor: this });
    this.options.onCreate?.({ editor: this });
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

    // 4. Check if we should skip update event
    const skipUpdate = transaction.getMeta('skipUpdate') as boolean | undefined;

    // 5. Emit selectionUpdate if selection changed (without doc change)
    if (!transaction.docChanged && transaction.selectionSet) {
      this.emit('selectionUpdate', { editor: this, transaction });
      this.options.onSelectionUpdate?.({ editor: this, transaction });
    }

    // 6. Emit update if document changed
    if (transaction.docChanged && !skipUpdate) {
      this.emit('update', { editor: this, transaction });
      this.options.onUpdate?.({ editor: this, transaction });
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
