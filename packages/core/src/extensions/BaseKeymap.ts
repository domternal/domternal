/**
 * BaseKeymap Extension
 *
 * Adds essential keyboard shortcuts for basic editing operations.
 * This includes Enter (new paragraph), Backspace, Delete, and other
 * fundamental editing commands from ProseMirror's baseKeymap.
 *
 * @example
 * ```ts
 * import { BaseKeymap } from '@domternal/core';
 *
 * const editor = new Editor({
 *   extensions: [Document, Paragraph, Text, BaseKeymap],
 * });
 * ```
 *
 * ## Included Shortcuts
 * - Enter: Create new paragraph / split block
 * - Backspace: Delete backward
 * - Delete: Delete forward
 * - Mod-Backspace: Delete to start of line
 * - Mod-Delete: Delete to end of line
 * - Alt-ArrowUp/Down: Join with block above/below
 * - Mod-a: Select all
 * - And more standard editing commands
 */
import { Extension } from '../Extension.js';
import { keymap } from 'prosemirror-keymap';
import {
  baseKeymap,
  chainCommands,
  createParagraphNear,
  liftEmptyBlock,
  newlineInCode,
  splitBlock,
} from 'prosemirror-commands';
import type { Command } from 'prosemirror-state';

export interface BaseKeymapOptions {
  /**
   * Whether to include the default Enter behavior.
   * @default true
   */
  enter: boolean;
}

// Enhanced Enter command that handles more cases
const enterCommand: Command = chainCommands(
  newlineInCode,
  createParagraphNear,
  liftEmptyBlock,
  splitBlock
);

export const BaseKeymap = Extension.create<BaseKeymapOptions>({
  name: 'baseKeymap',

  addOptions() {
    return {
      enter: true,
    };
  },

  addProseMirrorPlugins() {
    const bindings = { ...baseKeymap };

    // Override Enter with our enhanced version if enabled
    if (this.options.enter) {
      bindings['Enter'] = enterCommand;
    }

    return [keymap(bindings)];
  },
});
