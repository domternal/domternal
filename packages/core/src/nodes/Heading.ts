/**
 * Heading Node
 *
 * Block-level heading elements (h1-h6).
 * Supports configurable levels and markdown-style input rules.
 */

import { Node } from '../Node.js';
import { textblockTypeInputRule } from '@domternal/pm/inputrules';
import { keymap } from '@domternal/pm/keymap';
import type { Command as PMCommand } from '@domternal/pm/state';
import type { CommandSpec } from '../types/Commands.js';
import type { ToolbarItem, ToolbarButton } from '../types/Toolbar.js';

declare module '../types/Commands.js' {
  interface RawCommands {
    setHeading: CommandSpec<[attributes?: { level?: number }]>;
    toggleHeading: CommandSpec<[attributes?: { level?: number }]>;
  }
}

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
          const match = /^H(\d)$/i.exec(element.tagName);
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
    // `this` is properly typed via ThisType<NodeContext<HeadingOptions>>
    return this.options.levels.map((level) => ({
      tag: `h${String(level)}`,
      attrs: { level },
    }));
  },

  renderHTML({ node, HTMLAttributes }) {
    const level = node.attrs['level'] as number;
    // Ensure level is within allowed range
    const validLevel = this.options.levels.includes(level) ? level : this.options.levels[0];
    return [`h${String(validLevel)}`, { ...this.options.HTMLAttributes, ...HTMLAttributes }, 0];
  },

  addCommands() {
    const { name, options } = this;
    return {
      setHeading:
        (attributes?: { level?: number }) =>
        ({ commands }) => {
          const level = attributes?.level ?? options.levels[0] ?? 1;
          if (!options.levels.includes(level)) {
            return false;
          }
          return commands.setBlockType(name, { level });
        },
      toggleHeading:
        (attributes?: { level?: number }) =>
        ({ commands }) => {
          const level = attributes?.level ?? options.levels[0] ?? 1;
          if (!options.levels.includes(level)) {
            return false;
          }
          return commands.toggleBlockType(name, 'paragraph', { level });
        },
    };
  },

  addKeyboardShortcuts() {
    const shortcuts: Record<string, () => boolean> = {};
    const { options, editor } = this;

    options.levels.forEach((level) => {
      shortcuts[`Mod-Alt-${String(level)}`] = () => {
        return editor?.commands['toggleHeading']?.({ level }) ?? false;
      };
    });

    return shortcuts;
  },

  addToolbarItems(): ToolbarItem[] {
    const iconMap: Record<number, string> = {
      1: 'textHOne',
      2: 'textHTwo',
      3: 'textHThree',
    };

    const headingItems: ToolbarButton[] = this.options.levels
      .filter((level) => level <= 3)
      .map((level) => ({
        type: 'button' as const,
        name: `heading${String(level)}`,
        command: 'toggleHeading',
        commandArgs: [{ level }],
        isActive: { name: 'heading', attributes: { level } },
        icon: iconMap[level] ?? 'textH',
        label: `Heading ${String(level)}`,
        shortcut: `Mod-Alt-${String(level)}`,
      }));

    const paragraphItem: ToolbarButton = {
      type: 'button',
      name: 'paragraph',
      command: 'setParagraph',
      isActive: 'paragraph',
      icon: 'textT',
      label: 'Normal text',
      shortcut: 'Mod-Alt-0',
    };

    return [
      {
        type: 'dropdown',
        name: 'heading',
        icon: 'textH',
        label: 'Heading',
        items: [paragraphItem, ...headingItems],
        group: 'blocks',
        priority: 200,
        dynamicIcon: true,
      },
    ];
  },

  addProseMirrorPlugins() {
    return [
      keymap({
        Backspace: ((state, dispatch) => {
          const { selection } = state;
          if (!selection.empty) return false;

          const { $from } = selection;
          if ($from.parentOffset !== 0) return false;
          if ($from.parent.type.name !== 'heading') return false;

          const paragraphType = state.schema.nodes['paragraph'];
          if (!paragraphType) return false;

          if (dispatch) {
            dispatch(
              state.tr.setNodeMarkup($from.before($from.depth), paragraphType).scrollIntoView()
            );
          }
          return true;
        }) as PMCommand,
      }),
    ];
  },

  addInputRules() {
    const { nodeType, options } = this;

    if (!nodeType) {
      return [];
    }

    const maxLevel = Math.max(...options.levels);
    return [
      textblockTypeInputRule(
        new RegExp(`^(#{1,${String(maxLevel)}})\\s$`),
        nodeType,
        (match) => {
          const hashes = match[1];
          if (!hashes) {
            return null;
          }
          const level = hashes.length;
          // Only convert if this level is enabled
          if (!options.levels.includes(level)) {
            return null;
          }
          return { level };
        }
      ),
    ];
  },
});
