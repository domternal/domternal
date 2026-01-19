import type { EditorState, Transaction } from 'prosemirror-state';

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
 * Raw commands as returned by extensions
 * Keys are command names, values are command specs
 */
export type RawCommands = Record<string, CommandSpec<never[]>>;

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
