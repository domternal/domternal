import { Fragment } from '@domternal/pm/model';
import type { ResolvedPos } from '@domternal/pm/model';
import type { Transaction } from '@domternal/pm/state';
import { canJoin } from '@domternal/pm/transform';
import { expandToEmptyWrappers } from './expandToEmptyWrappers.js';
import { convertListItemForParent } from './convertListItemForParent.js';

const LIST_ITEM_TYPES = new Set(['listItem', 'taskItem']);
const LIST_WRAPPER_TYPES = new Set(['bulletList', 'orderedList', 'taskList']);

/** The list-item node type a given list wrapper accepts as its child. */
function expectedItemFor(wrapperName: string): string {
  return wrapperName === 'taskList' ? 'taskItem' : 'listItem';
}

/**
 * Move a top-level block from `sourcePos` to `targetPos` in-place. Single
 * source of truth for block reorder position math, used by BlockHandle
 * drag-drop and KeyboardReorder.
 *
 * Notable steps: deletion range expands outward to swallow single-child
 * wrapper ancestors (else PM's fitter leaves an empty `<li>` placeholder);
 * the slice is adapted to the target parent's content rule (listItem ↔
 * taskItem auto-conversion when dropping across list types). A non-list
 * block dropped at a sibling gap inside a list splits the list and keeps
 * its own type (see `insertBlockSplittingList`) instead of being wrapped in
 * a bullet; conversely, removing the source can leave two same-type lists
 * touching, which `rejoinAtSeam` heals so the list stays continuous.
 * Self-drops (target inside the expanded deletion range) return the
 * transaction unchanged.
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
  // The list wrapper the source item currently lives in (its OWN list type),
  // captured before the delete so a mismatched drop can re-wrap it in a fresh
  // list of the same type instead of converting the item.
  const sourceWrapperType = tr.doc.resolve(sourcePos).parent.type;

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

  const $target = tr.doc.resolve(adjustedTarget);
  const targetParent = $target.parent;

  // A block that can't legally JOIN this list as a sibling item keeps its own
  // type and splits the list around it (Notion), instead of being converted.
  // Two cases land here:
  //   - a non-list block (heading, paragraph, …): inserted directly.
  //   - a list item of the OTHER kind (e.g. a to-do dropped into a bullet
  //     list): re-wrapped in a fresh list of ITS OWN type so it stays a
  //     to-do, not converted to a bullet.
  // A list item that DOES match (listItem into bullet/ordered, taskItem into
  // task) falls through and joins the list as a sibling below.
  const targetWrapperName = LIST_WRAPPER_TYPES.has(targetParent.type.name) ? targetParent.type.name : null;
  const sourceIsListItem = LIST_ITEM_TYPES.has(sourceNode.type.name);
  const splitsList = targetWrapperName !== null
    && (!sourceIsListItem || sourceNode.type.name !== expectedItemFor(targetWrapperName));
  if (splitsList) {
    const content = sourceIsListItem
      ? Fragment.from(sourceWrapperType.create(null, slice.content))
      : slice.content;
    insertBlockSplittingList(tr, $target, content);
  } else {
    // Same-type list item joins the list as a sibling; for a non-list-wrapper
    // target (top-level drops, paragraph parents) the helper returns the slice
    // content unchanged. `convertListItemForParent` is a no-op in both cases.
    const adaptedContent = convertListItemForParent(
      tr.doc.type.schema,
      slice.content,
      targetParent.type,
    );
    tr.insert(adjustedTarget, adaptedContent);
  }

  // Removing the source may have left two same-type lists touching where it
  // used to sit (e.g. the source was a heading splitting a list in two).
  // Heal the seam so the list becomes continuous again, matching Notion and
  // clearing any stale ordered-list `start` offset on the second half.
  rejoinAtSeam(tr, from);
  return tr;
}

/**
 * Joins two list wrappers that became adjacent at the source-removal seam.
 * `originalFrom` is the deleted range's left edge in the pre-mutation doc; it
 * is mapped through every step so the check lands at the seam in the final
 * doc. Restricted to same-type list wrappers (NOT plain blocks: two adjacent
 * paragraphs are joinable too, but merging them on a reorder would be wrong),
 * so unrelated adjacencies elsewhere in the doc are left untouched.
 */
function rejoinAtSeam(tr: Transaction, originalFrom: number): void {
  const seam = tr.mapping.map(originalFrom);
  if (seam <= 0 || seam >= tr.doc.content.size) return;
  const $seam = tr.doc.resolve(seam);
  const before = $seam.nodeBefore;
  const after = $seam.nodeAfter;
  if (!before || !after) return;
  if (before.type !== after.type) return;
  if (!LIST_WRAPPER_TYPES.has(before.type.name)) return;
  if (canJoin(tr.doc, seam)) tr.join(seam);
}

/**
 * Inserts `content` (the dragged block, type preserved) at the sibling gap
 * `$gap` points at inside a list wrapper, splitting the wrapper so the block
 * lands at the wrapper's PARENT level (the document, or the enclosing list
 * item). The list breaks around the block, mirroring Notion's "a dropped
 * heading/paragraph stays itself and the list reflows around it".
 *
 *   - gap before the first item -> insert before the whole wrapper
 *   - gap after the last item   -> insert after the whole wrapper
 *   - gap between two items      -> split the wrapper, insert in between
 *
 * For an ordered list the trailing half would restart at 1 after the break,
 * so its `start` attr is bumped to keep the numbering continuous.
 */
function insertBlockSplittingList(tr: Transaction, $gap: ResolvedPos, content: Fragment): void {
  const wrapper = $gap.parent;
  const index = $gap.index();
  if (index === 0) {
    tr.insert($gap.before(), content);
    return;
  }
  if (index === wrapper.childCount) {
    tr.insert($gap.after(), content);
    return;
  }
  const splitPos = $gap.pos;
  tr.split(splitPos, 1);
  const insertAt = splitPos + 1;
  tr.insert(insertAt, content);
  if (wrapper.type.name === 'orderedList') {
    const origStart = typeof wrapper.attrs['start'] === 'number' ? wrapper.attrs['start'] : 1;
    const secondWrapperPos = insertAt + content.size;
    const second = tr.doc.nodeAt(secondWrapperPos);
    if (second?.type.name === 'orderedList') {
      tr.setNodeMarkup(secondWrapperPos, undefined, { ...second.attrs, start: origStart + index });
    }
  }
}

