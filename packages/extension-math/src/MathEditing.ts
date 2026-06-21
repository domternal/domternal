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
import { MATH_INLINE_NAME, MATH_BLOCK_NAME } from './shared.js';

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
    let openedEmpty = false;
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
      openedEmpty = false;
      cleanupFloating?.();
      cleanupFloating = null;
      el.removeAttribute('data-show');
    };

    const apply = (opts?: { refocus?: boolean }): void => {
      const view = currentView;
      const pos = currentPos;
      const latex = textarea.value.trim();
      const refocus = opts?.refocus !== false;
      close();
      if (!view || pos === null) return;
      // The position can be stale after intervening edits, so confirm it still
      // points at a math node before mutating; otherwise we would write a bogus
      // latex attr onto, or delete, an unrelated node.
      const node = pos <= view.state.doc.content.size ? view.state.doc.nodeAt(pos) : null;
      if (!node || (node.type.name !== MATH_INLINE_NAME && node.type.name !== MATH_BLOCK_NAME)) {
        if (refocus) view.focus();
        return;
      }
      if (!latex) {
        view.dispatch(view.state.tr.delete(pos, pos + node.nodeSize));
      } else if (latex !== (node.attrs['latex'] as string | undefined)) {
        view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, latex }));
      }
      if (refocus) view.focus();
    };

    const cancel = (): void => {
      const view = currentView;
      const pos = currentPos;
      const wasEmpty = openedEmpty;
      close();
      // A freshly inserted, still-empty equation that the user cancels out of
      // should not be left behind as a dangling "New equation" atom.
      if (view && pos !== null && wasEmpty && pos <= view.state.doc.content.size) {
        const node = view.state.doc.nodeAt(pos);
        if (
          node &&
          (node.type.name === MATH_INLINE_NAME || node.type.name === MATH_BLOCK_NAME) &&
          !(node.attrs['latex'] as string | undefined)?.trim()
        ) {
          view.dispatch(view.state.tr.delete(pos, pos + node.nodeSize));
        }
      }
      view?.focus();
    };

    const openPopover = (edit: MathEditEvent): void => {
      const view = currentView;
      if (!view) return;
      currentPos = edit.pos;
      currentDisplayMode = edit.displayMode;
      openedEmpty = edit.latex.trim() === '';
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
      // `data-show` flips the popover from visibility:hidden to visible, but a
      // focus() before the browser recalculates style no-ops (the field is still
      // computed-hidden), leaving the caret in the document. Reading offsetHeight
      // forces the style/layout flush now so the field is focusable synchronously;
      // the wrappers' post-command refocus (refocusEditorAfterCommand) then sees
      // focus is already in this popover and yields instead of stealing it back.
      void el.offsetHeight;
      textarea.focus();
      textarea.select();
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
      const target = e.target as globalThis.Node;
      if (el.contains(target)) return;
      // Only pull focus back into the editor when the click landed inside it; a
      // click on an element outside the editor keeps its own focus.
      const insideEditor = currentView ? currentView.dom.contains(target) : false;
      apply({ refocus: insideEditor });
    };

    const onFocusOut = (e: FocusEvent): void => {
      if (!isOpen) return;
      const next = e.relatedTarget as globalThis.Node | null;
      if (next && el.contains(next)) return; // focus stayed within the popover
      // Focus left the popover (e.g. Tab out): apply, honoring the "blur applies"
      // contract, without yanking focus back into the editor.
      apply({ refocus: false });
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
          el.addEventListener('focusout', onFocusOut);
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
              el.removeEventListener('focusout', onFocusOut);
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
