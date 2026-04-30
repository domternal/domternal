import { Fragment } from '@domternal/pm/model';
import type { Node, NodeType, Schema } from '@domternal/pm/model';

const TASK_LIST_TYPE = 'taskList';
const BULLET_LIST_TYPES = new Set(['bulletList', 'orderedList']);

const TASK_ITEM_TYPE = 'taskItem';
const LIST_ITEM_TYPE = 'listItem';

/**
 * Auto-converts the IMMEDIATE children of a slice between `listItem`
 * and `taskItem` so they fit the target parent's content rule.
 *
 * Why: dragging a bulletList's `listItem` into a `taskList` (or vice
 * versa) violates the target's `taskItem+` (resp. `listItem+`) content
 * rule. PM's schema fitter then wraps the wrong-type child in an empty
 * placeholder of the right type — producing the visible "empty
 * checkbox containing a bullet list" garbage state on drop.
 *
 * Notion's actual UX is to **type-adapt on drop**: drop a bullet into a
 * task list → it becomes a task item (unchecked); drop a task into a
 * bullet/ordered list → it becomes a list item (the `checked` attr is
 * dropped on the floor, which is fine — PM ignores unknown attrs).
 *
 * Scope: conversion only touches the IMMEDIATE children of the slice.
 * Nested lists inside those children retain their original type — if a
 * user drags a bullet item that has a nested task list inside, the
 * outer item adapts to the new parent but the nested task list stays
 * a task list, preserving the user's intent.
 *
 * Returns the original Fragment unchanged if no conversion is needed
 * (target parent isn't a list wrapper, or all children already match).
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
  const sourceTypeName = expectsTaskItem ? LIST_ITEM_TYPE : TASK_ITEM_TYPE;
  const targetItemType = schema.nodes[targetTypeName];
  if (!targetItemType) return content;

  // Map each child: convert wrong-type list items, leave others alone.
  // `Array.from` / map preserved (rather than the `Fragment.forEach` form)
  // so the `every` short-circuit lets us skip allocating a new Fragment
  // when nothing actually changed.
  const children: Node[] = [];
  content.forEach((child) => { children.push(child); });
  const allMatch = children.every((c) => c.type.name !== sourceTypeName);
  if (allMatch) return content;

  const replaced = children.map((child) => {
    if (child.type.name !== sourceTypeName) return child;
    // Build attrs for the new wrapper:
    // - listItem → taskItem: add `checked: false` (unchecked default).
    //   Spread existing attrs first so any user-defined globals (id, etc.)
    //   carry across, then set `checked` so it always lands on the new node.
    // - taskItem → listItem: spread attrs through; PM ignores `checked`
    //   on listItem (not in its schema), so it's silently dropped.
    const newAttrs = expectsTaskItem
      ? { ...child.attrs, checked: false }
      : { ...child.attrs };
    return targetItemType.create(newAttrs, child.content, child.marks);
  });

  return Fragment.from(replaced);
}
