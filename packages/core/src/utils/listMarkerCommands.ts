import { Fragment, NodeRange, Slice } from '@domternal/pm/model';
import type { Attrs, Node as PMNode, NodeType } from '@domternal/pm/model';
import type { Command, Transaction } from '@domternal/pm/state';
import { canJoin, canSplit, findWrapping, liftTarget, ReplaceAroundStep, Transform } from '@domternal/pm/transform';
import { liftListItem, sinkListItem, wrapRangeInList } from '@domternal/pm/schema-list';
import { freshListAttrs, hasListMarker, sameListMarker } from './listMarker.js';

/** Structural joinability alone does not preserve a persisted list marker. */
export function canJoinListMarker(doc: PMNode, pos: number): boolean {
  const $pos = doc.resolve(pos);
  const before = $pos.nodeBefore; const after = $pos.nodeAfter;
  return !!before && !!after && sameListMarker(before, after) && canJoin(doc, pos);
}

export function sinkListItemWithMarker(itemType: NodeType): Command {
  return (state, dispatch) => {
    const { $from, $to } = state.selection;
    const range = $from.blockRange($to, node => node.childCount > 0 && node.firstChild?.type === itemType);
    if (!range || range.startIndex === 0) return false;
    const parent = range.parent; const previous = parent.child(range.startIndex - 1);
    if (previous.type !== itemType) return false;
    const nested = previous.lastChild;
    if (!hasListMarker(parent) && (!nested || !hasListMarker(nested))) return sinkListItem(itemType)(state, dispatch);
    const reuse = !!nested && sameListMarker(nested, parent);
    const inner = Fragment.from(reuse ? itemType.create() : null);
    const list = parent.type.create(freshListAttrs(parent.type, parent.attrs), inner);
    const slice = new Slice(Fragment.from(itemType.create(null, Fragment.from(list))), reuse ? 3 : 1, 0);
    const tr = state.tr;
    const result = tr.maybeStep(new ReplaceAroundStep(range.start - (reuse ? 3 : 1), range.end,
      range.start, range.end, slice, 1, true));
    if (result.failed) return false;
    if (state.storedMarks) tr.setStoredMarks(state.storedMarks);
    if (dispatch) dispatch(tr.scrollIntoView());
    return true;
  };
}

function ordinal(node: PMNode, index: number): number | null {
  if (node.type.name !== 'orderedList') return 1;
  const start: unknown = node.attrs['start'];
  return typeof start === 'number' && Number.isSafeInteger(start) && start >= 1
    && Number.isSafeInteger(start + index) ? start + index : null;
}

/** A marker boundary also exists when both wrappers contain ordinary listItem. */
export function hasMarkerLiftConflict(range: NodeRange, itemType: NodeType): boolean {
  if (range.depth < 2 || range.$from.node(range.depth - 1).type !== itemType) return false;
  const outer = range.$from.node(range.depth - 2);
  return (hasListMarker(range.parent) || hasListMarker(outer)) && !sameListMarker(range.parent, outer);
}

