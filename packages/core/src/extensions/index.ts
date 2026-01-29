/**
 * Functionality Extensions for @domternal/core
 */

// Core functionality
export { History, type HistoryOptions } from './History.js';
export { Dropcursor, type DropcursorOptions } from './Dropcursor.js';
export { Gapcursor } from './Gapcursor.js';
export { TrailingNode, type TrailingNodeOptions } from './TrailingNode.js';
export {
  Placeholder,
  placeholderPluginKey,
  type PlaceholderOptions,
} from './Placeholder.js';

// List & Count
export { ListKeymap, type ListKeymapOptions } from './ListKeymap.js';
export {
  CharacterCount,
  characterCountPluginKey,
  type CharacterCountOptions,
  type CharacterCountStorage,
} from './CharacterCount.js';

// Styling
export { Typography, type TypographyOptions } from './Typography.js';
export { TextAlign, type TextAlignOptions } from './TextAlign.js';
export { Focus, focusPluginKey, type FocusOptions } from './Focus.js';

// Bundle
export { StarterKit, type StarterKitOptions } from './StarterKit.js';
