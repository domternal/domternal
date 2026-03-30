/**
 * Node commands — setBlockType, toggleBlockType, wrapIn, toggleWrap, lift
 */
import { findWrapping, liftTarget } from '@domternal/pm/transform';
import type { Attrs, Node as PMNode } from '@domternal/pm/model';
import type { CommandSpec } from '../types/Commands.js';

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

      // Snapshot positions and sort descending so bottom-of-doc modifications
      // don't shift positions of cells still to be processed.
      const cellPositions = ranges
        .map((r) => ({ from: r.$from.pos, to: r.$to.pos }))
        .sort((a, b) => b.from - a.from);

      for (const cell of cellPositions) {
        const from = tr.mapping.map(cell.from);
        const to = tr.mapping.map(cell.to);
        const $from = tr.doc.resolve(from);
        const $to = tr.doc.resolve(to);
        const blockRange = $from.blockRange($to);
        if (!blockRange) continue;

        if (allWrapped) {
          const target = liftTarget(blockRange);
          if (target !== null) tr.lift(blockRange, target);
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
      const last = contentBlocks[contentBlocks.length - 1];
      if (first && last) {
        const $liftFrom = tr.doc.resolve(first.pos + 1);
        const $liftTo = tr.doc.resolve(last.pos + 1);
        const range = $liftFrom.blockRange($liftTo);
        if (!range) return false;
        const target = liftTarget(range);
        if (target === null) return false;
        if (!dispatch) return true;
        tr.lift(range, target).scrollIntoView();
        dispatch(tr);
        return true;
      }
      return lift()(props);
    }

    return wrapIn(nodeName, attributes)(props);
  };

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

      const cellPositions = ranges
        .map((r) => ({ from: r.$from.pos, to: r.$to.pos }))
        .sort((a, b) => b.from - a.from);

      for (const cell of cellPositions) {
        const from = tr.mapping.map(cell.from);
        const to = tr.mapping.map(cell.to);
        const $from = tr.doc.resolve(from);
        const $to = tr.doc.resolve(to);
        const range = $from.blockRange($to);
        if (!range) continue;
        const target = liftTarget(range);
        if (target !== null) tr.lift(range, target);
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
