/**
 * Functionality Extensions for @domternal/core
 */

// Core functionality
export { BaseKeymap, type BaseKeymapOptions } from './BaseKeymap.js';
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
export { LineHeight, type LineHeightOptions } from './LineHeight.js';

// Block Attributes
export {
  UniqueID,
  uniqueIDPluginKey,
  type UniqueIDOptions,
} from './UniqueID.js';

// Selection & Editor Utilities
export {
  Selection,
  type SelectionOptions,
  type SelectionStorage,
} from './Selection.js';
export {
  SelectionDecoration,
  selectionDecorationPluginKey,
  type SelectionDecorationOptions,
} from './SelectionDecoration.js';
export {
  InvisibleChars,
  invisibleCharsPluginKey,
  type InvisibleCharsOptions,
  type InvisibleCharsStorage,
} from './InvisibleChars.js';

// Text Style Extensions (require TextStyle mark)
export { TextColor, DEFAULT_TEXT_COLORS, type TextColorOptions } from './TextColor.js';
export { Highlight, DEFAULT_HIGHLIGHT_COLORS, type HighlightOptions } from './Highlight.js';
export { FontFamily, type FontFamilyOptions } from './FontFamily.js';
export { FontSize, type FontSizeOptions } from './FontSize.js';

// Formatting Utilities
export { ClearFormatting } from './ClearFormatting.js';

// Link UI
export { LinkPopover, type LinkPopoverOptions } from './LinkPopover.js';

// Menu Extensions
export {
  BubbleMenu,
  createBubbleMenuPlugin,
  bubbleMenuPluginKey,
  type BubbleMenuOptions,
  type CreateBubbleMenuPluginOptions,
} from './BubbleMenu.js';
export {
  FloatingMenu,
  createFloatingMenuPlugin,
  floatingMenuPluginKey,
  type FloatingMenuOptions,
  type CreateFloatingMenuPluginOptions,
} from './FloatingMenu.js';

// Bundle
export { StarterKit, type StarterKitOptions } from './StarterKit.js';
