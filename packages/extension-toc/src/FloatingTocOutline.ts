/**
 * FloatingTocOutline - Phase 1 spike.
 *
 * Mounts a hello-world `<div class="dm-toc-outline">` into the closest
 * non-overflow-hidden ancestor of the editor's view DOM. Verifies the
 * D11 outlineHost strategy from `_planning/notion_toc_1.md`: the panel
 * must live OUTSIDE `.dm-editor` (which has `overflow: hidden` and
 * would clip a right-rail child) and survive HMR cleanly.
 *
 * Phase 4 replaces this with the real implementation (ticks, hover
 * card, click navigation, theme class mirroring, mobile breakpoint).
 */
import { Extension } from '@domternal/core';
import type { EditorView } from '@domternal/pm/view';
import { Plugin, PluginKey } from '@domternal/pm/state';

export const floatingTocOutlinePluginKey = new PluginKey('floatingTocOutline');

const OUTLINE_CLASS = 'dm-toc-outline';

/**
 * Resolve the host element where the outline DOM mounts (D11 from
 * `_planning/notion_toc_1.md`). The outline must live OUTSIDE `.dm-editor`
 * because the editor wrapper has `overflow: hidden` and would clip a
 * right-rail child.
 *
 * Strategy:
 *   1. Find the `.dm-editor` host (the framework wrapper component).
 *   2. From its parent, walk up until we hit an ancestor whose computed
 *      `overflow` is not `hidden` - that's the host.
 *   3. Fall back to `document.body` if nothing matches.
 *
 * Starting from `view.dom.parentElement` is wrong: in the Angular wrapper,
 * `view.dom` (`.ProseMirror`) lives inside an unstyled template `<div>`
 * inside `<domternal-editor.dm-editor>`. That template div is `overflow:
 * visible` and would land us INSIDE the editor.
 */
function resolveOutlineHost(view: EditorView): HTMLElement {
  const editorHost = view.dom.closest<HTMLElement>('.dm-editor');
  let node: HTMLElement | null = (editorHost ?? view.dom).parentElement;
  while (node && node !== document.body) {
    const overflow = window.getComputedStyle(node).overflow;
    if (overflow !== 'hidden') return node;
    node = node.parentElement;
  }
  return document.body;
}

export const FloatingTocOutline = Extension.create({
  name: 'floatingTocOutline',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: floatingTocOutlinePluginKey,
        view(editorView) {
          const host = resolveOutlineHost(editorView);
          // Host needs `position: relative` so our absolute child anchors
          // to it. Capture the original inline value and restore it on
          // destroy to avoid mutating user CSS in a way that survives
          // unmount.
          const previousHostPosition = host.style.position;
          let positionPatched = false;
          if (window.getComputedStyle(host).position === 'static') {
            host.style.position = 'relative';
            positionPatched = true;
          }

          const outline = document.createElement('div');
          outline.className = OUTLINE_CLASS;
          outline.textContent = 'Hello outline (Phase 1 spike)';
          // Inline spike styles - Phase 4 moves these into _toc.scss with
          // proper tokens (--dm-toc-tick-*, etc.). Goal here is just to
          // verify D11 placement: visible in the right gutter, not clipped,
          // scrolls with page.
          Object.assign(outline.style, {
            position: 'absolute',
            top: '50%',
            right: '24px',
            transform: 'translateY(-50%)',
            padding: '8px 12px',
            background: 'rgba(0, 0, 0, 0.75)',
            color: '#fff',
            fontSize: '12px',
            borderRadius: '6px',
            zIndex: '10',
            pointerEvents: 'none',
          });
          host.appendChild(outline);

          return {
            destroy() {
              outline.remove();
              if (positionPatched) {
                host.style.position = previousHostPosition;
              }
            },
          };
        },
      }),
    ];
  },
});
