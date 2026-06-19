/**
 * Inline LaTeX math node (atom). The LaTeX source lives in the `latex` attribute
 * (serialized as `data-latex`); the visual math is produced by the node view via
 * the injected renderer. Authoring: the `insertMathInline` command, the `$...$`
 * input rule, and slash/toolbar items.
 */
import { Node } from '@domternal/core';
import type { CommandSpec, ToolbarItem, FloatingMenuItem } from '@domternal/core';
import { InputRule } from '@domternal/pm/inputrules';
import { TextSelection } from '@domternal/pm/state';
import type { EditorState } from '@domternal/pm/state';
import { MATH_INLINE_NAME } from './shared.js';
import type { MathOptions } from './shared.js';
import { createMathNodeView } from './createMathNodeView.js';
import { MathEditing, mathEditPluginKey } from './MathEditing.js';

export type MathInlineOptions = MathOptions;

declare module '@domternal/core' {
  interface RawCommands {
    insertMathInline: CommandSpec<[latex?: string]>;
  }
}

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

  addCommands() {
    return {
      insertMathInline:
        (latex = '') =>
        ({ state, tr, dispatch }) => {
          const type = this.nodeType;
          if (!type) return false;
          if (state.selection.$from.parent.type.spec.code) return false;
          if (dispatch) {
            if (!tr.selection.empty) tr.deleteSelection();
            const pos = tr.selection.from;
            tr.insert(pos, type.create({ latex }));
            tr.setSelection(TextSelection.create(tr.doc, pos + 1));
            if (!latex) {
              tr.setMeta(mathEditPluginKey, { pos, latex: '', displayMode: false });
            }
            dispatch(tr);
          }
          return true;
        },
    };
  },

  addInputRules() {
    const type = this.nodeType;
    if (!type) return [];
    return [
      new InputRule(
        /\$([^$\n]+)\$$/,
        (state: EditorState, match: RegExpMatchArray, start: number, end: number) => {
          const latex = match[1];
          if (!latex) return null;
          if (state.selection.$from.parent.type.spec.code) return null;
          const { tr } = state;
          tr.replaceWith(start, end, type.create({ latex }));
          return tr;
        },
      ),
    ];
  },

  addToolbarItems(): ToolbarItem[] {
    return [
      {
        type: 'button',
        name: 'mathInline',
        command: 'insertMathInline',
        icon: 'sigma',
        label: 'Inline equation',
        group: 'insert',
        priority: 45,
      },
    ];
  },

  addFloatingMenuItems(): FloatingMenuItem[] {
    return [
      {
        name: 'mathInline',
        label: 'Inline equation',
        description: 'Insert an inline LaTeX formula',
        icon: 'sigma',
        group: 'Advanced',
        priority: 80,
        keywords: ['math', 'latex', 'equation', 'formula', 'inline'],
        command: 'insertMathInline',
      },
    ];
  },
});
