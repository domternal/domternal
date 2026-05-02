import { Fragment } from '@domternal/pm/model';
import type { Node, NodeType, Schema } from '@domternal/pm/model';

const TASK_LIST_TYPE = 'taskList';
const BULLET_LIST_TYPES = new Set(['bulletList', 'orderedList']);

const TASK_ITEM_TYPE = 'taskItem';
const LIST_ITEM_TYPE = 'listItem';

/**
 * Adapts the IMMEDIATE children of a slice so they satisfy the target
 * parent's content rule when dropping into a list-wrapper container
 * (`bulletList` / `orderedList` / `taskList`).
 *
 * Three behaviours:
 *
 * 1. **Item already matches the target list.** No-op (e.g. dragging a
 *    `listItem` into another `bulletList` keeps it a `listItem`).
 *
 * 2. **Cross-list-type conversion.** Source is a list item of the OTHER
 *    type (e.g. `taskItem` → bulletList parent). Wrapper type swaps
 *    while preserving inner content. For listItem→taskItem we set
 *    `checked: false`; for taskItem→listItem the `checked` attr is
 *    dropped (PM ignores attrs not declared by the target schema).
 *
 * 3. **Arbitrary-block wrap.** Source is something else (heading,
 *    paragraph, codeBlock, blockquote, hr, image, etc.). We wrap the
 *    dragged block in a fresh `listItem` (or `taskItem`) so the drop
 *    lands INSIDE the list, mirroring Notion's behaviour.
 *
 *    Notion-strict listItem content (`paragraph block*`) requires the
 *    first child to be a paragraph (the "label" line aligned with the
 *    bullet/checkbox). For non-paragraph blocks we prepend an empty
 *    label paragraph so the block attaches as a nested child below
 *    it; for paragraphs we use them directly as the label.
 *
 *    Without this wrap, PM's content fitter would silently promote
 *    the dragged block to the next valid position (a sibling AFTER
 *    the list), which contradicts the visual drop indicator and
 *    surprises the user.
 *
 * Scope: only IMMEDIATE children of the slice are adapted. Nested
 * lists inside the dragged content keep their original type - drag a
 * bullet item that contains a nested task list, and the outer wrapper
 * adapts to the new parent while the nested task list is preserved.
 *
 * Returns the original Fragment unchanged when target parent isn't a
 * list wrapper, or when every child already matches the target item
 * type.
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

  // Snapshot children so we can short-circuit when nothing needs
  // adapting - every direct child is already the matching item type.
  const children: Node[] = [];
  content.forEach((child) => { children.push(child); });
  const allMatch = children.every((c) => c.type.name === targetTypeName);
  if (allMatch) return content;

  const replaced = children.map((child) => {
    // (1) Already the right type - keep as-is.
    if (child.type.name === targetTypeName) return child;

    // (2) Opposite list-item type - convert by reusing inner content.
    if (child.type.name === oppositeTypeName) {
      const newAttrs = expectsTaskItem
        ? { ...child.attrs, checked: false }
        : { ...child.attrs };
      return targetItemType.create(newAttrs, child.content, child.marks);
    }

    // (3) Arbitrary block (heading, paragraph, codeBlock, …) - wrap it
    // in a fresh item. Notion-strict listItem requires `paragraph
    // block*` content, so for non-paragraph children we prepend an
    // empty label paragraph (the bullet/checkbox-aligned line) and
    // attach the dragged block below it as a nested child.
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
