/**
 * BlockHandle Extension
 *
 * Renders a Notion-style gutter handle on the left side of each top-level
 * block when the user hovers over the editor. The handle exposes two
 * buttons:
 *
 * 1. `⋮⋮` drag handle (click → opens BlockContextMenu, drag → reorder)
 * 2. `+` insert button (inserts an empty paragraph below the block; the
 *    FloatingMenu extension picks up the empty-line state and auto-shows
 *    its insert menu)
 *
 * Visibility + drag + context-menu trigger are fully owned by this plugin;
 * the context menu UI itself lives in `BlockContextMenu.ts` and listens for
 * the `dm:block-context-menu-open` custom event that this plugin dispatches.
 *
 * Styles ship via `@domternal/theme` (`_block-handle.scss`). The plugin
 * adds a `dm-editor--has-block-handle` class to the `.dm-editor` container
 * so the theme stylesheet can widen `.ProseMirror` padding-left to create
 * gutter space inside the `overflow:hidden` editor wrapper.
 */
import { Extension, defaultIcons } from '@domternal/core';
import type { Editor } from '@domternal/core';
import { NodeSelection, Plugin, PluginKey, TextSelection } from '@domternal/pm/state';
import type { EditorView } from '@domternal/pm/view';
import type { Slice } from '@domternal/pm/model';
import { findDeepestBlockAtY } from './helpers/findTopLevelBlock.js';
import { moveBlock } from './helpers/moveBlock.js';
import { moveBlockAsNestedChild } from './helpers/moveBlockAsNestedChild.js';
import { buildDragPreview } from './helpers/cloneElement.js';
import { clampToContent } from './helpers/clampCoords.js';
import { normalizeEdgeDetection } from './helpers/edgeDetection.js';
import type { EdgeDetectionConfig, EdgePreset } from './helpers/edgeDetection.js';
import { DEFAULT_DRAG_HANDLE_RULES } from './helpers/defaultRules.js';
import { findBestDragTarget } from './helpers/findBestDragTarget.js';
import type { DragHandleRule } from './helpers/scoring.js';
import { showFloatingMenu } from './FloatingMenu.js';

/** Default list of nodes treated as drag-targetable when `nested: true`. */
export const DEFAULT_NESTED_NODES: string[] = ['listItem', 'taskItem'];

/**
 * Node types that accept a nested-child drop in MVP. When the resolver
 * lands on one of these AND `clientX` exceeds `nestThreshold` from the
 * left edge, `computeDropPlacement` returns `mode: 'nested'`. Other
 * containers (blockquote, codeBlock, details) have their own content
 * rules and remain sibling-only until explicit support lands.
 */
const LIST_ITEM_TYPES = new Set(['listItem', 'taskItem']);

/**
 * Default pixel threshold from the left edge of a list item beyond
 * which drop commits to nested-child mode. Roughly the width of a
 * bullet/checkbox marker (~24px) + a small buffer so the boundary
 * sits just past where the marker visually ends.
 */
export const DEFAULT_NEST_THRESHOLD = 28;

/**
 * Pixel inset of the nested-mode drop indicator from the resolved
 * block's left edge. Mirrors `--dm-block-children-indent` (1.5rem ≈
 * 24px) so the dashed line lands exactly where a nested child block
 * would render inside the list item.
 */
const NESTED_INDICATOR_INDENT_PX = 24;

/**
 * Drop-zone tolerance in CSS pixels. The handle's drop zone extends
 * `DROP_ZONE_TOL_LEFT` past the editor's left edge (so the gutter where
 * the handle visually lives counts as a valid drop area) and `DROP_ZONE_TOL`
 * on every other edge (subpixel jitter + small margins outside `.dm-editor`).
 * Hardcoded so the gate stays predictable regardless of how callers style
 * the wrapper. Override behaviour by setting `dropIndicator: false` and
 * rendering your own visual.
 */
const DROP_ZONE_TOL_LEFT = 80;
const DROP_ZONE_TOL = 16;

export const blockHandlePluginKey = new PluginKey<BlockHandlePluginState>('blockHandle');

export interface BlockHandleOptions {
  /**
   * Milliseconds to wait before hiding the handle after the mouse leaves
   * the editor. Gives users time to move into the handle without it
   * disappearing.
   * @default 200
   */
  hideDelay?: number;
  /**
   * Disable drag-to-reorder while still showing the plus/drag buttons
   * (drag becomes a no-op, click opens context menu only).
   * @default false
   */
  disableDrag?: boolean;
  /**
   * Auto-scroll the nearest scrollable ancestor when the user drags near
   * the top/bottom edge of the viewport. Disable if the host app manages
   * its own drag scroll behaviour.
   * @default true
   */
  autoScroll?: boolean;
  /**
   * Distance in CSS pixels from the top/bottom edge that triggers
   * auto-scroll. Larger values start scrolling sooner.
   * @default 48
   */
  autoScrollThreshold?: number;
  /**
   * Peak scroll speed in CSS pixels per animation frame. Speed ramps
   * linearly from 0 at the threshold to this value at the edge.
   * @default 18
   */
  autoScrollMaxSpeed?: number;
  /**
   * Whether the handle should resolve to nested block containers (list
   * items, task items, and optionally others) instead of always the
   * top-level block.
   *
   * - `false` - only top-level blocks are hoverable / draggable (default).
   * - `true` - list items and task items resolve individually (Notion behaviour).
   * - object - fine-grained config; see `NestedConfig`.
   *
   * @default false
   */
  nested?: boolean | NestedConfig;
  /**
   * Pixel threshold from the LEFT edge of a list item beyond which a
   * drop commits to nested-child mode (the dragged block becomes the
   * last child of that item) instead of sibling mode (a new list item
   * created next to it). Mirrors Notion's "drop indented = nested,
   * drop on the marker = sibling" UX.
   *
   * Set to `0` to disable nested-drop entirely (every drop is sibling).
   *
   * The X-detection only fires when nested mode is on AND the resolved
   * target is a `listItem` / `taskItem`. Other containers stay sibling-
   * only until explicit support lands.
   *
   * @default 28
   */
  nestThreshold?: number;
  /**
   * Show a custom drop indicator line during drag-from-handle that
   * mirrors EXACTLY where the drop will land. Replaces the need for
   * `prosemirror-dropcursor` for our drag flow - `dropcursor` uses
   * PM's default `posAtCoords` which can disagree with our resolver
   * (especially in side-gutter / inter-block-gap drops).
   *
   * Set to `false` if you want the standard `prosemirror-dropcursor`
   * behaviour or are providing your own indicator.
   * @default true
   */
  dropIndicator?: boolean;
}

/**
 * Configuration for nested resolution. Backwards-compatible with the
 * earlier `{ allowedNodes }` literal - every field is optional.
 */
export interface NestedConfig {
  /**
   * Node type names treated as drag targets when nested mode is on.
   * @default ['listItem', 'taskItem']
   */
  allowedNodes?: string[];
  /**
   * Restrict resolution to nodes that have at least one ancestor of one
   * of these type names. Use to scope nested mode to specific structures
   * (e.g. only inside `table`). Empty / omitted → no restriction.
   */
  allowedContainers?: string[];
  /**
   * Tiptap-style "promote to parent at the gutter" behaviour. When the
   * cursor is within `threshold` px of a configured edge, the candidate's
   * score is reduced by `strength * depth` - deeper nodes are penalised
   * more, so a shallower ancestor (e.g. the wrapping list) wins near the
   * boundary.
   *
   * - `false` / `undefined` / `'none'` → Notion behaviour (deepest match).
   * - `true` / `'left'` → Tiptap defaults: edges `['left','top']`, threshold 12, strength 500.
   * - `'right'` / `'both'` → preset variants.
   * - object → custom config (any field optional, merged over defaults).
   *
   * @default false
   */
  promoteOnEdge?: boolean | EdgePreset | Partial<EdgeDetectionConfig>;
  /**
   * Append custom scoring rules. Default rules still apply unless
   * `defaultRules: false` is also set.
   */
  rules?: DragHandleRule[];
  /**
   * Set to `false` to disable the four built-in scoring rules
   * (listItemFirstChild, listWrapperDeprioritize, tableStructure,
   * inlineContent). Almost always wanted; opt-out only for testing /
   * specialised host editors.
   * @default true
   */
  defaultRules?: boolean;
}

