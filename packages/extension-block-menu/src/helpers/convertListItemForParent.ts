import { Fragment } from '@domternal/pm/model';
import type { Node, NodeType, Schema } from '@domternal/pm/model';

const TASK_LIST_TYPE = 'taskList';
const BULLET_LIST_TYPES = new Set(['bulletList', 'orderedList']);

const TASK_ITEM_TYPE = 'taskItem';
const LIST_ITEM_TYPE = 'listItem';

/**
 * Adapts the IMMEDIATE children of a slice to satisfy the target parent's
 * content rule when dropping into a list wrapper (`bulletList` / `orderedList` /
 * `taskList`). Three behaviours:
 *
 * 1. Item already matches the target list: no-op.
 *
 * 2. Cross-list-type conversion: source is a list item of the OTHER type (e.g.
 *    `taskItem` -> bulletList parent). Wrapper type swaps, inner content kept.
 *    listItem->taskItem sets `checked: false`; taskItem->listItem drops `checked`
 *    (PM ignores attrs the target schema doesn't declare).
 *
 * 3. Arbitrary-block wrap: source is anything else (heading, codeBlock, hr, ...).
 *    Wrap it in a fresh `listItem`/`taskItem` so the drop lands INSIDE the list
 *    (Notion behaviour). Notion-strict listItem content (`paragraph block*`)
 *    requires a paragraph first child (the bullet/checkbox-aligned label), so
 *    for non-paragraph blocks we prepend an empty label paragraph and attach the
 *    block below it; paragraphs become the label directly. Without this wrap PM's
 *    fitter would silently promote the block to a sibling AFTER the list,
 *    contradicting the drop indicator.
 *
 * Scope: only IMMEDIATE children are adapted. Nested lists inside the dragged
 * content keep their original type.
 *
 * Returns the Fragment unchanged when the target isn't a list wrapper, or when
 * every child already matches the target item type.
 */
export function convertListItemForParent(
  schema: Schema,
  content: Fragment,
  parentType: NodeType,
): Fragment {
  const expectsTaskItem = parentType.name === TASK_LIST_TYPE;
  const expectsListItem = BULLET_LIST_TYPES.has(parentType.name);
  if (!expectsTaskItem && !expectsListItem) return content;

  const targetTypeName = expectsTaskItem ? TASK_ITEM_TYPE : LIST_ITEM_TYPE;
  const oppositeTypeName = expectsTaskItem ? LIST_ITEM_TYPE : TASK_ITEM_TYPE;
  const targetItemType = schema.nodes[targetTypeName];
  if (!targetItemType) return content;

  // Snapshot children to short-circuit when every direct child already matches.
  const children: Node[] = [];
  content.forEach((child) => { children.push(child); });
  const allMatch = children.every((c) => c.type.name === targetTypeName);
  if (allMatch) return content;

  const replaced = children.map((child) => {
    // (1) Already the right type.
    if (child.type.name === targetTypeName) return child;

    // (2) Opposite list-item type: convert by reusing inner content.
    if (child.type.name === oppositeTypeName) {
      const newAttrs = expectsTaskItem
        ? { ...child.attrs, checked: false }
        : { ...child.attrs };
      return targetItemType.create(newAttrs, child.content, child.marks);
    }

    // (3) Arbitrary block: wrap in a fresh item. Notion-strict listItem requires
    // `paragraph block*`, so for non-paragraph children prepend an empty label
    // paragraph (the bullet/checkbox-aligned line) and nest the block below it.
    const wrapperAttrs: Record<string, unknown> = expectsTaskItem
      ? { checked: false }
      : {};
    if (child.type.name === 'paragraph') {
      return targetItemType.create(wrapperAttrs, [child]);
    }
    const paragraphType = schema.nodes['paragraph'];
    const labelParagraph = paragraphType?.createAndFill();
    const content = labelParagraph ? [labelParagraph, child] : [child];
    return targetItemType.create(wrapperAttrs, content);
  });

  return Fragment.from(replaced);
}
