/**
 * CodeBlock Node
 *
 * Block-level code container with syntax highlighting support.
 * Preserves whitespace and disallows marks.
 *
 * Keyboard shortcuts:
 * - Mod-Alt-C: Toggle code block
 * - Enter (triple): Exit code block when last 2 lines are empty
 * - ArrowDown: Exit code block when cursor is at the end and it's the last block
 */

import { Node } from '../Node.js';
import { textblockTypeInputRule } from '@domternal/pm/inputrules';
import { TextSelection } from '@domternal/pm/state';
import type { CommandSpec } from '../types/Commands.js';
import type { ToolbarItem } from '../types/Toolbar.js';

declare module '../types/Commands.js' {
  interface RawCommands {
    setCodeBlock: CommandSpec<[attributes?: { language?: string }]>;
    toggleCodeBlock: CommandSpec<[attributes?: { language?: string }]>;
  }
}

export interface CodeBlockOptions {
  languageClassPrefix: string;
  HTMLAttributes: Record<string, unknown>;
  exitOnTripleEnter: boolean;
}

export const CodeBlock = Node.create<CodeBlockOptions>({
  name: 'codeBlock',
  group: 'block',
  content: 'text*',
  marks: '',
  code: true,
  defining: true,

  addOptions() {
    return {
      languageClassPrefix: 'language-',
      HTMLAttributes: {},
      exitOnTripleEnter: true,
    };
  },

  addAttributes() {
    const { options } = this;
    return {
      language: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const codeEl = element.querySelector('code');
          if (!codeEl) return null;

          const prefix = options.languageClassPrefix;

          // Find class starting with language prefix
          const classes = codeEl.className.split(/\s+/);
          for (const cls of classes) {
            if (cls.startsWith(prefix)) {
              return cls.slice(prefix.length) || null;
            }
          }
          return null;
        },
        renderHTML: () => {
          // Language is rendered on the code element, not pre
          return {};
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'pre',
        preserveWhitespace: 'full' as const,
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const language = node.attrs['language'] as string | null;

    const codeAttrs: Record<string, unknown> = {};
    if (language) {
      codeAttrs['class'] = `${this.options.languageClassPrefix}${language}`;
    }

    return [
      'pre',
      { ...this.options.HTMLAttributes, ...HTMLAttributes },
      ['code', codeAttrs, 0],
    ];
  },

  addCommands() {
    const { name } = this;
    return {
      setCodeBlock:
        (attributes?: { language?: string }) =>
        ({ commands }) => {
          return commands.setBlockType(name, attributes);
        },
      toggleCodeBlock:
        (attributes?: { language?: string }) =>
        ({ commands }) => {
          return commands.toggleBlockType(name, 'paragraph', attributes);
        },
    };
  },

  addKeyboardShortcuts() {
    const { editor } = this;

    const exitCodeBlock = (): boolean => {
      if (!editor) return false;
      const { state, view } = editor;
      const after = state.selection.$head.after();
      const paragraph = state.schema.nodes['paragraph']?.createAndFill();
      if (!paragraph) return false;
      const tr = state.tr.insert(after, paragraph);
      tr.setSelection(TextSelection.near(tr.doc.resolve(after + 1)));
      view.dispatch(tr.scrollIntoView());
      return true;
    };

    return {
      'Mod-Alt-c': () => editor?.commands['toggleCodeBlock']?.() ?? false,

      Enter: () => {
        if (!this.options.exitOnTripleEnter || !editor) return false;
        const { $head } = editor.state.selection;
        if ($head.parent.type !== this.nodeType) return false;
        const pos = $head.parentOffset;
        if (pos < 2 || pos !== $head.parent.content.size) return false;
        const text = $head.parent.textContent;
        if (text[pos - 1] !== '\n' || text[pos - 2] !== '\n') return false;
        editor.view.dispatch(editor.state.tr.delete($head.pos - 2, $head.pos));
        return exitCodeBlock();
      },

      ArrowDown: () => {
        if (!editor) return false;
        const { $head } = editor.state.selection;
        if ($head.parent.type !== this.nodeType) return false;
        if ($head.parentOffset !== $head.parent.content.size) return false;
        const after = $head.after();
        if (after < editor.state.doc.content.size && editor.state.doc.resolve(after).nodeAfter) return false;
        return exitCodeBlock();
      },
    };
  },

  addToolbarItems(): ToolbarItem[] {
    return [
      {
        type: 'button',
        name: 'codeBlock',
        command: 'toggleCodeBlock',
        isActive: 'codeBlock',
        icon: 'codeBlock',
        label: 'Code Block',
        shortcut: 'Mod-Alt-C',
        group: 'blocks',
        priority: 140,
      },
    ];
  },

  addInputRules() {
    const { nodeType } = this;

    if (!nodeType) {
      return [];
    }

    return [
      textblockTypeInputRule(
        /^```([a-z]*)?[\s\n]$/,
        nodeType,
        (match) => {
          const language = match[1] ?? null;
          return { language };
        }
      ),
    ];
  },
});
