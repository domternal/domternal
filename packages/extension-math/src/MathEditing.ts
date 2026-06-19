/**
 * Math editing popover. A companion extension (auto-included by both math nodes,
 * deduplicated by name) that owns a single shared popover: a LaTeX `<textarea>`
 * with a live preview. Clicking a math node dispatches an edit signal (plugin
 * meta); the plugin opens the popover anchored to that node. Enter (or blur)
 * applies, Escape cancels, an empty value deletes the node.
 */
import { Extension, positionFloating, copyThemeClass } from '@domternal/core';
import { Plugin, PluginKey } from '@domternal/pm/state';
import type { EditorView } from '@domternal/pm/view';
import type { MathRenderer } from './renderer.js';

/** Payload carried by the edit signal (a transaction meta). */
export interface MathEditEvent {
  /** Document position of the math node to edit. */
  pos: number;
  /** Current LaTeX source. */
  latex: string;
  /** Block (display) math when true. */
  displayMode: boolean;
}

interface MathEditPluginState {
  edit: MathEditEvent | null;
}

/** Plugin key used to open the editor for a math node via a transaction meta. */
export const mathEditPluginKey = new PluginKey<MathEditPluginState>('mathEditing');

export interface MathEditingOptions {
  /** Renderer used for the live preview. */
  renderer: MathRenderer | null;
}

export const MathEditing = Extension.create<MathEditingOptions>({
  name: 'mathEditing',

  addOptions() {
    return { renderer: null };
  },

  addProseMirrorPlugins() {
    const renderer = this.options.renderer;

    const el = document.createElement('div');
    el.className = 'dm-math-popover';
    el.setAttribute('data-dm-editor-ui', '');

    const textarea = document.createElement('textarea');
    textarea.className = 'dm-math-popover-input';
    textarea.rows = 2;
    textarea.spellcheck = false;
    textarea.setAttribute('aria-label', 'LaTeX source');

    const preview = document.createElement('div');
    preview.className = 'dm-math-popover-preview';

    el.appendChild(textarea);
    el.appendChild(preview);

    let currentView: EditorView | null = null;
    let currentPos: number | null = null;
    let currentDisplayMode = false;
    let isOpen = false;
    let cleanupFloating: (() => void) | null = null;

    const renderPreview = (latex: string): void => {
      preview.classList.remove('dm-math-error');
      if (!latex) {
        preview.textContent = '';
        return;
      }
      if (!renderer) {
        preview.textContent = latex;
        return;
      }
      try {
        preview.innerHTML = renderer.renderToString(latex, { displayMode: currentDisplayMode });
      } catch {
        preview.classList.add('dm-math-error');
        preview.textContent = latex;
      }
    };

    const close = (): void => {
      if (!isOpen) return;
      isOpen = false;
      currentPos = null;
      cleanupFloating?.();
      cleanupFloating = null;
      el.removeAttribute('data-show');
    };

    const apply = (): void => {
      const view = currentView;
      const pos = currentPos;
      const latex = textarea.value.trim();
      close();
      if (!view || pos === null) return;
      const node = view.state.doc.nodeAt(pos);
      if (!node) {
        view.focus();
        return;
      }
      if (!latex) {
        view.dispatch(view.state.tr.delete(pos, pos + node.nodeSize));
      } else if (latex !== (node.attrs['latex'] as string | undefined)) {
        view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, latex }));
      }
      view.focus();
    };

    const cancel = (): void => {
      const view = currentView;
      close();
      view?.focus();
    };

    const openPopover = (edit: MathEditEvent): void => {
      const view = currentView;
      if (!view) return;
      currentPos = edit.pos;
      currentDisplayMode = edit.displayMode;
      textarea.value = edit.latex;
      renderPreview(edit.latex);
      el.setAttribute('data-show', '');
      isOpen = true;
      copyThemeClass(view, el);

      const anchor = view.nodeDOM(edit.pos);
      const reference: Element | { getBoundingClientRect: () => DOMRect } =
        anchor instanceof HTMLElement
          ? anchor
          : {
              getBoundingClientRect: (): DOMRect => {
                const coords = view.coordsAtPos(edit.pos);
                return new DOMRect(coords.left, coords.top, 0, coords.bottom - coords.top);
              },
            };
      cleanupFloating?.();
      cleanupFloating = positionFloating(reference, el, {
        placement: 'bottom-start',
        offsetValue: 6,
      });
      textarea.focus();
    };

    const onInput = (): void => {
      renderPreview(textarea.value);
    };

    const onKeydown = (e: KeyboardEvent): void => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        apply();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
    };

    const onClickOutside = (e: MouseEvent): void => {
      if (!isOpen) return;
      if (el.contains(e.target as globalThis.Node)) return;
      apply();
    };

    let lastEdit: MathEditEvent | null = null;

    return [
      new Plugin<MathEditPluginState>({
        key: mathEditPluginKey,
        state: {
          init: (): MathEditPluginState => ({ edit: null }),
          apply: (tr, prev): MathEditPluginState => {
            const meta = tr.getMeta(mathEditPluginKey) as MathEditEvent | undefined;
            return meta ? { edit: meta } : prev;
          },
        },
        view(editorView) {
          currentView = editorView;
          document.body.appendChild(el);
          textarea.addEventListener('input', onInput);
          textarea.addEventListener('keydown', onKeydown);
          document.addEventListener('mousedown', onClickOutside);

          return {
            update(view): void {
              currentView = view;
              const edit = mathEditPluginKey.getState(view.state)?.edit ?? null;
              if (edit && edit !== lastEdit) {
                lastEdit = edit;
                openPopover(edit);
              } else if (!edit) {
                lastEdit = null;
              }
            },
            destroy(): void {
              close();
              textarea.removeEventListener('input', onInput);
              textarea.removeEventListener('keydown', onKeydown);
              document.removeEventListener('mousedown', onClickOutside);
              el.remove();
              currentView = null;
            },
          };
        },
      }),
    ];
  },
});
