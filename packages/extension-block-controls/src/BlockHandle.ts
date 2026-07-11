/**
 * BlockHandle Extension
 *
 * Notion-style gutter handle on the left of each top-level block, shown on
 * hover. Two buttons:
 *
 * 1. `⋮⋮` drag handle (click → opens BlockContextMenu, drag → reorder)
 * 2. `+` insert button (inserts an empty paragraph below; FloatingMenu
 *    picks up the empty-line state and auto-shows its insert menu)
 *
 * This plugin owns visibility + drag + context-menu trigger; the menu UI
 * lives in `BlockContextMenu.ts`, which listens for the
 * `dm:block-context-menu-open` event dispatched here.
 *
 * Styles ship via `@domternal/theme` (`_block-handle.scss`). The plugin adds
 * a `dm-editor--has-block-handle` class so the theme can widen `.ProseMirror`
 * padding-left for gutter space inside the `overflow:hidden` wrapper.
 */
import { Extension, defaultIcons } from '@domternal/core';
import type { Editor } from '@domternal/core';
import { NodeSelection, Plugin, PluginKey, TextSelection } from '@domternal/pm/state';
import type { Transaction } from '@domternal/pm/state';
import type { EditorView } from '@domternal/pm/view';
import type { Node, Slice } from '@domternal/pm/model';
import { findDeepestBlockAtY } from './helpers/findTopLevelBlock.js';
import { moveBlock } from './helpers/moveBlock.js';
import { moveBlockAsNestedChild } from './helpers/moveBlockAsNestedChild.js';
import { resolveDropSlot, DROP_SLOT_INDENT_PX } from './helpers/dropSlots.js';
import { createDragGhost } from './helpers/dragGhost.js';
import { clampToContent } from './helpers/clampCoords.js';
import { resolveGutterBias } from './helpers/gutterBias.js';
import type { GutterBiasConfig, GutterBiasPreset } from './helpers/gutterBias.js';
import { DEFAULT_BLOCK_MATCHERS } from './helpers/defaultMatchers.js';
import { resolveDragTarget } from './helpers/resolveDragTarget.js';
import type { BlockMatcher } from './helpers/blockMatcher.js';
import { showFloatingMenu } from './FloatingMenu.js';

/** Default list of nodes treated as drag-targetable when `nested: true`. */
export const DEFAULT_NESTED_NODES: string[] = ['listItem', 'taskItem'];

/**
 * Node types that accept a nested-child drop. When the resolver lands on one
 * and `clientX` exceeds `nestThreshold` from the left edge,
 * `computeDropPlacement` returns `mode: 'nested'`. Other containers (blockquote,
 * codeBlock, details) have their own content rules and stay sibling-only.
 */
const LIST_ITEM_TYPES = new Set(['listItem', 'taskItem']);

/**
 * Default px threshold from a list item's left edge past which a drop commits
 * to nested-child mode. Roughly the bullet/checkbox marker width (~24px) plus a
 * small buffer so the boundary sits just past the marker.
 */
export const DEFAULT_NEST_THRESHOLD = 28;

/** Sticky Y dead-band (px) so a wobble near a nested-list boundary can't flip the resolved target. */
export const DROP_HYSTERESIS_Y_PX = 6;

/** Sticky X dead-band (px) around `nestThreshold` so the sibling<->nested mode doesn't flicker. */
export const DROP_HYSTERESIS_X_PX = 8;

/** Nested-indicator inset from the block's left edge; mirrors `--dm-block-children-indent` (≈24px). */
const NESTED_INDICATOR_INDENT_PX = 24;

/**
 * Drop-zone tolerance in CSS px. The zone extends `DROP_ZONE_TOL_LEFT` past the
 * left edge (so the gutter where the handle sits counts as droppable) and
 * `DROP_ZONE_TOL` on every other edge (subpixel jitter + margins outside
 * `.dm-editor`). Hardcoded so the gate is predictable regardless of wrapper
 * styling; override via `dropIndicator: false` + your own visual.
 */
const DROP_ZONE_TOL_LEFT = 80;
const DROP_ZONE_TOL = 16;

export const blockHandlePluginKey = new PluginKey<BlockHandlePluginState>('blockHandle');

/** Pointer sample handed to a `DropZoneProvider` during a handle drag. */
export interface DropZoneQuery {
  view: EditorView;
  /** Pointer position in client coordinates. */
  clientX: number;
  clientY: number;
  /** Source position of the dragged block (tiered resolution; never null here). */
  draggedFrom: number;
}

/**
 * Claims pointer positions during a handle drag. Return `true` when the
 * position belongs to your zone: BlockHandle then hides its own drop
 * indicator for that frame and treats a release there as a no-op, leaving
 * both the visual and the drop transaction to you. Draw your own indicator
 * and handle the drop in a higher-priority plugin's `handleDrop` (drops on
 * `.ProseMirror`) or a capture-phase document `drop` listener (gutter
 * drops); an unclaimed-by-you release inside a claimed zone does nothing.
 *
 * Called from `dragover` at pointer-sample rate: keep it cheap and pure
 * (geometry math only, no DOM writes, no dispatch).
 *
 * @experimental The shape may still change in a minor release.
 */
export type DropZoneProvider = (query: DropZoneQuery) => boolean;

export interface BlockHandleOptions {
  /**
   * Ms to wait before hiding the handle after the mouse leaves the editor, so
   * users can move onto the handle without it vanishing.
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
   * Auto-scroll the nearest scrollable ancestor when dragging near the
   * top/bottom edge. Disable if the host app manages its own drag scroll.
   * @default true
   */
  autoScroll?: boolean;
  /**
   * Distance in CSS px from the top/bottom edge that triggers auto-scroll.
   * @default 48
   */
  autoScrollThreshold?: number;
  /**
   * Peak scroll speed in CSS px per frame. Ramps linearly from 0 at the
   * threshold to this value at the edge.
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
   * Px threshold from a list item's LEFT edge past which a drop becomes
   * nested-child (dragged block becomes a child of that item) instead of
   * sibling. Mirrors Notion's "drop indented = nested, drop on the marker =
   * sibling" UX. Set to `0` to disable nested-drop (every drop is sibling).
   *
   * X-detection only fires when nested mode is on AND the target is a
   * `listItem`/`taskItem`; other containers stay sibling-only.
   *
   * @default 28
   */
  nestThreshold?: number;
  /**
   * Custom drop indicator that mirrors exactly where a handle-drag lands.
   * Replaces `prosemirror-dropcursor` for handle drags (PM's `posAtCoords` can
   * disagree with our resolver in the gutter / inter-block gap). During a drag
   * the editor gets a `dm-block-handle-dragging` class so the theme can hide
   * the native dropcursor for this drag only; non-handle drags (text selection,
   * file drops) keep it. Set `false` to use the native dropcursor.
   * @default true
   */
  dropIndicator?: boolean;
  /**
   * Extension point for foreign drop zones (e.g. side-of-block zones that
   * create column layouts). Providers are consulted on every handle-drag
   * pointer sample; the first one returning `true` claims that position:
   * the built-in gap indicator hides and a release there is ignored by
   * BlockHandle, so the claiming plugin fully owns indicator and drop.
   * With no providers (default) behavior is unchanged.
   *
   * @experimental
   * @default []
   */
  dropZoneProviders?: DropZoneProvider[];
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
   * "Promote to parent at the gutter": within `threshold` px of a configured
   * edge, a candidate's score drops by `strength * depth`, so a shallower
   * ancestor (e.g. the wrapping list) wins near the boundary.
   *
   * - `false` / `undefined` / `'none'` → deepest match wins.
   * - `true` / `'left'` → defaults: edges `['left','top']`, threshold 12, strength 500.
   * - `'right'` / `'both'` → preset variants.
   * - object → custom config (any field optional, merged over defaults).
   *
   * @default false
   */
  promoteOnEdge?: boolean | GutterBiasPreset | Partial<GutterBiasConfig>;
  /**
   * Append custom block matchers. Default matchers still apply unless
   * `defaultMatchers: false` is also set.
   */
  matchers?: BlockMatcher[];
  /**
   * Set `false` to disable the built-in matchers (firstChildOfListItem,
   * listContainerSkip, tableInternals, inlineNodes). Almost always wanted;
   * opt out only for testing or specialised host editors.
   * @default true
   */
  defaultMatchers?: boolean;
}

