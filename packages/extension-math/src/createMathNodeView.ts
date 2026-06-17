/**
 * Node view factory for the math nodes. Renders the `latex` attribute to HTML via
 * the injected renderer. The node view owns its DOM (the renderer writes innerHTML),
 * so all mutations are ignored by ProseMirror. Editing (click to open a popover) is
 * wired in a later step.
 */
import type { Node as PmNode } from '@domternal/pm/model';
import type { MathRenderer } from './renderer.js';

export interface MathNodeViewConfig {
  /** Renderer to turn LaTeX into HTML. When null, the raw LaTeX is shown. */
  renderer: MathRenderer | null;
  /** Block (display) math when true, inline when false. */
  displayMode: boolean;
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
): (node: PmNode) => MathNodeViewInstance {
  const { renderer, displayMode } = config;

  return (node: PmNode): MathNodeViewInstance => {
    const typeName = node.type.name;
    const dom = document.createElement(displayMode ? 'div' : 'span');
    dom.className = displayMode ? 'dm-math dm-math-block' : 'dm-math dm-math-inline';

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

    render((node.attrs['latex'] as string | undefined) ?? '');

    return {
      dom,
      update(updatedNode: PmNode): boolean {
        if (updatedNode.type.name !== typeName) return false;
        render((updatedNode.attrs['latex'] as string | undefined) ?? '');
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
