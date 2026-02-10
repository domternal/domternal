/**
 * CanChecker - Dry-run command checker
 *
 * Provides API for checking if commands CAN be executed without actually executing them.
 * Commands receive dispatch=undefined to indicate dry-run mode.
 *
 * @example
 * // Check single command
 * if (editor.can().toggleBold()) {
 *   // Bold can be applied
 * }
 *
 * // Check command chain
 * if (editor.can().chain().toggleBold().toggleItalic().run()) {
 *   // Both commands can be executed
 * }
 */
import type { EditorState, Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type {
  CommandProps,
  Command,
  CommandMap,
  CanCommands,
  CanChainedCommands,
  SingleCommands,
  ChainedCommands,
} from './types/Commands.js';
import { buildCommandProps } from './commandPropsBuilder.js';

/**
 * Editor interface for CanChecker
 */
export interface CanCheckerEditor {
  readonly view: EditorView;
  readonly state: EditorState;
  readonly isDestroyed: boolean;
}

/**
 * Options for creating a CanChecker
 */
export interface CanCheckerOptions {
  editor: CanCheckerEditor;
  rawCommands: CommandMap;
  /** Function to create a ChainBuilder for chain() within commands */
  createChainBuilder: () => ChainedCommands;
  /**
   * Optional callback when an unknown command is accessed
   * Useful for debugging - called with command name and context
   */
  onUnknownCommand?: (name: string, context: 'single' | 'chain') => void;
}

/**
 * Checks if commands can be executed (dry-run mode)
 *
 * Uses JavaScript Proxy to dynamically generate command methods.
 * Each command is executed with dispatch=undefined.
 */
export class CanChecker {
  private readonly editor: CanCheckerEditor;
  private readonly rawCommands: CommandMap;
  private readonly createChainBuilder: () => ChainedCommands;
  private readonly onUnknownCommand: ((name: string, context: 'single' | 'chain') => void) | undefined;

  constructor(options: CanCheckerOptions) {
    this.editor = options.editor;
    this.rawCommands = options.rawCommands;
    this.createChainBuilder = options.createChainBuilder;
    this.onUnknownCommand = options.onUnknownCommand;
  }

  /**
   * Builds CommandProps for dry-run checks
   * dispatch is undefined to indicate dry-run mode
   */
  private buildDryRunProps(tr: Transaction): CommandProps {
    const { editor } = this;

    return buildCommandProps({
      editor,
      tr,
      dispatch: undefined, // Key difference: undefined for dry-run
      chain: this.createChainBuilder,
      can: () => this.proxy(),
      commands: () => this.buildSingleCommands(tr),
    });
  }

  /**
   * Builds SingleCommands for use within can() checks
   */
  private buildSingleCommands(tr: Transaction): SingleCommands {
    const { rawCommands } = this;

    return new Proxy({} as SingleCommands, {
      get: (_, name: string) => {
        const rawCommand = rawCommands[name];
        if (!rawCommand) {
          return () => false;
        }
        return (...args: unknown[]) => {
          const props = this.buildDryRunProps(tr);
          return (rawCommand as (...a: unknown[]) => Command)(...args)(props);
        };
      },
    });
  }

  /**
   * Creates a Proxy that provides dynamic can() methods
   * Each method returns boolean indicating if command can execute
   */
  proxy(): CanCommands {
    const { editor, rawCommands } = this;

    return new Proxy({} as CanCommands, {
      get: (_, name: string) => {
        // Handle chain() method
        if (name === 'chain') {
          return () => this.chainProxy();
        }

        // Handle dynamic commands
        const rawCommand = rawCommands[name];
        if (!rawCommand) {
          this.onUnknownCommand?.(name, 'single');
          return () => false;
        }

        return (...args: unknown[]) => {
          if (editor.isDestroyed) {
            return false;
          }

          const tr = editor.view.state.tr;
          const props = this.buildDryRunProps(tr);
          return (rawCommand as (...a: unknown[]) => Command)(...args)(props);
        };
      },
    });
  }

  /**
   * Creates a chain proxy for can().chain()
   * Tracks if all commands in chain can execute
   */
  chainProxy(): CanChainedCommands {
    const { editor, rawCommands } = this;
    let allSucceeded = true;
    const tr = editor.view.state.tr;

    const chainProxy: CanChainedCommands = new Proxy({} as CanChainedCommands, {
      get: (_, name: string) => {
        // Handle run() - returns accumulated result
        if (name === 'run') {
          return () => allSucceeded;
        }

        // Handle dynamic commands
        const rawCommand = rawCommands[name];
        if (!rawCommand) {
          this.onUnknownCommand?.(name, 'chain');
          return () => {
            allSucceeded = false;
            return chainProxy;
          };
        }

        return (...args: unknown[]) => {
          if (editor.isDestroyed) {
            allSucceeded = false;
            return chainProxy;
          }

          const props = this.buildDryRunProps(tr);
          const result = (rawCommand as (...a: unknown[]) => Command)(...args)(props);
          if (!result) {
            allSucceeded = false;
          }
          return chainProxy;
        };
      },
    });

    return chainProxy;
  }
}

/**
 * Creates a new CanChecker instance
 */
export function createCanChecker(options: CanCheckerOptions): CanCommands {
  const checker = new CanChecker(options);
  return checker.proxy();
}
