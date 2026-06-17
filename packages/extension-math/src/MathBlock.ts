/**
 * Block (display) LaTeX math node (atom). The LaTeX source lives in the `latex`
 * attribute (serialized as `data-latex`); the visual math is produced by the node
 * view via the injected renderer (added in a later step).
 */
import { Node } from '@domternal/core';
import { MATH_BLOCK_NAME } from './shared.js';
import type { MathOptions } from './shared.js';
import { createMathNodeView } from './createMathNodeView.js';

export type MathBlockOptions = MathOptions;

export const MathBlock = Node.create<MathOptions>({
  name: MATH_BLOCK_NAME,
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() {
    return {
      renderer: null,
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      latex: {
        default: '',
        parseHTML: (element: HTMLElement): string => element.getAttribute('data-latex') ?? '',
        renderHTML: (attributes: Record<string, unknown>): Record<string, string> => {
          const latex = (attributes['latex'] as string | undefined) ?? '';
          return latex ? { 'data-latex': latex } : {};
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="math-block"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      {
        ...this.options.HTMLAttributes,
        ...HTMLAttributes,
        'data-type': 'math-block',
      },
    ];
  },

  leafText(node) {
    const latex = (node.attrs['latex'] as string | undefined) ?? '';
    return latex ? `$$${latex}$$` : '';
  },

  addNodeView() {
    return createMathNodeView({ renderer: this.options.renderer, displayMode: true });
  },
});
