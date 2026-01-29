/**
 * Core type definitions for @domternal/core
 */

// Content types
export type {
  JSONAttribute,
  JSONMark,
  JSONContent,
  Content,
  Range,
} from './Content.js';

// Editor options
export type {
  AnyExtension,
  TextDirection,
  FocusPosition,
  EditorOptions,
  ResolvedEditorOptions,
} from './EditorOptions.js';

// Editor events
export type {
  EditorInstance,
  TransactionEventProps,
  FocusEventProps,
  CreateEventProps,
  ContentErrorProps,
  PasteEventProps,
  DropEventProps,
  MountEventProps,
  DeleteEventProps,
  ErrorEventProps,
  EditorEvents,
  EditorEventName,
} from './EditorEvents.js';

// Command types
export type {
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
} from './Commands.js';

// Extension config types
export type {
  ExtensionEditor,
  AnyExtensionConfig,
  GlobalAttributeSpec,
  GlobalAttributes,
  ExtensionConfig,
} from './ExtensionConfig.js';

// Attribute types
export type { AttributeSpec, AttributeSpecs } from './AttributeSpec.js';

// Node config types
export type {
  NodeParseRule,
  NodeRenderHTMLProps,
  NodeConfig,
} from './NodeConfig.js';

// Mark config types
export type {
  MarkParseRule,
  MarkRenderHTMLProps,
  MarkConfig,
} from './MarkConfig.js';
