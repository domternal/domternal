/**
 * CommandManager - Manages editor commands
 *
 * Step 1.3: Minimal version with 7 essential commands
 * Step 2: Will be expanded with chain(), can(), and dynamic commands from extensions
 */
import { TextSelection, AllSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { FocusPosition, Content } from './types/index.js';
import { createDocument } from './helpers/index.js';

/**
 * Options for setContent command
 */
export interface SetContentOptions {
  /**
   * Emit update event after setting content
   * @default true
   */
  emitUpdate?: boolean;

  /**
   * Parse options for HTML content
   */
  parseOptions?: Record<string, unknown>;
}

/**
 * Options for clearContent command
 */
export interface ClearContentOptions {
  /**
   * Emit update event after clearing content
   * @default true
   */
  emitUpdate?: boolean;
}

/**
 * Editor interface for CommandManager
 * Forward declaration to avoid circular dependency
 */
export interface CommandManagerEditor {
  view: EditorView;
  readonly isDestroyed: boolean;
  emit(event: string, props?: unknown): void;
}

/**
 * Resolves focus position to a numeric position in the document
 */
function resolveFocusPosition(
  view: EditorView,
  position: FocusPosition
): number | null {
  const { doc } = view.state;

  if (position === null || position === false) {
    return null;
  }

  if (position === true || position === 'end') {
    // End of document
    return doc.content.size - 1;
  }

  if (position === 'start') {
    // Start of document (after opening tag of first node)
    return 1;
  }

  if (position === 'all') {
    // Select all - handled separately
    return null;
  }

  if (typeof position === 'number') {
    // Clamp to valid range
    return Math.max(0, Math.min(position, doc.content.size));
  }

  return null;
}

/**
 * Manages editor commands
 *
 * In Step 1.3, provides 7 essential commands:
 * - focus, blur, setContent, clearContent, insertText, deleteSelection, selectAll
 *
 * In Step 2, will be expanded with:
 * - chain() for chainable commands
 * - can() for checking command availability
 * - Dynamic commands from extensions
 */
export class CommandManager {
  private editor: CommandManagerEditor;

  constructor(editor: CommandManagerEditor) {
    this.editor = editor;
  }

  /**
   * Focuses the editor at the specified position
   *
   * @param position - Where to place the cursor
   *   - true/'end': End of document
   *   - 'start': Start of document
   *   - 'all': Select all content
   *   - number: Specific position
   *   - null/false: Just focus without changing selection
   * @returns true if focus was successful
   */
  focus(position: FocusPosition = null): boolean {
    if (this.editor.isDestroyed) {
      return false;
    }

    const { view } = this.editor;

    // Check if view is attached to DOM
    if (!view.dom.isConnected) {
      // Detached view - can't focus
      return false;
    }

    // Focus the editor
    view.focus();

    // Handle 'all' position - select all content
    if (position === 'all') {
      const { tr } = view.state;
      const selection = new AllSelection(view.state.doc);
      view.dispatch(tr.setSelection(selection));
      return true;
    }

    // Resolve position to cursor location
    const resolvedPos = resolveFocusPosition(view, position);

    if (resolvedPos !== null) {
      const { tr, doc } = view.state;
      const $pos = doc.resolve(resolvedPos);
      const selection = TextSelection.near($pos);
      view.dispatch(tr.setSelection(selection));
    }

    return true;
  }

  /**
   * Removes focus from the editor
   *
   * @returns true if blur was successful
   */
  blur(): boolean {
    if (this.editor.isDestroyed) {
      return false;
    }

    const { view } = this.editor;
    const element = view.dom;

    element.blur();

    return true;
  }

  /**
   * Sets the editor content
   *
   * @param content - JSON or HTML content
   * @param options - Options for setting content
   * @returns true if content was set successfully
   */
  setContent(content: Content, options: SetContentOptions = {}): boolean {
    if (this.editor.isDestroyed) {
      return false;
    }

    const { emitUpdate = true, parseOptions } = options;
    const { view } = this.editor;
    const { schema } = view.state;

    // Parse content into document
    const doc = createDocument(content, schema, { parseOptions });

    // Create transaction that replaces entire document
    const { tr } = view.state;
    tr.replaceWith(0, view.state.doc.content.size, doc.content);

    // Mark transaction to potentially skip update event
    if (!emitUpdate) {
      tr.setMeta('addToHistory', false);
      tr.setMeta('skipUpdate', true);
    }

    view.dispatch(tr);

    return true;
  }

  /**
   * Clears the editor content to empty state
   *
   * @param options - Options for clearing content
   * @returns true if content was cleared successfully
   */
  clearContent(options: ClearContentOptions = {}): boolean {
    if (this.editor.isDestroyed) {
      return false;
    }

    const { emitUpdate = true } = options;
    const { view } = this.editor;
    const { schema } = view.state;

    // Create empty document
    const doc = createDocument(null, schema);

    // Create transaction that replaces entire document
    const { tr } = view.state;
    tr.replaceWith(0, view.state.doc.content.size, doc.content);

    if (!emitUpdate) {
      tr.setMeta('addToHistory', false);
      tr.setMeta('skipUpdate', true);
    }

    view.dispatch(tr);

    return true;
  }

  /**
   * Inserts text at the current selection
   *
   * @param text - Text to insert
   * @returns true if text was inserted successfully
   */
  insertText(text: string): boolean {
    if (this.editor.isDestroyed) {
      return false;
    }

    const { view } = this.editor;
    const { tr, selection } = view.state;

    // Insert text at current selection
    tr.insertText(text, selection.from, selection.to);
    view.dispatch(tr);

    return true;
  }

  /**
   * Deletes the current selection
   *
   * @returns true if selection was deleted
   */
  deleteSelection(): boolean {
    if (this.editor.isDestroyed) {
      return false;
    }

    const { view } = this.editor;
    const { tr, selection } = view.state;

    // Only delete if there's a selection range
    if (selection.empty) {
      return false;
    }

    tr.deleteSelection();
    view.dispatch(tr);

    return true;
  }

  /**
   * Selects all content in the editor
   *
   * @returns true if selection was successful
   */
  selectAll(): boolean {
    if (this.editor.isDestroyed) {
      return false;
    }

    const { view } = this.editor;
    const { tr } = view.state;

    const selection = new AllSelection(view.state.doc);
    tr.setSelection(selection);
    view.dispatch(tr);

    return true;
  }

  /**
   * Creates a chainable command builder
   *
   * Step 1.3: Throws error - not yet implemented
   * Step 2: Will return ChainBuilder for chainable commands
   */
  chain(): never {
    throw new Error(
      'chain() is not available in Step 1.3. ' +
        'Chainable commands will be implemented in Step 2 with the extension system.'
    );
  }

  /**
   * Creates a command availability checker
   *
   * Step 1.3: Throws error - not yet implemented
   * Step 2: Will return CanChecker for dry-run command checks
   */
  can(): never {
    throw new Error(
      'can() is not available in Step 1.3. ' +
        'Command availability checks will be implemented in Step 2 with the extension system.'
    );
  }
}
