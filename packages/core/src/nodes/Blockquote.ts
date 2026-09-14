import { coreMessages } from '../messages/core.js';
import { localizedLabel } from '../utils/localizeMessage.js';
import { localizedDescription, localizedGroup, messageAliases } from '../messages/presentation.js';
/**
 * Blockquote Node
 *
 * Block-level quote container that can hold other blocks.
 * Supports nested blockquotes and markdown-style input rule.
 */

import { Node } from '../Node.js';
import { wrappingInputRule } from '../helpers/wrappingInputRule.js';
import type { CommandSpec } from '../types/Commands.js';
import type { ToolbarItem } from '../types/Toolbar.js';
import type { FloatingMenuItem } from '../types/FloatingMenu.js';

declare module '@domternal/core' {
  interface RawCommands {
    setBlockquote: CommandSpec;
    toggleBlockquote: CommandSpec;
    unsetBlockquote: CommandSpec;
  }
}

export interface BlockquoteOptions {
  HTMLAttributes: Record<string, unknown>;
}

export const Blockquote = Node.create<BlockquoteOptions>({
  name: 'blockquote',
  group: 'block',
  content: 'block+',
  defining: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  parseHTML() {
    return [{ tag: 'blockquote' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['blockquote', { ...this.options.HTMLAttributes, ...HTMLAttributes }, 0];
  },

  addCommands() {
    const { name } = this;
    return {
      setBlockquote:
        () =>
        ({ commands }) => {
          return commands.wrapIn(name);
        },
      toggleBlockquote:
        () =>
        ({ commands }) => {
          return commands.toggleWrap(name);
        },
      unsetBlockquote:
        () =>
        ({ commands }) => {
          return commands.lift();
        },
    };
  },

  addKeyboardShortcuts() {
    const { editor } = this;
    return {
      'Mod-Shift-b': () => {
        return editor?.commands['toggleBlockquote']?.() ?? false;
      },
    };
  },

  addToolbarItems(): ToolbarItem[] {
    return [
      {
        type: 'button',
        name: 'blockquote',
        command: 'toggleBlockquote',
        isActive: 'blockquote',
        icon: 'quotes',
        ...localizedLabel(this.editor?.i18n, coreMessages.blockquote),
        shortcut: 'Mod-Shift-B',
        group: 'blocks',
        ...localizedGroup(this.editor?.i18n, coreMessages.groupBlocks),
        priority: 150,
      },
    ];
  },

  addFloatingMenuItems(): FloatingMenuItem[] {
    return [
      {
        name: 'blockquote',
        ...localizedLabel(this.editor?.i18n, coreMessages.quote),
        ...localizedDescription(this.editor?.i18n, coreMessages.quoteDescription),
        icon: 'quotes',
        group: 'Basic',
        ...localizedGroup(this.editor?.i18n, coreMessages.groupBasic),
        priority: 170,
        keywords: messageAliases(this.editor?.i18n, coreMessages.quote),
        shortcut: '> ',
        command: 'toggleBlockquote',
      },
    ];
  },

  addInputRules() {
    const { nodeType } = this;

    if (!nodeType) {
      return [];
    }

    return [
      wrappingInputRule({ find: /^\s*>\s$/, type: nodeType }),
    ];
  },
});