export interface BlockHandlePluginState {
  /** Absolute position of the top-level block currently under the cursor, or null. */
  hoveredPos: number | null;
  /**
   * Source position of the block being dragged (set on dragstart, cleared on
   * dragend). `handleDrop` uses it to tell whether the drop came from our handle.
   */
  draggedFrom: number | null;
}

/**
 * Minimal shape for PM's internal `view.dragging`. Assigning it tells PM a drag
 * is in progress and which slice moves; PM's default drop handler reads this.
 *
 * `node` is undocumented but critical: when present, PM's drop handler deletes
 * the old location from this selection instead of `view.state.selection`. The
 * browser can shift the selection mid-drag (e.g. user clicks elsewhere), and
 * without `node` the original block survives the drop. We set it from the
 * `NodeSelection` created on dragstart.
 */
interface PMViewWithDragging {
  dragging: { slice: Slice; move: boolean; node?: NodeSelection } | null;
}

/** Casts `EditorView` to expose PM's internal `dragging` field. */
function asDragView(view: EditorView): PMViewWithDragging {
  return view as unknown as PMViewWithDragging;
}

/**
 * Internal, fully-resolved view of `NestedConfig`: plain arrays + optional edge
 * config so the resolver doesn't interpret presets at hover time.
 */
export interface NestedResolution {
  /** Allowed drag targets. Empty array → top-level-only mode. */
  allowedNodes: string[];
  /** Optional ancestor whitelist; empty array → no restriction. */
  allowedContainers: string[];
  /** Gutter bias config; `null` → deepest match wins. */
  gutterBias: GutterBiasConfig | null;
  /** Effective matcher list (defaults + user, or just user when defaults off). */
  matchers: BlockMatcher[];
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
  /** Foreign drop zones (see `BlockHandleOptions.dropZoneProviders`). */
  dropZoneProviders: DropZoneProvider[];
}

/**
 * Nearest ancestor of `el` that actually scrolls vertically. Returns `null`
 * when none exists, so the caller skips its RAF scroll loop and lets the
 * browser's native drag-edge autoscroll handle the page (running both
 * double-scrolls and janks).
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
 * With allowed nested nodes, "nested mode" resolves the deepest allowed block
 * (list/task item) at the cursor row so users drag individual items, not the
 * whole list:
 *
 * - Mode B (deepest-match, default): spatial Y-walk via `findDeepestBlockAtY`.
 *   `posAtCoords` would resolve to whatever sits at the cursor's X, which in the
 *   gutter is OUTER content (inner items are indented further right). The Y-walk
 *   anchors on the cursor's row regardless of X.
 * - Mode C (gutter-bias ranking): `resolveDragTarget` with gutter bias, where
 *   gutter-X promotes to OUTER by design. Opt in via `promoteOnEdge`.
 *
 * With no allowed nodes (Mode A), classic behaviour: walk doc children by Y.
 */
function resolveBlockAtCoords(
  view: EditorView,
  clientX: number,
  clientY: number,
  nested: NestedResolution,
  incumbentPos: number | null = null,
): { pos: number; rect: DOMRect; dom: HTMLElement } | null {
  // Mode A - top-level only. Walk doc children by Y; X is ignored so the handle
  // still surfaces in the side gutter.
  if (nested.allowedNodes.length === 0) {
    return resolveTopLevelByY(view, clientY);
  }

  // Nested modes: clamp into the editor's content rect so resolution survives
  // cursor-in-gutter and above/below edges (where `posAtCoords` returns null).
  const clamped = clampToContent(view, clientX, clientY);
  if (!clamped) return null;

  // Mode C - gutter-bias ranking.
  if (nested.gutterBias) {
    const target = resolveDragTarget(view, clamped.x, clamped.y, {
      matchers: nested.matchers,
      gutterBias: nested.gutterBias,
      allowedTypes: nested.allowedNodes,
      requiredAncestorTypes: nested.allowedContainers,
    });
    if (target) {
      return { pos: target.pos, rect: target.rect, dom: target.dom };
    }
    // Ranking picked nothing: fall through to top-level so the handle still
    // surfaces on the outer block.
    return resolveTopLevelByY(view, clamped.y);
  }

  // Mode B - deepest allowed block at the cursor row (X ignored).
  // `nested.matchers` is forwarded so rejection logic (e.g. firstChildOfListItem)
  // matches Mode C: hosts adding `paragraph` to allowedNodes get label-paragraph
  // rejection for free.
  const found = findDeepestBlockAtY(view, clamped.y, nested.allowedNodes, nested.matchers, {
    incumbentPos,
    hysteresisBand: DROP_HYSTERESIS_Y_PX,
  });
  if (found) {
    return { pos: found.pos, rect: found.rect, dom: found.dom };
  }
  return resolveTopLevelByY(view, clamped.y);
}

/**
 * Top-level fallback for every mode: walk the doc's direct children and return
 * the one whose vertical range contains `clientY` (X ignored, so it resolves
 * even with the cursor outside the editor's horizontal bounds).
 *
 * When none strictly contains `clientY` (inter-block gap, above first, below
 * last), falls back to the closest top-level block by vertical distance. A prior
 * `posAtCoords({ left: 0, top })` fallback returned `null` when X=0 was outside
 * the content area, silently failing drop-in-gap. Closest-by-Y is robust and
 * matches Notion's "drop sticks to the nearest block" UX.
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


interface ResolvedBlock { pos: number; rect: DOMRect; dom: HTMLElement }

/**
 * Among the direct list-item children of the wrapper at `wrapperPos`, pick the
 * one whose row the cursor is nearest (distance 0 when strictly contained).
 */
function nearestChildItem(
  view: EditorView,
  wrapperPos: number,
  wrapper: Node,
  clientY: number,
): ResolvedBlock | null {
  let childPos = wrapperPos + 1;
  let best: { block: ResolvedBlock; dist: number } | null = null;
  for (let i = 0; i < wrapper.childCount; i++) {
    const child = wrapper.child(i);
    if (LIST_ITEM_TYPES.has(child.type.name)) {
      const dom = view.nodeDOM(childPos);
      if (dom instanceof HTMLElement) {
        const rect = dom.getBoundingClientRect();
        const dist = clientY < rect.top ? rect.top - clientY : clientY > rect.bottom ? clientY - rect.bottom : 0;
        if (best === null || dist < best.dist) best = { block: { pos: childPos, rect, dom }, dist };
      }
    }
    childPos += child.nodeSize;
  }
  return best?.block ?? null;
}

