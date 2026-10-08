import { Slice } from '@domternal/pm/model';
import type { Fragment, NodeType } from '@domternal/pm/model';

interface Unwrapped {
  readonly content: Fragment;
  /** The levels removed from the slice's open start. */
  readonly start: number;
  /** The levels removed from its open end. */
  readonly end: number;
}

/**
 * `content` without the details on its open start, at any depth, whose summary the copy did not
 * hold: each gives way to its body's blocks. `openEnd` is the content's open depth at its end when
 * its first node lies on the open end too, and -1 when it does not.
 */
function unwrap(content: Fragment, openStart: number, openEnd: number, details: NodeType, summary: NodeType): Unwrapped {
  const first = content.firstChild;
  if (first === null || openStart < 1) return { content, start: 0, end: 0 };
  const alone = content.childCount === 1;
  const body = first.firstChild;
  if (first.type === details && openStart >= 2 && body !== null && body.type !== summary) {
    const end = alone && openEnd >= 0 ? Math.min(2, openEnd) : 0;
    const inner = unwrap(body.content.append(content.cut(first.nodeSize)), openStart - 2, alone && openEnd >= 2 ? openEnd - 2 : -1, details, summary);
    return { content: inner.content, start: 2 + inner.start, end: end + inner.end };
  }
  const inner = unwrap(first.content, openStart - 1, alone && openEnd >= 1 ? openEnd - 1 : -1, details, summary);
  if (inner.start === 0) return { content, start: 0, end: 0 };
  return { content: content.replaceChild(0, first.copy(inner.content)), start: inner.start, end: inner.end };
}

/**
 * A pasted slice without the details a copy from inside its body recorded as context.
 *
 * ProseMirror's copy of blocks from inside a details body writes the details as the slice's
 * context, and the paste rebuilt it around the blocks with an empty summary: a collapsed details
 * with no title, which hid what was pasted. A details on the slice's open start, whether it opens
 * the slice or sits in a list item, quote or table cell the copy also recorded, that starts with
 * its body, so its summary was not copied, gives way to the body's blocks, each level of nesting
 * in turn. A copy that holds the summary keeps its details.
 */
export function unwrapCopiedBody(slice: Slice, details: NodeType, summary: NodeType): Slice {
  const unwrapped = unwrap(slice.content, slice.openStart, slice.openEnd, details, summary);
  if (unwrapped.start === 0) return slice;
  return new Slice(unwrapped.content, slice.openStart - unwrapped.start, Math.max(0, slice.openEnd - unwrapped.end));
}
