import type { EditorState, Transaction } from '@domternal/pm/state';

/**
 * Editor instance type (forward declaration)
 */
export interface CommandEditor {
  readonly view: unknown;
  readonly state: EditorState;
}

/**
 * Props passed to every command function
 */
export interface CommandProps {
  /** The editor instance */
  editor: CommandEditor;

  /** Current editor state */
  state: EditorState;

  /** Current transaction (shared in chains) */
  tr: Transaction;

  /**
   * Dispatch function - if undefined, command is in "dry run" mode
   * When undefined, command should only check if it CAN be executed
   */
  dispatch: ((tr: Transaction) => void) | undefined;

  /** Start a new command chain */
  chain: () => ChainedCommands;

  /** Check if commands can be executed (dry run) */
  can: () => CanCommands;

  /** Access to all single commands */
  commands: SingleCommands;
}

/**
 * A command function that returns true if it was executed successfully
 */
export type Command = (props: CommandProps) => boolean;

/**
 * A command factory that returns a Command
 * Used for commands that take arguments
 *
 * @example
 * const setHeading: CommandSpec = (level: number) => ({ state, dispatch }) => {
 *   // ... implementation
 *   return true;
 * };
 */
export type CommandSpec<Args extends unknown[] = []> = (...args: Args) => Command;

/**
 * Internal command storage used by CommandManager and ExtensionManager.
 * Holds commands as a generic record for dynamic runtime collection.
 */
export type CommandMap = Record<string, CommandSpec<unknown[]>>;

/**
 * Typed command interface for the public API.
 *
 * Each extension augments this interface via `declare module` to register
 * its commands with proper argument types. This gives full type safety
 * on `editor.commands.*`, `editor.chain().*`, and `editor.can().*`.
 *
 * @example
 * ```ts
 * declare module '../types/Commands.js' {
 *   interface RawCommands {
 *     toggleBold: CommandSpec;
 *     setHeading: CommandSpec<[attributes?: { level?: number }]>;
 *   }
 * }
 * ```
 */
export interface RawCommands {}

/**
 * Single commands that execute immediately
 * These are accessed via editor.commands.commandName()
 */
export type SingleCommands = {
  [K in keyof RawCommands]: RawCommands[K] extends CommandSpec<infer Args>
    ? (...args: Args) => boolean
    : never;
};

/**
 * Information about a command chain failure
 */
export interface ChainFailure {
  /** Name of the command that failed */
  command: string;
  /** Arguments passed to the command */
  args: unknown[];
  /** Index of the command in the chain (0-based) */
  index: number;
}

/**
 * Chained commands that return `this` for fluent API
 * These are accessed via editor.chain().commandName().run()
 */
export type ChainedCommands = {
  [K in keyof RawCommands]: RawCommands[K] extends CommandSpec<infer Args>
    ? (...args: Args) => ChainedCommands
    : never;
} & {
  /** Execute the command chain */
  run: () => boolean;
  /** Get information about the first command failure (if any) */
  getFailure: () => ChainFailure | null;
};

/**
 * Commands for checking if execution is possible (dry run)
 * These are accessed via editor.can().commandName()
 */
export type CanCommands = {
  [K in keyof RawCommands]: RawCommands[K] extends CommandSpec<infer Args>
    ? (...args: Args) => boolean
    : never;
} & {
  /** Start a chain check */
  chain: () => CanChainedCommands;
};

/**
 * Chained commands for dry-run checking
 */
export type CanChainedCommands = {
  [K in keyof RawCommands]: RawCommands[K] extends CommandSpec<infer Args>
    ? (...args: Args) => CanChainedCommands
    : never;
} & {
  /** Check if the entire chain can be executed */
  run: () => boolean;
};

/**
 * Keyboard shortcut handler
 */
export type KeyboardShortcutCommand = (props: { editor: CommandEditor }) => boolean;