export interface BlockHandlePluginState {
  /** Absolute position of the top-level block currently under the cursor, or null. */
  hoveredPos: number | null;
  /**
   * Source position of the block currently being dragged (set on
   * dragstart, cleared on dragend). Used by `handleDrop` to determine
   * whether the drop originated from our handle.
   */
  draggedFrom: number | null;
}

/**
 * Minimal shape for ProseMirror's internal `view.dragging` property.
 * Assigning to it tells PM that a drag is in progress and which slice is
 * being moved; PM's default drop handler reads this to finalise the move.
 *
 * `node` is an undocumented but critical field - when present, PM's drop
 * handler treats it as the authoritative source selection to delete from
 * the old location, rather than relying on `view.state.selection`. The
 * browser may shift the selection mid-drag (e.g. when the user clicks
 * somewhere else during the drag), which without `node` causes the
 * original block to survive the drop. Setting it explicitly from the
 * `NodeSelection` we created on dragstart is Tiptap's fix for the same
 * family of bugs.
 */
interface PMViewWithDragging {
  dragging: { slice: Slice; move: boolean; node?: NodeSelection } | null;
}

/** Casts `EditorView` to expose PM's internal `dragging` field. */
function asDragView(view: EditorView): PMViewWithDragging {
  return view as unknown as PMViewWithDragging;
}

/**
 * Internal, fully-resolved view of `NestedConfig`. Plain string arrays
 * + an optional edge config so the resolver doesn't have to interpret
 * presets at hover time.
 */
export interface NestedResolution {
  /** Allowed drag targets. Empty array → top-level-only mode. */
  allowedNodes: string[];
  /** Optional ancestor whitelist; empty array → no restriction. */
  allowedContainers: string[];
  /** Edge promotion config; `null` → Notion-style deepest match. */
  edgeConfig: EdgeDetectionConfig | null;
  /** Effective rule list (defaults + user, or just user when defaults off). */
  rules: DragHandleRule[];
}

export interface CreateBlockHandlePluginOptions {
  pluginKey: PluginKey<BlockHandlePluginState>;
  editor: Editor;
  hideDelay: number;
  disableDrag: boolean;
  autoScroll: boolean;
  autoScrollThreshold: number;
  autoScrollMaxSpeed: number;
  nested: NestedResolution;
  dropIndicator: boolean;
  /**
   * Pixel threshold for nested-drop X-detection (see `BlockHandleOptions.nestThreshold`).
   * `0` disables nested-drop.
   */
  nestThreshold: number;
}

/**
 * Walks up from `el` to the nearest ancestor that actually scrolls
 * vertically. Returns `null` when no bounded scrollable ancestor exists -
 * the caller should then skip its custom scroll loop and let the browser's
 * native drag-edge autoscroll handle page-level scrolling. Running both
 * our RAF scrollBy AND the browser's native scroll at the same time
 * double-scrolls and feels janky.
 */
function findScrollableAncestor(el: HTMLElement): HTMLElement | null {
  let cur: HTMLElement | null = el;
  while (cur) {
    const style = getComputedStyle(cur);
    const overflowY = style.overflowY;
    if ((overflowY === 'auto' || overflowY === 'scroll') && cur.scrollHeight > cur.clientHeight) {
      return cur;
    }
    cur = cur.parentElement;
  }
  return null;
}

/**
 * Finds the block under the given client coordinates.
 *
 * When `nestedNodes` is non-empty, the plugin is in "nested mode":
 * resolves the deepest allowed block (list item, task item, etc.) at
 * the cursor row so users drag individual list items instead of always
 * the whole list.
 *
 * - Mode B (Notion default): spatial Y-walk via `findDeepestBlockAtY`.
 *   `posAtCoords` would resolve to whatever sits at the cursor's X,
 *   which in the gutter is OUTER content (the inner items are indented
 *   further right). Notion's actual behaviour is to anchor the handle
 *   on the row the cursor is in, regardless of X - that's what the
 *   spatial walk gives us.
 * - Mode C (Tiptap-style scoring): uses `findBestDragTarget` with
 *   edge promotion. By design, gutter-X promotes to OUTER (different
 *   UX choice). Opt in via `promoteOnEdge`.
 *
 * When `nestedNodes` is empty, classic behavior: walk doc children and
 * compare Y against each top-level block's DOM rect, with a `posAtCoords`
 * fallback for positions in between blocks.
 */
function resolveBlockAtCoords(
  view: EditorView,
  clientX: number,
  clientY: number,
  nested: NestedResolution,
): { pos: number; rect: DOMRect; dom: HTMLElement } | null {
  // Mode A - top-level only (classic). Walk doc children by Y range; X
  // is intentionally ignored so the handle still surfaces when the
  // cursor is in the side gutter.
  if (nested.allowedNodes.length === 0) {
    return resolveTopLevelByY(view, clientY);
  }

  // Common to nested modes: clamp coords into the editor's content
  // rectangle so resolution survives cursor-in-gutter and above/below
  // edge cases (where `posAtCoords` would otherwise return null).
  const clamped = clampToContent(view, clientX, clientY);
  if (!clamped) return null;

  // Mode C - Tiptap-style scoring with edge promotion.
  if (nested.edgeConfig) {
    const target = findBestDragTarget(view, clamped.x, clamped.y, {
      rules: nested.rules,
      edgeConfig: nested.edgeConfig,
      allowedNodeTypes: nested.allowedNodes,
      allowedContainers: nested.allowedContainers,
    });
    if (target) {
      return { pos: target.pos, rect: target.rect, dom: target.dom };
    }
    // Scoring picked nothing - fall through to top-level so the handle
    // still surfaces on the doc's outer block.
    return resolveTopLevelByY(view, clamped.y);
  }

  // Mode B - Notion-style: deepest allowed block at the cursor row.
  // X is intentionally ignored; see `findDeepestBlockAtY` rationale.
  // `nested.rules` is forwarded so exclusion rules (e.g. listItemFirstChild)
  // apply consistently with Mode C - hosts extending allowedNodes to
  // include `paragraph` get label-paragraph exclusion for free.
  const found = findDeepestBlockAtY(view, clamped.y, nested.allowedNodes, nested.rules);
  if (found) {
    return { pos: found.pos, rect: found.rect, dom: found.dom };
  }
  return resolveTopLevelByY(view, clamped.y);
}

/**
 * Top-level fallback used by every mode: walk the doc's direct children
 * and return the one whose vertical range contains `clientY`. X is
 * ignored so the handle resolves correctly even when the cursor sits
 * outside the editor's horizontal bounds.
 *
 * When no top-level block strictly contains `clientY` (cursor sits in
 * the inter-block gap, above the first block, or below the last), this
 * falls back to the **closest** top-level block by vertical distance.
 * The previous fallback used `posAtCoords({ left: 0, top: clientY })`
 * which returned `null` when X=0 was outside the editor's content area -
 * leading to silent drop-in-gap failures (the user sees a hover that
 * anchors but the drop does nothing). Closest-by-Y is robust regardless
 * of horizontal layout and matches Notion's "drop sticks to the nearest
 * block" UX.
 */
function resolveTopLevelByY(
  view: EditorView,
  clientY: number,
): { pos: number; rect: DOMRect; dom: HTMLElement } | null {
  const doc = view.state.doc;
  let offset = 0;
  let closest: { pos: number; rect: DOMRect; dom: HTMLElement; dist: number } | null = null;
  for (let i = 0; i < doc.childCount; i++) {
    const child = doc.child(i);
    const dom = view.nodeDOM(offset);
    if (dom instanceof HTMLElement) {
      const rect = dom.getBoundingClientRect();
      if (clientY >= rect.top && clientY <= rect.bottom) {
        return { pos: offset, rect, dom };
      }
      const dist = clientY < rect.top ? rect.top - clientY : clientY - rect.bottom;
      if (closest === null || dist < closest.dist) {
        closest = { pos: offset, rect, dom, dist };
      }
    }
    offset += child.nodeSize;
  }
  if (closest) return { pos: closest.pos, rect: closest.rect, dom: closest.dom };
  return null;
}

