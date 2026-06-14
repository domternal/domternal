/**
 * List commands, toggleList
 */
import { TextSelection, EditorState } from '@domternal/pm/state';
import type { Transaction } from '@domternal/pm/state';
import { wrapRangeInList, liftListItem } from '@domternal/pm/schema-list';
import { canJoin } from '@domternal/pm/transform';
import type { Attrs, NodeType, Node as PMNode } from '@domternal/pm/model';
import type { CommandSpec } from '../types/Commands.js';
import { getListItemCursorContext } from '../utils/listItemCursorContext.js';
import { liftCurrentListItem } from '../utils/liftCurrentListItem.js';

/**
 * Find the innermost list of the given type around the selection,
 * then join it with an adjacent list of the same type if possible.
 */
function joinListBackwards(tr: Transaction, listType: NodeType): void {
  const { $from } = tr.selection;
  for (let d = $from.depth; d >= 0; d--) {
    if ($from.node(d).type === listType) {
      const listPos = $from.before(d);
      if (listPos > 0 && canJoin(tr.doc, listPos)) {
        const nodeBefore = tr.doc.resolve(listPos - 1).parent;
        if (nodeBefore.type === listType) {
          tr.join(listPos);
        }
      }
      return;
    }
  }
}

function joinListForwards(tr: Transaction, listType: NodeType): void {
  const { $from } = tr.selection;
  for (let d = $from.depth; d >= 0; d--) {
    if ($from.node(d).type === listType) {
      const after = $from.after(d);
      if (after < tr.doc.content.size && canJoin(tr.doc, after)) {
        const nodeAfter = tr.doc.nodeAt(after);
        if (nodeAfter?.type === listType) {
          tr.join(after);
        }
      }
      return;
    }
  }
}

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
 * @param options - `perItem: true` converts ONLY the cursor's item (Notion
 *   turn-into via slash / block menu); the default whole-list toggle is what the
 *   toolbar button and Mod-Shift shortcut use.
 */
export const toggleList: CommandSpec<
  [listNodeName: string, listItemNodeName: string, attributes?: Attrs, options?: { perItem?: boolean }]
