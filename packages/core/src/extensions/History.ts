/**
 * History Extension
 *
 * Provides undo/redo functionality using prosemirror-history.
 */
import { history, undo, redo } from 'prosemirror-history';
import { Extension } from '../Extension.js';
import type { CommandSpec } from '../types/Commands.js';

declare module '../types/Commands.js' {
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
