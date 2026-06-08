/**
 * Built-in eligibility matchers. They constrain the drag resolver to
 * user-visible block units (paragraphs, headings, list/task items, images) and
 * exclude structural plumbing (table cells, inline text, list containers whose
 * items are draggable individually). Hosts can disable them with
 * `defaultMatchers: false` and supply their own via `matchers`.
 */
import type { BlockMatcher } from './blockMatcher.js';

const LIST_ITEM_NODE_TYPES = new Set(['listItem', 'taskItem']);
const TABLE_PLUMBING_TYPES = new Set(['tableRow', 'tableCell', 'tableHeader']);

/**
 * Reject a paragraph that is the first child of a list/task item. Dragging it
 * alone would split the item; rejecting sends the resolver up to the item itself.
 */
const firstChildOfListItem: BlockMatcher = {
  name: 'firstChildOfListItem',
  test(candidate) {
    if (!candidate.isFirstChild) return 'allow';
    const parent = candidate.container;
    if (parent === null) return 'allow';
    return LIST_ITEM_NODE_TYPES.has(parent.type.name) ? 'reject' : 'allow';
  },
};

/**
 * Reject a list/task container whose direct children are list items, else the
 * resolver locks onto the wrapping list near the first item's top edge.
 */
const listContainerSkip: BlockMatcher = {
  name: 'listContainerSkip',
  test(candidate) {
    const firstChild = candidate.block.firstChild;
    if (firstChild === null) return 'allow';
    return LIST_ITEM_NODE_TYPES.has(firstChild.type.name) ? 'reject' : 'allow';
  },
};

/**
 * Reject table-internal nodes (rows, cells, headers): the Table extension
 * manages those via its own UI; the block handle is for top-level blocks only.
 */
const tableInternals: BlockMatcher = {
  name: 'tableInternals',
  test(candidate) {
    if (TABLE_PLUMBING_TYPES.has(candidate.block.type.name)) return 'reject';
    if (candidate.container?.type.name === 'tableHeader') return 'reject';
    return 'allow';
  },
};

/** Reject inline-level nodes; the handle targets block-level content only. */
const inlineNodes: BlockMatcher = {
  name: 'inlineNodes',
  test(candidate) {
    const { block } = candidate;
    return block.isText || block.isInline ? 'reject' : 'allow';
  },
};

export const DEFAULT_BLOCK_MATCHERS: readonly BlockMatcher[] = Object.freeze([
  firstChildOfListItem,
  listContainerSkip,
  tableInternals,
  inlineNodes,
]);