export function liftListItemWithMarker(itemType: NodeType): Command {
  return (state, dispatch) => {
    const { $from, $to } = state.selection;
    let range = $from.blockRange($to, node => node.childCount > 0 && node.firstChild?.type === itemType);
    if (!range) return false;
    const source = range.parent;
    if (range.depth < 2 || $from.node(range.depth - 1).type !== itemType) {
      if (!hasListMarker(source)) return liftListItem(itemType)(state, dispatch);
      const hasTail = range.endIndex < source.childCount;
      const nextStart = ordinal(source, range.endIndex);
      if (hasTail && nextStart === null) return false;
      const originalEnd = range.$to.after(range.depth);
      let prepared: Transaction | undefined;
      const applied = liftListItem(itemType)(state, tr => {
        if (hasTail) {
          const tailEnd = tr.mapping.map(originalEnd, -1);
          const tail = tr.doc.resolve(tailEnd).nodeBefore;
          if (tail?.type !== source.type) return;
          tr.setNodeMarkup(tailEnd - tail.nodeSize, undefined, { ...tail.attrs, start: nextStart });
        }
        if (state.storedMarks !== null) tr.setStoredMarks(state.storedMarks);
        prepared = tr;
      });
      if (!applied || !prepared) return false;
      if (dispatch) dispatch(prepared);
      return true;
    }
    const outer = range.$from.node(range.depth - 2);
    const conflict = hasMarkerLiftConflict(range, itemType);
    const nestedTail = source.child(range.endIndex - 1).lastChild;
    const joinHasMarker = range.endIndex < source.childCount && !!nestedTail && hasListMarker(nestedTail);
    if (!hasListMarker(source) && !hasListMarker(outer) && !joinHasMarker) return liftListItem(itemType)(state, dispatch);
    const firstAnchor = range.start + 1;
    let lastAnchor = range.start + 1;
    for (let index = range.startIndex; index < range.endIndex - 1; index++) lastAnchor += source.child(index).nodeSize;
    const targetItemDepth = range.depth - 1;
    const movedStart = ordinal(source, range.startIndex);
    const remainingStart = ordinal(outer, range.$from.index(range.depth - 2) + 1);
    if (conflict && (movedStart === null || remainingStart === null)) return false;
    const tr = state.tr;
    const end = range.end; const endOfList = range.$to.end(range.depth);
    if (end < endOfList) {
      const suffixStart = ordinal(source, range.endIndex);
      if (hasListMarker(source) && suffixStart === null) return false;
      const suffix = hasListMarker(source)
        ? source.type.create(freshListAttrs(source.type, source.attrs, suffixStart ?? 1)) : source.copy();
      const result = tr.maybeStep(new ReplaceAroundStep(end - 1, endOfList, end, endOfList,
        new Slice(Fragment.from(itemType.create(null, suffix)), 1, 0), 1, true));
      if (result.failed) return false;
      range = new NodeRange(tr.doc.resolve(range.$from.pos), tr.doc.resolve(endOfList), range.depth);
    }
    if (conflict) {
      // Blocks after the inner wrapper must follow the lifted item, not leap before it.
      const listEnd = range.$to.end(range.depth);
      const parentEnd = range.$from.end(range.depth - 1);
      if (listEnd + 1 < parentEnd) {
        const lastItem = range.parent.lastChild;
        if (!lastItem) return false;
        const closing = range.parent.copy(Fragment.from(lastItem.copy()));
        const result = tr.maybeStep(new ReplaceAroundStep(listEnd - 1, parentEnd, listEnd + 1, parentEnd,
          new Slice(Fragment.from(closing), 2, 0), 0, true));
        if (result.failed) return false;
        range = new NodeRange(tr.doc.resolve(range.$from.pos), tr.doc.resolve(parentEnd - 1), range.depth);
      }
    }
    const target = liftTarget(range);
    if (target === null) return false;
    tr.lift(range, target);
    if (conflict) {
      const $first = tr.doc.resolve(tr.mapping.map(firstAnchor));
      const $last = tr.doc.resolve(tr.mapping.map(lastAnchor));
      if ($first.depth < targetItemDepth || $last.depth < targetItemDepth
        || $first.node(targetItemDepth).type !== itemType || $last.node(targetItemDepth).type !== itemType
        || $first.node(targetItemDepth - 1) !== $last.node(targetItemDepth - 1)) return false;
      const first = $first.before(targetItemDepth); const after = $last.after(targetItemDepth);
      const wrapper = $first.node(targetItemDepth - 1);
      const wrapperPos = $first.before(targetItemDepth - 1);
      if ($last.index(targetItemDepth - 1) < wrapper.childCount - 1) {
        const tail = [{ type: outer.type, attrs: freshListAttrs(outer.type, outer.attrs, remainingStart ?? 1) }];
        if (!canSplit(tr.doc, after, 1, tail)) return false;
        tr.split(after, 1, tail);
      }
      const attrs = freshListAttrs(source.type, source.attrs, movedStart ?? 1);
      if ($first.index(targetItemDepth - 1) > 0) {
        const middle = [{ type: source.type, attrs }];
        if (!canSplit(tr.doc, first, 1, middle)) return false;
        tr.split(first, 1, middle);
      } else {
        tr.setNodeMarkup(wrapperPos, source.type, attrs);
      }
    } else {
      const after = tr.mapping.map(end, -1) - 1;
      if (after >= 0 && after <= tr.doc.content.size && canJoinListMarker(tr.doc, after)) tr.join(after);
    }
    if (state.storedMarks) tr.setStoredMarks(state.storedMarks);
    if (dispatch) dispatch(tr.scrollIntoView());
    return true;
  };
}

