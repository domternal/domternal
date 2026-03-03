/**
 * Built-in commands converted to CommandSpec format
 *
 * These commands are merged with extension commands
 * to provide a unified command API.
 */
import { TextSelection, AllSelection, EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { selectNodeBackward as pmSelectNodeBackward } from 'prosemirror-commands';
import { wrapRangeInList, liftListItem } from 'prosemirror-schema-list';
import { findWrapping, liftTarget } from 'prosemirror-transform';
import { Fragment, Slice, DOMParser as ProseMirrorDOMParser } from 'prosemirror-model';
import type { Attrs, Node as PMNode } from 'prosemirror-model';
import type { CommandSpec, CommandMap } from '../types/Commands.js';
import type { FocusPosition, Content } from '../types/index.js';
import { createDocument } from '../helpers/index.js';
import { Mark } from '../Mark.js';

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

    // Handle 'all' position - select all content
    // Use tr.doc to support chain context where prior commands may have modified the document
    if (position === 'all') {
      const selection = new AllSelection(tr.doc);
      dispatch(tr.setSelection(selection));
      return true;
    }

    // Resolve position to cursor location
    // Use tr.doc to support chain context where prior commands may have modified the document
    const resolvedPos = resolveFocusPosition(tr.doc, position);

    if (resolvedPos !== null) {
      const $pos = tr.doc.resolve(resolvedPos);
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

    // Parse content into document (with graceful error handling)
    let doc;
    try {
      doc = createDocument(content, schema, { parseOptions });
    } catch {
      // Invalid content - return false to indicate command failed
      return false;
    }

    // In dry-run mode, just check if content can be created
    if (!dispatch) {
      return true;
    }

    // Replace entire document
    // Use tr.doc for chain compatibility - prior commands may have modified the document
    tr.replaceWith(0, tr.doc.content.size, doc.content);

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
    // Use tr.doc for chain compatibility - prior commands may have modified the document
    tr.replaceWith(0, tr.doc.content.size, doc.content);

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

    // For TextSelection, check if parent allows inline content
    // For other selections (AllSelection, NodeSelection), let ProseMirror handle validation
    if (tr.selection instanceof TextSelection) {
      const { $from } = tr.selection;
      if (!$from.parent.inlineContent) {
        return false;
      }
    }

    if (!dispatch) {
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
  ({ tr, dispatch }) => {
    // In dry-run mode, always possible
    if (!dispatch) {
      return true;
    }

    // Use tr.doc for chain compatibility - prior commands may have modified the document
    const selection = new AllSelection(tr.doc);
    tr.setSelection(selection);
    dispatch(tr);
    return true;
  };

// ============================================================================
// Mark Commands
// ============================================================================

/**
 * ToggleMark command - toggles a mark on the current selection
 *
 * Uses tr.doc/tr.selection for chain compatibility instead of delegating
 * to ProseMirror's toggleMark which reads from stale state.
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

    const { empty, ranges } = tr.selection;
    if (!ranges.length) return false;

    // Check if mark can be applied — respects both schema (allowsMarkType)
    // and mark exclusions (e.g. code mark excludes bold/italic/etc.)
    if (empty) {
      const from = ranges[0]!.$from.pos;
      const $pos = tr.doc.resolve(from);
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
    if (!dispatch) return true;

    if (empty) {
      // Cursor mode — toggle stored mark
      const from = ranges[0]!.$from.pos;
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

    const { empty, ranges } = tr.selection;
    if (!ranges.length) return false;

    // Can't add mark to empty selection (unless storedMarks)
    if (empty) {
      // For empty selection, add to stored marks
      if (!dispatch) {
        return true;
      }

      const from = ranges[0]!.$from.pos;
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

// ============================================================================
// Block Commands
// ============================================================================

/**
 * SetBlockType command - changes the block type of the selection
 *
 * Uses tr.doc/tr.selection for chain compatibility. Preserves global
 * attributes (textAlign, lineHeight, etc.) by merging existing node
 * attrs with the provided ones via tr.setBlockType's function form.
 *
 * @param nodeName - The name of the node type to set
 * @param attributes - Optional attributes for the node
 */
export const setBlockType: CommandSpec<[nodeName: string, attributes?: Attrs]> =
  (nodeName: string, attributes?: Attrs) =>
  ({ state, tr, dispatch }) => {
    const nodeType = state.schema.nodes[nodeName];

    if (!nodeType) {
      return false;
    }

    // Check if any textblock in the selection can be changed
    const canApply = tr.selection.ranges.some((range) => {
      let found = false;
      tr.doc.nodesBetween(range.$from.pos, range.$to.pos, (node, pos) => {
        if (found) return false;
        if (!node.isTextblock) return;
        const mergedAttrs = { ...node.attrs, ...(attributes ?? {}) };
        if (node.hasMarkup(nodeType, mergedAttrs)) return;
        if (node.type === nodeType) {
          found = true;
        } else {
          const $pos = tr.doc.resolve(pos);
          const index = $pos.index();
          found = $pos.parent.canReplaceWith(index, index + 1, nodeType);
        }
        return;
      });
      return found;
    });

    if (!canApply) return false;
    if (!dispatch) return true;

    // Apply: use function attrs to preserve global attributes (textAlign, lineHeight, etc.)
    for (const range of tr.selection.ranges) {
      const from = range.$from.pos;
      const to = range.$to.pos;
      tr.setBlockType(from, to, nodeType, (node) => ({ ...node.attrs, ...(attributes ?? {}) }));
    }

    dispatch(tr.scrollIntoView());
    return true;
  };

/**
 * ToggleBlockType command - toggles between a block type and a default type
 *
 * If the current block is of the target type, changes it to the default type.
 * If the current block is not of the target type, changes it to the target type.
 * Preserves global attributes (textAlign, lineHeight) on toggle.
 *
 * @param nodeName - The name of the node type to toggle to
 * @param defaultNodeName - The name of the default node type (usually 'paragraph')
 * @param attributes - Optional attributes for the node
 */
export const toggleBlockType: CommandSpec<[nodeName: string, defaultNodeName: string, attributes?: Attrs]> =
  (nodeName: string, defaultNodeName: string, attributes?: Attrs) =>
  (props) => {
    const { state, tr } = props;
    const nodeType = state.schema.nodes[nodeName];
    const defaultNodeType = state.schema.nodes[defaultNodeName];

    if (!nodeType || !defaultNodeType) {
      return false;
    }

    // Collect non-empty textblocks in the selection. Empty textblocks
    // (e.g., trailing node from TrailingNode extension) are excluded so they
    // don't affect toggle direction. This handles AllSelection correctly.
    const { from, to } = tr.selection;
    const contentBlocks: { node: PMNode }[] = [];
    tr.doc.nodesBetween(from, to, (node) => {
      if (node.isTextblock && node.content.size > 0) {
        contentBlocks.push({ node });
      }
    });

    const allMatch = contentBlocks.length > 0 && contentBlocks.every(({ node }) => {
      const typeMatches = node.type === nodeType;
      const attrsMatch = !attributes || Object.keys(attributes).every(
        (key) => node.attrs[key] === attributes[key]
      );
      return typeMatches && attrsMatch;
    });

    if (allMatch) {
      // Toggle OFF → switch to default type, preserving global attrs
      return setBlockType(defaultNodeName)(props);
    }

    // Toggle ON → switch to target type with attrs, preserving global attrs
    return setBlockType(nodeName, attributes)(props);
  };

/**
 * WrapIn command - wraps the selection in a node type
 *
 * Uses tr.doc/tr.selection for chain compatibility.
 *
 * @param nodeName - The name of the wrapping node type
 * @param attributes - Optional attributes for the node
 */
export const wrapIn: CommandSpec<[nodeName: string, attributes?: Attrs]> =
  (nodeName: string, attributes?: Attrs) =>
  ({ state, tr, dispatch }) => {
    const nodeType = state.schema.nodes[nodeName];

    if (!nodeType) {
      return false;
    }

    const { $from, $to } = tr.selection;
    const range = $from.blockRange($to);
    if (!range) return false;

    const wrapping = findWrapping(range, nodeType, attributes);
    if (!wrapping) return false;
    if (!dispatch) return true;

    tr.wrap(range, wrapping).scrollIntoView();
    dispatch(tr);
    return true;
  };

/**
 * ToggleWrap command - toggles wrapping of the selection in a node type
 *
 * If the selection is already wrapped in the node type, lifts it out.
 * Otherwise, wraps the selection in the node type.
 * Uses tr.doc/tr.selection for chain compatibility.
 *
 * @param nodeName - The name of the wrapping node type
 * @param attributes - Optional attributes for the node
 */
export const toggleWrap: CommandSpec<[nodeName: string, attributes?: Attrs]> =
  (nodeName: string, attributes?: Attrs) =>
  (props) => {
    const { state, tr, dispatch } = props;
    const nodeType = state.schema.nodes[nodeName];

    if (!nodeType) {
      return false;
    }

    const { ranges } = tr.selection;

    const isInsideWrap = (pos: number): boolean => {
      const $pos = tr.doc.resolve(pos);
      for (let d = $pos.depth; d > 0; d--) {
        if ($pos.node(d).type === nodeType) return true;
      }
      return false;
    };

    // Multi-range selection (CellSelection): handle each cell independently
    if (ranges.length > 1) {
      const allWrapped = ranges.every(range => isInsideWrap(range.$from.pos));
      if (!dispatch) return true;

      // Process in reverse to preserve positions
      for (let i = ranges.length - 1; i >= 0; i--) {
        const { $from, $to } = ranges[i]!;
        const blockRange = $from.blockRange($to);
        if (!blockRange) continue;

        if (allWrapped) {
          const target = liftTarget(blockRange);
          if (target != null) tr.lift(blockRange, target);
        } else {
          const wrapping = findWrapping(blockRange, nodeType, attributes);
          if (wrapping) tr.wrap(blockRange, wrapping);
        }
      }

      dispatch(tr.scrollIntoView());
      return true;
    }

    // Single-range selection: existing logic
    // Collect non-empty textblocks in the selection with their positions.
    // Empty textblocks (e.g., trailing node) are excluded so they don't
    // affect toggle direction. This handles AllSelection correctly.
    const { from, to } = tr.selection;
    const contentBlocks: { pos: number }[] = [];
    tr.doc.nodesBetween(from, to, (node, pos) => {
      if (node.isTextblock && node.content.size > 0) {
        contentBlocks.push({ pos });
      }
    });

    const allWrapped = contentBlocks.length > 0
      ? contentBlocks.every(({ pos }) => isInsideWrap(pos))
      : isInsideWrap(from);

    if (allWrapped) {
      const first = contentBlocks[0];
      if (first) {
        tr.setSelection(TextSelection.create(tr.doc, first.pos + 1));
      }
      return lift()(props);
    }

    return wrapIn(nodeName, attributes)(props);
  };

// ============================================================================
// Lift Command
// ============================================================================

/**
 * Lift command - lifts the current block out of its parent wrapper
 *
 * Uses tr.doc/tr.selection for chain compatibility.
 * For example, lifts a paragraph out of a blockquote.
 */
export const lift: CommandSpec =
  () =>
  ({ tr, dispatch }) => {
    const { ranges } = tr.selection;

    // Multi-range selection (CellSelection): lift each cell independently
    if (ranges.length > 1) {
      if (!dispatch) return true;
      for (let i = ranges.length - 1; i >= 0; i--) {
        const { $from, $to } = ranges[i]!;
        const range = $from.blockRange($to);
        if (!range) continue;
        const target = liftTarget(range);
        if (target != null) tr.lift(range, target);
      }
      dispatch(tr.scrollIntoView());
      return true;
    }

    const { $from, $to } = tr.selection;
    const range = $from.blockRange($to);
    if (!range) return false;

    const target = liftTarget(range);
    if (target === null) return false;
    if (!dispatch) return true;

    tr.lift(range, target).scrollIntoView();
    dispatch(tr);
    return true;
  };

// ============================================================================
// List Commands
// ============================================================================

/**
 * ToggleList command - toggles a list type on the current selection
 *
 * If the selection is not in a list, wraps it in the specified list type.
 * If it's in the same list type, lifts the list items out.
 * If it's in a different list type, converts to the new list type in-place.
 *
 * @param listNodeName - The name of the list node type (e.g., 'bulletList', 'orderedList')
 * @param listItemNodeName - The name of the list item node type (usually 'listItem')
 * @param attributes - Optional attributes for the list node
 */
export const toggleList: CommandSpec<[listNodeName: string, listItemNodeName: string, attributes?: Attrs]> =
  (listNodeName: string, listItemNodeName: string, attributes?: Attrs) =>
  ({ state, tr, dispatch }) => {
    const listType = state.schema.nodes[listNodeName];
    const listItemType = state.schema.nodes[listItemNodeName];

    if (!listType || !listItemType) {
      return false;
    }

    const collectListContext = (
      doc: PMNode,
      rfrom: number,
      rto: number,
    ): { pos: number; inTargetList: boolean; inSomeList: boolean; otherListPos: number | null }[] => {
      const blocks: { pos: number; inTargetList: boolean; inSomeList: boolean; otherListPos: number | null }[] = [];
      doc.nodesBetween(rfrom, rto, (node, pos) => {
        if (!node.isTextblock || node.content.size === 0) return;
        let inTargetList = false;
        let inSomeList = false;
        let otherListPos: number | null = null;
        const $pos = doc.resolve(pos);
        for (let d = $pos.depth; d >= 0; d--) {
          const n = $pos.node(d);
          if (n.type === listType) {
            inTargetList = true;
            inSomeList = true;
            break;
          }
          const groups = (n.type.spec.group ?? '').split(/\s+/);
          if (groups.includes('list')) {
            inSomeList = true;
            otherListPos = $pos.before(d);
            break;
          }
        }
        blocks.push({ pos, inTargetList, inSomeList, otherListPos });
      });
      return blocks;
    };

    const { ranges } = tr.selection;

    // Multi-range selection (CellSelection): handle each cell independently
    if (ranges.length > 1) {
      // Collect across all ranges to determine global toggle direction
      const allBlocks: { pos: number; inTargetList: boolean; inSomeList: boolean; otherListPos: number | null }[] = [];
      for (const range of ranges) {
        const blocks = collectListContext(tr.doc, range.$from.pos, range.$to.pos);
        allBlocks.push(...blocks);
      }

      const allInTargetList = allBlocks.length > 0 && allBlocks.every((b) => b.inTargetList);
      if (!dispatch) return true;

      if (allInTargetList) {
        // Lift: per-cell in reverse
        for (let i = ranges.length - 1; i >= 0; i--) {
          const { $from, $to } = ranges[i]!;
          const cellBlocks = collectListContext(tr.doc, $from.pos, $to.pos);
          const first = cellBlocks[0];
          const last = cellBlocks[cellBlocks.length - 1];
          if (!first || !last) continue;
          const narrowSel = TextSelection.create(tr.doc, first.pos + 1, last.pos + 1);
          const narrowState = EditorState.create({ doc: tr.doc, selection: narrowSel });
          liftListItem(listItemType)(narrowState, (liftTr) => {
            // Apply lift steps to our transaction
            for (const step of liftTr.steps) {
              tr.step(step);
            }
          });
        }
      } else {
        // Wrap: per-cell in reverse
        for (let i = ranges.length - 1; i >= 0; i--) {
          const { $from, $to } = ranges[i]!;
          const blockRange = $from.blockRange($to);
          if (!blockRange) continue;
          wrapRangeInList(tr, blockRange, listType, attributes);
        }
      }

      dispatch(tr.scrollIntoView());
      return true;
    }

    // Single-range selection: existing logic
    const { from, to } = tr.selection;
    const contentBlocks = collectListContext(tr.doc, from, to);

    // Cursor in empty textblock (e.g. new list item): nodesBetween skipped it,
    // but we still need its list context so toggle/convert/lift work correctly.
    if (contentBlocks.length === 0) {
      const $cur = tr.doc.resolve(from);
      let inTargetList = false;
      let inSomeList = false;
      let otherListPos: number | null = null;
      for (let d = $cur.depth; d >= 0; d--) {
        const n = $cur.node(d);
        if (n.type === listType) { inTargetList = true; inSomeList = true; break; }
        const groups = (n.type.spec.group ?? '').split(/\s+/);
        if (groups.includes('list')) { inSomeList = true; otherListPos = $cur.before(d); break; }
      }
      contentBlocks.push({ pos: from, inTargetList, inSomeList, otherListPos });
    }

    const allInTargetList = contentBlocks.length > 0 && contentBlocks.every((b) => b.inTargetList);
    const allInSomeList = contentBlocks.length > 0 && contentBlocks.every((b) => b.inSomeList);

    // Case 1: All non-empty textblocks are in the target list type → lift items out
    if (allInTargetList) {
      const first = contentBlocks[0];
      const last = contentBlocks[contentBlocks.length - 1];
      if (!first || !last) return false;
      const narrowSel = TextSelection.create(tr.doc, first.pos + 1, last.pos + 1);
      const narrowState = EditorState.create({
        doc: tr.doc,
        selection: narrowSel,
      });
      return liftListItem(listItemType)(narrowState, dispatch);
    }

    // Case 2: All non-empty textblocks are in some list but not target → convert
    if (allInSomeList) {
      const otherPos = contentBlocks.find((b) => b.otherListPos !== null)?.otherListPos;
      if (otherPos === undefined || otherPos === null) return false;

      if (!dispatch) {
        return true; // Can convert
      }

      const listNode = tr.doc.nodeAt(otherPos);
      if (!listNode) return false;

      const firstChild = listNode.firstChild;
      if (firstChild && firstChild.type !== listItemType) {
        const cursorOffset = tr.selection.from - otherPos;
        const newItems: PMNode[] = [];
        listNode.forEach((child) => {
          newItems.push(listItemType.create(child.attrs, child.content, child.marks));
        });
        const newList = listType.create(attributes, newItems);
        tr.replaceWith(otherPos, otherPos + listNode.nodeSize, newList);
        const restored = otherPos + Math.min(cursorOffset, newList.nodeSize - 1);
        tr.setSelection(TextSelection.near(tr.doc.resolve(restored)));
      } else {
        tr.setNodeMarkup(otherPos, listType, attributes);
      }

      dispatch(tr);
      return true;
    }

    // Case 3: Not in a list → wrap in the target list type
    const { $from: $wrapFrom, $to: $wrapTo } = tr.selection;
    const wrapRange = $wrapFrom.blockRange($wrapTo);
    if (!wrapRange) return false;
    if (!wrapRangeInList(dispatch ? tr : null, wrapRange, listType, attributes)) return false;
    if (dispatch) dispatch(tr.scrollIntoView());
    return true;
  };

// ============================================================================
// Insert Content Command
// ============================================================================

/**
 * InsertContent command - inserts content at the current selection
 *
 * @param content - The content to insert (JSON object, array, or HTML string)
 */
export const insertContent: CommandSpec<[content: Content]> =
  (content: Content) =>
  ({ state, tr, dispatch }) => {
    const { schema } = state;
    const { from, to } = tr.selection;

    // Parse content based on type
    let fragment: Fragment;

    if (typeof content === 'string') {
      // HTML string - parse using DOMParser
      if (typeof window === 'undefined') {
        return false; // Can't parse HTML in SSR without DOM
      }

      const parser = ProseMirrorDOMParser.fromSchema(schema);
      const wrapper = document.createElement('div');
      wrapper.innerHTML = content;
      const parsed = parser.parse(wrapper);
      fragment = parsed.content;
    } else if (content && typeof content === 'object') {
      // JSON content
      if (Array.isArray(content)) {
        // Array of nodes
        const nodes = content.map(item => schema.nodeFromJSON(item));
        fragment = Fragment.from(nodes);
      } else if ('type' in content) {
        // Single node or document
        const node = schema.nodeFromJSON(content);
        // If it's a doc, use its content; otherwise wrap in fragment
        fragment = node.type.name === 'doc' ? node.content : Fragment.from(node);
      } else {
        return false;
      }
    } else {
      return false;
    }

    if (!dispatch) {
      return true;
    }

    // Insert the content
    tr.replaceRange(from, to, new Slice(fragment, 0, 0));
    dispatch(tr);
    return true;
  };

// ============================================================================
// Selection Commands
// ============================================================================

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

// ============================================================================
// Attribute Commands
// ============================================================================

/**
 * UpdateAttributes command - updates attributes on nodes matching a type
 *
 * Updates attributes on all nodes of the specified type within the selection.
 *
 * @param typeOrName - The node type name or NodeType to update
 * @param attributes - The attributes to merge into existing attributes
 */
export const updateAttributes: CommandSpec<[typeOrName: string, attributes: Record<string, unknown>]> =
  (typeOrName: string, attributes: Record<string, unknown>) =>
  ({ state, tr, dispatch }) => {
    const type = state.schema.nodes[typeOrName] ?? state.schema.marks[typeOrName];

    if (!type) {
      return false;
    }

    const { from, to } = tr.selection;
    const nodeChanges: { pos: number; attrs: Record<string, unknown> }[] = [];
    const markChanges: { pos: number; nodeSize: number; attrs: Record<string, unknown> }[] = [];

    // Use tr.doc to support chain context where prior commands may have modified the document
    // For nodes - collect changes
    if (state.schema.nodes[typeOrName]) {
      tr.doc.nodesBetween(from, to, (node, pos) => {
        if (node.type.name === typeOrName) {
          nodeChanges.push({ pos, attrs: { ...node.attrs, ...attributes } });
        }
      });
    }

    // For marks - collect changes
    if (state.schema.marks[typeOrName]) {
      const markType = state.schema.marks[typeOrName];
      tr.doc.nodesBetween(from, to, (node, pos) => {
        if (!node.isInline) return;

        const mark = markType.isInSet(node.marks);
        if (mark) {
          markChanges.push({
            pos,
            nodeSize: node.nodeSize,
            attrs: { ...mark.attrs, ...attributes },
          });
        }
      });
    }

    const hasChanges = nodeChanges.length > 0 || markChanges.length > 0;

    if (hasChanges && dispatch) {
      // Apply node changes
      for (const change of nodeChanges) {
        tr.setNodeMarkup(change.pos, undefined, change.attrs);
      }

      // Apply mark changes
      if (state.schema.marks[typeOrName]) {
        const markType = state.schema.marks[typeOrName];
        for (const change of markChanges) {
          const newMark = markType.create(change.attrs);
          tr.removeMark(change.pos, change.pos + change.nodeSize, markType);
          tr.addMark(change.pos, change.pos + change.nodeSize, newMark);
        }
      }

      dispatch(tr);
    }

    return hasChanges;
  };

/**
 * ResetAttributes command - resets an attribute to its default value
 *
 * Resets the specified attribute on all nodes of the given type within the selection
 * to the default value defined in the schema.
 *
 * @param typeOrName - The node type name to update
 * @param attributeName - The name of the attribute to reset
 */
export const resetAttributes: CommandSpec<[typeOrName: string, attributeName: string]> =
  (typeOrName: string, attributeName: string) =>
  ({ state, tr, dispatch }) => {
    const nodeType = state.schema.nodes[typeOrName];
    const markType = state.schema.marks[typeOrName];

    if (!nodeType && !markType) {
      return false;
    }

    const { from, to } = tr.selection;
    const nodeChanges: { pos: number; attrs: Record<string, unknown> }[] = [];
    const markChanges: { pos: number; nodeSize: number; attrs: Record<string, unknown> }[] = [];

    // Use tr.doc to support chain context where prior commands may have modified the document
    // For nodes - collect changes
    if (nodeType) {
      const defaultValue: unknown = nodeType.spec.attrs?.[attributeName]?.default;

      tr.doc.nodesBetween(from, to, (node, pos) => {
        if (node.type === nodeType) {
          nodeChanges.push({
            pos,
            attrs: { ...node.attrs, [attributeName]: defaultValue },
          });
        }
      });
    }

    // For marks - collect changes
    if (markType) {
      const defaultValue: unknown = markType.spec.attrs?.[attributeName]?.default;

      tr.doc.nodesBetween(from, to, (node, pos) => {
        if (!node.isInline) return;

        const mark = markType.isInSet(node.marks);
        if (mark) {
          markChanges.push({
            pos,
            nodeSize: node.nodeSize,
            attrs: { ...mark.attrs, [attributeName]: defaultValue },
          });
        }
      });
    }

    const hasChanges = nodeChanges.length > 0 || markChanges.length > 0;

    if (hasChanges && dispatch) {
      // Apply node changes
      for (const change of nodeChanges) {
        tr.setNodeMarkup(change.pos, undefined, change.attrs);
      }

      // Apply mark changes
      if (markType) {
        for (const change of markChanges) {
          const newMark = markType.create(change.attrs);
          tr.removeMark(change.pos, change.pos + change.nodeSize, markType);
          tr.addMark(change.pos, change.pos + change.nodeSize, newMark);
        }
      }

      dispatch(tr);
    }

    return hasChanges;
  };

/**
 * All built-in commands as RawCommands
 * These are merged with extension commands in CommandManager
 */
export const builtInCommands: CommandMap = {
  focus,
  blur,
  setContent,
  clearContent,
  insertText,
  deleteSelection,
  selectAll,
  // Mark commands
  toggleMark,
  setMark,
  unsetMark,
  unsetAllMarks,
  // Block commands
  setBlockType,
  toggleBlockType,
  // Wrap commands
  wrapIn,
  toggleWrap,
  // Lift command
  lift,
  // List commands
  toggleList,
  // Insert commands
  insertContent,
  // Selection commands
  selectNodeBackward,
  // Attribute commands
  updateAttributes,
  resetAttributes,
} as CommandMap;

// Module augmentation: register built-in commands with typed signatures
declare module '../types/Commands.js' {
  interface RawCommands {
    focus: CommandSpec<[position?: FocusPosition]>;
    blur: CommandSpec;
    setContent: CommandSpec<[content: Content, options?: SetContentOptions]>;
    clearContent: CommandSpec<[options?: ClearContentOptions]>;
    insertText: CommandSpec<[text: string]>;
    deleteSelection: CommandSpec;
    selectAll: CommandSpec;
    toggleMark: CommandSpec<[markName: string, attributes?: Attrs]>;
    setMark: CommandSpec<[markName: string, attributes?: Attrs]>;
    unsetMark: CommandSpec<[markName: string]>;
    unsetAllMarks: CommandSpec;
    setBlockType: CommandSpec<[nodeName: string, attributes?: Attrs]>;
    toggleBlockType: CommandSpec<[nodeName: string, defaultNodeName: string, attributes?: Attrs]>;
    wrapIn: CommandSpec<[nodeName: string, attributes?: Attrs]>;
    toggleWrap: CommandSpec<[nodeName: string, attributes?: Attrs]>;
    lift: CommandSpec;
    toggleList: CommandSpec<[listNodeName: string, listItemNodeName: string, attributes?: Attrs]>;
    insertContent: CommandSpec<[content: Content]>;
    selectNodeBackward: CommandSpec;
    updateAttributes: CommandSpec<[typeOrName: string, attributes: Record<string, unknown>]>;
    resetAttributes: CommandSpec<[typeOrName: string, attributeName: string]>;
  }
}
