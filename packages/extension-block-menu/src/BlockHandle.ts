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
import { buildDragPreview } from './helpers/cloneElement.js';
import { clampToContent } from './helpers/clampCoords.js';
import { normalizeEdgeDetection } from './helpers/edgeDetection.js';
import type { EdgeDetectionConfig, EdgePreset } from './helpers/edgeDetection.js';
import { DEFAULT_DRAG_HANDLE_RULES } from './helpers/defaultRules.js';
import { findBestDragTarget } from './helpers/findBestDragTarget.js';
import type { DragHandleRule } from './helpers/scoring.js';

/** Default list of nodes treated as drag-targetable when `nested: true`. */
export const DEFAULT_NESTED_NODES: string[] = ['listItem', 'taskItem'];

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
   * - `false` — only top-level blocks are hoverable / draggable (default).
   * - `true` — list items and task items resolve individually (Notion behaviour).
   * - object — fine-grained config; see `NestedConfig`.
   *
   * @default false
   */
  nested?: boolean | NestedConfig;
  /**
   * Show a custom drop indicator line during drag-from-handle that
   * mirrors EXACTLY where the drop will land. Replaces the need for
   * `prosemirror-dropcursor` for our drag flow — `dropcursor` uses
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
 * earlier `{ allowedNodes }` literal — every field is optional.
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
   * score is reduced by `strength * depth` — deeper nodes are penalised
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
 * `node` is an undocumented but critical field — when present, PM's drop
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
}

/**
 * Walks up from `el` to the nearest ancestor that actually scrolls
 * vertically. Returns `null` when no bounded scrollable ancestor exists —
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
 *   on the row the cursor is in, regardless of X — that's what the
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
  // Mode A — top-level only (classic). Walk doc children by Y range; X
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

  // Mode C — Tiptap-style scoring with edge promotion.
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
    // Scoring picked nothing — fall through to top-level so the handle
    // still surfaces on the doc's outer block.
    return resolveTopLevelByY(view, clamped.y);
  }

  // Mode B — Notion-style: deepest allowed block at the cursor row.
  // X is intentionally ignored; see `findDeepestBlockAtY` rationale.
  const found = findDeepestBlockAtY(view, clamped.y, nested.allowedNodes);
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
 * which returned `null` when X=0 was outside the editor's content area —
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
 * next block would be processed against the wrapper UL — and PM's
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
 * Computes the FINAL drop placement using the same logic `handleDrop`
 * uses. Returned by both the actual drop handler AND the visual drop
 * indicator so the line draws exactly where the drop will land — no
 * "indicator says one place, item drops elsewhere" mismatch (the classic
 * dropcursor pain point with custom drop handlers).
 *
 * - `rect` is the resolved target block's rect (for drawing the line)
 * - `insertAfter` decides whether the line sits above or below the rect
 *   AND whether the drop pos becomes `pos + nodeSize` or `pos`
 *
 * Returns `null` when the resolver finds no candidate (e.g. empty doc).
 */
function computeDropPlacement(
  view: EditorView,
  clientX: number,
  clientY: number,
  nested: NestedResolution,
): { pos: number; rect: DOMRect; insertAfter: boolean } | null {
  const initial = resolveBlockAtCoords(view, clientX, clientY, nested);
  if (!initial) return null;
  const resolved = adjustDropTargetForListWrapper(view, initial, clientY);
  const rect = resolved.rect;
  const midY = rect.top + rect.height / 2;
  return { pos: resolved.pos, rect, insertAfter: clientY > midY };
}

/**
 * Creates a standalone BlockHandle ProseMirror plugin. Exported so
 * framework wrappers can build on top without going through the Extension
 * factory.
 */
