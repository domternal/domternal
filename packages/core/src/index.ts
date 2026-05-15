/**
 * @domternal/core
 * Framework-agnostic ProseMirror editor engine
 */

export const VERSION = '0.1.0';

// === Type exports ===
export type {
  // Content types
  JSONAttribute,
  JSONMark,
  JSONContent,
  Content,
  Range,
  // Editor options
  AnyExtension,
  FocusPosition,
  EditorOptions,
  // Editor events
  EditorInstance,
  TransactionEventProps,
  FocusEventProps,
  CreateEventProps,
  ContentErrorProps,
  PasteEventProps,
  DropEventProps,
  MountEventProps,
  DeleteEventProps,
  EditorEvents,
  EditorEventName,
  // Command types
  CommandEditor,
  CommandProps,
  Command,
  CommandSpec,
  CommandMap,
  RawCommands,
  SingleCommands,
  ChainedCommands,
  ChainFailure,
  CanCommands,
  CanChainedCommands,
  KeyboardShortcutCommand,
  // Extension config types
  ExtensionEditor,
  AnyExtensionConfig,
  GlobalAttributeSpec,
  GlobalAttributes,
  ExtensionConfig,
  // Attribute types
  AttributeSpec,
  AttributeSpecs,
  // Node config types
  NodeParseRule,
  NodeRenderHTMLProps,
  NodeConfig,
  // Mark config types
  MarkParseRule,
  MarkRenderHTMLProps,
  MarkConfig,
  // Toolbar types
  IconSet,
  ToolbarButton,
  ToolbarDropdown,
  ToolbarSeparator,
  ToolbarItem,
  ToolbarLayoutDropdown,
  ToolbarLayoutEntry,
  // Floating menu types
  FloatingMenuItem,
  FloatingMenuItemsOverride,
} from './types/index.js';

// === ProseMirror re-exports (for framework wrappers) ===
export { PluginKey } from '@domternal/pm/state';

// === Core classes ===
export { EventEmitter } from './EventEmitter.js';
export { Editor } from './Editor.js';
export {
  ExtensionManager,
  type ExtensionManagerOptions,
  type ExtensionManagerEditor,
  type NodeViewContext,
} from './ExtensionManager.js';
export {
  CommandManager,
  type SetContentOptions,
  type ClearContentOptions,
  type CommandManagerEditor,
} from './CommandManager.js';

// === Floating UI ===
export {
  positionFloating,
  positionFloatingOnce,
  type PositionFloatingOptions,
} from './utils/positionFloating.js';

// === Inline Styles ===
export {
  inlineStyles,
  applyInlineStyles,
  type InlineStyleOverrides,
} from './utils/inlineStyles.js';

// === Clipboard ===
export { writeToClipboard } from './utils/clipboard.js';

// === Bubble menu defaults ===
export { defaultBubbleContexts } from './utils/defaultBubbleContexts.js';

// === List utilities ===
export {
  insertAsListItemChild,
  type InsertAsListItemChildArgs,
  type InsertAsListItemChildResult,
} from './utils/insertAsListItemChild.js';
export {
  getListItemCursorContext,
  type ListItemCursorContext,
} from './utils/listItemCursorContext.js';
export {
  liftEmptyChildrenZoneParagraph,
} from './utils/liftEmptyChildrenZoneParagraph.js';
export {
  insertChildrenZoneSibling,
} from './utils/insertChildrenZoneSibling.js';
export {
  liftCurrentListItem,
} from './utils/liftCurrentListItem.js';
export {
  splitListForInsert,
  type SplitListForInsertRange,
} from './utils/splitListForInsert.js';
export {
  findListItemAncestorDepth,
  isInsideListItem,
  isInListItemLabel,
  LIST_ITEM_TYPE_NAMES,
} from './utils/listItemAncestor.js';

// === Helpers ===
export {
  createDocument,
  isNodeEmpty,
  isDocumentEmpty,
  callOrReturn,
  markInputRule,
  markInputRulePatterns,
  wrappingInputRule,
  textblockTypeInputRule,
  textInputRule,
  nodeInputRule,
  isValidUrl,
  generateHTML,
  generateJSON,
  generateText,
  type CreateDocumentOptions,
  type IsNodeEmptyOptions,
  type MarkInputRuleOptions,
  type WrappingInputRuleOptions,
  type TextblockTypeInputRuleOptions,
  type TextInputRuleOptions,
  type NodeInputRuleOptions,
  type IsValidUrlOptions,
  type GenerateHTMLOptions,
  type GenerateJSONOptions,
  type GenerateTextOptions,
  getMarkRange,
  type MarkRange,
  findParentNode,
  type FindParentNodeResult,
  findChildren,
  type FindChildResult,
  defaultBlockAt,
} from './helpers/index.js';

// === Extension System ===
export { Extension } from './Extension.js';
export { Node } from './Node.js';

// === Toolbar ===
export {
  ToolbarController,
  type ToolbarControllerEditor,
  type ToolbarGroup,
} from './ToolbarController.js';

