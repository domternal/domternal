/**
 * Attribute commands — updateAttributes, resetAttributes
 */
import type { CommandSpec } from '../types/Commands.js';

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
