/**
 * List commands — toggleList
 */
import { TextSelection, EditorState } from '@domternal/pm/state';
import { wrapRangeInList, liftListItem } from '@domternal/pm/schema-list';
import type { Attrs, Node as PMNode } from '@domternal/pm/model';
import type { CommandSpec } from '../types/Commands.js';

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

    interface ListBlockCtx { pos: number; inTargetList: boolean; inSomeList: boolean; otherListPos: number | null }

    /** Collect list context for non-empty textblocks in a range.
     *  If no textblocks are found (cursor in empty block), falls back to the
     *  resolved position's ancestor context so toggle/convert/lift still work. */
    const collectListContext = (doc: PMNode, rfrom: number, rto: number): ListBlockCtx[] => {
      const blocks: ListBlockCtx[] = [];
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

      // Empty-textblock fallback: cursor in empty list item etc.
      // Use the textblock node position (not cursor position) so that
      // pos + 1 points into the textblock content, not past it.
      if (blocks.length === 0) {
        const $cur = doc.resolve(rfrom);
        const nodePos = $cur.parent.inlineContent ? $cur.before($cur.depth) : rfrom;
        let inTargetList = false;
        let inSomeList = false;
        let otherListPos: number | null = null;
        for (let d = $cur.depth; d >= 0; d--) {
          const n = $cur.node(d);
          if (n.type === listType) { inTargetList = true; inSomeList = true; break; }
          const groups = (n.type.spec.group ?? '').split(/\s+/);
          if (groups.includes('list')) { inSomeList = true; otherListPos = $cur.before(d); break; }
        }
        blocks.push({ pos: nodePos, inTargetList, inSomeList, otherListPos });
      }

      return blocks;
    };

    const { ranges } = tr.selection;

    // Multi-range selection (CellSelection): handle each cell independently
    if (ranges.length > 1) {
      // Snapshot raw positions and sort descending (process bottom-of-doc first
      // so modifications don't shift positions of cells still to be processed)
      const cellPositions = ranges
        .map((r) => ({ from: r.$from.pos, to: r.$to.pos }))
        .sort((a, b) => b.from - a.from);

      // Determine global toggle direction on unmodified doc
      const allBlocks: ListBlockCtx[] = [];
      for (const cell of cellPositions) {
        allBlocks.push(...collectListContext(tr.doc, cell.from, cell.to));
      }
      const allInTargetList = allBlocks.length > 0 && allBlocks.every((b) => b.inTargetList);
      if (!dispatch) return true;

      if (allInTargetList) {
        // Lift: remove target list from all cells
        for (const cell of cellPositions) {
          const from = tr.mapping.map(cell.from);
          const to = tr.mapping.map(cell.to);
          const cellBlocks = collectListContext(tr.doc, from, to);
          const first = cellBlocks[0];
          const last = cellBlocks[cellBlocks.length - 1];
          if (!first || !last) continue;
          const narrowSel = TextSelection.create(tr.doc, first.pos + 1, last.pos + 1);
          const narrowState = EditorState.create({ doc: tr.doc, selection: narrowSel });
          liftListItem(listItemType)(narrowState, (liftTr) => {
            for (const step of liftTr.steps) {
              tr.step(step);
            }
          });
        }
      } else {
        // Per-cell: skip if already target, convert if in other list, wrap if no list
        for (const cell of cellPositions) {
          const from = tr.mapping.map(cell.from);
          const to = tr.mapping.map(cell.to);
          const cellBlocks = collectListContext(tr.doc, from, to);
          const cellInTarget = cellBlocks.length > 0 && cellBlocks.every((b) => b.inTargetList);
          const cellInSomeList = cellBlocks.length > 0 && cellBlocks.every((b) => b.inSomeList);

          if (cellInTarget) {
            continue; // already has target list type
          } else if (cellInSomeList) {
            // Convert: change list type in-place
            const otherPos = cellBlocks.find((b) => b.otherListPos !== null)?.otherListPos;
            if (otherPos === null || otherPos === undefined) continue;
            const listNode = tr.doc.nodeAt(otherPos);
            if (!listNode) continue;
            const firstChild = listNode.firstChild;
            if (firstChild && firstChild.type !== listItemType) {
              // Cross-type (e.g. taskItem → listItem): rebuild items
              const newItems: PMNode[] = [];
              listNode.forEach((child) => {
                newItems.push(listItemType.create(child.attrs, child.content, child.marks));
              });
              tr.replaceWith(otherPos, otherPos + listNode.nodeSize, listType.create(attributes, newItems));
            } else {
              tr.setNodeMarkup(otherPos, listType, attributes);
            }
          } else {
            // Not in any list → wrap
            const $from = tr.doc.resolve(from);
            const $to = tr.doc.resolve(to);
            const blockRange = $from.blockRange($to);
            if (!blockRange) continue;
            wrapRangeInList(tr, blockRange, listType, attributes);
          }
        }
      }

      dispatch(tr.scrollIntoView());
      return true;
    }

    // Single-range selection
    const { from, to } = tr.selection;
    const contentBlocks = collectListContext(tr.doc, from, to);

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