export function createBlockHandlePlugin(
  options: CreateBlockHandlePluginOptions,
): Plugin<BlockHandlePluginState> {
  const { pluginKey, editor, hideDelay, disableDrag, autoScroll, autoScrollThreshold, autoScrollMaxSpeed, nested, dropIndicator } = options;

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

  // Hover-tick state — rAF-coalesced to keep the handle glide-smooth even
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
  // fires — feels like "click and hold does nothing".
  let dragPressActive = false;

  // Active drag preview wrapper — built on dragstart via `buildDragPreview`,
  // removed on drop/dragend.
  let dragPreview: HTMLElement | null = null;

  // Auto-scroll state (populated during an active drag).
  let autoScrollRaf: number | null = null;
  let autoScrollTarget: HTMLElement | null = null;
  let lastDragoverClientY: number | null = null;
  // Timestamp (ms, performance.now) of the most recent dragover event. Used
  // by the RAF loop as a dead-man switch — if no dragover arrived in the
  // last N seconds we assume the drag was cancelled (crashed tab, browser
  // ate the dragend event) and stop the loop to avoid leaking frames.
  // Threshold is generous to tolerate users holding cursor still mid-drag
  // (e.g., while the system pages in content under a slow scroll).
  let lastDragoverAt = 0;
  const DRAGOVER_SILENCE_MS = 3000;

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
      // `line-height: normal` returns a non-numeric string — fall back to
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

  // mousemove is the single hottest event on the editor — high-refresh
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
      // — keep it unconditional so that if a prior docChanged transaction
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

  // --- Plus button: insert paragraph after hovered block, focus, and let
  // FloatingMenu pick up the empty-line state.
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

    const blockEnd = pos + node.nodeSize;
    const tr = editor.view.state.tr;
    tr.insert(blockEnd, paragraphType.create());
    // Place cursor inside the new paragraph (blockEnd + 1 lands after the
    // opening paragraph token).
    const sel = TextSelection.near(tr.doc.resolve(blockEnd + 1));
    tr.setSelection(sel);
    editor.view.dispatch(tr.scrollIntoView());
    editor.view.focus();

    // Let other overlays know something opened; also ensures BubbleMenu /
    // ContextMenu close if they were somehow visible.
    editorEl?.dispatchEvent(new Event('dm:dismiss-overlays', { bubbles: false }));
  };

  // Plus button: keep editor focus during click so the FloatingMenu that
  // auto-appears after insert can read the correct state. `preventDefault`
  // on mousedown stops the button from grabbing focus.
  //
  // Drag button: must NOT call `preventDefault` on mousedown — for a
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
  const onDragBtnMouseDown = (): void => {
    dragPressActive = true;
  };
  const releaseDragPress = (): void => {
    dragPressActive = false;
  };

  // --- Drag handle: click opens context menu, drag reorders the block.
  //
  // Browser semantics we rely on: when `draggable="true"` and the user
  // presses and releases without moving more than ~3px (browser threshold),
  // a `click` event fires and no `dragstart` is dispatched. Conversely, if
  // the user moves past that threshold, `dragstart` fires and `click` does
  // NOT. This gives us a free, reliable click-vs-drag split — no custom
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
  // than `DRAGOVER_SILENCE_MS` — a cheap failsafe against the browser
  // skipping the `dragend` event (it happens on some OS/browser combos).

  const onDocumentDragover = (event: DragEvent): void => {
    lastDragoverClientY = event.clientY;
    lastDragoverAt = performance.now();
    if (dropIndicator) {
      updateDropIndicator(event.clientX, event.clientY);
    }
  };

  /**
   * Reposition the drop-indicator line at the same target `handleDrop`
   * would land at for these coordinates. Called from the document-level
   * `dragover` listener while a drag is in progress.
   *
   * Hides the indicator when the resolver finds nothing (e.g. cursor
   * outside the editor's content range during a no-op drag-out).
   */
  const updateDropIndicator = (clientX: number, clientY: number): void => {
    if (!editorEl) return;
    const placement = computeDropPlacement(editor.view, clientX, clientY, nested);
    if (!placement) {
      indicator.removeAttribute('data-show');
      return;
    }
    const editorRect = editorEl.getBoundingClientRect();
    // Line Y: line sits ABOVE the rect when inserting before, BELOW
    // when inserting after. Both are aligned to the rect's edge so the
    // user sees exactly which boundary is the landing site.
    const lineY = (placement.insertAfter ? placement.rect.bottom : placement.rect.top) - editorRect.top;
    // Line X spans the resolved block's width — gives a strong visual
    // cue for indented blocks (nested list items show a shorter line
    // matching their column, which makes "into list" vs "before next
    // block" outcomes immediately distinguishable).
    const left = placement.rect.left - editorRect.left;
    const width = placement.rect.right - placement.rect.left;
    indicator.style.top = `${String(lineY)}px`;
    indicator.style.left = `${String(left)}px`;
    indicator.style.width = `${String(width)}px`;
    indicator.setAttribute('data-show', '');
  };

  const stopAutoScroll = (): void => {
    if (autoScrollRaf !== null) {
      cancelAnimationFrame(autoScrollRaf);
      autoScrollRaf = null;
    }
    autoScrollTarget = null;
    lastDragoverClientY = null;
    lastDragoverAt = 0;
    // Listener removed by `removeDragoverListener` (called from dragend)
    // — keeping it here too is redundant but harmless; left in case of
    // legacy callers.
    document.removeEventListener('dragover', onDocumentDragover);
  };

  const hideDropIndicator = (): void => {
    indicator.removeAttribute('data-show');
  };

  let dragoverAttached = false;
  /** Register a single document-level dragover listener for the active
   * drag. Shared by auto-scroll AND drop-indicator features so they stay
   * in lockstep without double-listening. */
  const startDragListeners = (): void => {
    if (dragoverAttached) return;
    document.addEventListener('dragover', onDocumentDragover);
    dragoverAttached = true;
  };
  const stopDragListeners = (): void => {
    if (!dragoverAttached) return;
    document.removeEventListener('dragover', onDocumentDragover);
    dragoverAttached = false;
  };

  const autoScrollTick = (): void => {
    if (autoScrollTarget === null) {
      autoScrollRaf = null;
      return;
    }
    // Dead-man switch: if the browser stopped sending dragover events, the
    // drag is effectively over. Bail rather than spinning forever.
    if (lastDragoverAt > 0 && performance.now() - lastDragoverAt > DRAGOVER_SILENCE_MS) {
      stopAutoScroll();
      return;
    }
    if (lastDragoverClientY !== null) {
      // `findScrollableAncestor` only returns bounded elements now, so we
      // measure against the scrollable rect directly. Page-level scroll
      // is handled by the browser's own drag-edge autoscroll (running
      // both would double-scroll and visibly jank).
      const rect = autoScrollTarget.getBoundingClientRect();
      const distFromTop = lastDragoverClientY - rect.top;
      const distFromBottom = rect.bottom - lastDragoverClientY;
      let delta = 0;
      if (distFromTop < autoScrollThreshold && distFromTop >= 0) {
        // Ramp: at the edge (dist=0) speed is maxSpeed; at threshold speed is 0.
        delta = -Math.round(autoScrollMaxSpeed * (1 - distFromTop / autoScrollThreshold));
      } else if (distFromBottom < autoScrollThreshold && distFromBottom >= 0) {
        delta = Math.round(autoScrollMaxSpeed * (1 - distFromBottom / autoScrollThreshold));
      }
      if (delta !== 0) {
        autoScrollTarget.scrollBy(0, delta);
      }
    }
    autoScrollRaf = requestAnimationFrame(autoScrollTick);
  };

  const startAutoScroll = (): void => {
    if (!autoScroll) return;
    if (!editorEl) return;
    autoScrollTarget = findScrollableAncestor(editorEl);
    if (!autoScrollTarget) return;
    lastDragoverClientY = null;
    lastDragoverAt = performance.now();
    autoScrollRaf = requestAnimationFrame(autoScrollTick);
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
      // `text/plain` fallback — Firefox cancels the drag if no data is set.
      event.dataTransfer.setData('text/plain', node.textContent);
      const dom = editor.view.nodeDOM(pos);
      if (dom instanceof HTMLElement) {
        // Build a styled, off-screen clone as the drag preview. Passing
        // the live DOM to setDragImage captures ambient transforms, clip,
        // and scroll offsets from ancestors — the clone is always crisp.
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
    (editor.view as unknown as PMViewWithDragging).dragging = {
      slice,
      move: true,
      node: nodeSelection,
    };

    // CRITICAL — do not move this work back into the sync dragstart tick.
    //
    // Chrome's HTML5 drag machinery commits the drag in the microtask
    // immediately after the `dragstart` handler returns. If the drag
    // source's DOM mutates in any way between dragstart and that commit,
    // Chrome aborts the drag and fires `dragend` INSTANTLY — the user
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
    window.setTimeout(() => {
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
    (editor.view as unknown as PMViewWithDragging).dragging = null;
    setDraggedFrom(editor.view, null);
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
        // `setNodeMarkup` on the hovered block — which replaces the node
        // with the same type but new attrs — does NOT treat the left
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
      // Custom drop handler — gives Notion-like "above-mid → insert before,
      // below-mid → insert after" block-level semantics instead of PM's
      // default `posAtCoords + dropPoint` which for short paragraphs
      // rounds to an arbitrary neighbour boundary and surprises users.
      // The `moveBlock` helper handles the delete+insert + position
      // adjustment so the block keeps its attrs (UniqueID, colors) and
      // the doc ends up in a predictable state.
      handleDrop(view, event, _slice, moved): boolean {
        if (!moved) return false;
        const state = pluginKey.getState(view.state);
        const draggedFrom = state?.draggedFrom ?? null;
        if (draggedFrom === null) return false;

        const sourceNode = view.state.doc.nodeAt(draggedFrom);
        if (!sourceNode) { event.preventDefault(); return true; }

        // Shared placement helper — used by the visual indicator too, so
        // the drop lands EXACTLY where the user saw the line.
        const placement = computeDropPlacement(view, event.clientX, event.clientY, nested);
        if (!placement) { event.preventDefault(); return true; }

        const targetNode = view.state.doc.nodeAt(placement.pos);
        const targetEnd = targetNode ? placement.pos + targetNode.nodeSize : placement.pos;
        const targetPos = placement.insertAfter ? targetEnd : placement.pos;

        event.preventDefault();
        const tr = view.state.tr;
        moveBlock(tr, draggedFrom, targetPos);
        view.dispatch(tr.scrollIntoView());
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
      // also catches mouse movement in the side gutter — the area where the
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
      // dragBtn mousedown is a no-preventDefault listener — we rely on
      // the browser's native drag initiation (`draggable="true"`) and
      // only use mousedown to set a hover-freeze lock so the handle
      // doesn't slide away before the drag threshold is crossed.
      dragBtn.addEventListener('mousedown', onDragBtnMouseDown);
      // Fallback for the click-without-drag case: if the user presses
      // then releases without moving, the browser fires `mouseup` but
      // no `dragend`. Releasing the lock on document mouseup covers
      // both paths (drag ended off-target + plain click).
      document.addEventListener('mouseup', releaseDragPress);
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
