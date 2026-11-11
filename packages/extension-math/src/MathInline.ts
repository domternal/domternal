/**
 * Inline LaTeX math node (atom). The LaTeX source lives in the `latex` attribute
 * (serialized as `data-latex`); the visual math is produced by the node view via
 * the injected renderer. Authoring: the `insertMathInline` command, the `$...$`
 * input rule, and slash/toolbar items.
 */
import { Node, localizeMessage, localizedLabel, coreMessages } from '@domternal/core';
import { mathMessages } from './messages.js';
import type { CommandSpec, ToolbarItem, FloatingMenuItem } from '@domternal/core';
import { InputRule } from '@domternal/pm/inputrules';
import { NodeSelection, TextSelection } from '@domternal/pm/state';
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
      ...(this.editor?.i18n ? { i18n: this.editor.i18n } : {}),
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
          const sel = state.selection;
          // Notion behavior: with text selected and no explicit latex, the
          // selected text becomes the equation source (select "x^2" -> inline math).
          const effectiveLatex = latex || (sel.empty ? '' : state.doc.textBetween(sel.from, sel.to, ''));
          if (dispatch) {
            if (!tr.selection.empty) tr.deleteSelection();
            const pos = tr.selection.from;
            tr.insert(pos, type.create({ latex: effectiveLatex }));
            tr.setSelection(TextSelection.create(tr.doc, pos + 1));
            if (!effectiveLatex) {
              tr.setMeta(mathEditPluginKey, { pos, latex: '', displayMode: false });
            }
            dispatch(tr);
          }
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      // Keyboard path to edit a selected equation (WCAG 2.1.1): when the inline
      // math atom is node-selected, Enter opens the same edit popover as a click.
      Enter: () => {
        const editor = this.editor;
        const type = this.nodeType;
        if (!editor || !type) return false;
        const { selection } = editor.state;
        if (!(selection instanceof NodeSelection) || selection.node.type !== type) return false;
        const latex = selection.node.attrs['latex'] as string;
        editor.view.dispatch(
          editor.state.tr.setMeta(mathEditPluginKey, { pos: selection.from, latex, displayMode: false }),
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
        // The opening dollar is not glued to an ASCII letter or digit ("US$5"),
        // a backslash ("\$") or another dollar ("$$" never opens inline math, as
        // in the Markdown parser). The check is ASCII only, so CJK text written
        // right against an equation still converts. An escaped character such
        // as "\$" stays inside the span, and the span never takes in an inline
        // node, which the input rules read as U+FFFC.
        /(?<![A-Za-z0-9\\$])\$((?:[^$\\\n\ufffc]|\\[^\n\ufffc])+)\$$/,
        (state: EditorState, match: RegExpMatchArray, start: number, end: number) => {
          const latex = match[1];
          if (!latex) return null;
          if (state.selection.$from.parent.type.spec.code) return null;
          // Currency stays text, as in the Markdown parser: no whitespace right
          // inside either dollar ("$5 and $10") and no digit right after the
          // closing one ("$5$20"). A price range reaches its second dollar while
          // the amount after it is still untyped, so a span that starts with a
          // digit and ends in a range mark stays text too ("$10-$20", "$5/$10").
          if (/^\s|\s$/.test(latex)) return null;
          if (/^\d.*[-\u2010\u2011\u2013\u2014\u2212/,~\uff5e\u301c+]$/.test(latex)) return null;
          const after = state.doc.resolve(end).nodeAfter;
          if (after?.isText && /^\d/.test(after.text ?? '')) return null;
          // Inline code is literal text.
          const code = state.schema.marks['code'];
          if (code && state.doc.rangeHasMark(start, end, code)) return null;
          const { tr } = state;
          tr.replaceWith(start, end, type.create({ latex }));
          return tr;
        },
      ),
    ];
  },

  addToolbarItems(): ToolbarItem[] {
    const i18n = this.editor?.i18n;
    const group = localizeMessage(i18n, coreMessages.groupInsert);
    return [
      {
        type: 'button',
        name: 'mathInline',
        command: 'insertMathInline',
        icon: 'radical',
        ...localizedLabel(i18n, mathMessages.inline),
        group: 'insert',
        groupLabel: group.text, groupLabelLanguage: group.language,
        priority: 45,
        // Also surfaced as a selection action in the bubble menu (Notion-style:
        // turn selected text into an equation); see defaultBubbleContexts. Stays
        // in the main toolbar too, so the classic editor keeps an explicit button.
        bubbleMenu: 'text',
      },
    ];
  },

  addFloatingMenuItems(): FloatingMenuItem[] {
    const i18n = this.editor?.i18n;
    const group = localizeMessage(i18n, coreMessages.groupAdvanced);
    const description = localizeMessage(i18n, mathMessages.inlineDescription);
    return [
      {
        name: 'mathInline',
        ...localizedLabel(i18n, mathMessages.inline),
        description: description.text, descriptionLanguage: description.language,
        icon: 'radical',
        group: 'Advanced',
        groupLabel: group.text, groupLabelLanguage: group.language,
        priority: 80,
        keywords: [...(i18n?.getSearchAliases(mathMessages.inline) ?? mathMessages.inline.technicalAliases ?? [])],
        command: 'insertMathInline',
      },
    ];
  },
});
