import type { Attrs, NodeType } from '@domternal/pm/model';
import type { Transaction } from '@domternal/pm/state';
import { TextSelection } from '@domternal/pm/state';

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
 */
export function deleteBlock(tr: Transaction, blockPos: number): Transaction {
  if (blockPos < 0 || blockPos >= tr.doc.content.size) return tr;
  const node = tr.doc.nodeAt(blockPos);
  if (!node) return tr;
  const blockEnd = blockPos + node.nodeSize;

  // The doc schema typically requires `block+` — deleting the only block
  // would violate that and throw on dispatch. Replace with a fresh
  // paragraph instead so the editor stays usable (mirrors Notion).
  if (tr.doc.childCount === 1) {
    const paragraphType = tr.doc.type.schema.nodes['paragraph'];
    if (!paragraphType) {
      // No paragraph type in this schema — we can't safely replace.
      // Bail out rather than let the delete throw.
      return tr;
    }
    // `createAndFill` fills required attrs with defaults — safer than
    // `create()` when the schema's paragraph requires non-null attrs
    // (custom user schemas can do that).
    const replacement = paragraphType.createAndFill();
    if (!replacement) return tr;
    tr.replaceWith(blockPos, blockEnd, replacement);
    // Put the cursor inside the new paragraph so the user can start typing.
    tr.setSelection(TextSelection.near(tr.doc.resolve(blockPos + 1)));
    return tr;
  }

  tr.delete(blockPos, blockEnd);
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
 * (bgColor, textColor, id, etc.) to their defaults — surprising users who
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
