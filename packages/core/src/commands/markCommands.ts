/**
 * Mark commands — toggleMark, setMark, unsetMark, unsetAllMarks
 */
import type { Attrs, MarkType } from '@domternal/pm/model';
import type { EditorState, Transaction } from '@domternal/pm/state';
import type { CommandSpec } from '../types/Commands.js';
import { Mark } from '../Mark.js';

/**
 * Checks if a mark can be applied in the current selection context.
 * Shared by toggleMark and setMark to avoid duplicated logic.
 *
 * For empty selections: checks that the cursor is in inline content,
 * the parent allows the mark type, and no existing marks exclude it.
 *
 * For range selections: checks that at least one parent allows the mark
 * and that applicable text exists (text not excluded by other marks).
 */
function canApplyMark(
  state: EditorState,
  tr: Transaction,
  markType: MarkType,
): boolean {
  const { empty, ranges } = tr.selection;
  const firstRange = ranges[0];
  if (!firstRange) return false;

  if (empty) {
    const $pos = tr.doc.resolve(firstRange.$from.pos);
    if (!$pos.parent.inlineContent || !$pos.parent.type.allowsMarkType(markType)) {
      return false;
    }
    const cursorMarks = tr.storedMarks ?? state.storedMarks ?? $pos.marks();
    if (cursorMarks.some((m) => m.type.excludes(markType) && m.type !== markType)) {
      return false;
    }
  } else {
    const ctx = { parentAllows: false, hasText: false, hasApplicableText: false };
    for (const range of ranges) {
      tr.doc.nodesBetween(range.$from.pos, range.$to.pos, (node) => {
        if (node.inlineContent && node.type.allowsMarkType(markType)) {
          ctx.parentAllows = true;
        }
        if (node.isText) {
          ctx.hasText = true;
          if (!node.marks.some((m) => m.type.excludes(markType) && m.type !== markType)) {
            ctx.hasApplicableText = true;
          }
        }
      });
    }
    if (!ctx.parentAllows || (ctx.hasText && !ctx.hasApplicableText)) {
      return false;
    }
  }

  return true;
}

/**
 * ToggleMark command - toggles a mark on the current selection
 *
 * In cursor mode (empty selection): toggles stored mark.
 * In range mode: applies/removes mark across the entire selection,
 * respecting CellSelection ranges.
 *
 * @param markName - The name of the mark to toggle
 * @param attributes - Optional attributes for the mark
 */
export const toggleMark: CommandSpec<[markName: string, attributes?: Attrs]> =
  (markName: string, attributes?: Attrs) =>
  ({ state, tr, dispatch }) => {
    const markType = state.schema.marks[markName];

    if (!markType) {
      return false;
    }

    if (!canApplyMark(state, tr, markType)) {
      return false;
    }

    const { empty, ranges } = tr.selection;
    const firstRange = ranges[0];
    if (!firstRange) return false;

    if (!dispatch) return true;

    if (empty) {
      // Cursor mode — toggle stored mark
      const from = firstRange.$from.pos;
      const cursorMarks = tr.storedMarks
        ?? state.storedMarks
        ?? tr.doc.resolve(from).marks();

      if (markType.isInSet(cursorMarks)) {
        tr.removeStoredMark(markType);
      } else {
        tr.addStoredMark(markType.create(attributes ?? null));
      }
    } else {
      // Range mode — iterate over selection ranges (handles CellSelection)
      const hasMark = ranges.every(range =>
        tr.doc.rangeHasMark(range.$from.pos, range.$to.pos, markType),
      );
      for (const range of ranges) {
        if (hasMark) {
          tr.removeMark(range.$from.pos, range.$to.pos, markType);
        } else {
          tr.addMark(range.$from.pos, range.$to.pos, markType.create(attributes ?? null));
        }
      }
    }

    dispatch(tr);
    return true;
  };

/**
 * SetMark command - adds a mark to the current selection
 *
 * @param markName - The name of the mark to set
 * @param attributes - Optional attributes for the mark
 */
