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
export { ExtensionManager } from './ExtensionManager.js';
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
