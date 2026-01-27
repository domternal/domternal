/**
 * Heading Node
 *
 * Block-level heading elements (h1-h6).
 * Supports configurable levels and markdown-style input rules.
 */

import type { Node as NodeClass } from '../Node.js';
import { Node } from '../Node.js';
import { textblockTypeInputRule } from 'prosemirror-inputrules';

export interface HeadingOptions {
  levels: number[];
  HTMLAttributes: Record<string, unknown>;
}

export const Heading = Node.create<HeadingOptions>({
  name: 'heading',
  group: 'block',
  content: 'inline*',
  defining: true,

  addOptions() {
    return {
      levels: [1, 2, 3, 4, 5, 6],
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      level: {
        default: 1,
        parseHTML: (element: HTMLElement) => {
          const match = element.tagName.match(/^H(\d)$/i);
          return match?.[1] ? parseInt(match[1], 10) : 1;
        },
        renderHTML: () => {
          // Level is used in the tag name, not as an attribute
          return {};
        },
      },
    };
  },

  parseHTML() {
    const self = this as unknown as NodeClass<HeadingOptions>;
    return self.options.levels.map((level) => ({
      tag: `h${level}`,
      attrs: { level },
    }));
  },

  renderHTML({ node, HTMLAttributes }) {
    const self = this as unknown as NodeClass<HeadingOptions>;
    const level = node.attrs['level'] as number;
    // Ensure level is within allowed range
    const validLevel = self.options.levels.includes(level) ? level : self.options.levels[0];
    return [`h${validLevel}`, { ...self.options.HTMLAttributes, ...HTMLAttributes }, 0];
  },

  addCommands() {
    const self = this as unknown as NodeClass<HeadingOptions>;
    return {
      setHeading:
        (attributes?: { level?: number }) =>
        ({ commands }) => {
          const cmds = commands as Record<string, (name: string, attrs?: Record<string, unknown>) => boolean>;
          const level = attributes?.level ?? self.options.levels[0] ?? 1;
          if (!self.options.levels.includes(level)) {
            return false;
          }
          return cmds['setBlockType']?.(self.name, { level }) ?? false;
        },
      toggleHeading:
        (attributes?: { level?: number }) =>
        ({ commands }) => {
          const cmds = commands as Record<string, (name: string, defaultName: string, attrs?: Record<string, unknown>) => boolean>;
          const level = attributes?.level ?? self.options.levels[0] ?? 1;
          if (!self.options.levels.includes(level)) {
            return false;
          }
          return cmds['toggleBlockType']?.(self.name, 'paragraph', { level }) ?? false;
        },
    };
  },

  addKeyboardShortcuts() {
    const self = this as unknown as NodeClass<HeadingOptions>;
    const shortcuts: Record<string, () => boolean> = {};

    self.options.levels.forEach((level) => {
      shortcuts[`Mod-Alt-${level}`] = () => {
        const editor = self.editor as { commands: Record<string, (attrs?: Record<string, unknown>) => boolean> } | null;
        return editor?.commands['toggleHeading']?.({ level }) ?? false;
      };
    });

    return shortcuts;
  },

  addInputRules() {
    const self = this as unknown as NodeClass<HeadingOptions>;
    const nodeType = self.nodeType;

    if (!nodeType) {
      return [];
    }

    const maxLevel = Math.max(...self.options.levels);
    return [
      textblockTypeInputRule(
        new RegExp(`^(#{1,${maxLevel}})\\s$`),
        nodeType,
        (match) => {
          const hashes = match[1];
          if (!hashes) {
            return null;
          }
          const level = hashes.length;
          // Only convert if this level is enabled
          if (!self.options.levels.includes(level)) {
            return null;
          }
          return { level };
        }
      ),
    ];
  },
});