/** The direct nested list-wrapper child of the item at `itemPos`, if any. */
function findNestedListChild(
  view: EditorView,
  itemPos: number,
  item: Node,
): { pos: number; node: Node; rect: DOMRect } | null {
  let childPos = itemPos + 1;
  for (let i = 0; i < item.childCount; i++) {
    const child = item.child(i);
    if (LIST_WRAPPER_TYPE_NAMES.has(child.type.name)) {
      const dom = view.nodeDOM(childPos);
      if (dom instanceof HTMLElement) return { pos: childPos, node: child, rect: dom.getBoundingClientRect() };
      return null;
    }
    childPos += child.nodeSize;
  }
  return null;
}

/**
 * Anchor the handle on the list/task ITEM whose row the cursor is nearest,
 * descending through nesting. `findDeepestBlockAtY` resolves to the containing
 * ANCESTOR when the cursor sits in a gap between sibling items, parking the
 * handle far above; this walks down to the nearest child so it tracks the real
 * row. Stays put when the cursor is on an item's own label row.
 */
export function descendToNearestHoverItem(view: EditorView, resolved: ResolvedBlock, clientY: number): ResolvedBlock {
  let current = resolved;
  for (let guard = 0; guard < 20; guard++) {
    const node = view.state.doc.nodeAt(current.pos);
    if (!node) return current;
    if (LIST_WRAPPER_TYPE_NAMES.has(node.type.name)) {
      const next = nearestChildItem(view, current.pos, node, clientY);
      if (!next || next.pos === current.pos) return current;
      current = next;
      continue;
    }
    if (LIST_ITEM_TYPES.has(node.type.name)) {
      const nested = findNestedListChild(view, current.pos, node);
      // No nested list, or the cursor is on this item's own label row (above
      // the nested list): the item itself is the right anchor.
      if (!nested || clientY < nested.rect.top) return current;
      const next = nearestChildItem(view, nested.pos, nested.node, clientY);
      if (!next || next.pos === current.pos) return current;
      current = next;
      continue;
    }
    return current;
  }
  return current;
}

/** Client-coord gap rect an indicator line draws into. */
interface ChildGapRect {
  top: number;
  bottom: number;
  left: number;
  width: number;
}

/**
 * Resolved drop target, shared by `handleDrop` and `updateDropIndicator` so the
 * indicator draws where the drop lands. `mode` is `'sibling'` (drop via
 * `moveBlock`) or `'nested'` (child of `targetItemPos` inside `wrapperPos`).
 */
export interface DropPlacement {
  /** Position right BEFORE the resolved block (same convention as `nodeAt`). */
  pos: number;
  /** Bounding rect of the resolved block, used to draw the indicator line. */
  rect: DOMRect;
  /** `true` -> drop AFTER the block, `false` -> BEFORE (Y-mid). Ignored when nested. */
  insertAfter: boolean;
  /** Sibling drop vs nested-child drop. */
  mode: 'sibling' | 'nested';
  /** Target list item (nested only). */
  targetItemPos?: number;
  /** Containing list wrapper (nested only). */
  wrapperPos?: number;
  /**
   * Child index a nested drop lands at, in `[1, childCount]` (index 0 is the
   * label; `=== childCount` means append). Picks first/between/last slot.
   */
  childIndex?: number;
  /** Client-coord gap the chosen `childIndex` slot occupies (drives the line). */
  nestedGapRect?: ChildGapRect;
  /**
   * Absolute position to insert AT for a sibling drop (slot model). When set,
   * `handleDrop` uses it directly instead of deriving from `pos`/`insertAfter`.
   */
  insertPos?: number;
  /**
   * Explicit client-coord indicator line `{ top, left, width }` from the slot
   * resolver. When set, `updateDropIndicator` draws it directly instead of
   * deriving geometry from `rect`/`mode`.
   */
  indicatorLine?: { top: number; left: number; width: number };
  /** Resolved gap bounds + depth, fed back next dragover for the dead-bands. */
  gapUpperPos?: number | null;
  gapLowerPos?: number | null;
  depthLevel?: number;
}

/**
 * Per-drag hysteresis state threaded into {@link computeDropPlacement}.
 * Omitted by pure callers (tests) so the resolver stays stateless.
 */
export interface DropPlacementOptions {
  /** Previous dragover's gap upper/lower row, for the Y-gap dead-band. */
  incumbentUpperPos?: number | null;
  incumbentLowerPos?: number | null;
  /** Previous dragover's depth level, for the X-depth dead-band. */
  incumbentLevel?: number | null;
  /** Previous dragover's child slot, for the nested child-slot dead-band. */
  incumbentChildIndex?: number | null;
  /** Enable the dead-bands (off for unit callers, `true` from the plugin). */
  hysteresis?: boolean;
  /**
   * The dragged source's list WRAPPER type (`'bulletList'`/`'orderedList'`/
   * `'taskList'`), or `null` for a non-list block. Drives the sibling indicator
   * column: a drop that splits the list (a non-list block, or a list item of a
   * different kind) draws at the list's parent column; one that joins (same list
   * kind) keeps the item column. Omit for stateless callers. See
   * {@link resolveDropSlot}.
   */
  sourceWrapperName?: string | null;
}

/**
 * Computes the final drop placement, returned by BOTH the drop handler and the
 * indicator so the line draws where the drop lands. `null` when no candidate
 * (e.g. empty doc).
 *
 * Gap-first: {@link resolveDropSlot} picks the nearest gap by Y and the depth
 * available there by X, so the line stays near the cursor. A `nested` option is
 * refined by Y via {@link resolveChildSlot} for the child slot inside the item.
 */
export function computeDropPlacement(
  view: EditorView,
  clientX: number,
  clientY: number,
  nested: NestedResolution,
  nestThreshold: number = DEFAULT_NEST_THRESHOLD,
  options: DropPlacementOptions = {},
): DropPlacement | null {
  const incumbent = options.hysteresis
    ? { upperPos: options.incumbentUpperPos ?? null, lowerPos: options.incumbentLowerPos ?? null, level: options.incumbentLevel ?? null }
    : null;
  const slot = resolveDropSlot({
    view,
    clientX,
    clientY,
    indentStep: nestThreshold > 0 ? nestThreshold : DROP_SLOT_INDENT_PX,
    nestedEnabled: nested.allowedNodes.length > 0,
    offerNest: nestThreshold > 0,
    incumbent,
    bandY: options.hysteresis ? DROP_HYSTERESIS_Y_PX : 0,
    bandX: options.hysteresis ? DROP_HYSTERESIS_X_PX : 0,
    ...(options.sourceWrapperName !== undefined ? { sourceWrapperName: options.sourceWrapperName } : {}),
  });
  if (!slot) return null;
  const opt = slot.option;
  const feedback = {
    gapUpperPos: slot.upperPos,
    gapLowerPos: slot.lowerPos,
    depthLevel: opt.level,
  };

  if (opt.insert.kind === 'nested') {
    const itemPos = opt.insert.targetItemPos;
    const itemNode = view.state.doc.nodeAt(itemPos);
    const itemDom = view.nodeDOM(itemPos);
    const itemRect = itemDom instanceof HTMLElement ? itemDom.getBoundingClientRect() : null;
    // Refine the child slot by cursor Y among the item's children; falls back
    // to the slot's childIndex when no rect.
    let childIndex = opt.insert.childIndex;
    let gapRect: ChildGapRect = { top: slot.gapY, bottom: slot.gapY, left: opt.lineLeft - NESTED_INDICATOR_INDENT_PX, width: opt.lineWidth + NESTED_INDICATOR_INDENT_PX };
    if (itemNode && itemRect) {
      const childBand = options.hysteresis ? DROP_HYSTERESIS_Y_PX : 0;
      const cs = resolveChildSlot(view, itemNode, itemPos, itemRect, clientY, options.incumbentChildIndex ?? null, childBand);
      childIndex = cs.childIndex;
      gapRect = cs.gapRect;
    }
    return {
      pos: itemPos,
      rect: itemRect ?? new DOMRect(opt.lineLeft, slot.gapY, opt.lineWidth, 0),
      insertAfter: false,
      mode: 'nested',
      targetItemPos: itemPos,
      wrapperPos: opt.insert.wrapperPos,
      childIndex,
      nestedGapRect: gapRect,
      indicatorLine: { top: gapRect.top, left: gapRect.left + NESTED_INDICATOR_INDENT_PX, width: Math.max(0, gapRect.width - NESTED_INDICATOR_INDENT_PX) },
      ...feedback,
    };
  }

  const insertPos = opt.insert.pos;
  return {
    pos: insertPos,
    rect: new DOMRect(opt.lineLeft, slot.gapY, opt.lineWidth, 0),
    insertAfter: false,
    mode: 'sibling',
    insertPos,
    indicatorLine: { top: slot.gapY, left: opt.lineLeft, width: opt.lineWidth },
    ...feedback,
  };
}