const LIST_WRAPPER_TYPE_NAMES = new Set(['bulletList', 'orderedList', 'taskList']);

/**
 * Notion-style "drop sticks to the list" semantics. When the resolved
 * drop target is a list-wrapper container (bulletList / orderedList /
 * taskList) and the cursor sits ABOVE its top edge or BELOW its bottom
 * edge, descend into the wrapper and pick the FIRST or LAST listItem
 * (respectively) so the drop lands inside the list rather than creating
 * a sibling list of one item.
 *
 * Without this, a drop in the small gap between a list bottom and the
 * next block would be processed against the wrapper UL - and PM's
 * subsequent insert at the wrapper's end position would auto-wrap the
 * dragged listItem in a brand-new bulletList sibling, which is rarely
 * what users intend (most lists were the user's grouping; they want the
 * drag to keep things in the same list).
 *
 * Returns `resolved` unchanged when:
 * - The resolved node isn't a list wrapper.
 * - The wrapper has no children (e.g. mid-edit transient state).
 * - The cursor is INSIDE the wrapper's vertical extent (the resolver
 *   would have already returned a child via `findDeepestBlockAtY` in
 *   that case; if we got the wrapper despite being inside, the caller's
 *   default targeting is already correct).
 */
function adjustDropTargetForListWrapper(
  view: EditorView,
  resolved: { pos: number; rect: DOMRect; dom: HTMLElement },
  clientY: number,
): { pos: number; rect: DOMRect; dom: HTMLElement } {
  const node = view.state.doc.nodeAt(resolved.pos);
  if (!node) return resolved;
  if (!LIST_WRAPPER_TYPE_NAMES.has(node.type.name)) return resolved;
  if (node.childCount === 0) return resolved;

  const isAbove = clientY < resolved.rect.top;
  const isBelow = clientY > resolved.rect.bottom;
  if (!isAbove && !isBelow) return resolved;

  // Find absolute pos of the first or last child relative to the wrapper.
  // Wrapper opens at `resolved.pos`, so its first child starts at
  // `resolved.pos + 1` (one past the open token).
  const targetIndex = isBelow ? node.childCount - 1 : 0;
  let childPos = resolved.pos + 1;
  for (let i = 0; i < targetIndex; i++) {
    childPos += node.child(i).nodeSize;
  }
  const childDom = view.nodeDOM(childPos);
  if (!(childDom instanceof HTMLElement)) return resolved;
  return { pos: childPos, rect: childDom.getBoundingClientRect(), dom: childDom };
}

/**
 * Resolved drop target shared by `handleDrop` and `updateDropIndicator`
 * so the indicator draws exactly where the drop lands (no
 * "indicator says X, item drops Y" mismatch).
 *
 * `mode` distinguishes the two ways a block can be dropped over a list
 * item: `'sibling'` (the existing behaviour, drop position becomes a
 * new sibling of the target via the standard `moveBlock` flow) and
 * `'nested'` (drop becomes a nested child of `targetItemPos` inside
 * `wrapperPos`, applied via `insertAsListItemChild`). Today every
 * placement is `'sibling'`; the `'nested'` branch activates in a
 * follow-up that adds X-threshold detection.
 */
export interface DropPlacement {
  /** Position right BEFORE the resolved block (same convention as `nodeAt`). */
  pos: number;
  /** Bounding rect of the resolved block, used to draw the indicator line. */
  rect: DOMRect;
  /**
   * When `true` the drop lands AFTER the resolved block (line below);
   * when `false` it lands BEFORE the block (line above). Computed from
   * the cursor's Y position relative to the resolved block's mid-line
   * regardless of `mode` so the existing drop pipeline (which reads this
   * field) produces an identical sibling-style move while Phase 5's
   * nested-child insertion is still being wired in. Phase 5 ignores
   * this field for `mode === 'nested'` placements and dispatches via
   * `insertAsListItemChild` instead.
   */
  insertAfter: boolean;
  /** Sibling drop (current behaviour) vs nested-child drop (drop-indent). */
  mode: 'sibling' | 'nested';
  /** Position of the target list item when `mode === 'nested'`. */
  targetItemPos?: number;
  /** Position of the containing list wrapper when `mode === 'nested'`. */
  wrapperPos?: number;
}

/**
 * Computes the FINAL drop placement using the same logic `handleDrop`
 * uses. Returned by both the actual drop handler AND the visual drop
 * indicator so the line draws exactly where the drop will land - no
 * "indicator says one place, item drops elsewhere" mismatch (the classic
 * dropcursor pain point with custom drop handlers).
 *
 * - `rect` is the resolved target block's rect (for drawing the line)
 * - `insertAfter` decides whether the line sits above or below the rect
 *   AND whether the drop pos becomes `pos + nodeSize` or `pos`
 *
 * Returns `null` when the resolver finds no candidate (e.g. empty doc).
 *
 * **Inter-block gap normalization.** When the cursor sits in the gap
 * between two siblings, `resolveBlockAtCoords` flips between them based
 * on Y proximity. Without normalization the indicator would draw at two
 * different rect edges (upper.bottom vs lower.top) - visually two lines
 * for what is the SAME logical drop slot (PM treats `endOf(upper)` and
 * `startOf(lower)` as one position in the parent's content array). To
 * unify the visual we canonicalise `insertAfter=false` to "after the
 * previous sibling" whenever a previous sibling exists at the same depth.
 * Net effect: one gap → one line, anchored at the bottom edge of the
 * upper block, with the upper block's width (which equals the lower's
 * for prose at the same depth, so the line spans the content column).
 */
export function computeDropPlacement(
  view: EditorView,
  clientX: number,
  clientY: number,
  nested: NestedResolution,
  nestThreshold: number = DEFAULT_NEST_THRESHOLD,
): DropPlacement | null {
  const initial = resolveBlockAtCoords(view, clientX, clientY, nested);
  if (!initial) return null;
  const resolved = adjustDropTargetForListWrapper(view, initial, clientY);

  // X-threshold detection: when the resolved target is a list item and
  // the cursor is sitting `>= nestThreshold` px from the left edge of
  // its rect (and inside the rect's vertical span), commit to nested
  // mode. The dragged block becomes the LAST child of the target item.
  // Pipeline ignores `mode` until Phase 4 (indicator visual) and Phase
  // 5 (drop transaction) wire it through; until then a 'nested' result
  // still produces sibling behaviour at drop time.
  //
  // `nestThreshold === 0` is the explicit "disable" knob - the early
  // exit guard below skips the entire X branch so every drop stays
  // sibling regardless of X.
  if (nestThreshold > 0) {
    const targetNode = view.state.doc.nodeAt(resolved.pos);
    if (targetNode && LIST_ITEM_TYPES.has(targetNode.type.name)) {
      const targetRect = resolved.rect;
      const xInTarget = clientX - targetRect.left;
      const isInsideX = xInTarget >= 0 && xInTarget <= targetRect.width;
      const isInNestZone = xInTarget >= nestThreshold;
      const isInsideY = clientY >= targetRect.top && clientY <= targetRect.bottom;
      if (isInsideX && isInNestZone && isInsideY) {
        // Walk up to the wrapping list. `$resolved.before()` returns the
        // position right before the parent at $resolved.depth - which
        // for a position sitting BETWEEN siblings is the wrapper itself
        // (bulletList / orderedList / taskList). `doc.nodeAt(wrapperPos)`
        // can then resolve the wrapper for the Phase 5 tr math.
        const $resolved = view.state.doc.resolve(resolved.pos);
        const wrapperPos = $resolved.before();
        // `insertAfter` mirrors the sibling-mode Y-mid calculation so the
        // existing drop pipeline (which reads `placement.insertAfter` to
        // compute `targetPos`) produces an identical result for the
        // sibling-style move that runs today. Phase 5 will branch on
        // `mode === 'nested'` and ignore insertAfter, switching to the
        // `insertAsListItemChild` flow instead. This keeps the field
        // semantically meaningful for both consumers.
        const midY = targetRect.top + targetRect.height / 2;
        return {
          pos: resolved.pos,
          rect: targetRect,
          insertAfter: clientY > midY,
          mode: 'nested',
          targetItemPos: resolved.pos,
          wrapperPos,
        };
      }
    }
  }

  const rect = resolved.rect;
  const midY = rect.top + rect.height / 2;
  const insertAfter = clientY > midY;

  if (!insertAfter) {
    const prev = findPreviousSiblingAtSameDepth(view, resolved.pos);
    if (prev) {
      return { pos: prev.pos, rect: prev.rect, insertAfter: true, mode: 'sibling' };
    }
  }
  return { pos: resolved.pos, rect, insertAfter, mode: 'sibling' };
}

