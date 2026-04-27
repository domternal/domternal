/**
 * Default rule set for `findBestDragTarget`. Modelled on Tiptap's drag-
 * handle extension (MIT). Each rule returns a deduction; returning
 * `BASE_SCORE` (1000) effectively excludes the candidate from being
 * picked as the drag target. The four built-ins keep the resolver
 * focused on user-visible "block units" (paragraph, heading, list item,
 * task item, image, etc.) and out of structural plumbing (table cells,
 * inline content, list wrappers when their items are individually
 * draggable).
 */
import { BASE_SCORE } from './scoring.js';
import type { DragHandleRule } from './scoring.js';

const LIST_ITEM_TYPES = new Set(['listItem', 'taskItem']);
const TABLE_INTERNAL_TYPES = new Set(['tableRow', 'tableCell', 'tableHeader']);

/**
 * The first child paragraph of a list item should NOT be the drag
 * target — dragging that paragraph alone breaks the list. Promote up to
 * the list item itself.
 */
const listItemFirstChild: DragHandleRule = {
  id: 'listItemFirstChild',
  evaluate: ({ isFirst, parent }) => (
    isFirst && parent && LIST_ITEM_TYPES.has(parent.type.name) ? BASE_SCORE : 0
  ),
};

/**
 * `<ul>` / `<ol>` / task-list wrappers are not directly draggable when
 * their list-item children are. Without this rule, hovering near the
 * top edge of the first item would resolve to the list wrapper, not
 * the item.
 */
const listWrapperDeprioritize: DragHandleRule = {
  id: 'listWrapperDeprioritize',
  evaluate: ({ node }) => (
    node.firstChild && LIST_ITEM_TYPES.has(node.firstChild.type.name) ? BASE_SCORE : 0
  ),
};

/**
 * Table internals (`tableRow`, `tableCell`, `tableHeader`, and direct
 * children of `tableHeader`) are managed by the Table extension's own
 * controls — never the block handle.
 */
const tableStructure: DragHandleRule = {
  id: 'tableStructure',
  evaluate: ({ node, parent }) => {
    if (TABLE_INTERNAL_TYPES.has(node.type.name)) return BASE_SCORE;
    if (parent?.type.name === 'tableHeader') return BASE_SCORE;
    return 0;
  },
};

/**
 * Inline runs and text nodes are never legitimate drag targets.
 */
const inlineContent: DragHandleRule = {
  id: 'inlineContent',
  evaluate: ({ node }) => (node.isInline || node.isText ? BASE_SCORE : 0),
};

export const DEFAULT_DRAG_HANDLE_RULES: DragHandleRule[] = [
  listItemFirstChild,
  listWrapperDeprioritize,
  tableStructure,
  inlineContent,
];
