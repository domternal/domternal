/**
 * CodeBlock Node
 *
 * Block-level code container with syntax highlighting support.
 * Preserves whitespace and disallows marks.
 */

import type { Node as NodeClass } from '../Node.js';
import { Node } from '../Node.js';
import { textblockTypeInputRule } from 'prosemirror-inputrules';

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
    return {
      language: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const codeEl = element.querySelector('code');
          if (!codeEl) return null;

          const self = this as unknown as NodeClass<CodeBlockOptions>;
          const prefix = self.options.languageClassPrefix;

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
    const self = this as unknown as NodeClass<CodeBlockOptions>;
    const language = node.attrs['language'] as string | null;

    const codeAttrs: Record<string, unknown> = {};
    if (language) {
      codeAttrs['class'] = `${self.options.languageClassPrefix}${language}`;
    }

    return [
      'pre',
      { ...self.options.HTMLAttributes, ...HTMLAttributes },
      ['code', codeAttrs, 0],
    ];
  },

  addCommands() {
    const self = this as unknown as NodeClass<CodeBlockOptions>;
    return {
      setCodeBlock:
        (attributes?: { language?: string }) =>
        ({ commands }) => {
          const cmds = commands as Record<string, (name: string, attrs?: Record<string, unknown>) => boolean>;
          return cmds['setBlockType']?.(self.name, attributes) ?? false;
        },
      toggleCodeBlock:
        (attributes?: { language?: string }) =>
        ({ commands }) => {
          const cmds = commands as Record<string, (name: string, defaultName: string, attrs?: Record<string, unknown>) => boolean>;
          return cmds['toggleBlockType']?.(self.name, 'paragraph', attributes) ?? false;
        },
    };
  },

  addKeyboardShortcuts() {
    const self = this as unknown as NodeClass<CodeBlockOptions>;
    return {
      'Mod-Alt-c': () => {
        const editor = self.editor as { commands: Record<string, () => boolean> } | null;
        return editor?.commands['toggleCodeBlock']?.() ?? false;
      },
    };
  },

  addInputRules() {
    const self = this as unknown as NodeClass<CodeBlockOptions>;
    const nodeType = self.nodeType;

    if (!nodeType) {
      return [];
    }

    return [
      textblockTypeInputRule(
        /^```([a-z]*)?[\s\n]$/,
        nodeType,
        (match) => {
          const language = match[1] || null;
          return { language };
        }
      ),
    ];
  },
});
