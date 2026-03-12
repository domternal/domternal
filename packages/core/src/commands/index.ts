/**
 * Built-in commands for @domternal/core
 *
 * Re-exports from domain-specific command files and assembles the
 * builtInCommands map consumed by CommandManager.
 */
import type { CommandMap } from '../types/Commands.js';

// Selection commands
export {
  focus,
  blur,
  selectAll,
  selectNodeBackward,
  deleteSelection,
} from './selectionCommands.js';

// Content commands
export {
  setContent,
  clearContent,
  insertText,
  insertContent,
  type SetContentOptions,
  type ClearContentOptions,
} from './contentCommands.js';

// Mark commands
export {
  toggleMark,
  setMark,
  unsetMark,
  unsetAllMarks,
} from './markCommands.js';

// Node / block commands
export {
  setBlockType,
  toggleBlockType,
  wrapIn,
  toggleWrap,
  lift,
} from './nodeCommands.js';

// List commands
export { toggleList } from './listCommands.js';

// Attribute commands
export {
  updateAttributes,
  resetAttributes,
} from './attributeCommands.js';

// --- Assemble the builtInCommands map ---
import { focus, blur, selectAll, selectNodeBackward, deleteSelection } from './selectionCommands.js';
import { setContent, clearContent, insertText, insertContent } from './contentCommands.js';
import { toggleMark, setMark, unsetMark, unsetAllMarks } from './markCommands.js';
import { setBlockType, toggleBlockType, wrapIn, toggleWrap, lift } from './nodeCommands.js';
import { toggleList } from './listCommands.js';
import { updateAttributes, resetAttributes } from './attributeCommands.js';

export const builtInCommands: CommandMap = {
  focus,
  blur,
  setContent,
  clearContent,
  insertText,
  deleteSelection,
  selectAll,
  toggleMark,
  setMark,
  unsetMark,
  unsetAllMarks,
  setBlockType,
  toggleBlockType,
  wrapIn,
  toggleWrap,
  lift,
  toggleList,
  insertContent,
  selectNodeBackward,
  updateAttributes,
  resetAttributes,
} as CommandMap;

// Module augmentation: register built-in commands with typed signatures
import type { Attrs } from '@domternal/pm/model';
import type { CommandSpec } from '../types/Commands.js';
import type { FocusPosition, Content } from '../types/index.js';
import type { SetContentOptions, ClearContentOptions } from './contentCommands.js';

declare module '../types/Commands.js' {
  interface RawCommands {
    focus: CommandSpec<[position?: FocusPosition]>;
    blur: CommandSpec;
    setContent: CommandSpec<[content: Content, options?: SetContentOptions]>;
    clearContent: CommandSpec<[options?: ClearContentOptions]>;
    insertText: CommandSpec<[text: string]>;
    deleteSelection: CommandSpec;
    selectAll: CommandSpec;
    toggleMark: CommandSpec<[markName: string, attributes?: Attrs]>;
    setMark: CommandSpec<[markName: string, attributes?: Attrs]>;
    unsetMark: CommandSpec<[markName: string]>;
    unsetAllMarks: CommandSpec;
    setBlockType: CommandSpec<[nodeName: string, attributes?: Attrs]>;
    toggleBlockType: CommandSpec<[nodeName: string, defaultNodeName: string, attributes?: Attrs]>;
    wrapIn: CommandSpec<[nodeName: string, attributes?: Attrs]>;
    toggleWrap: CommandSpec<[nodeName: string, attributes?: Attrs]>;
    lift: CommandSpec;
    toggleList: CommandSpec<[listNodeName: string, listItemNodeName: string, attributes?: Attrs]>;
    insertContent: CommandSpec<[content: Content]>;
    selectNodeBackward: CommandSpec;
    updateAttributes: CommandSpec<[typeOrName: string, attributes: Record<string, unknown>]>;
    resetAttributes: CommandSpec<[typeOrName: string, attributeName: string]>;
  }
}
