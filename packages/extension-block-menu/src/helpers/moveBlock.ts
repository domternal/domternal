import type { Transaction } from '@domternal/pm/state';
import { expandToEmptyWrappers } from './expandToEmptyWrappers.js';
import { convertListItemForParent } from './convertListItemForParent.js';

/**
 * Move a top-level block from `sourcePos` to `targetPos` in-place. Single
 * source of truth for block reorder position math, used by BlockHandle
 * drag-drop and KeyboardReorder.
 *
 * Notable steps: deletion range expands outward to swallow single-child
 * wrapper ancestors (else PM's fitter leaves an empty `<li>` placeholder);
 * the slice is adapted to the target parent's content rule (listItem ↔
 * taskItem auto-conversion when dropping across list types). Self-drops
 * (target inside the expanded deletion range) return the transaction
 * unchanged.
 */
export function moveBlock(
  tr: Transaction,
  sourcePos: number,
  targetPos: number,
): Transaction {
  if (sourcePos < 0 || sourcePos >= tr.doc.content.size) return tr;
  const sourceNode = tr.doc.nodeAt(sourcePos);
  if (!sourceNode) return tr;
  const sourceEnd = sourcePos + sourceNode.nodeSize;

  const { from, to } = expandToEmptyWrappers(tr.doc, sourcePos, sourceEnd);
  if (targetPos >= from && targetPos <= to) return tr;

  // Slice ONLY the source node (not the wrappers we're about to remove -
  // they exist purely as redundant single-child containers and should not
  // travel with the source to its new location).
  const slice = tr.doc.slice(sourcePos, sourceEnd);
  tr.delete(from, to);
  const adjustedTarget = targetPos > from
    ? targetPos - (to - from)
    : targetPos;

  // Auto-convert listItem ↔ taskItem when crossing list types, matching
  // Notion's "drop adapts to context" UX. When the target's parent isn't
  // a list wrapper (top-level drops, paragraph parents, etc.) the helper
  // returns the slice content unchanged.
  const targetParent = tr.doc.resolve(adjustedTarget).parent;
  const adaptedContent = convertListItemForParent(
    tr.doc.type.schema,
    slice.content,
    targetParent.type,
  );

  tr.insert(adjustedTarget, adaptedContent);
  return tr;
}

