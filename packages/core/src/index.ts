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
} from './types/index.js';

// Editor class will be implemented here
// export { Editor } from './Editor';

// Extension system will be implemented here
// export { Extension } from './Extension';
// export { Node } from './Node';
// export { Mark } from './Mark';
