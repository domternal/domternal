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
import { findTopLevelBlock, findDraggableBlock } from './helpers/findTopLevelBlock.js';
import { moveBlock } from './helpers/moveBlock.js';

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
   * - `true` — list items and task items resolve individually.
   * - `{ allowedNodes: [...] }` — custom whitelist of node type names.
   *
   * @default false
   */
  nested?: boolean | { allowedNodes?: string[] };
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
 */
interface PMViewWithDragging {
  dragging: { slice: Slice; move: boolean } | null;
}

export interface CreateBlockHandlePluginOptions {
  pluginKey: PluginKey<BlockHandlePluginState>;
  editor: Editor;
  hideDelay: number;
  disableDrag: boolean;
  autoScroll: boolean;
  autoScrollThreshold: number;
  autoScrollMaxSpeed: number;
  /**
   * If empty, the plugin only resolves top-level blocks (classic mode).
   * If non-empty, these node type names get hover / drag targeting.
   */
  nestedNodes: string[];
}

/**
 * Walks up from `el` to the nearest ancestor that actually scrolls
 * vertically. Returns `document.scrollingElement` (typically `<html>`) when
 * no ancestor qualifies — that's the last-resort scroll target for a full-
 * page editor.
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
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

/**
 * Finds the block under the given client coordinates.
 *
 * When `nestedNodes` is non-empty, the plugin is in "nested mode": uses
 * `posAtCoords` + `findDraggableBlock` to resolve the deepest allowed
 * ancestor (list item, task item, etc.). This lets users drag individual
 * list items instead of always the whole list.
 *
 * When `nestedNodes` is empty, classic behavior: walk doc children and
 * compare Y against each top-level block's DOM rect, with a `posAtCoords`
 * fallback for positions in between blocks.
 */
function resolveBlockAtCoords(
  view: EditorView,
  clientX: number,
  clientY: number,
  nestedNodes: string[],
): { pos: number; rect: DOMRect } | null {
  const doc = view.state.doc;

  // Nested mode — resolve via posAtCoords, then walk ancestors to the
  // deepest allowed draggable. nodeDOM gives us the rect for positioning.
  if (nestedNodes.length > 0) {
    const coord = view.posAtCoords({ left: clientX, top: clientY });
    if (coord) {
      const draggable = findDraggableBlock(doc, coord.pos, nestedNodes);
      if (draggable) {
        const dom = view.nodeDOM(draggable.pos);
        if (dom instanceof HTMLElement) {
          return { pos: draggable.pos, rect: dom.getBoundingClientRect() };
        }
      }
    }
    // Fall through to classic top-level walk if nested lookup missed.
  }

  let offset = 0;
  for (let i = 0; i < doc.childCount; i++) {
    const child = doc.child(i);
    const dom = view.nodeDOM(offset);
    if (dom instanceof HTMLElement) {
      const rect = dom.getBoundingClientRect();
      if (clientY >= rect.top && clientY <= rect.bottom) {
        return { pos: offset, rect };
      }
    }
    offset += child.nodeSize;
  }
  // Fallback: ask ProseMirror for the nearest position and walk up.
  const coord = view.posAtCoords({ left: clientX, top: clientY });
  if (!coord) return null;
  const top = findTopLevelBlock(doc, coord.pos);
  if (!top) return null;
  const dom = view.nodeDOM(top.pos);
  if (!(dom instanceof HTMLElement)) return null;
  return { pos: top.pos, rect: dom.getBoundingClientRect() };
}

/**
 * Creates a standalone BlockHandle ProseMirror plugin. Exported so
 * framework wrappers can build on top without going through the Extension
 * factory.
 */
