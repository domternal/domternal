/**
 * @domternal/core
 * Framework-agnostic ProseMirror editor engine
 */

export const VERSION = '0.0.1';

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
  TextDirection,
  FocusPosition,
  EditorOptions,
  ResolvedEditorOptions,
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
} from './types/index.js';

// === ProseMirror re-exports (for framework wrappers) ===
export { PluginKey } from 'prosemirror-state';

// === Core classes ===
export { EventEmitter } from './EventEmitter.js';
export { Editor } from './Editor.js';
export {
  ExtensionManager,
  type ExtensionManagerOptions,
  type ExtensionManagerEditor,
} from './ExtensionManager.js';
export {
  CommandManager,
  type SetContentOptions,
  type ClearContentOptions,
  type CommandManagerEditor,
} from './CommandManager.js';

// === Helpers ===
export {
  createDocument,
  isNodeEmpty,
  isDocumentEmpty,
  callOrReturn,
  markInputRule,
  markInputRulePatterns,
  isValidUrl,
  extractUrls,
  generateHTML,
  generateJSON,
  generateText,
  type CreateDocumentOptions,
  type IsNodeEmptyOptions,
  type MarkInputRuleOptions,
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
  // Menu Extensions
  BubbleMenu,
  createBubbleMenuPlugin,
  bubbleMenuPluginKey,
  type BubbleMenuOptions,
  type CreateBubbleMenuPluginOptions,
  FloatingMenu,
  createFloatingMenuPlugin,
  floatingMenuPluginKey,
  type FloatingMenuOptions,
  type CreateFloatingMenuPluginOptions,
  // Bundle
  StarterKit,
  type StarterKitOptions,
} from './extensions/index.js';
