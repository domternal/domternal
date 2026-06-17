/**
 * Inline LaTeX math node (atom). The LaTeX source lives in the `latex` attribute
 * (serialized as `data-latex`); the visual math is produced by the node view via
 * the injected renderer (added in a later step).
 */
import { Node } from '@domternal/core';
import { MATH_INLINE_NAME } from './shared.js';
import type { MathOptions } from './shared.js';
import { createMathNodeView } from './createMathNodeView.js';
import { MathEditing, mathEditPluginKey } from './MathEditing.js';

export type MathInlineOptions = MathOptions;

export const MathInline = Node.create<MathOptions>({
  name: MATH_INLINE_NAME,
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

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
    return [{ tag: 'span[data-type="math-inline"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      {
        ...this.options.HTMLAttributes,
        ...HTMLAttributes,
        'data-type': 'math-inline',
      },
    ];
  },

  leafText(node) {
    const latex = (node.attrs['latex'] as string | undefined) ?? '';
    return latex ? `$${latex}$` : '';
  },

  addExtensions() {
    return [MathEditing.configure({ renderer: this.options.renderer })];
  },

  addNodeView() {
    return createMathNodeView({
      renderer: this.options.renderer,
      displayMode: false,
      editKey: mathEditPluginKey,
    });
  },
});
