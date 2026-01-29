/**
 * Built-in commands for @domternal/core
 */
export {
  builtInCommands,
  focus,
  blur,
  setContent,
  clearContent,
  insertText,
  deleteSelection,
  selectAll,
  // Mark commands
  toggleMark,
  setMark,
  unsetMark,
  // Block commands
  setBlockType,
  toggleBlockType,
  // Wrap commands
  wrapIn,
  toggleWrap,
  // Lift command
  lift,
  // List commands
  toggleList,
  // Insert commands
  insertContent,
  // Selection commands
  selectNodeBackward,
  // Attribute commands
  updateAttributes,
  resetAttributes,
  type SetContentOptions,
  type ClearContentOptions,
} from './builtIn.js';
