/**
 * Block (display) LaTeX math node (atom). The LaTeX source lives in the `latex`
 * attribute (serialized as `data-latex`); the visual math is produced by the node
 * view via the injected renderer. Authoring: the `insertMathBlock` command, the
 * `$$` input rule, and slash/toolbar items.
 */
import { Node } from '@domternal/core';
import type { CommandSpec, ToolbarItem, FloatingMenuItem } from '@domternal/core';
import { InputRule } from '@domternal/pm/inputrules';
import { NodeSelection } from '@domternal/pm/state';
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
          const { $from } = state.selection;
          if ($from.parent.type.spec.code) return false;
          if (dispatch) {
            const node = type.create({ latex });
            // On an empty line, replace it with the equation (Notion parity) so no
            // empty paragraph is left behind. Skip the replace when the container
            // requires a leading textblock (a list item is `paragraph block*`): the
            // schema would refit the paragraph back, so insert after it instead.
            const depth = $from.depth;
            const idx = depth > 0 ? $from.index(depth - 1) : 0;
            const onEmptyLine =
              depth > 0 &&
              $from.parent.isTextblock &&
              $from.parent.content.size === 0 &&
              $from.node(depth - 1).canReplaceWith(idx, idx + 1, type);
            let pos: number;
            if (onEmptyLine) {
              pos = $from.before(depth);
              tr.replaceWith(pos, $from.after(depth), node);
            } else {
              pos = depth > 0 ? $from.after(depth) : state.selection.to;
              tr.insert(pos, node);
            }
            if (!latex) {
              tr.setMeta(mathEditPluginKey, { pos, latex: '', displayMode: true });
            }
            dispatch(tr);
          }
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      // Keyboard path to edit a selected equation (WCAG 2.1.1): when the block
      // math atom is node-selected, Enter opens the same edit popover as a click.
      Enter: () => {
        const editor = this.editor;
        const type = this.nodeType;
        if (!editor || !type) return false;
        const { selection } = editor.state;
        if (!(selection instanceof NodeSelection) || selection.node.type !== type) return false;
        const latex = selection.node.attrs['latex'] as string;
        editor.view.dispatch(
          editor.state.tr.setMeta(mathEditPluginKey, { pos: selection.from, latex, displayMode: true }),
        );
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
        icon: 'sigma',
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
        icon: 'sigma',
        group: 'Advanced',
        priority: 79,
        keywords: ['math', 'latex', 'equation', 'formula', 'block', 'display'],
        command: 'insertMathBlock',
      },
    ];
  },
});