> =
  (listNodeName: string, listItemNodeName: string, attributes?: Attrs, options?: { perItem?: boolean }) =>
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

    // Children-zone exception. When the cursor is collapsed and sits in
    // a paragraph that is a CHILDREN-ZONE block of a list/task item
    // (i.e. NOT the first-child label paragraph), the user typically
    // wants the slash command, toolbar, etc. to insert a NEW list of
    // the target type at this position rather than to convert the
    // ancestor list. Without this branch, `collectListContext`'s
    // ancestor walk finds the parent list wrapper and the "convert in
    // place" path runs, which silently re-types the surrounding bullet
    // list. We wrap the cursor's paragraph in a fresh list of the
    // target type as a sibling within the same children-zone, then
    // run the standard adjacency joins so the new list merges with
    // sibling lists of the same type when applicable (Notion-style
    // "extend the list" feel).
    //
    // Only paragraphs are considered: heading / codeBlock have their
    // own slash/Enter semantics and `getListItemCursorContext` already
    // returns null for them.
    if (from === to) {
      const ctx = getListItemCursorContext(tr.selection.$from);
      if (ctx?.isInChildrenZone) {
        if (!dispatch) return true;
        const blockRange = tr.selection.$from.blockRange();
        if (blockRange && wrapRangeInList(tr, blockRange, listType, attributes)) {
          joinListBackwards(tr, listType);
          joinListForwards(tr, listType);
          dispatch(tr.scrollIntoView());
          return true;
        }
        // wrapRangeInList rejected by schema. Fall through to default
        // toggle/convert path so the command still has a chance to do
        // something rather than silently no-op.
      }
    }

    const contentBlocks = collectListContext(tr.doc, from, to);

    const allInTargetList = contentBlocks.length > 0 && contentBlocks.every((b) => b.inTargetList);
    const allInSomeList = contentBlocks.length > 0 && contentBlocks.every((b) => b.inSomeList);

    // Per-item convert (opt-in via `perItem`, used by the Notion turn-into
    // surfaces: slash menu + block "..." menu). A COLLAPSED cursor in a
    // list-item LABEL, converting to a DIFFERENT list kind, changes ONLY that
    // item and splits the run (Notion), instead of retyping the whole wrapper
    // as Case 2 does. Lift the single item out of its current list (which
    // splits it), wrap just that block in the target list, and merge with
    // same-kind neighbours. Without `perItem` (toolbar button / Mod-Shift
    // shortcut) the whole-wrapper Case 2 runs, so the toolbar keeps the
    // classic-editor "toggle the whole list" semantics.
    if (options?.perItem && from === to && allInSomeList && !allInTargetList) {
      if (!dispatch) return true;
      if (liftCurrentListItem(state, tr)) {
        const blockRange = tr.selection.$from.blockRange();
        if (blockRange) wrapRangeInList(tr, blockRange, listType, attributes);
        joinListBackwards(tr, listType);
        joinListForwards(tr, listType);
        dispatch(tr.scrollIntoView());
        return true;
      }
      // Lift didn't apply (cursor not in a label slot, or the item owns its own
      // sub-blocks): fall through to the whole-wrapper Case 2 below.
    }

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

    // Case 3: Not in a list (or mixed) → flatten lists if needed, then wrap
    const blocksInList = contentBlocks.filter((b) => b.inSomeList);

    if (blocksInList.length === 0) {
      // Pure wrap: no blocks in any list
      const { $from: $wf, $to: $wt } = tr.selection;
      const wr = $wf.blockRange($wt);
      if (!wr) return false;
      if (!wrapRangeInList(dispatch ? tr : null, wr, listType, attributes)) return false;
      if (dispatch) {
        joinListBackwards(tr, listType);
        joinListForwards(tr, listType);
        dispatch(tr.scrollIntoView());
      }
      return true;
    }

    // Mixed selection: some blocks in lists, some not.
    // Flatten existing lists to their child blocks first, then wrap
    // everything in the target list.
    if (!dispatch) return true;

    // Collect unique list positions
    const seen = new Set<number>();
    const listPositions: number[] = [];
    for (const block of blocksInList) {
      const $pos = tr.doc.resolve(block.pos);
      for (let d = $pos.depth; d >= 0; d--) {
        const groups = ($pos.node(d).type.spec.group ?? '').split(/\s+/);
        if (groups.includes('list')) {
          const lpos = $pos.before(d);
          if (!seen.has(lpos)) {
            seen.add(lpos);
            listPositions.push(lpos);
          }
          break;
        }
      }
    }

    // Process bottom-to-top so earlier positions stay stable
    listPositions.sort((a, b) => b - a);
    for (const pos of listPositions) {
      const listNode = tr.doc.nodeAt(pos);
      if (!listNode) continue;
      const children: PMNode[] = [];
      listNode.forEach((item) => {
        item.forEach((child) => children.push(child));
      });
      tr.replaceWith(pos, pos + listNode.nodeSize, children);
    }

    // Wrap everything in the target list.
    // Use original from/to mapped through the transaction (tr.selection may
    // have collapsed after replaceWith, so we map the raw positions instead).
    const mappedFrom = tr.mapping.map(from, -1);
    const mappedTo = tr.mapping.map(to, 1);
    const $wrapFrom = tr.doc.resolve(mappedFrom);
    const $wrapTo = tr.doc.resolve(mappedTo);
    const wrapRange = $wrapFrom.blockRange($wrapTo);
    if (!wrapRange) return false;
    wrapRangeInList(tr, wrapRange, listType, attributes);

    // Merge with adjacent lists of the same type
    joinListBackwards(tr, listType);
    joinListForwards(tr, listType);

    dispatch(tr.scrollIntoView());
    return true;
  };