/**
 * Returns the previous sibling at the same parent depth as `pos` (which
 * must be the position immediately BEFORE a node - same convention as
 * `nodeAt`). Returns `null` when the node has no previous sibling (it's
 * the first child of its parent) or when the previous sibling has no DOM
 * representation.
 *
 * Works for any depth: top-level blocks resolve against `doc`; nested
 * blocks (list items, table cells) resolve against their immediate
 * container - so the canonical "between" position is always the upper
 * sibling within the SAME container, never crossing container boundaries.
 */
function findPreviousSiblingAtSameDepth(
  view: EditorView,
  pos: number,
): { pos: number; rect: DOMRect } | null {
  const doc = view.state.doc;
  if (pos <= 0) return null;
  const $pos = doc.resolve(pos);
  if ($pos.index() === 0) return null;
  const prevNode = $pos.parent.child($pos.index() - 1);
  const prevPos = pos - prevNode.nodeSize;
  const prevDom = view.nodeDOM(prevPos);
  if (!(prevDom instanceof HTMLElement)) return null;
  return { pos: prevPos, rect: prevDom.getBoundingClientRect() };
}

/**
 * Creates a standalone BlockHandle ProseMirror plugin. Exported so
 * framework wrappers can build on top without going through the Extension
 * factory.
 */