// === Floating Menu Controller ===
export {
  FloatingMenuController,
  FLOATING_MENU_NO_FOCUS,
  type FloatingMenuGroup,
} from './FloatingMenuController.js';

// === Shared helpers ===
export { groupFloatingMenuItems } from './utils/groupFloatingMenuItems.js';

// === Icons ===
export { defaultIcons } from './icons/index.js';

export { Mark } from './Mark.js';

// === Command System ===
export {
  ChainBuilder,
  createChainBuilder,
  type ChainBuilderEditor,
  type ChainBuilderOptions,
} from './ChainBuilder.js';
export {
  CanChecker,
  createCanChecker,
  type CanCheckerEditor,
  type CanCheckerOptions,
} from './CanChecker.js';
export {
  buildCommandProps,
  createAccumulatingDispatch,
  type CommandPropsEditor,
  type BuildCommandPropsOptions,
} from './commandPropsBuilder.js';
export {
  builtInCommands,
  // Basic commands
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
  unsetAllMarks,
  // Block commands
  setBlockType,
  toggleBlockType,
  // Wrap commands
  wrapIn,
  toggleWrap,
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
} from './commands/index.js';

// === Nodes ===
export {
  Document,
  Text,
  Paragraph,
  type ParagraphOptions,
  Heading,
  type HeadingOptions,
  Blockquote,
  type BlockquoteOptions,
  CodeBlock,
  type CodeBlockOptions,
  BulletList,
  type BulletListOptions,
  OrderedList,
  type OrderedListOptions,
  ListItem,
  type ListItemOptions,
  HorizontalRule,
  type HorizontalRuleOptions,
  HardBreak,
  type HardBreakOptions,
  TaskList,
  type TaskListOptions,
  TaskItem,
  type TaskItemOptions,
} from './nodes/index.js';

// === Marks ===
export {
  Bold,
  type BoldOptions,
  Italic,
  type ItalicOptions,
  Underline,
  type UnderlineOptions,
  Strike,
  type StrikeOptions,
  Code,
  type CodeOptions,
  Link,
  type LinkOptions,
  type LinkAttributes,
  Subscript,
  type SubscriptOptions,
  Superscript,
  type SuperscriptOptions,
  TextStyle,
  type TextStyleOptions,
  // Link helpers
  linkClickPlugin,
  linkClickPluginKey,
  type LinkClickPluginOptions,
  linkPastePlugin,
  linkPastePluginKey,
  type LinkPastePluginOptions,
  autolinkPlugin,
  autolinkPluginKey,
  type AutolinkPluginOptions,
  linkExitPlugin,
  linkExitPluginKey,
  type LinkExitPluginOptions,
} from './marks/index.js';

// === Extensions ===
export {
  // Core functionality
  BaseKeymap,
  type BaseKeymapOptions,
  History,
  type HistoryOptions,
  Dropcursor,
  type DropcursorOptions,
  Gapcursor,
  TrailingNode,
  type TrailingNodeOptions,
  Placeholder,
  placeholderPluginKey,
  type PlaceholderOptions,
  // List & Count
  ListKeymap,
  type ListKeymapOptions,
  ListIndent,
  indentBlockAsListChild,
  outdentBlockFromListItem,
  CharacterCount,
  characterCountPluginKey,
  type CharacterCountOptions,
  type CharacterCountStorage,
  // Styling
  Typography,
  type TypographyOptions,
  TextAlign,
  type TextAlignOptions,
  Focus,
  focusPluginKey,
  type FocusOptions,
  LineHeight,
  type LineHeightOptions,
  // Block Attributes
  UniqueID,
  uniqueIDPluginKey,
  type UniqueIDOptions,
  BlockColor,
  DEFAULT_BLOCK_COLORS,
  DEFAULT_BLOCK_COLOR_TYPES,
  stripInlineColorConflicts,
  type BlockColorOptions,
  // Selection & Editor Utilities
  Selection,
  type SelectionOptions,
  type SelectionStorage,
  SelectionDecoration,
  selectionDecorationPluginKey,
  type SelectionDecorationOptions,
  InvisibleChars,
  invisibleCharsPluginKey,
  type InvisibleCharsOptions,
  type InvisibleCharsStorage,
  // Text Style Extensions
  TextColor,
  DEFAULT_TEXT_COLORS,
  type TextColorOptions,
  Highlight,
  DEFAULT_HIGHLIGHT_COLORS,
  type HighlightOptions,
  FontFamily,
  type FontFamilyOptions,
  FontSize,
  type FontSizeOptions,
  NotionColorPicker,
  DEFAULT_NOTION_COLOR_PALETTE,
  type NotionColorPickerOptions,
  type NotionColorPickerStorage,
  // Formatting Utilities
  ClearFormatting,
  // Link UI
  LinkPopover,
  type LinkPopoverOptions,
  // Menu Extensions
  BubbleMenu,
  createBubbleMenuPlugin,
  bubbleMenuPluginKey,
  type BubbleMenuOptions,
  type CreateBubbleMenuPluginOptions,
  // Bundle
  StarterKit,
  type StarterKitOptions,
} from './extensions/index.js';