/** Guard schema-list's internal autojoin before it can erase a marker boundary. */
export function wrapRangeInListWithMarker(tr: Transaction | null, range: NodeRange, listType: NodeType,
  attrs: Attrs | null = null): boolean {
  if (range.depth >= 2 && range.startIndex === 0) {
    const wrapper = range.$from.node(range.depth - 1);
    const requested = listType.create(attrs);
    if (wrapper.type.compatibleContent(listType) && (hasListMarker(wrapper) || hasListMarker(requested))
      && !sameListMarker(wrapper, requested)) {
      const wrapping = findWrapping(range, listType, attrs);
      if (!wrapping) return false;
      const plan = new Transform(range.$from.doc);
      plan.wrap(range, wrapping);
      const listIndex = wrapping.findIndex(wrapper => wrapper.type === listType);
      const splitDepth = wrapping.length - listIndex - 1;
      let splitPos = range.start + wrapping.length;
      for (let index = range.startIndex; index < range.endIndex; index++) {
        if (index > range.startIndex) {
          if (!canSplit(plan.doc, splitPos, splitDepth)) return false;
          plan.split(splitPos, splitDepth);
          splitPos += 2 * splitDepth;
        }
        splitPos += range.parent.child(index).nodeSize;
      }
      if (tr) for (const step of plan.steps) tr.step(step);
      return true;
    }
  }
  return wrapRangeInList(tr, range, listType, attrs);
}

/** Known marker loss must not fall through to an attr-insensitive base command. */
export function markerLiftConflict(state: Parameters<Command>[0], itemType: NodeType): boolean {
  const range = state.selection.$from.blockRange(state.selection.$to,
    node => node.childCount > 0 && node.firstChild?.type === itemType);
  return !!range && hasMarkerLiftConflict(range, itemType);
}

function conflictingLists(left: PMNode | null, right: PMNode | null): boolean {
  if (!left || !right || !['orderedList', 'bulletList'].includes(left.type.name)
    || !['orderedList', 'bulletList'].includes(right.type.name)) return false;
  return (hasListMarker(left) || hasListMarker(right)) && !sameListMarker(left, right);
}

/** Preserve an explicit marker boundary before PM's generic deleteBarrier path. */
export function guardListMarkerDeletion(command: Command, direction: -1 | 1): Command {
  return (state, dispatch, view) => {
    const { selection } = state; const $cursor = selection.$from;
    if (!selection.empty || !$cursor.parent.isTextblock
      || $cursor.parentOffset !== (direction < 0 ? 0 : $cursor.parent.content.size)) return command(state, dispatch, view);
    if ($cursor.parent.type.spec.isolating) return command(state, dispatch, view);
    for (let depth = $cursor.depth - 1; depth >= 0; depth--) {
      const parent = $cursor.node(depth);
      const hasSibling = direction < 0 ? $cursor.index(depth) > 0 : $cursor.indexAfter(depth) < parent.childCount;
      if (hasSibling) {
        const pos = direction < 0 ? $cursor.before(depth + 1) : $cursor.after(depth + 1);
        const $cut = state.doc.resolve(pos); const before = $cut.nodeBefore; const after = $cut.nodeAfter;
        if (conflictingLists(before, after)) return true;
        // Deleting an empty separator is valid, but it must not collapse its two list owners.
        if (direction > 0 && after?.type.name === 'paragraph' && after.content.size === 0) {
          const next = $cut.parent.maybeChild($cut.index() + 1);
          if (conflictingLists(before, next)) {
            if (dispatch) dispatch(state.tr.delete(pos, pos + after.nodeSize).scrollIntoView());
            return true;
          }
        }
        break;
      }
      if (parent.type.spec.isolating) break;
    }
    return command(state, dispatch, view);
  };
}