export function createBlockHandlePlugin(
  options: CreateBlockHandlePluginOptions,
): Plugin<BlockHandlePluginState> {
  const { pluginKey, editor, hideDelay, disableDrag, autoScroll, autoScrollThreshold, autoScrollMaxSpeed, nested, dropIndicator, nestThreshold } = options;

  // --- Build DOM once. Buttons rendered with the shared Phosphor icons.
  const root = document.createElement('div');
  root.className = 'dm-block-handle';
  root.setAttribute('data-dm-editor-ui', '');

  const dragBtn = document.createElement('button');
  dragBtn.type = 'button';
  dragBtn.className = 'dm-block-handle-btn dm-block-handle-drag';
  dragBtn.setAttribute('aria-label', 'Drag to reorder, click for options');
  dragBtn.setAttribute('draggable', 'true');
  dragBtn.innerHTML = defaultIcons['dotsSixVertical'] ?? '';

  const plusBtn = document.createElement('button');
  plusBtn.type = 'button';
  plusBtn.className = 'dm-block-handle-btn dm-block-handle-plus';
  plusBtn.setAttribute('aria-label', 'Add block below');
  plusBtn.innerHTML = defaultIcons['plus'] ?? '';

  root.appendChild(dragBtn);
  root.appendChild(plusBtn);

  // --- Drop indicator: a thin horizontal line drawn at the resolved
  // drop target during an active drag. Built once, hidden by default,
  // appended into `.dm-editor` alongside the handle.
  const indicator = document.createElement('div');
  indicator.className = 'dm-block-drop-indicator';
  indicator.setAttribute('data-dm-editor-ui', '');

  let editorEl: HTMLElement | null = null;
  // Element that captures hover events. Usually `editorEl.parentElement`
  // so the listener catches mouse moves in the side gutter (where the
  // BlockHandle sits visually when the editor is centered narrower than
  // the page). Falls back to `editorEl` if no parent exists.
  let hoverEl: HTMLElement | null = null;
  let hideTimer: number | null = null;

  // Hover-tick state - rAF-coalesced to keep the handle glide-smooth even
  // when mousemove fires ~240Hz on high-refresh pointers. Only one rAF is
  // registered at a time; latest coords win. `currentHoveredPos` is the
  // identity gate: we only repaint when the ProseMirror position under
  // the cursor *changes*, not on every micro-move within the same block.
  let hoverRaf: number | null = null;
  let pendingHoverCoords: { x: number; y: number } | null = null;
  let currentHoveredPos: number | null = null;
  // Set on `mousedown` on the drag button, cleared on `mouseup` / `dragend`.
  // While truthy, hover updates are paused so the handle does NOT jump to
  // a neighbouring block during the browser's drag-initiation window
  // (the ~3-5px mousedown+move that decides click-vs-drag). Without this
  // lock, the handle slides out from under the user's cursor before the
  // browser has decided the interaction is a drag, and `dragstart` never
  // fires - feels like "click and hold does nothing".
  let dragPressActive = false;

  // Active drag preview wrapper - built on dragstart via `buildDragPreview`,
  // removed on drop/dragend.
  let dragPreview: HTMLElement | null = null;

  // SYNC source position captured in `onDragStart`. Required because PM's
  // internal drop handler clears `view.dragging` BEFORE the `handleDrop`
  // plugin hook fires, AND the plugin-state `draggedFrom` is committed via
  // a deferred `setTimeout(0)` (see comment on the dispatch in `onDragStart`)
  // that may not have run by drop time on very fast drags. Closure scope is
  // independent of both, so reading from here is reliable. Cleared on
  // dragend, so it never lingers across drags.
  let pendingDraggedFrom: number | null = null;

  // Auto-scroll state machine (populated during an active drag, reset by
  // `resetAutoScroll`). Grouped into one object so every reset clears every
  // field - prevents the "I forgot to reset X" class of bug.
  //
  // `lastDragoverAt` is a `performance.now()` timestamp used by the RAF
  // loop as a dead-man switch: if no dragover arrived for `DRAGOVER_SILENCE_MS`,
  // we assume the drag was cancelled (browser ate dragend, OS-level abort)
  // and stop the loop to avoid leaking frames. 1.5s is generous enough to
  // tolerate users holding cursor still mid-drag, tight enough to recover
  // quickly when the browser drops events.
  const DRAGOVER_SILENCE_MS = 1500;
  const autoScrollState: {
    raf: number | null;
    target: HTMLElement | null;
    lastClientY: number | null;
    lastAt: number;
  } = { raf: null, target: null, lastClientY: null, lastAt: 0 };

  const resetAutoScroll = (): void => {
    if (autoScrollState.raf !== null) {
      cancelAnimationFrame(autoScrollState.raf);
    }
    autoScrollState.raf = null;
    autoScrollState.target = null;
    autoScrollState.lastClientY = null;
    autoScrollState.lastAt = 0;
  };

  const clearHideTimer = (): void => {
    if (hideTimer !== null) {
      window.clearTimeout(hideTimer);
      hideTimer = null;
    }
  };

  const hide = (): void => {
    root.removeAttribute('data-show');
    currentHoveredPos = null;
  };

  const scheduleHide = (): void => {
    clearHideTimer();
    hideTimer = window.setTimeout(() => {
      hide();
      hideTimer = null;
    }, hideDelay);
  };

  const show = (blockEl: HTMLElement, blockRect: DOMRect, editorRect: DOMRect): void => {
    // Vertically center the handle on the FIRST LINE of the block, not on
    // the block's top edge. For tall blocks (e.g., H1 with line-height
    // 2.8rem) the top edge sits well above the visible text, leaving the
    // handle floating above the title. Aligning to the first line's
    // center matches Notion's positioning regardless of font size.
    const cs = getComputedStyle(blockEl);
    let lineHeight = parseFloat(cs.lineHeight);
    if (!Number.isFinite(lineHeight)) {
      // `line-height: normal` returns a non-numeric string - fall back to
      // ~1.2× the font size (browser default for `normal`).
      const fontSize = parseFloat(cs.fontSize) || 16;
      lineHeight = fontSize * 1.2;
    }
    const handleHeight = root.offsetHeight || 24;
    const offsetIntoBlock = Math.max(0, (lineHeight - handleHeight) / 2);
    const top = blockRect.top - editorRect.top + offsetIntoBlock;
    root.style.top = `${String(top)}px`;
    root.setAttribute('data-show', '');
  };

  const updateHoverState = (view: EditorView, pos: number | null): void => {
    const current = pluginKey.getState(view.state)?.hoveredPos ?? null;
    if (current === pos) return;
    view.dispatch(view.state.tr.setMeta(pluginKey, { hoveredPos: pos }));
  };

  const setDraggedFrom = (view: EditorView, pos: number | null): void => {
    view.dispatch(view.state.tr.setMeta(pluginKey, { draggedFrom: pos }));
  };

  // mousemove is the single hottest event on the editor - high-refresh
  // pointers fire it at 240+Hz. Running `posAtCoords` + `getBoundingClientRect`
  // + `style.top` writes on every tick causes visible wobble because each
  // layout read forces sync layout and each write flips the visibility of
  // the handle one frame at a time. Coalescing to one rAF per frame and
  // gating reposition on ProseMirror-position identity eliminates both.
  const onMouseMove = (event: MouseEvent): void => {
    if (!editorEl) return;
    // Freeze the handle in place while the user is pressing the drag
    // button. Moving it here would slide the button out from under the
    // cursor before the browser decides the interaction is a drag.
    if (dragPressActive) return;
    pendingHoverCoords = { x: event.clientX, y: event.clientY };
    if (hoverRaf !== null) return;
    hoverRaf = requestAnimationFrame(() => {
      hoverRaf = null;
      const coords = pendingHoverCoords;
      pendingHoverCoords = null;
      if (!coords || !editorEl) return;
      const resolved = resolveBlockAtCoords(editor.view, coords.x, coords.y, nested);
      if (!resolved) {
        scheduleHide();
        return;
      }
      clearHideTimer();
      // `updateHoverState` is a no-op when PM plugin state already matches
      // - keep it unconditional so that if a prior docChanged transaction
      // cleared `state.hoveredPos` (forward-assoc mapping can still miss
      // the edge cases around setNodeMarkup), the next hover tick
      // re-asserts it. Skipping this led to "click on drag handle does
      // nothing" after a color-swatch change, since the subsequent click
      // would bail with `hoveredPos === null`.
      updateHoverState(editor.view, resolved.pos);
      // Identity gate for the visual reposition only: don't rewrite
      // style.top + data-show if the cursor is still over the same block.
      // That's where the measurable smoothness win lives.
      if (resolved.pos === currentHoveredPos && root.hasAttribute('data-show')) {
        return;
      }
      currentHoveredPos = resolved.pos;
      const editorRect = editorEl.getBoundingClientRect();
      show(resolved.dom, resolved.rect, editorRect);
    });
  };

  const onMouseLeave = (): void => {
    scheduleHide();
  };

  const onMouseEnter = (): void => {
    clearHideTimer();
  };

  const onDismissOverlays = (): void => {
    hide();
    updateHoverState(editor.view, null);
  };

  // --- Plus button: dismiss other overlays, insert empty paragraph
  // after the hovered block, focus, then EXPLICITLY trigger the
  // FloatingMenu. Order matters:
  //
  //   1. Dispatch `dm:dismiss-overlays` FIRST - closes BubbleMenu /
  //      ContextMenu / SlashCommand and any opt-in FloatingMenu that's
  //      already open elsewhere. We do this before flipping our own
  //      explicit-trigger flag so the dismissal can't accidentally
  //      clear it.
  //   2. Insert the paragraph + move the caret + focus.
  //   3. Call `showFloatingMenu(view)` - required for FloatingMenu
  //      instances configured with `requireExplicitTrigger: true`
  //      (Notion-style; no auto-show on plain Enter). Default instances
  //      ignore the meta and auto-show on the empty paragraph anyway.
  const onPlusClick = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    if (!editor.isEditable) return;
    const state = pluginKey.getState(editor.view.state);
    const pos = state?.hoveredPos ?? null;
    if (pos === null) return;
    const node = editor.view.state.doc.nodeAt(pos);
    if (!node) return;

    const paragraphType = editor.view.state.schema.nodes['paragraph'];
    if (!paragraphType) return;

    // (1) Close anything else that might be open.
    editorEl?.dispatchEvent(new Event('dm:dismiss-overlays', { bubbles: false }));

    // (2) Insert the new paragraph + park the caret inside it.
    const blockEnd = pos + node.nodeSize;
    const tr = editor.view.state.tr;
    tr.insert(blockEnd, paragraphType.create());
    const sel = TextSelection.near(tr.doc.resolve(blockEnd + 1));
    tr.setSelection(sel);
    editor.view.dispatch(tr.scrollIntoView());
    editor.view.focus();

    // (3) Mark this insert as an explicit "user wants the menu" gesture.
    showFloatingMenu(editor.view);
  };

  // Plus button: keep editor focus during click so the FloatingMenu that
  // auto-appears after insert can read the correct state. `preventDefault`
  // on mousedown stops the button from grabbing focus.
  //
  // Drag button: must NOT call `preventDefault` on mousedown - for a
  // `draggable="true"` element, the browser requires the default mousedown
  // action to initiate a drag. Cancelling it silently kills drag-to-reorder
  // in Chrome/Safari. Focus is restored explicitly after context-menu
  // actions via `editor.view.focus()`.
  const onPlusBtnMouseDown = (event: MouseEvent): void => {
    event.preventDefault();
  };

  // Lock the handle in place from mousedown through dragend (or mouseup
  // without drag). Prevents the rAF hover loop from repositioning the
  // handle out from under the cursor during the click-vs-drag window.
  //
  // Mouseup is attached lazily as a one-shot ONLY for the click-without-
  // drag path: the user pressed the drag button but never crossed the
  // browser's drag-init threshold. The dragend path calls `releaseDragPress`
  // directly. Keeping the listener attached for the editor's lifetime
  // (the previous design) leaked a global handler that fired on every
  // click anywhere in the document.
  const onDragBtnMouseDown = (): void => {
    dragPressActive = true;
    document.addEventListener('mouseup', releaseDragPress, { once: true });
  };
  const releaseDragPress = (): void => {
    dragPressActive = false;
    // Defensive: dragend may fire BEFORE mouseup (the common drag-success
    // path). Remove the once-listener so the next stray mouseup anywhere
    // in the page doesn't fire into an already-released lock.
    document.removeEventListener('mouseup', releaseDragPress);
  };

  // --- Drag handle: click opens context menu, drag reorders the block.
  //
  // Browser semantics we rely on: when `draggable="true"` and the user
  // presses and releases without moving more than ~3px (browser threshold),
  // a `click` event fires and no `dragstart` is dispatched. Conversely, if
  // the user moves past that threshold, `dragstart` fires and `click` does
  // NOT. This gives us a free, reliable click-vs-drag split - no custom
  // threshold tracking needed.

  const onDragBtnClick = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    if (!editor.isEditable) return;
    const state = pluginKey.getState(editor.view.state);
    const pos = state?.hoveredPos ?? null;
    if (pos === null) return;
    // Dispatch custom event for BlockContextMenu plugin to pick up. Using
    // a CustomEvent with detail preserves both the source block and the
    // anchor element for positioning.
    editorEl?.dispatchEvent(new CustomEvent('dm:block-context-menu-open', {
      bubbles: false,
      detail: { blockPos: pos, anchorElement: dragBtn },
    }));
  };

  // --- Auto-scroll during drag.
  //
  // A single RAF loop runs for the whole drag. Each frame reads the last
  // known dragover Y and, if it's within `autoScrollThreshold` of the top
  // or bottom edge of the scrollable target, nudges scroll by a ramped
  // speed (linear from 0 at the threshold to `autoScrollMaxSpeed` at the
  // edge). The loop self-terminates if dragover has been silent for longer
  // than `DRAGOVER_SILENCE_MS` - a cheap failsafe against the browser
  // skipping the `dragend` event (it happens on some OS/browser combos).

  const onDocumentDragover = (event: DragEvent): void => {
    autoScrollState.lastClientY = event.clientY;
    autoScrollState.lastAt = performance.now();
    const inZone = isCursorOverDropZone(event.clientX, event.clientY);
    // CRITICAL: when the cursor is in our drop zone (incl. the gutter
    // outside `.ProseMirror`'s padding box), we MUST call preventDefault
    // on dragover. Without it, the browser refuses to fire the subsequent
    // `drop` event on non-PM targets (notion-page, body, etc.) - the
    // user's release becomes a silent no-op. With it, drop fires on
    // whatever element is under the cursor; bubbles up to our document
    // drop listener, which performs the move.
    if (inZone) event.preventDefault();
    if (dropIndicator) {
      if (!inZone) {
        indicator.removeAttribute('data-show');
        return;
      }
      updateDropIndicator(event.clientX, event.clientY);
    }
  };

  /**
   * Document-level drop listener. Catches drops that happened OUTSIDE
   * `.ProseMirror` (handle gutter, notion-page padding) but INSIDE our
   * indicator zone - places where the user just saw a "drop will land
   * here" line and reasonably expects the release to take effect.
   *
   * Bubbles after PM's own handler (registered on `view.dom`); when PM
   * handled the drop already we see `event.defaultPrevented === true`
   * and bail to avoid double-processing. When PM didn't see the drop
   * (cursor was in the gutter, target is `.notion-page` or similar)
   * `defaultPrevented` is false and we run the same drop logic ourselves.
   */
  const onDocumentDrop = (event: DragEvent): void => {
    if (event.defaultPrevented) return;
    const view = editor.view;
    const dragging = asDragView(view).dragging;
    if (!dragging) return;
    if (!isCursorOverDropZone(event.clientX, event.clientY)) return;
    if (performBlockDrop(event.clientX, event.clientY)) {
      event.preventDefault();
    }
  };

  /**
   * Shared drop logic - runs from both PM's `handleDrop` (when cursor
   * is over `.ProseMirror`) and our document-level drop listener (when
   * cursor is in the gutter/margin area but still inside the indicator
   * zone). Returns `true` when a move was dispatched, so callers can
   * decide whether to `preventDefault()` on the source event.
   */
  const performBlockDrop = (clientX: number, clientY: number): boolean => {
    const view = editor.view;
    const state = pluginKey.getState(view.state);
    // Read the source position with a tiered fallback:
    // 1. Plugin state `draggedFrom` - the canonical source. Set via the
    //    deferred dispatch in `onDragStart` (Chrome microtask-window
    //    workaround) so it MAY still be null on very fast drags where
    //    drop fires before the timer has run.
    // 2. Closure-scoped `pendingDraggedFrom` - set SYNCHRONOUSLY in
    //    `onDragStart`. Independent of both the deferred dispatch AND of
    //    PM's `view.dragging`, which PM's internal drop handler clears
    //    BEFORE invoking the plugin `handleDrop` hook (so reading
    //    `view.dragging.node.from` here would already see null).
    // 3. `view.dragging.node.from` - last-ditch resort for callers that
    //    might fire `drop` directly without ever invoking our
    //    `onDragStart` (synthetic e2e events bypass the handle).
    const draggedFrom = state?.draggedFrom
      ?? pendingDraggedFrom
      ?? asDragView(view).dragging?.node?.from
      ?? null;
    if (draggedFrom === null) return false;
    const sourceNode = view.state.doc.nodeAt(draggedFrom);
    if (!sourceNode) return false;
    const placement = computeDropPlacement(view, clientX, clientY, nested, nestThreshold);
    if (!placement) return false;
    const tr = view.state.tr;

    if (
      placement.mode === 'nested'
      && placement.targetItemPos !== undefined
      && placement.wrapperPos !== undefined
    ) {
      // Drop-indent path: append source as the last child of the target
      // list item via `insertAsListItemChild`. On schema reject the
      // helper leaves `tr` untouched and returns false; we fall back to
      // the sibling-style move so the user's drag still produces a
      // sensible result.
      const ok = moveBlockAsNestedChild(tr, draggedFrom, placement.wrapperPos, placement.targetItemPos);
      if (ok) {
        view.dispatch(tr.scrollIntoView());
        return true;
      }
    }

    const targetNode = view.state.doc.nodeAt(placement.pos);
    const targetEnd = targetNode ? placement.pos + targetNode.nodeSize : placement.pos;
    const targetPos = placement.insertAfter ? targetEnd : placement.pos;
    moveBlock(tr, draggedFrom, targetPos);
    view.dispatch(tr.scrollIntoView());
    return true;
  };

  /**
   * Defines the rectangle in which a drop on the editor will succeed.
   * Equals `.dm-editor`'s bounding box extended by `DROP_ZONE_TOL_LEFT`
   * on the left (gutter where the BlockHandle visually sits) and
   * `DROP_ZONE_TOL` on every other edge. See the constant declarations
   * at the top of the file for rationale.
   */
  const isCursorOverDropZone = (clientX: number, clientY: number): boolean => {
    if (!editorEl) return false;
    const rect = editorEl.getBoundingClientRect();
    return clientX >= rect.left - DROP_ZONE_TOL_LEFT
      && clientX <= rect.right + DROP_ZONE_TOL
      && clientY >= rect.top - DROP_ZONE_TOL
      && clientY <= rect.bottom + DROP_ZONE_TOL;
  };

  /**
   * Reposition the drop-indicator line at the same target `handleDrop`
   * would land at for these coordinates. Called from the document-level
   * `dragover` listener while a drag is in progress.
   *
   * Hides the indicator when the resolver finds nothing (e.g. cursor
   * outside the editor's content range during a no-op drag-out).
   *
   * Two visual modes:
   *
   *  - **Sibling** - solid line at the rect's top OR bottom edge
   *    (decided by `insertAfter`), spanning the full block width. The
   *    line lives in the gap BETWEEN sibling blocks.
   *  - **Nested** - dashed line at the rect's BOTTOM edge, indented to
   *    where children render (matching `--dm-block-children-indent`,
   *    nominally 24px). Communicates "this drop becomes a nested
   *    child appended at the end" - the destination Phase 5 will
   *    actually produce via `insertAsListItemChild`.
   *
   * The `data-mode` attribute carries the placement mode so theme CSS
   * can swap solid for dashed via `&[data-mode='nested']`.
   */
  const updateDropIndicator = (clientX: number, clientY: number): void => {
    if (!editorEl) return;
    const placement = computeDropPlacement(editor.view, clientX, clientY, nested, nestThreshold);
    if (!placement) {
      indicator.removeAttribute('data-show');
      return;
    }
    const editorRect = editorEl.getBoundingClientRect();

    let lineY: number;
    let left: number;
    let width: number;
    if (placement.mode === 'nested') {
      // Indicator sits AT the bottom of the target list item, indented
      // to the children-zone start. `NESTED_INDICATOR_INDENT_PX` mirrors
      // the default `--dm-block-children-indent` CSS variable (1.5rem ≈
      // 24px); custom themes that override the variable can override
      // the indicator indent through the same CSS hook (see theme).
      const indent = NESTED_INDICATOR_INDENT_PX;
      lineY = placement.rect.bottom - editorRect.top;
      left = placement.rect.left - editorRect.left + indent;
      width = Math.max(0, placement.rect.width - indent);
    } else {
      // Sibling line: ABOVE rect when inserting before, BELOW when
      // inserting after. Spans the full resolved block width.
      lineY = (placement.insertAfter ? placement.rect.bottom : placement.rect.top) - editorRect.top;
      left = placement.rect.left - editorRect.left;
      width = placement.rect.width;
    }
    indicator.style.top = `${String(lineY)}px`;
    indicator.style.left = `${String(left)}px`;
    indicator.style.width = `${String(width)}px`;
    indicator.setAttribute('data-show', '');
    indicator.setAttribute('data-mode', placement.mode);
  };

  const stopAutoScroll = (): void => {
    resetAutoScroll();
  };

  const hideDropIndicator = (): void => {
    indicator.removeAttribute('data-show');
  };

  let dragoverAttached = false;
  /** Register document-level dragover + drop listeners for the active
   * drag. Shared by auto-scroll AND drop-indicator AND the
   * gutter-area drop handling so they stay in lockstep without
   * double-listening. */
  const startDragListeners = (): void => {
    if (dragoverAttached) return;
    document.addEventListener('dragover', onDocumentDragover);
    document.addEventListener('drop', onDocumentDrop);
    dragoverAttached = true;
  };
  const stopDragListeners = (): void => {
    if (!dragoverAttached) return;
    document.removeEventListener('dragover', onDocumentDragover);
    document.removeEventListener('drop', onDocumentDrop);
    dragoverAttached = false;
  };

  const autoScrollTick = (): void => {
    const target = autoScrollState.target;
    if (target === null) {
      autoScrollState.raf = null;
      return;
    }
    // Dead-man switch: if the browser stopped sending dragover events, the
    // drag is effectively over (some OS/browser combos eat `dragend`).
    // Tear down the same things `onDragEnd` would so we don't leak the
    // document-level listeners or leave a stale drop indicator visible.
    if (autoScrollState.lastAt > 0 && performance.now() - autoScrollState.lastAt > DRAGOVER_SILENCE_MS) {
      stopAutoScroll();
      stopDragListeners();
      hideDropIndicator();
      return;
    }
    if (autoScrollState.lastClientY !== null) {
      // `findScrollableAncestor` only returns bounded elements now, so we
      // measure against the scrollable rect directly. Page-level scroll
      // is handled by the browser's own drag-edge autoscroll (running
      // both would double-scroll and visibly jank).
      const rect = target.getBoundingClientRect();
      const distFromTop = autoScrollState.lastClientY - rect.top;
      const distFromBottom = rect.bottom - autoScrollState.lastClientY;
      let delta = 0;
      if (distFromTop < autoScrollThreshold && distFromTop >= 0) {
        // Ramp: at the edge (dist=0) speed is maxSpeed; at threshold speed is 0.
        delta = -Math.round(autoScrollMaxSpeed * (1 - distFromTop / autoScrollThreshold));
      } else if (distFromBottom < autoScrollThreshold && distFromBottom >= 0) {
        delta = Math.round(autoScrollMaxSpeed * (1 - distFromBottom / autoScrollThreshold));
      }
      if (delta !== 0) {
        target.scrollBy(0, delta);
      }
    }
    autoScrollState.raf = requestAnimationFrame(autoScrollTick);
  };

  const startAutoScroll = (): void => {
    if (!autoScroll) return;
    if (!editorEl) return;
    const target = findScrollableAncestor(editorEl);
    if (!target) return;
    autoScrollState.target = target;
    autoScrollState.lastClientY = null;
    autoScrollState.lastAt = performance.now();
    autoScrollState.raf = requestAnimationFrame(autoScrollTick);
  };

  const onDragStart = (event: DragEvent): void => {
    if (disableDrag || !editor.isEditable) {
      event.preventDefault();
      return;
    }
    const state = pluginKey.getState(editor.view.state);
    const pos = state?.hoveredPos ?? null;
    if (pos === null) {
      event.preventDefault();
      return;
    }
    // Capture source pos SYNCHRONOUSLY for `performBlockDrop`, which needs
    // it before the deferred plugin-state commit (setTimeout(0) below) and
    // works even after PM has cleared `view.dragging` in its drop handler.
    pendingDraggedFrom = pos;
    const node = editor.view.state.doc.nodeAt(pos);
    if (!node) {
      event.preventDefault();
      return;
    }

    const sourceEnd = pos + node.nodeSize;
    const slice = editor.view.state.doc.slice(pos, sourceEnd);
    const nodeSelection = NodeSelection.create(editor.view.state.doc, pos);

    // Set the drag preview BEFORE any PM dispatch: the browser only honours
    // `setDragImage` during the initial dragstart tick. If we dispatch a
    // transaction first, PM re-renders and the nodeDOM we captured may be
    // replaced before we set the image.
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      // `text/plain` fallback - Firefox cancels the drag if no data is set.
      event.dataTransfer.setData('text/plain', node.textContent);
      const dom = editor.view.nodeDOM(pos);
      if (dom instanceof HTMLElement) {
        // Build a styled, off-screen clone as the drag preview. Passing
        // the live DOM to setDragImage captures ambient transforms, clip,
        // and scroll offsets from ancestors - the clone is always crisp.
        dragPreview = buildDragPreview(dom);
        event.dataTransfer.setDragImage(dragPreview, 10, 10);
      }
    }

    // Inform ProseMirror that a drag is in progress. Including `node` is
    // critical: PM's built-in drop handler deletes the source using this
    // NodeSelection rather than the current view selection, which may
    // shift unexpectedly mid-drag. Without it, the block occasionally
    // survives the drop (the classic "phantom source" bug).
    //
    // This assignment is sync-only and doesn't mutate the DOM; it's safe
    // to do inside the dragstart tick.
    asDragView(editor.view).dragging = {
      slice,
      move: true,
      node: nodeSelection,
    };

    // CRITICAL - do not move this work back into the sync dragstart tick.
    //
    // Chrome's HTML5 drag machinery commits the drag in the microtask
    // immediately after the `dragstart` handler returns. If the drag
    // source's DOM mutates in any way between dragstart and that commit,
    // Chrome aborts the drag and fires `dragend` INSTANTLY - the user
    // sees "click and hold does absolutely nothing" (crbug/168544,
    // react-dnd #1085).
    //
    // Concrete failure we observed: dispatching
    // `setSelection(NodeSelection) + setMeta(draggedFrom)` synchronously
    // caused PM to add the `.ProseMirror-selectednode` class to the
    // dragged block's DOM. That class mutation was enough for Chrome
    // to kill the drag before a single `drag` or `dragover` event fired.
    //
    // Deferring to `setTimeout(..., 0)` runs after the browser has
    // already committed; the subsequent mutations are safe.
    //
    // Skip the dispatch entirely if the drag has already ended by the
    // time this fires - happens on extremely fast drags where dragstart
    // → drop → dragend all complete in a single JS task before the timer
    // gets a chance to run. `onDragEnd` clears `pendingDraggedFrom` to
    // null, so we use that as the "is drag still alive?" signal. Without
    // this guard, the post-drag dispatch would attempt to apply a stale
    // `nodeSelection` against a doc whose positions changed during the
    // already-completed drop - PM throws "Selection passed to
    // setSelection must point at the current document".
    window.setTimeout(() => {
      if (pendingDraggedFrom === null) return;
      editor.view.dispatch(
        editor.view.state.tr
          .setSelection(nodeSelection)
          .setMeta(pluginKey, { draggedFrom: pos }),
      );
      editorEl?.dispatchEvent(new Event('dm:dismiss-overlays', { bubbles: false }));
      hide();
    }, 0);

    // Begin tracking dragover Y and ramping scroll as the cursor nears
    // viewport edges. No-op when `autoScroll: false` or no scroll ancestor.
    startAutoScroll();
    // The shared document-level dragover listener powers BOTH auto-scroll
    // and the drop-indicator. Attached once per drag, removed in dragend.
    startDragListeners();
  };

  const teardownDragPreview = (): void => {
    if (dragPreview) {
      dragPreview.remove();
      dragPreview = null;
    }
  };

  const onDragEnd = (): void => {
    asDragView(editor.view).dragging = null;
    setDraggedFrom(editor.view, null);
    pendingDraggedFrom = null;
    stopAutoScroll();
    stopDragListeners();
    hideDropIndicator();
    teardownDragPreview();
    releaseDragPress();
  };

  return new Plugin<BlockHandlePluginState>({
    key: pluginKey,

    state: {
      init: (): BlockHandlePluginState => ({ hoveredPos: null, draggedFrom: null }),
      apply(tr, prev): BlockHandlePluginState {
        const meta = tr.getMeta(pluginKey) as Partial<BlockHandlePluginState> | undefined;
        let next = prev;
        if (meta) {
          if ('hoveredPos' in meta) {
            next = { ...next, hoveredPos: meta.hoveredPos ?? null };
          }
          if ('draggedFrom' in meta) {
            next = { ...next, draggedFrom: meta.draggedFrom ?? null };
          }
        }
        // Map positions through doc changes so collaborative / programmatic
        // transactions that happen while hovering or dragging don't leave
        // us pointing at the wrong block. Use assoc=1 (forward bias) so
        // `setNodeMarkup` on the hovered block - which replaces the node
        // with the same type but new attrs - does NOT treat the left
        // boundary as deleted. Without the forward bias, BlockColor's
        // swatch click would wipe `hoveredPos`, causing the next click
        // on the handle to bail silently.
        if (tr.docChanged) {
          if (next.hoveredPos !== null) {
            const mapped = tr.mapping.mapResult(next.hoveredPos, 1);
            next = { ...next, hoveredPos: mapped.deleted ? null : mapped.pos };
          }
          if (next.draggedFrom !== null) {
            const mapped = tr.mapping.mapResult(next.draggedFrom, 1);
            next = { ...next, draggedFrom: mapped.deleted ? null : mapped.pos };
          }
        }
        return next;
      },
    },

    props: {
      // Custom drop handler - gives Notion-like "above-mid → insert before,
      // below-mid → insert after" block-level semantics instead of PM's
      // default `posAtCoords + dropPoint` which for short paragraphs
      // rounds to an arbitrary neighbour boundary and surprises users.
      // The `moveBlock` helper handles the delete+insert + position
      // adjustment so the block keeps its attrs (UniqueID, colors) and
      // the doc ends up in a predictable state.
      handleDrop(_view, event, _slice, moved): boolean {
        if (!moved) return false;
        // Delegates to the shared `performBlockDrop`, which is also used
        // by the document-level drop listener so the same move logic runs
        // whether the drop fired on `.ProseMirror` (this path) or on
        // surrounding chrome inside our indicator zone (doc listener).
        if (performBlockDrop(event.clientX, event.clientY)) {
          event.preventDefault();
          return true;
        }
        // Source node missing, no resolved placement - still consume
        // the event so PM doesn't fall back to its default drop logic.
        event.preventDefault();
        return true;
      },
    },

    view: (editorView) => {
      editorEl = editorView.dom.closest('.dm-editor');
      if (!editorEl) {
        // No `.dm-editor` container → plugin inert.
        return { destroy: () => { /* noop */ } };
      }

      editorEl.classList.add('dm-editor--has-block-handle');
      editorEl.appendChild(root);
      if (dropIndicator) {
        editorEl.appendChild(indicator);
      }
      hide();
      hideDropIndicator();

      // Hover detection lives on `.dm-editor`'s parent (typically the page
      // wrapper, e.g. `.notion-page`'s framework-host child) so the listener
      // also catches mouse movement in the side gutter - the area where the
      // BlockHandle visually lives when the editor is centered narrower than
      // the page. `resolveBlockAtCoords` falls back to a Y-range walk when
      // the cursor's X is outside `.ProseMirror`, so the block under the
      // cursor still resolves correctly.
      hoverEl = editorEl.parentElement ?? editorEl;
      hoverEl.addEventListener('mousemove', onMouseMove);
      hoverEl.addEventListener('mouseleave', onMouseLeave);
      hoverEl.addEventListener('mouseenter', onMouseEnter);
      editorEl.addEventListener('dm:dismiss-overlays', onDismissOverlays);

      plusBtn.addEventListener('mousedown', onPlusBtnMouseDown);
      plusBtn.addEventListener('click', onPlusClick);
      // dragBtn mousedown is a no-preventDefault listener - we rely on
      // the browser's native drag initiation (`draggable="true"`) and
      // only use mousedown to set a hover-freeze lock so the handle
      // doesn't slide away before the drag threshold is crossed.
      dragBtn.addEventListener('mousedown', onDragBtnMouseDown);
      // (mouseup is attached lazily inside `onDragBtnMouseDown` as a
      // one-shot - see its comment for the click-vs-drag rationale.)
      dragBtn.addEventListener('click', onDragBtnClick);
      dragBtn.addEventListener('dragstart', onDragStart);
      dragBtn.addEventListener('dragend', onDragEnd);

      return {
        destroy: () => {
          clearHideTimer();
          // If the editor is destroyed mid-drag, stop the RAF loop and
          // drop the document-level dragover listener immediately.
          stopAutoScroll();
          stopDragListeners();
          hideDropIndicator();
          indicator.remove();
          teardownDragPreview();
          if (hoverRaf !== null) {
            cancelAnimationFrame(hoverRaf);
            hoverRaf = null;
          }
          hoverEl?.removeEventListener('mousemove', onMouseMove);
          hoverEl?.removeEventListener('mouseleave', onMouseLeave);
          hoverEl?.removeEventListener('mouseenter', onMouseEnter);
          editorEl?.removeEventListener('dm:dismiss-overlays', onDismissOverlays);
          plusBtn.removeEventListener('mousedown', onPlusBtnMouseDown);
          plusBtn.removeEventListener('click', onPlusClick);
          dragBtn.removeEventListener('mousedown', onDragBtnMouseDown);
          document.removeEventListener('mouseup', releaseDragPress);
          dragBtn.removeEventListener('click', onDragBtnClick);
          dragBtn.removeEventListener('dragstart', onDragStart);
          dragBtn.removeEventListener('dragend', onDragEnd);
          editorEl?.classList.remove('dm-editor--has-block-handle');
          root.remove();
          editorEl = null;
          hoverEl = null;
        },
      };
    },
  });
}