/**
 * Build the transaction a drop at `placement` would dispatch, given the dragged
 * block at `draggedFrom`. Mirrors `performBlockDrop`'s move logic (nested-child,
 * self-drop bail, sibling fallback, sibling) so both the live drop AND the
 * "would this actually move anything?" probe share ONE source of truth. The
 * returned transaction is left UNCHANGED when the move is a no-op (e.g. the
 * block already sits in this exact slot, or a self-drop), so callers can detect
 * it with `tr.doc.eq(view.state.doc)`.
 */
export function buildDropTr(
  view: EditorView,
  draggedFrom: number,
  sourceNode: Node,
  placement: DropPlacement,
): Transaction {
  const tr = view.state.tr;
  if (
    placement.mode === 'nested'
    && placement.targetItemPos !== undefined
    && placement.wrapperPos !== undefined
  ) {
    const ok = moveBlockAsNestedChild(
      tr,
      draggedFrom,
      placement.wrapperPos,
      placement.targetItemPos,
      placement.childIndex,
    );
    if (ok) return tr;
    // Helper bailed. A SELF-drop (source/target overlap) is a no-op: leave the
    // transaction unchanged. A true schema reject (no overlap) falls through to
    // the sibling move below.
    const targetItem = view.state.doc.nodeAt(placement.targetItemPos);
    const targetItemEnd = targetItem
      ? placement.targetItemPos + targetItem.nodeSize
      : placement.targetItemPos;
    const sourceEnd = draggedFrom + sourceNode.nodeSize;
    const sourceInTarget = draggedFrom >= placement.targetItemPos && draggedFrom < targetItemEnd;
    const targetInSource = placement.targetItemPos >= draggedFrom && placement.targetItemPos < sourceEnd;
    if (sourceInTarget || targetInSource) return tr;
  }

  // Slot model supplies an absolute `insertPos`; legacy callers derive it.
  let targetPos = placement.insertPos;
  if (targetPos === undefined) {
    const targetNode = view.state.doc.nodeAt(placement.pos);
    const targetEnd = targetNode ? placement.pos + targetNode.nodeSize : placement.pos;
    targetPos = placement.insertAfter ? targetEnd : placement.pos;
  }
  moveBlock(tr, draggedFrom, targetPos);
  return tr;
}

interface ChildSlot {
  /** Child-array index to insert at, in `[1, childCount]`. */
  childIndex: number;
  /** Client-coord gap the chosen slot occupies (drives the indicator line). */
  gapRect: ChildGapRect;
}

/**
 * Picks which child slot of a list item the cursor's Y lands in. `childIndex` is
 * `1 + (children whose mid-line is at/above the cursor)`, clamped to
 * `[1, childCount]` (index 0 is the label). `band > 0` keeps
 * `incumbentChildIndex` sticky within `band` px of a boundary. Degrades to
 * append-last when a rect is missing. All gaps share the item's content column.
 */
function resolveChildSlot(
  view: EditorView,
  item: Node,
  itemStart: number,
  itemRect: DOMRect,
  clientY: number,
  incumbentChildIndex: number | null,
  band: number,
): ChildSlot {
  const childCount = item.childCount;
  const gap = (top: number, bottom: number): ChildGapRect => ({
    top,
    bottom,
    left: itemRect.left,
    width: itemRect.width,
  });
  const append: ChildSlot = { childIndex: childCount, gapRect: gap(itemRect.bottom, itemRect.bottom) };

  // Measure each child's rect; `posAtIndex` gives the position before child i.
  const $item = view.state.doc.resolve(itemStart + 1);
  const rects: DOMRect[] = [];
  for (let i = 0; i < childCount; i++) {
    const dom = view.nodeDOM($item.posAtIndex(i, $item.depth));
    if (!(dom instanceof HTMLElement)) return append; // degrade on first missing rect
    rects.push(dom.getBoundingClientRect());
  }

  const label = rects[0];
  if (!label) return append;
  if (childCount === 1) return { childIndex: 1, gapRect: gap(label.bottom, label.bottom) };

  let index = 1;
  for (let i = 1; i < childCount; i++) {
    const r = rects[i];
    if (r && clientY >= (r.top + r.bottom) / 2) index = i + 1;
  }
  index = Math.min(Math.max(index, 1), childCount);

  // Dead-band: keep the incumbent within `band` px of the shared boundary.
  if (
    band > 0 &&
    incumbentChildIndex !== null &&
    incumbentChildIndex >= 1 &&
    incumbentChildIndex <= childCount &&
    Math.abs(index - incumbentChildIndex) === 1
  ) {
    const r = rects[Math.min(index, incumbentChildIndex)];
    if (r && Math.abs(clientY - (r.top + r.bottom) / 2) <= band) index = incumbentChildIndex;
  }

  const above = rects[index - 1];
  const below = index < childCount ? rects[index] : undefined;
  if (!above) return append;
  return { childIndex: index, gapRect: gap(above.bottom, below ? below.top : above.bottom) };
}

/**
 * Creates a standalone BlockHandle PM plugin. Exported so framework wrappers can
 * build on it without the Extension factory.
 */
