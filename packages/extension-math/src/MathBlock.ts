/**
 * Block (display) LaTeX math node (atom). The LaTeX source lives in the `latex`
 * attribute (serialized as `data-latex`); the visual math is produced by the node
 * view via the injected renderer. Authoring: the `insertMathBlock` command, the
 * `$$` input rule, and slash/toolbar items.
 */
import { Node } from '@domternal/core';
import type { CommandSpec, ToolbarItem, FloatingMenuItem } from '@domternal/core';
import { InputRule } from '@domternal/pm/inputrules';
import type { EditorState } from '@domternal/pm/state';
import { MATH_BLOCK_NAME } from './shared.js';
import type { MathOptions } from './shared.js';
import { createMathNodeView } from './createMathNodeView.js';
import { MathEditing, mathEditPluginKey } from './MathEditing.js';

export type MathBlockOptions = MathOptions;

declare module '@domternal/core' {
  interface RawCommands {
    insertMathBlock: CommandSpec<[latex?: string]>;
  }
}

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

  addExtensions() {
    return [MathEditing.configure({ renderer: this.options.renderer })];
  },

  addNodeView() {
    return createMathNodeView({
      renderer: this.options.renderer,
      displayMode: true,
      editKey: mathEditPluginKey,
    });
  },

  addCommands() {
    return {
      insertMathBlock:
        (latex = '') =>
        ({ state, tr, dispatch }) => {
          const type = this.nodeType;
          if (!type) return false;
          if (dispatch) {
            const { $from } = state.selection;
            const insertPos = $from.depth > 0 ? $from.after($from.depth) : state.selection.to;
            tr.insert(insertPos, type.create({ latex }));
            if (!latex) {
              tr.setMeta(mathEditPluginKey, { pos: insertPos, latex: '', displayMode: true });
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
        /^\$\$$/,
        (state: EditorState, _match: RegExpMatchArray, start: number) => {
          const $start = state.doc.resolve(start);
          if ($start.depth === 0 || $start.parent.type.spec.code) return null;
          const from = $start.before();
          const to = $start.after();
          const { tr } = state;
          tr.replaceWith(from, to, type.create({ latex: '' }));
          tr.setMeta(mathEditPluginKey, { pos: from, latex: '', displayMode: true });
          return tr;
        },
      ),
    ];
  },

  addToolbarItems(): ToolbarItem[] {
    return [
      {
        type: 'button',
        name: 'mathBlock',
        command: 'insertMathBlock',
        icon: 'textSuperscript',
        label: 'Equation',
        group: 'insert',
        priority: 44,
      },
    ];
  },

  addFloatingMenuItems(): FloatingMenuItem[] {
    return [
      {
        name: 'mathBlock',
        label: 'Equation',
        description: 'Insert a block LaTeX formula',
        icon: 'textSuperscript',
        group: 'Advanced',
        priority: 79,
        keywords: ['math', 'latex', 'equation', 'formula', 'block', 'display'],
        command: 'insertMathBlock',
      },
    ];
  },
});