export const BlockHandle = Extension.create<BlockHandleOptions>({
  name: 'blockHandle',

  addOptions() {
    return {
      hideDelay: 200,
      disableDrag: false,
      autoScroll: true,
      autoScrollThreshold: 48,
      autoScrollMaxSpeed: 18,
      nested: false,
      dropIndicator: true,
      nestThreshold: DEFAULT_NEST_THRESHOLD,
    };
  },

  addProseMirrorPlugins() {
    const editor = this.editor as Editor | null;
    if (!editor) return [];
    return [
      createBlockHandlePlugin({
        pluginKey: blockHandlePluginKey,
        editor,
        hideDelay: this.options.hideDelay ?? 200,
        disableDrag: this.options.disableDrag ?? false,
        autoScroll: this.options.autoScroll ?? true,
        autoScrollThreshold: this.options.autoScrollThreshold ?? 48,
        autoScrollMaxSpeed: this.options.autoScrollMaxSpeed ?? 18,
        nested: resolveNestedConfig(this.options.nested),
        dropIndicator: this.options.dropIndicator ?? true,
        nestThreshold: this.options.nestThreshold ?? DEFAULT_NEST_THRESHOLD,
      }),
    ];
  },
});

/**
 * Normalises the user-facing `nested` option (boolean | config object)
 * into the resolver-friendly `NestedResolution`:
 *
 * - `false` / `undefined` → top-level-only (mode A).
 * - `true` → default list (list item, task item), Notion-style (mode B).
 * - object → explicit config; defaults fill in for missing fields.
 */
export function resolveNestedConfig(nested: BlockHandleOptions['nested']): NestedResolution {
  if (nested === true) {
    return {
      allowedNodes: [...DEFAULT_NESTED_NODES],
      allowedContainers: [],
      edgeConfig: null,
      rules: [...DEFAULT_DRAG_HANDLE_RULES],
    };
  }
  if (nested && typeof nested === 'object') {
    const allowedNodes = nested.allowedNodes ?? DEFAULT_NESTED_NODES;
    if (allowedNodes.length === 0) {
      return { allowedNodes: [], allowedContainers: [], edgeConfig: null, rules: [] };
    }
    const useDefaults = nested.defaultRules ?? true;
    const rules: DragHandleRule[] = [];
    if (useDefaults) rules.push(...DEFAULT_DRAG_HANDLE_RULES);
    if (nested.rules) rules.push(...nested.rules);
    return {
      allowedNodes: [...allowedNodes],
      allowedContainers: nested.allowedContainers ? [...nested.allowedContainers] : [],
      edgeConfig: normalizeEdgeDetection(nested.promoteOnEdge),
      rules,
    };
  }
  return { allowedNodes: [], allowedContainers: [], edgeConfig: null, rules: [] };
}
