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
 *
 * Phase 3 in this file wires hover + plus button. Phase 3b adds drag
 * (dragstart + drop transaction + click-vs-drag threshold).
 */
import { Extension, defaultIcons } from '@domternal/core';
import type { Editor } from '@domternal/core';
import { NodeSelection, Plugin, PluginKey, TextSelection } from '@domternal/pm/state';
import type { EditorView } from '@domternal/pm/view';
import type { Slice } from '@domternal/pm/model';
import { findTopLevelBlock } from './helpers/findTopLevelBlock.js';
import { moveBlock } from './helpers/moveBlock.js';

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
}

/**
 * Finds the top-level block under the given client coordinates by walking
 * doc children and comparing y against each block DOM's bounding rect.
 * Falls back to `posAtCoords` when no block directly matches (e.g. when
 * the cursor is in padding between blocks).
 */
function resolveBlockAtCoords(
  view: EditorView,
  clientX: number,
  clientY: number,
): { pos: number; rect: DOMRect } | null {
  const doc = view.state.doc;
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
  const { pluginKey, editor, hideDelay, disableDrag } = options;

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
    const resolved = resolveBlockAtCoords(editor.view, event.clientX, event.clientY);
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

  // Prevent mousedown from stealing editor focus before the click fires.
  const onButtonMouseDown = (event: MouseEvent): void => {
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
  };

  const onDragEnd = (): void => {
    (editor.view as unknown as PMViewWithDragging).dragging = null;
    setDraggedFrom(editor.view, null);
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

        // Resolve drop target to a top-level block boundary. Compare the
        // cursor Y against the target block's vertical midpoint: above =
        // insert before, below = insert after. This matches Dropcursor's
        // visual line placement.
        const targetTopLevel = findTopLevelBlock(view.state.doc, coords.pos);
        if (!targetTopLevel) {
          event.preventDefault();
          return true;
        }

        let targetPos = targetTopLevel.pos;
        const targetDOM = view.nodeDOM(targetTopLevel.pos);
        if (targetDOM instanceof HTMLElement) {
          const rect = targetDOM.getBoundingClientRect();
          const midY = rect.top + rect.height / 2;
          if (event.clientY > midY) {
            targetPos = targetTopLevel.end;
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

      plusBtn.addEventListener('mousedown', onButtonMouseDown);
      plusBtn.addEventListener('click', onPlusClick);
      dragBtn.addEventListener('mousedown', onButtonMouseDown);
      dragBtn.addEventListener('click', onDragBtnClick);
      dragBtn.addEventListener('dragstart', onDragStart);
      dragBtn.addEventListener('dragend', onDragEnd);

      return {
        destroy: () => {
          clearHideTimer();
          editorEl?.removeEventListener('mousemove', onMouseMove);
          editorEl?.removeEventListener('mouseleave', onMouseLeave);
          editorEl?.removeEventListener('mouseenter', onMouseEnter);
          editorEl?.removeEventListener('dm:dismiss-overlays', onDismissOverlays);
          plusBtn.removeEventListener('mousedown', onButtonMouseDown);
          plusBtn.removeEventListener('click', onPlusClick);
          dragBtn.removeEventListener('mousedown', onButtonMouseDown);
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
      }),
    ];
  },
});
