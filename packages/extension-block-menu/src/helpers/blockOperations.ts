import type { Attrs, NodeType } from '@domternal/pm/model';
import type { Transaction } from '@domternal/pm/state';
import { TextSelection } from '@domternal/pm/state';
import { expandToEmptyWrappers } from './expandToEmptyWrappers.js';

/**
 * Block-level transaction helpers shared between BlockContextMenu commands
 * (Delete, Duplicate, Turn into) and other feature implementations that
 * need to operate on a top-level block.
 *
 * All helpers mutate and return the given transaction (chainable) rather
 * than creating a new one.
 */

/**
 * Removes the block at `blockPos` entirely.
 *
 * Two correctness properties:
 *
 * 1. **Single-child wrapper expansion.** Deleting an inner block whose
 *    parent only had that block as its single child would leave PM
 *    fitting an empty placeholder (e.g. a `<ul>` with one `<li>` whose
 *    paragraph is blank) to satisfy schemas like `bulletList → listItem+`.
 *    Worse: in some schemas the fitter unwraps the parent and the
 *    user perceives "delete killed the whole list". We expand the
 *    deletion range outward through such wrappers (same logic as
 *    `moveBlock`) so the entire orphan chain is removed atomically.
 *
 * 2. **Doc-empty fallback.** If the expanded range covers the entire
 *    doc (e.g. doc had `[ul[only-li]]` and we expand to remove ul +
 *    li), the delete would leave an empty doc and violate `block+`
 *    on the doc itself. We replace with a fresh paragraph instead so
 *    the editor stays usable (matches Notion).
 */
export function deleteBlock(tr: Transaction, blockPos: number): Transaction {
  if (blockPos < 0 || blockPos >= tr.doc.content.size) return tr;
  const node = tr.doc.nodeAt(blockPos);
  if (!node) return tr;
  const blockEnd = blockPos + node.nodeSize;

  const { from, to } = expandToEmptyWrappers(tr.doc, blockPos, blockEnd);

  // After expansion, would the doc be left empty? Compare the expanded
  // range to the doc's full content range - equality means we covered
  // every top-level child via single-child wrapper chains.
  const wouldEmptyDoc = from === 0 && to === tr.doc.content.size;
  if (wouldEmptyDoc) {
    const paragraphType = tr.doc.type.schema.nodes['paragraph'];
    if (!paragraphType) {
      // Schema has no `paragraph` type - bail rather than risk an
      // invalid replacement.
      return tr;
    }
    const replacement = paragraphType.createAndFill();
    if (!replacement) return tr;
    tr.replaceWith(from, to, replacement);
    tr.setSelection(TextSelection.near(tr.doc.resolve(from + 1)));
    return tr;
  }

  tr.delete(from, to);
  return tr;
}

/**
 * Duplicates the block at `blockPos` by inserting a copy immediately after
 * it. The copy preserves content, attrs, AND node-level marks (important
 * for annotation / comment extensions that attach marks to blocks).
 *
 * @param transformAttrs Optional mapper invoked on the source attrs to
 *   produce the copy's attrs. Use this to regenerate unique IDs so the
 *   duplicate doesn't collide with the original (e.g. `{ ...attrs, id: uuid() }`).
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
  // `type.create(attrs, content, marks)` preserves all three; plain
  // `node.copy(content)` drops the node's marks which breaks use cases
  // like block-level annotations.
  const copy = node.type.create(attrs, node.content, node.marks);
  tr.insert(blockEnd, copy);
  return tr;
}

/**
 * Transforms the block at `blockPos` into a different textblock type while
 * preserving its inline content AND any attributes that are valid on the
 * target type. Without this, `setBlockType` would reset global attrs
 * (bgColor, textColor, id, etc.) to their defaults - surprising users who
 * expect "Turn into" to keep a block's color and identity.
 *
 * Which attrs carry over is decided by the target type's schema: attrs that
 * exist on BOTH source and target flow through; attrs specific to the
 * source type (e.g., `level` on a Heading when turning into Paragraph) are
 * dropped naturally because the target doesn't declare them.
 *
 * The explicit `attrs` argument (e.g., `{ level: 2 }` for Heading 2) takes
 * precedence over source attrs with the same key.
 *
 * Returns the transaction unchanged if the target type is not a textblock
 * or if the node at `blockPos` can't be transformed.
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
  // `setBlockType` requires the target to be a textblock; if it isn't, bail.
  if (!targetType.isTextblock) return tr;
  const blockEnd = blockPos + node.nodeSize;

  // Preserve source attrs that the target type also declares, then overlay
  // caller-provided attrs on top. `targetType.spec.attrs` is the schema
  // truth about which attrs are valid on the new type.
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
