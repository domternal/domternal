/**
 * Selection Extension
 *
 * Provides selection utilities and helpers for working with
 * the editor's current selection state.
 *
 * @example
 * ```ts
 * import { Selection } from '@domternal/core';
 *
 * const editor = new Editor({
 *   extensions: [
 *     // ... other extensions
 *     Selection,
 *   ],
 * });
 *
 * // Get selected text
 * const text = editor.storage.selection.getText();
 *
 * // Check if selection is empty
 * if (editor.storage.selection.isEmpty()) {
 *   console.log('Cursor is collapsed');
 * }
 *
 * // Get selection range
 * const { from, to } = editor.storage.selection.getRange();
 *
 * // Set selection programmatically
 * editor.commands.setSelection(5, 10);
 * ```
 */
import { Extension } from '../Extension.js';
import { NodeSelection, TextSelection } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import type { Editor } from '../Editor.js';

export interface SelectionOptions {
  /**
   * HTML attributes to apply.
   * @default {}
   */
  HTMLAttributes: Record<string, unknown>;
}

export interface SelectionStorage {
  /**
   * Returns the currently selected text content.
   */
  getText: () => string;

  /**
   * Returns the selected node (if a node selection).
   */
  getNode: () => PMNode | null;

  /**
   * Returns true if the selection is empty.
   */
  isEmpty: () => boolean;

  /**
   * Returns the selection range { from, to }.
   */
  getRange: () => { from: number; to: number };

  /**
   * Returns the current cursor position (null if range selection).
   */
  getCursor: () => number | null;
}

export const Selection = Extension.create<SelectionOptions, SelectionStorage>({
  name: 'selection',

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addStorage() {
    return {
      getText: () => '',
      getNode: () => null,
      isEmpty: () => true,
      getRange: () => ({ from: 0, to: 0 }),
      getCursor: () => null,
    };
  },

  onCreate() {
    const editor = this.editor as Editor | null;

    // Initialize storage methods
    this.storage.getText = () => {
      const state = editor?.state;
      if (!state) return '';

      const { selection, doc } = state;
      const { from, to } = selection;
      return doc.textBetween(from, to, ' ');
    };

    this.storage.getNode = () => {
      const state = editor?.state;
      if (!state) return null;

      const { selection } = state;
      if (selection instanceof NodeSelection) {
        return selection.node;
      }

      return null;
    };

    this.storage.isEmpty = () => {
      const state = editor?.state;
      if (!state) return true;
      return state.selection.empty;
    };

    this.storage.getRange = () => {
      const state = editor?.state;
      if (!state) return { from: 0, to: 0 };
      return { from: state.selection.from, to: state.selection.to };
    };

    this.storage.getCursor = () => {
      const state = editor?.state;
      if (!state) return null;
      const { selection } = state;
      if (!selection.empty) return null;
      return selection.from;
    };
  },

  addCommands() {
    return {
      setSelection:
        (from: number, to?: number) =>
        ({ state, dispatch }) => {
          const resolvedTo = to ?? from;

          if (from < 0 || resolvedTo > state.doc.content.size) {
            return false;
          }

          if (dispatch) {
            const selection = TextSelection.create(state.doc, from, resolvedTo);
            const tr = state.tr.setSelection(selection);
            dispatch(tr);
          }

          return true;
        },

      selectNode:
        (pos: number) =>
        ({ state, dispatch }) => {
          // Validate position is within bounds
          if (pos < 0 || pos >= state.doc.content.size) {
            return false;
          }

          const node = state.doc.nodeAt(pos);

          if (!node) return false;

          if (dispatch) {
            const selection = NodeSelection.create(state.doc, pos);
            const tr = state.tr.setSelection(selection);
            dispatch(tr);
          }

          return true;
        },

      selectParentNode:
        () =>
        ({ state, dispatch }) => {
          const { selection } = state;
          const { $from } = selection;

          // Find the nearest parent node that can be selected
          for (let depth = $from.depth; depth > 0; depth--) {
            const node = $from.node(depth);
            const pos = $from.before(depth);

            if (node.type.spec.selectable !== false) {
              if (dispatch) {
                const sel = NodeSelection.create(state.doc, pos);
                const tr = state.tr.setSelection(sel);
                dispatch(tr);
              }
              return true;
            }
          }

          return false;
        },

      extendSelection:
        (direction: 'left' | 'right' | 'start' | 'end') =>
        ({ state, dispatch }) => {
          const { selection } = state;
          let { from, to } = selection;

          switch (direction) {
            case 'left':
              from = Math.max(0, from - 1);
              break;
            case 'right':
              to = Math.min(state.doc.content.size, to + 1);
              break;
            case 'start':
              from = 0;
              break;
            case 'end':
              to = state.doc.content.size;
              break;
          }

          if (dispatch) {
            const newSelection = TextSelection.create(state.doc, from, to);
            const tr = state.tr.setSelection(newSelection);
            dispatch(tr);
          }

          return true;
        },
    };
  },
});
