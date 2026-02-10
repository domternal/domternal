/**
 * CodeBlock Node
 *
 * Block-level code container with syntax highlighting support.
 * Preserves whitespace and disallows marks.
 */

import { Node } from '../Node.js';
import { textblockTypeInputRule } from 'prosemirror-inputrules';
import type { CommandSpec } from '../types/Commands.js';

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
    return {
      'Mod-Alt-c': () => {
        return editor?.commands['toggleCodeBlock']?.() ?? false;
      },
    };
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
