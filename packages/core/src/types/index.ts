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
  CanCommands,
  CanChainedCommands,
  KeyboardShortcutCommand,
} from './Commands.js';
