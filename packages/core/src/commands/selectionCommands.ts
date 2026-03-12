/**
 * Selection commands — focus, blur, selectAll, selectNodeBackward, deleteSelection
 */
import { TextSelection, AllSelection } from '@domternal/pm/state';
import type { EditorView } from '@domternal/pm/view';
import { selectNodeBackward as pmSelectNodeBackward } from '@domternal/pm/commands';
import type { CommandSpec } from '../types/Commands.js';
import type { FocusPosition } from '../types/index.js';

/**
 * Resolves focus position to a numeric position in the document
 *
 * Uses the provided doc (tr.doc) rather than view.state.doc to support
 * chain context where prior commands may have modified the document.
 */
function resolveFocusPosition(
  doc: { content: { size: number } },
  position: FocusPosition
): number | null {
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
  ({ editor, tr, dispatch }) => {
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

    if (position === 'all') {
      const selection = new AllSelection(tr.doc);
      dispatch(tr.setSelection(selection));
      return true;
    }

    // Resolve position
    const resolvedPos = resolveFocusPosition(tr.doc, position);

    if (resolvedPos !== null) {
      // Use TextSelection.near() to find nearest valid text position
      // (e.g., position 1 inside a blockquote resolves to the paragraph within)
      const $pos = tr.doc.resolve(resolvedPos);
      const selection = TextSelection.near($pos);
      dispatch(tr.setSelection(selection));
    } else {
      dispatch(tr);
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

    if (!dispatch) {
      return true;
    }

    // blur() is not part of ProseMirror API, but works on the DOM element
    view.dom.blur();
    return true;
  };

/**
 * SelectAll command - selects all content in the editor
 *
 * Uses AllSelection to select the entire document.
 * Uses tr.doc to support chain context.
 */
export const selectAll: CommandSpec =
  () =>
  ({ tr, dispatch }) => {
    if (!dispatch) {
      return true;
    }

    tr.setSelection(new AllSelection(tr.doc));
    dispatch(tr);
    return true;
  };

/**
 * SelectNodeBackward command - selects the node before the cursor
 *
 * When the cursor is at the start of a textblock, this selects the node before it.
 */
export const selectNodeBackward: CommandSpec =
  () =>
  ({ state, dispatch }) => {
    return pmSelectNodeBackward(state, dispatch);
  };

/**
 * DeleteSelection command - deletes the current selection
 *
 * Uses tr.selection to support chain context.
 */
export const deleteSelection: CommandSpec =
  () =>
  ({ tr, dispatch }) => {
    const { empty, from, to } = tr.selection;

    if (empty) {
      return false;
    }

    if (!dispatch) {
      return true;
    }

    tr.deleteRange(from, to);
    dispatch(tr);
    return true;
  };
