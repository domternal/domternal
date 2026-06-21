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

export interface MathNodeViewConfig {
  /** Renderer to turn LaTeX into HTML. When null, the raw LaTeX is shown. */
  renderer: MathRenderer | null;
  /** Block (display) math when true, inline when false. */
  displayMode: boolean;
  /** Plugin key used to dispatch the "edit this node" signal on click. */
  editKey?: PluginKey;
}

/** Placeholder shown for an empty (no latex) math node. */
export const MATH_PLACEHOLDER = 'New equation';

interface MathNodeViewInstance {
  dom: HTMLElement;
  update(updatedNode: PmNode): boolean;
  selectNode(): void;
  deselectNode(): void;
  ignoreMutation(): boolean;
}

export function createMathNodeView(
  config: MathNodeViewConfig,
): (node: PmNode, view: EditorView, getPos: () => number | undefined) => MathNodeViewInstance {
  const { renderer, displayMode, editKey } = config;

  return (node: PmNode, view: EditorView, getPos: () => number | undefined): MathNodeViewInstance => {
    const typeName = node.type.name;
    const dom = document.createElement(displayMode ? 'div' : 'span');
    dom.className = displayMode ? 'dm-math dm-math-block' : 'dm-math dm-math-inline';

    let currentLatex = (node.attrs['latex'] as string | undefined) ?? '';

    const render = (latex: string): void => {
      dom.classList.remove('dm-math-empty', 'dm-math-error');
      if (!latex) {
        dom.classList.add('dm-math-empty');
        dom.textContent = MATH_PLACEHOLDER;
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