export function createBlockHandlePlugin(
  options: CreateBlockHandlePluginOptions,
): Plugin<BlockHandlePluginState> {
  const { pluginKey, editor, hideDelay, disableDrag, autoScroll, autoScrollThreshold, autoScrollMaxSpeed, nestedNodes } = options;

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

  let editorEl: HTMLElement | null = null;
  let hideTimer: number | null = null;

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
  };

  const scheduleHide = (): void => {
    clearHideTimer();
    hideTimer = window.setTimeout(() => {
      hide();
      hideTimer = null;
    }, hideDelay);
  };

  const show = (blockRect: DOMRect, editorRect: DOMRect): void => {
    const top = blockRect.top - editorRect.top;
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

  const onMouseMove = (event: MouseEvent): void => {
    if (!editorEl) return;
    const resolved = resolveBlockAtCoords(editor.view, event.clientX, event.clientY, nestedNodes);
    if (!resolved) {
      scheduleHide();
      return;
    }
    clearHideTimer();
    const editorRect = editorEl.getBoundingClientRect();
    show(resolved.rect, editorRect);
    updateHoverState(editor.view, resolved.pos);
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
  };

  const stopAutoScroll = (): void => {
    if (autoScrollRaf !== null) {
      cancelAnimationFrame(autoScrollRaf);
      autoScrollRaf = null;
    }
    autoScrollTarget = null;
    lastDragoverClientY = null;
    lastDragoverAt = 0;
    document.removeEventListener('dragover', onDocumentDragover);
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
      // Use the scroll target's own rect when it's a bounded element; fall
      // back to the viewport for `document.documentElement` / body so the
      // threshold math stays in screen space.
      const isPageScroll = autoScrollTarget === document.documentElement
        || autoScrollTarget === document.body;
      const top = isPageScroll ? 0 : autoScrollTarget.getBoundingClientRect().top;
      const bottom = isPageScroll
        ? window.innerHeight
        : autoScrollTarget.getBoundingClientRect().bottom;
      const distFromTop = lastDragoverClientY - top;
      const distFromBottom = bottom - lastDragoverClientY;
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
    document.addEventListener('dragover', onDocumentDragover);
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

    // Select the whole block as a NodeSelection so ProseMirror knows what
    // is being dragged (important for Dropcursor and drop-target logic).
    editor.view.dispatch(
      editor.view.state.tr.setSelection(
        NodeSelection.create(editor.view.state.doc, pos),
      ),
    );

    // Inform ProseMirror that a drag is in progress. Its built-in handlers
    // (Dropcursor, default drop) read `view.dragging` to decide behaviour.
    (editor.view as unknown as PMViewWithDragging).dragging = { slice, move: true };

    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      // `text/plain` fallback — Firefox cancels the drag if no data is set.
      event.dataTransfer.setData('text/plain', node.textContent);
      const dom = editor.view.nodeDOM(pos);
      if (dom instanceof HTMLElement) {
        event.dataTransfer.setDragImage(dom, 10, 10);
      }
    }

    setDraggedFrom(editor.view, pos);
    // Hide the handle itself during drag — it's being used, not hovered.
    hide();

    // Let other overlays know (close any open menus/popovers).
    editorEl?.dispatchEvent(new Event('dm:dismiss-overlays', { bubbles: false }));

    // Begin tracking dragover Y and ramping scroll as the cursor nears
    // viewport edges. No-op when `autoScroll: false` or no scroll ancestor.
    startAutoScroll();
  };

  const onDragEnd = (): void => {
    (editor.view as unknown as PMViewWithDragging).dragging = null;
    setDraggedFrom(editor.view, null);
    stopAutoScroll();
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
        // us pointing at the wrong block. `mapping.mapResult` reports
        // `deleted: true` when the position falls inside a removed range —
        // in that case we null out the field.
        if (tr.docChanged) {
          if (next.hoveredPos !== null) {
            const mapped = tr.mapping.mapResult(next.hoveredPos);
            next = { ...next, hoveredPos: mapped.deleted ? null : mapped.pos };
          }
          if (next.draggedFrom !== null) {
            const mapped = tr.mapping.mapResult(next.draggedFrom);
            next = { ...next, draggedFrom: mapped.deleted ? null : mapped.pos };
          }
        }
        return next;
      },
    },

    props: {
      handleDrop(view, event, _slice, moved): boolean {
        if (!moved) return false;
        const state = pluginKey.getState(view.state);
        const draggedFrom = state?.draggedFrom ?? null;
        // Not our drag — let PM / other handlers process it.
        if (draggedFrom === null) return false;

        const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (!coords) {
          event.preventDefault();
          return true;
        }

        const sourceNode = view.state.doc.nodeAt(draggedFrom);
        if (!sourceNode) {
          event.preventDefault();
          return true;
        }

        // Resolve drop target. In nested mode, use the same
        // `findDraggableBlock` walk so dropping between list items lands
        // the slice at the correct boundary within the list. In classic
        // mode, fall back to the top-level block. Either way, compare
        // cursor Y against the target's vertical midpoint: above = insert
        // before, below = insert after (matches Dropcursor placement).
        const targetBlock = nestedNodes.length > 0
          ? findDraggableBlock(view.state.doc, coords.pos, nestedNodes)
          : findTopLevelBlock(view.state.doc, coords.pos);
        if (!targetBlock) {
          event.preventDefault();
          return true;
        }

        let targetPos = targetBlock.pos;
        const targetDOM = view.nodeDOM(targetBlock.pos);
        if (targetDOM instanceof HTMLElement) {
          const rect = targetDOM.getBoundingClientRect();
          const midY = rect.top + rect.height / 2;
          if (event.clientY > midY) {
            targetPos = targetBlock.end;
          }
        }

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
      hide();

      editorEl.addEventListener('mousemove', onMouseMove);
      editorEl.addEventListener('mouseleave', onMouseLeave);
      editorEl.addEventListener('mouseenter', onMouseEnter);
      editorEl.addEventListener('dm:dismiss-overlays', onDismissOverlays);

      plusBtn.addEventListener('mousedown', onPlusBtnMouseDown);
      plusBtn.addEventListener('click', onPlusClick);
      // dragBtn: intentionally no mousedown handler — see comment on
      // `onPlusBtnMouseDown`. Click / dragstart / dragend cover the two
      // interactions (context menu vs drag-to-reorder).
      dragBtn.addEventListener('click', onDragBtnClick);
      dragBtn.addEventListener('dragstart', onDragStart);
      dragBtn.addEventListener('dragend', onDragEnd);

      return {
        destroy: () => {
          clearHideTimer();
          // If the editor is destroyed mid-drag, stop the RAF loop and
          // drop the document-level dragover listener immediately.
          stopAutoScroll();
          editorEl?.removeEventListener('mousemove', onMouseMove);
          editorEl?.removeEventListener('mouseleave', onMouseLeave);
          editorEl?.removeEventListener('mouseenter', onMouseEnter);
          editorEl?.removeEventListener('dm:dismiss-overlays', onDismissOverlays);
          plusBtn.removeEventListener('mousedown', onPlusBtnMouseDown);
          plusBtn.removeEventListener('click', onPlusClick);
          dragBtn.removeEventListener('click', onDragBtnClick);
          dragBtn.removeEventListener('dragstart', onDragStart);
          dragBtn.removeEventListener('dragend', onDragEnd);
          editorEl?.classList.remove('dm-editor--has-block-handle');
          root.remove();
          editorEl = null;
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
        nestedNodes: resolveNestedNodes(this.options.nested),
      }),
    ];
  },
});

/**
 * Normalises the user-facing `nested` option (boolean | config object)
 * into the flat `string[]` that the plugin wants internally:
 * - `false` / undefined → empty list (classic top-level-only mode).
 * - `true` → default list (list item, task item).
 * - `{ allowedNodes: [...] }` → explicit list; empty array disables.
 */
function resolveNestedNodes(nested: BlockHandleOptions['nested']): string[] {
  if (nested === true) return DEFAULT_NESTED_NODES;
  if (nested && typeof nested === 'object') {
    return nested.allowedNodes ?? DEFAULT_NESTED_NODES;
  }
  return [];
}
