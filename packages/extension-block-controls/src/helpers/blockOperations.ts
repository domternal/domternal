import type { Attrs, Fragment, Mark, Node as PMNode, NodeType } from '@domternal/pm/model';
import type { Transaction } from '@domternal/pm/state';
import { TextSelection } from '@domternal/pm/state';
import { expandToEmptyWrappers } from './expandToEmptyWrappers.js';
import { rejoinAtSeam } from './rejoinAtSeam.js';

/**
 * Block-level transaction helpers for BlockContextMenu commands (Delete,
 * Duplicate, Turn into) and other features operating on a top-level block.
 * All helpers mutate and return the given transaction (chainable).
 */

/**
 * Removes the block at `blockPos` entirely. Two correctness properties:
 *
 * 1. Single-child wrapper expansion: deleting an inner block whose parent had it
 *    as sole child would leave PM fitting an empty placeholder (a `<ul>` with one
 *    blank `<li>`) to satisfy `bulletList -> listItem+`; worse, some fitters
 *    unwrap the parent so "delete killed the whole list". We expand the deletion
 *    range outward through such wrappers (like `moveBlock`) to remove the orphan
 *    chain atomically.
 *
 * 2. Doc-empty fallback: if the expanded range covers the whole doc, deleting
 *    would violate `block+` on the doc. We replace with a fresh paragraph so the
 *    editor stays usable (Notion behaviour).
 *
 * 3. Seam heal: deleting a block that sat between two same-type lists leaves them
 *    touching; `rejoinAtSeam` merges them (clearing a stale ordered `start`) so
 *    numbering stays continuous, matching `moveBlock`.
 */
export function deleteBlock(tr: Transaction, blockPos: number): Transaction {
  if (blockPos < 0 || blockPos >= tr.doc.content.size) return tr;
  const node = tr.doc.nodeAt(blockPos);
  if (!node) return tr;
  const blockEnd = blockPos + node.nodeSize;

  const { from, to } = expandToEmptyWrappers(tr.doc, blockPos, blockEnd);

  // Would the doc be left empty? Equality with the full content range means we
  // covered every top-level child via single-child wrapper chains.
  const wouldEmptyDoc = from === 0 && to === tr.doc.content.size;
  if (wouldEmptyDoc) {
    const paragraphType = tr.doc.type.schema.nodes['paragraph'];
    if (!paragraphType) {
      // No `paragraph` type in the schema - bail rather than risk an invalid replacement.
      return tr;
    }
    const replacement = paragraphType.createAndFill();
    if (!replacement) return tr;
    tr.replaceWith(from, to, replacement);
    tr.setSelection(TextSelection.near(tr.doc.resolve(from + 1)));
    return tr;
  }

  tr.delete(from, to);
  // The block's removal may bring two same-type lists flush together.
  rejoinAtSeam(tr, from);
  return tr;
}

/**
 * Marks whose spec declares `keepOnDuplicate: false` reference identity
 * outside the document (a comment thread anchor, a suggestion id); copying
 * them along would make one identity point at two unrelated places, so
 * `duplicateBlock` strips them from the copy.
 */
function stripDropOnDuplicateMarks(marks: readonly Mark[]): readonly Mark[] {
  return marks.filter((mark) => mark.type.spec['keepOnDuplicate'] !== false);
}

function stripDropOnDuplicateNode(node: PMNode): PMNode {
  const marks = stripDropOnDuplicateMarks(node.marks);
  if (node.isText) {
    return marks.length === node.marks.length ? node : node.mark(marks as Mark[]);
  }
  const content = stripDropOnDuplicateFragment(node.content);
  if (marks.length === node.marks.length && content === node.content) return node;
  return node.type.create(node.attrs, content, marks as Mark[]);
}

function stripDropOnDuplicateFragment(fragment: Fragment): Fragment {
  // replaceChild returns the same fragment for an identical child, so an
  // unchanged fragment keeps its identity (callers compare by reference).
  let result = fragment;
  fragment.forEach((child, _offset, index) => {
    result = result.replaceChild(index, stripDropOnDuplicateNode(child));
  });
  return result;
}

/**
 * Duplicates the block at `blockPos`, inserting a copy immediately after it.
 * The copy preserves content, attrs, AND node-level marks (needed for
 * annotation / comment extensions that attach marks to blocks), except marks
 * declaring `keepOnDuplicate: false`, which are stripped throughout the copy.
 *
 * @param transformAttrs Optional mapper on the source attrs to produce the
 *   copy's attrs. Use it to regenerate unique IDs so the duplicate doesn't
 *   collide (e.g. `{ ...attrs, id: uuid() }`).
 */
export function duplicateBlock(
  tr: Transaction,
  blockPos: number,
  transformAttrs?: (attrs: Attrs) => Attrs,
): Transaction {
  if (blockPos < 0 || blockPos >= tr.doc.content.size) return tr;
  const node = tr.doc.nodeAt(blockPos);
  if (!node) return tr;
  const blockEnd = blockPos + node.nodeSize;
  const attrs = transformAttrs ? transformAttrs(node.attrs) : node.attrs;
  // `type.create(attrs, content, marks)` preserves all three; `node.copy(content)`
  // drops node marks, breaking block-level annotations.
  const copy = node.type.create(
    attrs,
    stripDropOnDuplicateFragment(node.content),
    stripDropOnDuplicateMarks(node.marks) as Mark[],
  );
  tr.insert(blockEnd, copy);
  return tr;
}

/**
 * Transforms the block at `blockPos` into a different textblock type, preserving
 * inline content AND any attrs valid on the target. Without this, `setBlockType`
 * resets global attrs (bgColor, textColor, id, ...) to defaults, so "Turn into"
 * would lose a block's color and identity.
 *
 * Attrs present on BOTH source and target carry over; source-only attrs (e.g.
 * `level` on a Heading turning into Paragraph) drop since the target doesn't
 * declare them. The explicit `attrs` arg (e.g. `{ level: 2 }`) wins on key clash.
 *
 * Returns the transaction unchanged if the target isn't a textblock or the node
 * can't be transformed.
 */
export function turnIntoBlock(
  tr: Transaction,
  blockPos: number,
  targetType: NodeType,
  attrs?: Attrs,
): Transaction {
  if (blockPos < 0 || blockPos >= tr.doc.content.size) return tr;
  const node = tr.doc.nodeAt(blockPos);
  if (!node) return tr;
  // `setBlockType` requires a textblock target.
  if (!targetType.isTextblock) return tr;
  const blockEnd = blockPos + node.nodeSize;

  // Preserve source attrs the target also declares, then overlay caller attrs.
  // `targetType.spec.attrs` is the schema truth on which attrs are valid here.
  const validKeys = Object.keys(targetType.spec.attrs ?? {});
  const preserved: Record<string, unknown> = {};
  const sourceAttrs = node.attrs as Record<string, unknown>;
  for (const key of validKeys) {
    if (key in sourceAttrs) preserved[key] = sourceAttrs[key];
  }
  const mergedAttrs = attrs ? { ...preserved, ...attrs } : preserved;

  tr.setBlockType(blockPos, blockEnd, targetType, mergedAttrs);
  return tr;
}