export const setMark: CommandSpec<[markName: string, attributes?: Attrs]> =
  (markName: string, attributes?: Attrs) =>
  ({ state, tr, dispatch }) => {
    const markType = state.schema.marks[markName];

    if (!markType) {
      return false;
    }

    if (!canApplyMark(state, tr, markType)) {
      return false;
    }

    const { empty, ranges } = tr.selection;
    const firstRange = ranges[0];
    if (!firstRange) return false;

    // Cursor mode — add to stored marks
    if (empty) {
      if (!dispatch) return true;

      const from = firstRange.$from.pos;
      // Merge with existing mark attributes to preserve sibling attributes
      // (e.g., fontFamily should not be lost when setting fontSize on textStyle)
      // Priority: stored marks on tr > stored marks on state > marks at cursor position
      const existingMark = tr.storedMarks?.find(m => m.type === markType)
        ?? state.storedMarks?.find(m => m.type === markType)
        ?? tr.doc.resolve(from).marks().find(m => m.type === markType)
        ?? null;
      const mergedAttrs = existingMark
        ? { ...existingMark.attrs, ...attributes }
        : attributes;

      const mark = markType.create(mergedAttrs);
      tr.addStoredMark(mark);
      dispatch(tr);
      return true;
    }

    if (!dispatch) {
      return true;
    }

    // Merge per-node to preserve each node's own attributes
    // (e.g., one word has fontFamily: 'Arial', another has 'Georgia' —
    //  setting fontSize should preserve each node's fontFamily independently)
    // Iterate over selection ranges to handle CellSelection (multiple ranges)
    const nodeMarks: { from: number; to: number; attrs: Attrs }[] = [];
    for (const range of ranges) {
      const rfrom = range.$from.pos;
      const rto = range.$to.pos;
      tr.doc.nodesBetween(rfrom, rto, (node, pos) => {
        if (!node.isText) return;
        const existing = markType.isInSet(node.marks);
        const nodeAttrs = existing
          ? { ...existing.attrs, ...attributes }
          : (attributes ?? {});
        nodeMarks.push({
          from: Math.max(pos, rfrom),
          to: Math.min(pos + node.nodeSize, rto),
          attrs: nodeAttrs,
        });
      });
    }

    if (nodeMarks.length > 0) {
      for (const nm of nodeMarks) {
        tr.addMark(nm.from, nm.to, markType.create(nm.attrs));
      }
    } else {
      // No text nodes found (e.g., selection across empty blocks) — apply globally
      for (const range of ranges) {
        tr.addMark(range.$from.pos, range.$to.pos, markType.create(attributes));
      }
    }

    dispatch(tr);
    return true;
  };

/**
 * UnsetMark command - removes a mark from the current selection
 *
 * @param markName - The name of the mark to remove
 */
export const unsetMark: CommandSpec<[markName: string]> =
  (markName: string) =>
  ({ state, tr, dispatch }) => {
    const markType = state.schema.marks[markName];

    if (!markType) {
      return false;
    }

    const { empty, ranges } = tr.selection;

    // For empty selection, remove from stored marks
    if (empty) {
      if (!dispatch) {
        return true;
      }

      tr.removeStoredMark(markType);
      dispatch(tr);
      return true;
    }

    if (!dispatch) {
      return true;
    }

    for (const range of ranges) {
      tr.removeMark(range.$from.pos, range.$to.pos, markType);
    }
    dispatch(tr);
    return true;
  };

/**
 * UnsetAllMarks command - removes all formatting marks from the current selection
 *
 * Iterates over all mark types in the schema and removes those with
 * `isFormatting !== false`. Marks like Link that set `isFormatting: false`
 * are preserved.
 *
 * Returns false for empty selections (no range to clear).
 */
export const unsetAllMarks: CommandSpec =
  () =>
  ({ state, tr, dispatch, editor }) => {
    const { empty, ranges } = tr.selection;

    if (empty) return false;
    if (!dispatch) return true;

    // Build set of non-formatting mark names to skip.
    // Mark extensions with isFormatting: false (e.g. Link) survive clear formatting.
    const skipMarks = new Set<string>();
    const mgr = (editor as unknown as { extensionManager: { extensions: readonly unknown[] } }).extensionManager;
    for (const ext of mgr.extensions) {
      if (ext instanceof Mark && !ext.isFormatting) {
        skipMarks.add(ext.name);
      }
    }

    for (const markName of Object.keys(state.schema.marks)) {
      if (!skipMarks.has(markName)) {
        for (const range of ranges) {
          tr.removeMark(range.$from.pos, range.$to.pos, state.schema.marks[markName]);
        }
      }
    }
    tr.setStoredMarks([]);
    dispatch(tr);
    return true;
  };
