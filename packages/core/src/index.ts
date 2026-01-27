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
} from './types/index.js';

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
  type CreateDocumentOptions,
  type IsNodeEmptyOptions,
} from './helpers/index.js';

// === Extension System ===
export { Extension } from './Extension.js';
export { Node } from './Node.js';
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
  Image,
  type ImageOptions,
} from './nodes/index.js';
