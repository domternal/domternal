import { coreMessages } from '../messages/core.js';
import { localizedLabel } from '../utils/localizeMessage.js';
import { localizedGroup } from '../messages/presentation.js';
/**
 * History Extension
 *
 * Provides undo/redo functionality using prosemirror-history.
 */
import { history, undo, redo } from '@domternal/pm/history';
import { Extension } from '../Extension.js';
import type { CommandSpec } from '../types/Commands.js';
import type { ToolbarItem } from '../types/Toolbar.js';

declare module '@domternal/core' {
  interface RawCommands {
    undo: CommandSpec;
    redo: CommandSpec;
  }
}

export interface HistoryOptions {
  /**
   * Maximum number of undo steps to keep in history.
   * @default 100
   */
  depth: number;

  /**
   * Time in milliseconds to group changes into a single undo step.
   * Changes within this delay will be combined.
   * @default 500
   */
  newGroupDelay: number;
}

export const History = Extension.create<HistoryOptions>({
  name: 'history',

  addOptions() {
    return {
      depth: 100,
      newGroupDelay: 500,
    };
  },

  addCommands() {
    return {
      undo:
        () =>
        ({ state, dispatch }) =>
          undo(state, dispatch),

      redo:
        () =>
        ({ state, dispatch }) =>
          redo(state, dispatch),
    };
  },

  addToolbarItems(): ToolbarItem[] {
    return [
      {
        type: 'button',
        name: 'undo',
        command: 'undo',
        icon: 'arrowCounterClockwise',
        ...localizedLabel(this.editor?.i18n, coreMessages.undo),
        shortcut: 'Mod-Z',
        group: 'history',
        ...localizedGroup(this.editor?.i18n, coreMessages.groupHistory),
        priority: 200,
      },
      {
        type: 'button',
        name: 'redo',
        command: 'redo',
        icon: 'arrowClockwise',
        ...localizedLabel(this.editor?.i18n, coreMessages.redo),
        shortcut: 'Mod-Shift-Z',
        group: 'history',
        ...localizedGroup(this.editor?.i18n, coreMessages.groupHistory),
        priority: 190,
      },
    ];
  },

  addKeyboardShortcuts() {
    return {
      'Mod-z': () => this.editor?.commands.undo() ?? false,
      'Mod-Shift-z': () => this.editor?.commands.redo() ?? false,
      'Mod-y': () => this.editor?.commands.redo() ?? false,
    };
  },

  addProseMirrorPlugins() {
    return [
      history({
        depth: this.options.depth,
        newGroupDelay: this.options.newGroupDelay,
      }),
    ];
  },
});