export function createBlockHandlePlugin(
  options: CreateBlockHandlePluginOptions,
): Plugin<BlockHandlePluginState> {
  const { pluginKey, editor, hideDelay, disableDrag, autoScroll, autoScrollThreshold, autoScrollMaxSpeed, nested, dropIndicator, nestThreshold, dropZoneProviders } = options;

  // --- Build DOM once. Buttons use the shared Phosphor icons.
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

  // --- Drop indicator: thin horizontal line at the resolved drop target during
  // a drag. Built once, hidden by default, appended into `.dm-editor`.
  const indicator = document.createElement('div');
  indicator.className = 'dm-block-drop-indicator';
  indicator.setAttribute('data-dm-editor-ui', '');

  let editorEl: HTMLElement | null = null;
  // Hover-capture element, usually `editorEl.parentElement` so the listener also
  // catches mouse moves in the side gutter where the handle visually sits.
  // Falls back to `editorEl` when there's no parent.
  let hoverEl: HTMLElement | null = null;
  let hideTimer: number | null = null;

  // Hover-tick state, rAF-coalesced so the handle stays smooth even when
  // mousemove fires ~240Hz. One rAF at a time; latest coords win.
  // `currentHoveredPos` is the identity gate: repaint only when the PM position
  // under the cursor changes, not on every micro-move within a block.
  let hoverRaf: number | null = null;
  let pendingHoverCoords: { x: number; y: number } | null = null;
  let currentHoveredPos: number | null = null;
  // Set on drag-button `mousedown`, cleared on `mouseup`/`dragend`. While truthy,
  // hover updates pause so the handle doesn't jump to a neighbour during the
  // browser's click-vs-drag window; otherwise it slides out from under the
  // cursor before `dragstart` fires ("click and hold does nothing").
  let dragPressActive = false;

  // Active drag preview wrapper, built on dragstart, removed on drop/dragend.
  let dragPreview: HTMLElement | null = null;

  // SYNC source position captured in `onDragStart`. Needed because PM clears
  // `view.dragging` BEFORE the `handleDrop` hook fires, AND plugin-state
  // `draggedFrom` is committed via a deferred `setTimeout(0)` (see `onDragStart`)
  // that may not have run by drop time on fast drags. Closure scope is
  // independent of both. Cleared on dragend so it never lingers.
  let pendingDraggedFrom: number | null = null;

  // Drop-indicator drag-session state. Like the hover path: rAF-coalesced,
  // repainted only when the line moves (`currentDropKey`). `dragHyst` carries
  // the previous resolution forward for Y/X/child-slot hysteresis, bundled so
  // every reset is atomic.
  let dropRaf: number | null = null;
  let pendingDropCoords: { x: number; y: number } | null = null;
  let currentDropKey: string | null = null;
  const dragHyst: { upperPos: number | null; lowerPos: number | null; level: number | null; childIndex: number | null } = {
    upperPos: null,
    lowerPos: null,
    level: null,
    childIndex: null,
  };

  const resetDragHyst = (): void => {
    dragHyst.upperPos = null;
    dragHyst.lowerPos = null;
    dragHyst.level = null;
    dragHyst.childIndex = null;
  };

  const resetDropState = (): void => {
    if (dropRaf !== null) {
      cancelAnimationFrame(dropRaf);
      dropRaf = null;
    }
    pendingDropCoords = null;
    currentDropKey = null;
    resetDragHyst();
  };

  // Auto-scroll state machine (populated during a drag, reset by
  // `resetAutoScroll`). One object so every reset clears every field.
  //
  // `lastAt` (`performance.now()`) is a dead-man switch: if no dragover arrives
  // for `DRAGOVER_SILENCE_MS`, assume the drag was cancelled (browser ate
  // dragend, OS abort) and stop the loop. 1.5s tolerates holding still mid-drag
  // yet recovers quickly when events are dropped.
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
    // Context-menu pin: same gate as `onMouseMove`.
    if (editorEl?.hasAttribute('data-block-context-menu-open')) return;
    clearHideTimer();
    hideTimer = window.setTimeout(() => {
      hide();
      hideTimer = null;
    }, hideDelay);
  };

  const show = (blockEl: HTMLElement, blockRect: DOMRect, editorRect: DOMRect): void => {
    // Center the handle on the block's FIRST LINE, not its top edge. For tall
    // blocks (e.g. H1 with line-height 2.8rem) the top edge sits well above the
    // text, leaving the handle floating above the title. First-line center
    // matches Notion regardless of font size.
    const cs = getComputedStyle(blockEl);
    let lineHeight = parseFloat(cs.lineHeight);
    if (!Number.isFinite(lineHeight)) {
      // `line-height: normal` returns a non-numeric string; fall back to ~1.2x
      // the font size (the browser default for `normal`).
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

  // mousemove is the hottest event on the editor (240+Hz on high-refresh
  // pointers). Running `posAtCoords` + `getBoundingClientRect` + `style.top`
  // every tick causes visible wobble (each read forces sync layout). Coalescing
  // to one rAF/frame and gating reposition on PM-position identity fixes both.
  const onMouseMove = (event: MouseEvent): void => {
    if (!editorEl) return;
    // Freeze the handle while the drag button is pressed; moving it would slide
    // the button out from under the cursor before the browser commits to a drag.
    if (dragPressActive) return;
    // Pin to the source block while the BlockContextMenu is open (it's the
    // menu's visual anchor).
    if (editorEl.hasAttribute('data-block-context-menu-open')) return;
    pendingHoverCoords = { x: event.clientX, y: event.clientY };
    if (hoverRaf !== null) return;
    hoverRaf = requestAnimationFrame(() => {
      hoverRaf = null;
      const coords = pendingHoverCoords;
      pendingHoverCoords = null;
      if (!coords || !editorEl) return;
      // Re-check the pin gate: a mousemove queued pre-open can fire after
      // `open()` and otherwise reposition the handle.
      if (editorEl.hasAttribute('data-block-context-menu-open')) return;
      const initial = resolveBlockAtCoords(editor.view, coords.x, coords.y, nested);
      if (!initial) {
        scheduleHide();
        return;
      }
      // Gap hovers resolve to an ancestor; descend to the nearest leaf row.
      const resolved = descendToNearestHoverItem(editor.view, initial, coords.y);
      clearHideTimer();
      // Keep `updateHoverState` unconditional (it's a no-op when state already
      // matches): if a prior docChanged cleared `hoveredPos`, the next tick
      // re-asserts it. Skipping this caused "click on drag handle does nothing"
      // after a color-swatch change, since the next click bailed on null.
      updateHoverState(editor.view, resolved.pos);
      // Identity gate for the visual reposition only: skip style.top + data-show
      // when still over the same block. This is the measurable smoothness win.
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
    // BlockContextMenu fires this while opening to close other overlays; keep
    // the handle visible since it anchors the menu. The attribute is set by
    // `open()` before the dispatch, so its presence means "menu opening".
    if (editorEl?.hasAttribute('data-block-context-menu-open')) return;
    hide();
    updateHoverState(editor.view, null);
  };

  // --- Plus button: insert an empty paragraph after the hovered block, focus,
  // then explicitly trigger the FloatingMenu. Order matters:
  //   1. Dispatch `dm:dismiss-overlays` FIRST to close BubbleMenu / ContextMenu /
  //      SlashCommand / any open FloatingMenu, before our own explicit-trigger
  //      flag so the dismissal can't clear it.
  //   2. Insert the paragraph + move the caret + focus.
  //   3. `showFloatingMenu(view)` - required for instances with
  //      `requireExplicitTrigger: true`; default instances auto-show anyway.
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

    // (1) Close anything else open.
    editorEl?.dispatchEvent(new Event('dm:dismiss-overlays', { bubbles: false }));

    // (2) Insert the paragraph + park the caret inside it.
    const blockEnd = pos + node.nodeSize;
    const tr = editor.view.state.tr;
    tr.insert(blockEnd, paragraphType.create());
    const sel = TextSelection.near(tr.doc.resolve(blockEnd + 1));
    tr.setSelection(sel);
    editor.view.dispatch(tr.scrollIntoView());
    editor.view.focus();

    // (3) Mark this as an explicit "user wants the menu" gesture.
    showFloatingMenu(editor.view);
  };

  // Plus button: `preventDefault` on mousedown keeps editor focus (the button
  // doesn't grab it) so the auto-appearing FloatingMenu reads the right state.
  //
  // Drag button must NOT preventDefault on mousedown: a `draggable="true"`
  // element needs the default mousedown to initiate a drag, and cancelling it
  // silently kills drag-to-reorder in Chrome/Safari. Focus is restored after
  // context-menu actions via `editor.view.focus()`.
  const onPlusBtnMouseDown = (event: MouseEvent): void => {
    event.preventDefault();
  };

  // Lock the handle from mousedown through dragend (or mouseup without drag) so
  // the rAF hover loop can't reposition it during the click-vs-drag window.
  //
  // Mouseup is a lazy one-shot ONLY for the click-without-drag path (button
  // pressed but drag-init threshold never crossed); the dragend path calls
  // `releaseDragPress` directly. A lifetime listener (prior design) leaked a
  // global handler firing on every click in the document.
  const onDragBtnMouseDown = (): void => {
    dragPressActive = true;
    document.addEventListener('mouseup', releaseDragPress, { once: true });
  };
  const releaseDragPress = (): void => {
    dragPressActive = false;
    // dragend may fire BEFORE mouseup (the common drag-success path); remove the
    // once-listener so a later stray mouseup doesn't hit an already-released lock.
    document.removeEventListener('mouseup', releaseDragPress);
  };

  // --- Drag handle: click opens context menu, drag reorders the block.
  // Browser semantics: with `draggable="true"`, press+release under ~3px fires
  // `click` and no `dragstart`; moving past the threshold fires `dragstart` and
  // no `click`. A free, reliable click-vs-drag split, no custom tracking needed.

  const onDragBtnClick = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    if (!editor.isEditable) return;
    const state = pluginKey.getState(editor.view.state);
    const pos = state?.hoveredPos ?? null;
    if (pos === null) return;
    // Notify the BlockContextMenu plugin; the detail carries the source block
    // and the anchor element for positioning.
    editorEl?.dispatchEvent(new CustomEvent('dm:block-context-menu-open', {
      bubbles: false,
      detail: { blockPos: pos, anchorElement: dragBtn },
    }));
  };

  // --- Auto-scroll during drag.
  // One RAF loop runs for the whole drag. Each frame reads the last dragover Y
  // and, when within `autoScrollThreshold` of the target's top/bottom edge,
  // nudges scroll by a ramped speed (0 at the threshold to `autoScrollMaxSpeed`
  // at the edge). Self-terminates after `DRAGOVER_SILENCE_MS` of silence, a
  // failsafe against the browser skipping `dragend` on some OS/browser combos.

  const onDocumentDragover = (event: DragEvent): void => {
    autoScrollState.lastClientY = event.clientY;
    autoScrollState.lastAt = performance.now();
    const inZone = isCursorOverDropZone(event.clientX, event.clientY);
    // CRITICAL: in our drop zone (incl. the gutter outside `.ProseMirror`'s
    // padding box) we MUST preventDefault on dragover, or the browser won't fire
    // `drop` on non-PM targets (notion-page, body) and the release is a silent
    // no-op. With it, drop fires and bubbles to our document drop listener.
    if (inZone) event.preventDefault();
    if (!dropIndicator) return;
    if (!inZone) {
      // Left the zone: hide and drop the hysteresis incumbents so re-entry
      // resolves fresh (no stale nest-latch across a round-trip out).
      if (dropRaf !== null) {
        cancelAnimationFrame(dropRaf);
        dropRaf = null;
      }
      pendingDropCoords = null;
      currentDropKey = null;
      resetDragHyst();
      indicator.removeAttribute('data-show');
      return;
    }
    // Coalesce the repaint to one rAF/frame; preventDefault + auto-scroll above
    // stay synchronous.
    pendingDropCoords = { x: event.clientX, y: event.clientY };
    if (dropRaf !== null) return;
    dropRaf = requestAnimationFrame(() => {
      dropRaf = null;
      const coords = pendingDropCoords;
      pendingDropCoords = null;
      if (coords) updateDropIndicator(coords.x, coords.y);
    });
  };

  /**
   * Document-level drop listener for drops OUTSIDE `.ProseMirror` (handle
   * gutter, notion-page padding) but INSIDE our indicator zone, where the user
   * saw a "drop lands here" line and expects the release to take effect.
   *
   * Bubbles after PM's own handler; if PM already handled it we see
   * `defaultPrevented === true` and bail. Otherwise (cursor in the gutter,
   * target `.notion-page` etc.) we run the same drop logic ourselves.
   */
  const onDocumentDrop = (event: DragEvent): void => {
    if (event.defaultPrevented) return;
    const view = editor.view;
    const dragging = asDragView(view).dragging;
    if (!dragging) return;
    if (!isCursorOverDropZone(event.clientX, event.clientY)) return;
    performBlockDrop(event.clientX, event.clientY);
    // Consume our own drag within the drop zone even when the drop was a no-op,
    // so the browser doesn't run a native default drop for a gutter/margin
    // release. (`performBlockDrop` returns false for a no-op now.)
    event.preventDefault();
  };

  /**
   * `true` when a `dropZoneProviders` entry claims this pointer position.
   * Claimed positions belong entirely to the claiming plugin: the built-in
   * indicator hides and a release is a no-op for BlockHandle. Reads the same
   * tiered drag source as `performBlockDrop` so both sides always agree on
   * whether a handle drag is in flight.
   */
  const zoneClaimed = (clientX: number, clientY: number): boolean => {
    if (dropZoneProviders.length === 0) return false;
    const view = editor.view;
    const draggedFrom = pluginKey.getState(view.state)?.draggedFrom
      ?? pendingDraggedFrom
      ?? asDragView(view).dragging?.node?.from
      ?? null;
    if (draggedFrom === null) return false;
    return dropZoneProviders.some((provider) => provider({ view, clientX, clientY, draggedFrom }));
  };

  /**
   * Shared drop logic, run by both PM's `handleDrop` (cursor over `.ProseMirror`)
   * and our document-level drop listener (cursor in gutter/margin but inside the
   * indicator zone). Returns `true` when a move was dispatched.
   */
  const performBlockDrop = (clientX: number, clientY: number): boolean => {
    // A claimed position is the claiming plugin's responsibility; treat the
    // release as a no-op here (the event still gets consumed by our callers,
    // so PM's default drop cannot corrupt the doc if the claimer declined it).
    if (zoneClaimed(clientX, clientY)) return false;
    const view = editor.view;
    const state = pluginKey.getState(view.state);
    // Tiered source-position fallback:
    // 1. Plugin state `draggedFrom` - canonical, but set via the deferred
    //    dispatch in `onDragStart`, so it MAY be null on fast drops.
    // 2. `pendingDraggedFrom` - set SYNCHRONOUSLY in `onDragStart`, independent
    //    of both the deferred dispatch and `view.dragging` (which PM clears
    //    before the `handleDrop` hook).
    // 3. `view.dragging.node.from` - last resort for callers that fire `drop`
    //    without our `onDragStart` (synthetic e2e events bypass the handle).
    const draggedFrom = state?.draggedFrom
      ?? pendingDraggedFrom
      ?? asDragView(view).dragging?.node?.from
      ?? null;
    if (draggedFrom === null) return false;
    const sourceNode = view.state.doc.nodeAt(draggedFrom);
    if (!sourceNode) return false;
    // Same hysteresis state the indicator last used, so the drop lands on the line.
    const placement = computeDropPlacement(view, clientX, clientY, nested, nestThreshold, {
      incumbentUpperPos: dragHyst.upperPos,
      incumbentLowerPos: dragHyst.lowerPos,
      incumbentLevel: dragHyst.level,
      incumbentChildIndex: dragHyst.childIndex,
      hysteresis: true,
      sourceWrapperName: LIST_ITEM_TYPES.has(sourceNode.type.name)
        ? view.state.doc.resolve(draggedFrom).parent.type.name
        : null,
    });
    if (!placement) return false;
    const tr = buildDropTr(view, draggedFrom, sourceNode, placement);
    // No-op drop (self-drop, or the block already sits in exactly this slot):
    // nothing to dispatch. `handleDrop` still consumes the event, so PM's
    // default drop never runs and the undo stack isn't polluted with a
    // do-nothing entry. The indicator is also suppressed for these slots (see
    // `updateDropIndicator`), so a release here should be rare.
    if (tr.doc.eq(view.state.doc)) return false;
    view.dispatch(tr.scrollIntoView());
    return true;
  };

  /**
   * Rectangle in which a drop succeeds: `.dm-editor`'s box extended by
   * `DROP_ZONE_TOL_LEFT` on the left (gutter) and `DROP_ZONE_TOL` elsewhere.
   * See the constant declarations at the top of the file.
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
   * List WRAPPER type of the dragged block (`'bulletList'`/`'orderedList'`/
   * `'taskList'`), or `null` for a non-list block. Drives source-aware drop
   * geometry: a splitting drop (non-list block, or a different list kind) sits at
   * the list's parent column, a joining one keeps the item column. Reads the same
   * tiered source as `performBlockDrop` so indicator and drop agree.
   */
  const draggedSourceWrapperName = (): string | null => {
    const from = pluginKey.getState(editor.view.state)?.draggedFrom ?? pendingDraggedFrom;
    if (from === null) return null;
    const node = editor.view.state.doc.nodeAt(from);
    if (!node || !LIST_ITEM_TYPES.has(node.type.name)) return null;
    return editor.view.state.doc.resolve(from).parent.type.name;
  };

  /**
   * Reposition the drop-indicator line where `handleDrop` would land; hide it
   * when nothing resolves. `data-mode` lets theme CSS draw a solid sibling line
   * vs a dashed indented nested line.
   */
  const updateDropIndicator = (clientX: number, clientY: number): void => {
    if (!editorEl) return;
    // Foreign zone: the claiming plugin draws its own indicator there.
    if (zoneClaimed(clientX, clientY)) {
      hideDropIndicator();
      return;
    }
    const placement = computeDropPlacement(editor.view, clientX, clientY, nested, nestThreshold, {
      incumbentUpperPos: dragHyst.upperPos,
      incumbentLowerPos: dragHyst.lowerPos,
      incumbentLevel: dragHyst.level,
      incumbentChildIndex: dragHyst.childIndex,
      hysteresis: true,
      sourceWrapperName: draggedSourceWrapperName(),
    });
    if (!placement) {
      indicator.removeAttribute('data-show');
      currentDropKey = null;
      return;
    }
    // Carry forward for the next dragover's hysteresis, even if the repaint is
    // gated below.
    dragHyst.upperPos = placement.gapUpperPos ?? null;
    dragHyst.lowerPos = placement.gapLowerPos ?? null;
    dragHyst.level = placement.depthLevel ?? null;
    dragHyst.childIndex = placement.mode === 'nested' ? placement.childIndex ?? null : null;

    // Suppress the indicator when a release here would NOT move anything: the
    // block already occupies exactly this slot (e.g. a block dragged onto the
    // gap right after its own list, where several outdent options collapse onto
    // its current position), or a self-drop. Drawing a line the drop then
    // silently ignores is misleading; hide it so only real targets light up.
    const indicatorDraggedFrom = pluginKey.getState(editor.view.state)?.draggedFrom ?? pendingDraggedFrom;
    if (indicatorDraggedFrom !== null) {
      const indicatorSource = editor.view.state.doc.nodeAt(indicatorDraggedFrom);
      if (
        indicatorSource
        && buildDropTr(editor.view, indicatorDraggedFrom, indicatorSource, placement).doc.eq(editor.view.state.doc)
      ) {
        indicator.removeAttribute('data-show');
        currentDropKey = null;
        return;
      }
    }

    const editorRect = editorEl.getBoundingClientRect();

    let lineY: number;
    let left: number;
    let width: number;
    if (placement.indicatorLine) {
      // Slot model: the resolver supplies the exact client-coord line.
      lineY = placement.indicatorLine.top - editorRect.top;
      left = placement.indicatorLine.left - editorRect.left;
      width = placement.indicatorLine.width;
    } else if (placement.mode === 'nested') {
      // Anchor on the gap's TOP edge, indented to the children zone (the theme's
      // `translateY` tuck is uniform, so JS owns no CSS-coupled offset). Fall
      // back to the item bottom when `nestedGapRect` is absent.
      const indent = NESTED_INDICATOR_INDENT_PX;
      const gap = placement.nestedGapRect ?? {
        top: placement.rect.bottom,
        left: placement.rect.left,
        width: placement.rect.width,
      };
      lineY = gap.top - editorRect.top;
      left = gap.left - editorRect.left + indent;
      width = Math.max(0, gap.width - indent);
    } else {
      // Sibling line at the rect's top/bottom edge, full width.
      lineY = (placement.insertAfter ? placement.rect.bottom : placement.rect.top) - editorRect.top;
      left = placement.rect.left - editorRect.left;
      width = placement.rect.width;
    }
    // Identity gate: skip DOM writes when the drawn line is unchanged. Keyed on
    // geometry + child slot (so a slot change at the same row still repaints).
    const slotPart = placement.mode === 'nested' ? String(placement.childIndex ?? -1) : 's';
    const key = `${placement.mode}|${slotPart}|${String(Math.round(lineY))}|${String(Math.round(left))}|${String(Math.round(width))}`;
    if (key === currentDropKey && indicator.hasAttribute('data-show')) return;
    currentDropKey = key;

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
    // Drop the identity gate so the next show repaints from scratch.
    currentDropKey = null;
  };

  let dragoverAttached = false;
  /** Register document-level dragover + drop listeners for the drag. Shared by
   * auto-scroll, drop-indicator, and gutter-area drop handling so they stay in
   * lockstep without double-listening. */
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
    // Every teardown path funnels through here, so no stale state leaks.
    resetDropState();
  };

  const autoScrollTick = (): void => {
    const target = autoScrollState.target;
    if (target === null) {
      autoScrollState.raf = null;
      return;
    }
    // Dead-man switch: no dragover events means the drag is effectively over
    // (some OS/browser combos eat `dragend`). Tear down what `onDragEnd` would so
    // we don't leak the document listeners or leave a stale indicator visible.
    if (autoScrollState.lastAt > 0 && performance.now() - autoScrollState.lastAt > DRAGOVER_SILENCE_MS) {
      stopAutoScroll();
      stopDragListeners();
      hideDropIndicator();
      return;
    }
    if (autoScrollState.lastClientY !== null) {
      // `findScrollableAncestor` returns only bounded elements, so we measure
      // against the scrollable rect directly. Page-level scroll is the browser's
      // own drag-edge autoscroll (running both would double-scroll and jank).
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
    // Capture source pos SYNCHRONOUSLY for `performBlockDrop`: it needs the value
    // before the deferred plugin-state commit (setTimeout(0) below) and after PM
    // clears `view.dragging` in its drop handler.
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
    // `setDragImage` during the initial dragstart tick, and a dispatch first
    // re-renders PM, possibly replacing the captured nodeDOM.
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      // `text/plain` fallback: Firefox cancels the drag if no data is set.
      event.dataTransfer.setData('text/plain', node.textContent);
      const dom = editor.view.nodeDOM(pos);
      if (dom instanceof HTMLElement) {
        // Off-screen styled clone as the preview. Passing live DOM to
        // setDragImage captures ancestor transforms/clip/scroll; the clone stays
        // crisp.
        const ghost = createDragGhost(dom);
        dragPreview = ghost.wrapper;
        event.dataTransfer.setDragImage(ghost.wrapper, 10, 10);
      }
    }

    // Tell PM a drag is in progress. `node` is critical: PM's drop handler
    // deletes the source via this NodeSelection rather than the view selection,
    // which can shift mid-drag; without it the block sometimes survives the drop
    // (the "phantom source" bug). Sync-only, no DOM mutation, safe in dragstart.
    asDragView(editor.view).dragging = {
      slice,
      move: true,
      node: nodeSelection,
    };

    // CRITICAL: do NOT move this back into the sync dragstart tick. Chrome
    // commits the drag in the microtask after `dragstart` returns; any DOM
    // mutation of the source between dragstart and that commit aborts the drag
    // and fires `dragend` INSTANTLY ("click and hold does nothing"; crbug/168544,
    // react-dnd #1085). The concrete trigger: a sync `setSelection +
    // setMeta(draggedFrom)` made PM add `.ProseMirror-selectednode`, killing the
    // drag. `setTimeout(0)` runs after the commit, so the mutations are safe.
    //
    // Skip the dispatch if the drag already ended (fast drags where dragstart →
    // drop → dragend run in one JS task before the timer). `onDragEnd` nulls
    // `pendingDraggedFrom`, our "drag still alive?" signal; otherwise the stale
    // `nodeSelection` would hit a changed doc and PM throws "Selection passed to
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

    // Start with clean hysteresis state so the first dragover resolves freely.
    resetDropState();

    // Track dragover Y and ramp scroll near viewport edges (no-op when off).
    startAutoScroll();
    // Shared document-level dragover listener powers both auto-scroll and the
    // drop-indicator. Attached once per drag, removed in dragend.
    startDragListeners();

    // Theme hides native `.prosemirror-dropcursor-*` while this class is set.
    if (dropIndicator) editorEl?.classList.add('dm-block-handle-dragging');
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
    editorEl?.classList.remove('dm-block-handle-dragging');
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
        // Map positions through doc changes so transactions while hovering or
        // dragging don't leave us on the wrong block. assoc=1 (forward bias) so
        // `setNodeMarkup` on the hovered block (same type, new attrs) doesn't
        // treat the left boundary as deleted; without it, BlockColor's swatch
        // click wipes `hoveredPos` and the next handle click bails silently.
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
      // Custom drop handler for Notion-like block semantics (above-mid → insert
      // before, below-mid → after), instead of PM's default `posAtCoords +
      // dropPoint` which rounds short paragraphs to an arbitrary neighbour.
      // `moveBlock` does the delete+insert + position fix so the block keeps its
      // attrs (UniqueID, colors).
      handleDrop(_view, event, _slice, moved): boolean {
        if (!moved) return false;
        // Shared with the document-level drop listener, so the same logic runs
        // whether drop fired on `.ProseMirror` (here) or surrounding chrome.
        if (performBlockDrop(event.clientX, event.clientY)) {
          event.preventDefault();
          return true;
        }
        // No source/placement: still consume the event so PM doesn't fall back
        // to its default drop logic.
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

      // Hover detection lives on `.dm-editor`'s parent (the page wrapper) so the
      // listener also catches movement in the side gutter where the handle sits.
      // `resolveBlockAtCoords` falls back to a Y-range walk when the cursor's X
      // is outside `.ProseMirror`, so the block still resolves.
      hoverEl = editorEl.parentElement ?? editorEl;
      hoverEl.addEventListener('mousemove', onMouseMove);
      hoverEl.addEventListener('mouseleave', onMouseLeave);
      hoverEl.addEventListener('mouseenter', onMouseEnter);
      editorEl.addEventListener('dm:dismiss-overlays', onDismissOverlays);

      plusBtn.addEventListener('mousedown', onPlusBtnMouseDown);
      plusBtn.addEventListener('click', onPlusClick);
      // dragBtn mousedown must NOT preventDefault (native drag init relies on
      // `draggable="true"`); it only sets the hover-freeze lock so the handle
      // doesn't slide away before the drag threshold. (mouseup is attached
      // lazily inside `onDragBtnMouseDown` - see its comment.)
      dragBtn.addEventListener('mousedown', onDragBtnMouseDown);
      dragBtn.addEventListener('click', onDragBtnClick);
      dragBtn.addEventListener('dragstart', onDragStart);
      dragBtn.addEventListener('dragend', onDragEnd);

      return {
        destroy: () => {
          clearHideTimer();
          // If destroyed mid-drag, stop the RAF loop and drop the document-level
          // dragover listener immediately.
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
          editorEl?.classList.remove('dm-block-handle-dragging');
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
      dropZoneProviders: [],
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
        dropZoneProviders: this.options.dropZoneProviders ?? [],
      }),
    ];
  },
});

