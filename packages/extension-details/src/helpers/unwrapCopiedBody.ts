import { Slice } from '@domternal/pm/model';
import type { NodeType } from '@domternal/pm/model';

/**
 * A pasted slice without the details a copy from inside its body recorded as context.
 *
 * ProseMirror's copy of blocks from inside a details body writes the details as the slice's
 * context, and the paste rebuilt it around the blocks with an empty summary: a collapsed details
 * with no title, which hid what was pasted. A details that opens the slice and starts with its
 * body, so its summary was not copied, gives way to the body's blocks, each level of nesting in
 * turn. A copy that holds the summary keeps its details.
 */
export function unwrapCopiedBody(slice: Slice, details: NodeType, summary: NodeType): Slice {
  let current = slice;
  for (;;) {
    const first = current.content.firstChild;
    const body = first?.firstChild;
    if (current.openStart < 2 || first?.type !== details || !body || body.type === summary) return current;
    const only = current.content.childCount === 1;
    current = new Slice(body.content.append(current.content.cut(first.nodeSize)), current.openStart - 2,
      only ? Math.max(0, current.openEnd - 2) : current.openEnd);
  }
}
