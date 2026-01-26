/**
 * Built-in commands converted to CommandSpec format
 *
 * These 7 essential commands are merged with extension commands
 * to provide a unified command API.
 */
import { TextSelection, AllSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { CommandSpec, RawCommands } from '../types/Commands.js';
import type { FocusPosition, Content } from '../types/index.js';
import { createDocument } from '../helpers/index.js';

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
    return doc.content.size - 1;
  }

  if (position === 'start') {
    return 1;
  }

  if (position === 'all') {
    return null;
  }

  if (typeof position === 'number') {
    return Math.max(0, Math.min(position, doc.content.size));
  }

  return null;
}

/**
 * Focus command - focuses the editor at the specified position
 *
 * @param position - Where to place the cursor
 *   - true/'end': End of document
 *   - 'start': Start of document
 *   - 'all': Select all content
 *   - number: Specific position
 *   - null/false: Just focus without changing selection
 */
export const focus: CommandSpec<[position?: FocusPosition]> =
  (position: FocusPosition = null) =>
  ({ editor, state, tr, dispatch }) => {
    const view = editor.view as EditorView;

    // Check if view is attached to DOM (dry-run always returns true)
    if (!dispatch) {
      return true;
    }

    if (!view.dom.isConnected) {
      return false;
    }

    // Focus the editor
    view.focus();

    // Handle 'all' position - select all content
    if (position === 'all') {
      const selection = new AllSelection(state.doc);
      dispatch(tr.setSelection(selection));
      return true;
    }

    // Resolve position to cursor location
    const resolvedPos = resolveFocusPosition(view, position);

    if (resolvedPos !== null) {
      const $pos = state.doc.resolve(resolvedPos);
      const selection = TextSelection.near($pos);
      dispatch(tr.setSelection(selection));
    }

    return true;
  };

/**
 * Blur command - removes focus from the editor
 */
export const blur: CommandSpec =
  () =>
  ({ editor, dispatch }) => {
    const view = editor.view as EditorView;

    // Dry-run always returns true
    if (!dispatch) {
      return true;
    }

    view.dom.blur();
    return true;
  };

/**
 * SetContent command - sets the editor content
 *
 * @param content - JSON or HTML content
 * @param options - Options for setting content
 */
export const setContent: CommandSpec<[content: Content, options?: SetContentOptions]> =
  (content: Content, options: SetContentOptions = {}) =>
  ({ state, tr, dispatch }) => {
    const { emitUpdate = true, parseOptions } = options;
    const { schema } = state;

    // Parse content into document
    const doc = createDocument(content, schema, { parseOptions });

    // In dry-run mode, just check if content can be created
    if (!dispatch) {
      return true;
    }

    // Replace entire document
    tr.replaceWith(0, state.doc.content.size, doc.content);

    // Mark transaction to potentially skip update event
    if (!emitUpdate) {
      tr.setMeta('addToHistory', false);
      tr.setMeta('skipUpdate', true);
    }

    dispatch(tr);
    return true;
  };

/**
 * ClearContent command - clears the editor content to empty state
 *
 * @param options - Options for clearing content
 */
export const clearContent: CommandSpec<[options?: ClearContentOptions]> =
  (options: ClearContentOptions = {}) =>
  ({ state, tr, dispatch }) => {
    const { emitUpdate = true } = options;
    const { schema } = state;

    // Create empty document
    const doc = createDocument(null, schema);

    // In dry-run mode, just return true
    if (!dispatch) {
      return true;
    }

    // Replace entire document
    tr.replaceWith(0, state.doc.content.size, doc.content);

    if (!emitUpdate) {
      tr.setMeta('addToHistory', false);
      tr.setMeta('skipUpdate', true);
    }

    dispatch(tr);
    return true;
  };

/**
 * InsertText command - inserts text at the current selection
 *
 * @param text - Text to insert
 */
export const insertText: CommandSpec<[text: string]> =
  (text: string) =>
  ({ tr, dispatch }) => {
    // Use tr.selection for chain compatibility - reflects current position
    const { from, to } = tr.selection;

    // In dry-run mode, check if text can be inserted
    if (!dispatch) {
      // Text can always be inserted where selection is
      return true;
    }

    tr.insertText(text, from, to);
    dispatch(tr);
    return true;
  };

/**
 * DeleteSelection command - deletes the current selection
 */
export const deleteSelection: CommandSpec =
  () =>
  ({ tr, dispatch }) => {
    // Use tr.selection for chain compatibility
    const { selection } = tr;

    // Can only delete if there's a selection range
    if (selection.empty) {
      return false;
    }

    // In dry-run mode, just check if delete is possible
    if (!dispatch) {
      return true;
    }

    tr.deleteSelection();
    dispatch(tr);
    return true;
  };

/**
 * SelectAll command - selects all content in the editor
 */
export const selectAll: CommandSpec =
  () =>
  ({ state, tr, dispatch }) => {
    // In dry-run mode, always possible
    if (!dispatch) {
      return true;
    }

    const selection = new AllSelection(state.doc);
    tr.setSelection(selection);
    dispatch(tr);
    return true;
  };

/**
 * All built-in commands as RawCommands
 * These are merged with extension commands in CommandManager
 */
export const builtInCommands: RawCommands = {
  focus,
  blur,
  setContent,
  clearContent,
  insertText,
  deleteSelection,
  selectAll,
} as RawCommands;
