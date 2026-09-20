/**
 * Node view factory for the math nodes. Renders the `latex` attribute to HTML via
 * the injected renderer. The node view owns its DOM (the renderer writes innerHTML),
 * so all mutations are ignored by ProseMirror. Clicking the node dispatches an edit
 * signal (via `editKey` meta) that opens the editing popover (see MathEditing).
 */
import type { Node as PmNode } from '@domternal/pm/model';
import type { PluginKey } from '@domternal/pm/state';
import type { EditorView } from '@domternal/pm/view';
import type { MathRenderer } from './renderer.js';
import { localizeMessage } from '@domternal/core';
import type { I18nService } from '@domternal/core';
import { mathMessages } from './messages.js';

export interface MathNodeViewConfig {
  /** Renderer to turn LaTeX into HTML. When null, the raw LaTeX is shown. */
  renderer: MathRenderer | null;
  /** Block (display) math when true, inline when false. */
  displayMode: boolean;
  /** Plugin key used to dispatch the "edit this node" signal on click. */
  editKey?: PluginKey;
  /** Editor-local UI translation service. */
  i18n?: I18nService;
}

/** Placeholder shown for an empty (no latex) math node. */
export { MATH_PLACEHOLDER } from './messages.js';

interface MathNodeViewInstance {
  dom: HTMLElement;
  update(updatedNode: PmNode): boolean;
  selectNode(): void;
  deselectNode(): void;
  ignoreMutation(): boolean;
  destroy(): void;
}

export function createMathNodeView(
  config: MathNodeViewConfig,
): (node: PmNode, view: EditorView, getPos: () => number | undefined) => MathNodeViewInstance {
  const { renderer, displayMode, editKey, i18n } = config;

  return (node: PmNode, view: EditorView, getPos: () => number | undefined): MathNodeViewInstance => {
    const typeName = node.type.name;
    const dom = document.createElement(displayMode ? 'div' : 'span');
    dom.className = displayMode ? 'dm-math dm-math-block' : 'dm-math dm-math-inline';

    let currentLatex = (node.attrs['latex'] as string | undefined) ?? '';

    const render = (latex: string): void => {
      dom.classList.remove('dm-math-empty', 'dm-math-error');
      dom.removeAttribute('lang');
      if (!latex) {
        dom.classList.add('dm-math-empty');
        const revision = i18n?.getSnapshot().revision;
        const copy = localizeMessage(i18n, mathMessages.empty);
        if (revision !== i18n?.getSnapshot().revision) { render(currentLatex); return; }
        const text = dom.firstChild;
        if (text?.nodeType === 3 && text === dom.lastChild) {
          if (text.nodeValue !== copy.text) text.nodeValue = copy.text;
        } else {
          dom.textContent = copy.text;
        }
        dom.lang = copy.language;
        return;
      }
      if (!renderer) {
        dom.textContent = latex;
        return;
      }
      try {
        dom.innerHTML = renderer.renderToString(latex, { displayMode });
      } catch {
        dom.classList.add('dm-math-error');
        dom.textContent = latex;
      }
    };

    render(currentLatex);
    const unsubscribeI18n = i18n?.subscribe(() => {
      if (!currentLatex) render(currentLatex);
    });

    if (editKey) {
      dom.addEventListener('click', () => {
        if (!view.editable) return;
        const pos = getPos();
        if (pos === undefined) return;
        view.dispatch(
          view.state.tr.setMeta(editKey, { pos, latex: currentLatex, displayMode }),
        );
      });
    }

    return {
      dom,
      destroy() { unsubscribeI18n?.(); },
      update(updatedNode: PmNode): boolean {
        if (updatedNode.type.name !== typeName) return false;
        currentLatex = (updatedNode.attrs['latex'] as string | undefined) ?? '';
        render(currentLatex);
        return true;
      },
      selectNode(): void {
        dom.classList.add('ProseMirror-selectednode');
      },
      deselectNode(): void {
        dom.classList.remove('ProseMirror-selectednode');
      },
      ignoreMutation(): boolean {
        return true;
      },
    };
  };
}
