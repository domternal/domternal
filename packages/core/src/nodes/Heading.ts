/**
 * Heading Node
 *
 * Block-level heading elements (h1-h6).
 * Supports configurable levels and markdown-style input rules.
 */

import { Node } from '../Node.js';
import { textblockTypeInputRule } from '../helpers/textblockTypeInputRule.js';
import { keymap } from '@domternal/pm/keymap';
import { Plugin, PluginKey, TextSelection } from '@domternal/pm/state';
import type { Command as PMCommand } from '@domternal/pm/state';
import type { CommandSpec } from '../types/Commands.js';
import type { ToolbarItem, ToolbarButton } from '../types/Toolbar.js';
import type { FloatingMenuItem } from '../types/FloatingMenu.js';

declare module '@domternal/core' {
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
      levels: [1, 2, 3, 4],
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
    const validLevel = this.options.levels.includes(level) ? level : (this.options.levels[0] ?? 1);
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

    // Notion-style Enter on a heading. Lives in addKeyboardShortcuts
    // (the COLLECTED keymap, plugin index 1 in the editor) rather than
    // in addProseMirrorPlugins so it fires BEFORE the BaseKeymap plugin
    // (index 2+, the angular wrapper's `DEFAULT_EXTENSIONS` register
    // BaseKeymap before user extensions). Without that ordering,
    // BaseKeymap's `liftEmptyBlock` would claim Enter on an empty
    // heading first and lift it out of its parent.
    //
    // Behaviour:
    //  - End of NON-EMPTY heading -> insert a paragraph as the next
    //    sibling and move the caret into it.
    //  - EMPTY heading -> convert IN PLACE to a paragraph (no extra
    //    block; lets users back out of an accidental `# ` input rule).
    //  - Mid / start-of-non-empty heading -> return false so the
    //    default split runs (text splits in place; both halves stay
    //    heading).
    //
    // ListItem.Enter / TaskItem.Enter both early-bail when the cursor
    // is in a non-paragraph textblock, so this handler also fires for
    // headings nested INSIDE a list item.
    shortcuts['Enter'] = (): boolean => {
      if (!editor) return false;
      const { state, view } = editor;
      const { selection } = state;
      if (!selection.empty) return false;
      const { $from } = selection;
      if ($from.parent.type.name !== 'heading') return false;

      const paragraphType = state.schema.nodes['paragraph'];
      if (!paragraphType) return false;

      // Empty heading: convert to paragraph in place.
      if ($from.parent.content.size === 0) {
        view.dispatch(
          state.tr.setNodeMarkup($from.before($from.depth), paragraphType).scrollIntoView(),
        );
        return true;
      }

      // Non-empty: only act at the END of the heading.
      if ($from.parentOffset !== $from.parent.content.size) return false;

      const after = $from.after($from.depth);
      const $after = state.doc.resolve(after);
      const indexAfter = $after.index();
      // Schema check: parent must accept paragraph at this position.
      // Critical for nested-in-li context where the listItem's content
      // rule (`paragraph block*`) restricts what can land where.
      if (!$after.parent.canReplaceWith(indexAfter, indexAfter, paragraphType)) {
        return false;
      }

      const tr = state.tr.insert(after, paragraphType.create());
      // Caret at offset 0 inside the new paragraph (`after + 1` skips
      // the paragraph's open token).
      tr.setSelection(TextSelection.create(tr.doc, after + 1));
      view.dispatch(tr.scrollIntoView());
      return true;
    };

    return shortcuts;
  },

  addToolbarItems(): ToolbarItem[] {
    const iconMap: Record<number, string> = {
      1: 'textHOne',
      2: 'textHTwo',
      3: 'textHThree',
      4: 'textHFour',
    };

    const headingItems: ToolbarButton[] = this.options.levels
      .filter((level) => level <= 4)
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

  addFloatingMenuItems(): FloatingMenuItem[] {
    const iconMap: Record<number, string> = {
      1: 'textHOne',
      2: 'textHTwo',
      3: 'textHThree',
    };
    const descriptionMap: Record<number, string> = {
      1: 'Big section heading',
      2: 'Medium section heading',
      3: 'Small section heading',
    };
    // Only levels 1-3 in the quick-insert menu; deeper levels stay toolbar-only.
    return this.options.levels
      .filter((level) => level <= 3)
      .map((level): FloatingMenuItem => ({
        name: `heading-${String(level)}`,
        label: `Heading ${String(level)}`,
        description: descriptionMap[level] ?? 'Section heading',
        icon: iconMap[level] ?? 'textH',
        group: 'Basic',
        priority: 210 - level * 10,
        keywords: ['heading', `h${String(level)}`, 'title'],
        shortcut: '#'.repeat(level) + ' ',
        command: 'toggleHeading',
        commandArgs: [{ level }],
      }));
  },

  addProseMirrorPlugins() {
    const { options, editor } = this;

    // Build a map from code (e.g. 'Digit2') to heading level for levels
    // where Alt produces special characters on macOS, preventing the
    // regular keymap from matching.
    const codeToLevel: Record<string, number> = {};
    for (const level of options.levels) {
      codeToLevel[`Digit${String(level)}`] = level;
    }
    // Also handle Mod-Alt-0 for setParagraph
    codeToLevel['Digit0'] = 0;

    return [
      new Plugin({
        key: new PluginKey('headingKeydownFix'),
        props: {
          handleDOMEvents: {
            keydown(_view, event) {
              if (!event.altKey || !(event.metaKey || event.ctrlKey)) return false;
              const level = codeToLevel[event.code];
              if (level === undefined) return false;

              event.preventDefault();
              if (level === 0) {
                editor?.commands['setParagraph']?.();
              } else {
                editor?.commands['toggleHeading']?.({ level });
              }
              return true;
            },
          },
        },
      }),
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
      textblockTypeInputRule({
        find: new RegExp(`^(#{1,${String(maxLevel)}})\\s$`),
        type: nodeType,
        getAttributes: (match) => {
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
        },
      }),
    ];
  },
});