/**
 * Normalises the user-facing `nested` option into `NestedResolution`:
 *
 * - `false` / `undefined` → top-level-only (mode A).
 * - `true` → default list/task items, Notion-style (mode B).
 * - object → explicit config; defaults fill missing fields.
 */
export function resolveNestedConfig(nested: BlockHandleOptions['nested']): NestedResolution {
  if (nested === true) {
    return {
      allowedNodes: [...DEFAULT_NESTED_NODES],
      allowedContainers: [],
      gutterBias: null,
      matchers: [...DEFAULT_BLOCK_MATCHERS],
    };
  }
  if (nested && typeof nested === 'object') {
    const allowedNodes = nested.allowedNodes ?? DEFAULT_NESTED_NODES;
    if (allowedNodes.length === 0) {
      return { allowedNodes: [], allowedContainers: [], gutterBias: null, matchers: [] };
    }
    const useDefaults = nested.defaultMatchers ?? true;
    const matchers: BlockMatcher[] = [];
    if (useDefaults) matchers.push(...DEFAULT_BLOCK_MATCHERS);
    if (nested.matchers) matchers.push(...nested.matchers);
    return {
      allowedNodes: [...allowedNodes],
      allowedContainers: nested.allowedContainers ? [...nested.allowedContainers] : [],
      gutterBias: resolveGutterBias(nested.promoteOnEdge),
      matchers,
    };
  }
  return { allowedNodes: [], allowedContainers: [], gutterBias: null, matchers: [] };
}
