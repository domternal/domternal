/**
 * CommandManager - Manages editor commands
 *
 * Provides unified command API with:
 * - Dynamic commands from extensions
 * - Built-in commands (focus, blur, setContent, etc.)
 * - chain() for chainable commands
 * - can() for checking command availability
 */
import type { Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type {
  CommandProps,
  Command,
  CommandMap,
  SingleCommands,
  ChainedCommands,
  CanCommands,
} from './types/Commands.js';
import { builtInCommands } from './commands/builtIn.js';
import { createChainBuilder } from './ChainBuilder.js';
import { createCanChecker } from './CanChecker.js';

// Re-export option types for backward compatibility
export type { SetContentOptions, ClearContentOptions } from './commands/builtIn.js';

/**
 * Editor interface for CommandManager
 * Forward declaration to avoid circular dependency
 */
export interface CommandManagerEditor {
  readonly view: EditorView;
  readonly state: CommandManagerEditor['view']['state'];
  readonly isDestroyed: boolean;
  emit(event: string, props?: unknown): void;
  /** Extension manager for collecting extension commands */
  readonly extensionManager: {
    readonly commands: CommandMap;
  };
}

/**
 * Manages editor commands
 *
 * Provides:
 * - editor.commands.* - Single commands that execute immediately
 * - editor.chain().*.run() - Chainable commands with shared transaction
 * - editor.can().* - Dry-run checks if commands can execute
 */
export class CommandManager {
  private readonly editor: CommandManagerEditor;

  /** Cached raw commands (built-in + extension) */
  private _rawCommands: CommandMap | null = null;

  /** Cached dispatch function to avoid allocation on every command */
  private readonly _dispatch: (tr: Transaction) => void;

  constructor(editor: CommandManagerEditor) {
    this.editor = editor;
    this._dispatch = (tr: Transaction): void => {
      editor.view.dispatch(tr);
    };
  }

  /**
   * Gets all raw commands (built-in + extension commands)
   * Cached after first access
   */
  get rawCommands(): CommandMap {
    this._rawCommands ??= {
      ...builtInCommands,
      ...this.editor.extensionManager.commands,
    };
    return this._rawCommands;
  }

  /**
   * Builds CommandProps for executing a command
   */
  private buildCommandProps(tr: Transaction, dispatch?: (tr: Transaction) => void): CommandProps {
    const { editor } = this;

    return {
      // Cast needed: CommandManagerEditor is a minimal interface for dependency injection,
      // but CommandProps expects the full Editor type. Callers pass the actual Editor instance.
      editor: editor as unknown as CommandProps['editor'],
      state: editor.state,
      tr,
      dispatch,
      chain: () => this.chain(),
      can: () => this.can(),
      commands: this.commands,
    };
  }

  /**
   * Single commands that execute immediately
   * Uses Proxy to dynamically generate command methods (ID-1)
   *
   * @example
   * editor.commands.focus('end');
   * editor.commands.insertText('Hello');
   */
  get commands(): SingleCommands {
    const { editor, rawCommands } = this;

    return new Proxy({} as SingleCommands, {
      get: (_, name: string) => {
        const rawCommand = rawCommands[name];
        if (!rawCommand) {
          return () => false;
        }

        return (...args: unknown[]) => {
          if (editor.isDestroyed) {
            return false;
          }

          // Create fresh transaction for each command
          const tr = editor.state.tr;

          const props = this.buildCommandProps(tr, this._dispatch);
          return (rawCommand as (...a: unknown[]) => Command)(...args)(props);
        };
      },
    });
  }

  /**
   * Creates a chainable command builder
   *
   * Commands accumulate on a shared transaction, dispatched on run()
   *
   * @example
   * editor.chain()
   *   .focus()
   *   .insertText('Hello')
   *   .run();
   */
  chain(): ChainedCommands {
    const { editor, rawCommands } = this;

    return createChainBuilder({
      editor,
      rawCommands,
    });
  }

  /**
   * Creates a command availability checker (dry-run mode)
   *
   * Commands are executed with dispatch=undefined to check if they can run
   *
   * @example
   * if (editor.can().toggleBold()) {
   *   // Bold can be applied
   * }
   *
   * if (editor.can().chain().toggleBold().toggleItalic().run()) {
   *   // Both can be applied
   * }
   */
  can(): CanCommands {
    const { editor, rawCommands } = this;

    return createCanChecker({
      editor,
      rawCommands,
      createChainBuilder: () => this.chain(),
    });
  }

  /**
   * Clears cached commands
   * Call this if extensions change dynamically
   */
  clearCache(): void {
    this._rawCommands = null;
  }
}
