/**
 * ChainBuilder - Chainable command builder
 *
 * Provides fluent API for chaining multiple commands with a shared transaction.
 * Commands accumulate changes on the transaction, which is dispatched on run().
 *
 * @example
 * editor.chain()
 *   .focus()
 *   .insertText('Hello')
 *   .toggleBold()
 *   .run();
 */
import type { EditorState, Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type {
  CommandProps,
  Command,
  CommandMap,
  ChainedCommands,
  SingleCommands,
  CanCommands,
  ChainFailure,
} from './types/Commands.js';
import {
  buildCommandProps,
  createAccumulatingDispatch,
} from './commandPropsBuilder.js';

/**
 * Editor interface for ChainBuilder
 */
export interface ChainBuilderEditor {
  readonly view: EditorView;
  readonly state: EditorState;
  readonly isDestroyed: boolean;
}

/**
 * Options for creating a ChainBuilder
 */
export interface ChainBuilderOptions {
  editor: ChainBuilderEditor;
  rawCommands: CommandMap;
  tr?: Transaction;
}

/**
 * Builds chainable commands with shared transaction
 *
 * Uses JavaScript Proxy to dynamically generate command methods.
 * Each command method returns `this` for fluent chaining.
 */
export class ChainBuilder {
  private readonly editor: ChainBuilderEditor;
  private readonly rawCommands: CommandMap;
  private readonly tr: Transaction;
  private shouldDispatch = true;
  /** Cached proxy instance for performance (avoids creating new Proxy per command) */
  private _cachedProxy: ChainedCommands | null = null;
  /** Tracks the first command failure in the chain */
  private _failure: ChainFailure | null = null;
  /** Current command index in the chain */
  private _commandIndex = 0;
  /** Cached CommandProps for performance */
  private _cachedProps: CommandProps | null = null;
  /** Cached SingleCommands proxy for performance */
  private _cachedSingleCommands: SingleCommands | null = null;
  /** Cached CanCommands proxy for performance */
  private _cachedCanCommands: CanCommands | null = null;

  constructor(options: ChainBuilderOptions) {
    this.editor = options.editor;
    this.rawCommands = options.rawCommands;
    // Use provided transaction or create new one from current state
    this.tr = options.tr ?? options.editor.view.state.tr;
  }

  /**
   * Gets cached CommandProps or builds new one
   * In chain mode, dispatch adds to shared transaction
   */
  private buildCommandProps(): CommandProps {
    if (this._cachedProps) {
      return this._cachedProps;
    }

    const { editor, tr } = this;

    this._cachedProps = buildCommandProps({
      editor,
      tr,
      dispatch: createAccumulatingDispatch(tr),
      chain: () => this.proxy(),
      can: () => this.buildCanCommands(),
      commands: () => this.buildSingleCommands(),
    });

    return this._cachedProps;
  }

  /**
   * Gets cached SingleCommands proxy or builds new one
   */
  private buildSingleCommands(): SingleCommands {
    if (this._cachedSingleCommands) {
      return this._cachedSingleCommands;
    }

    const { rawCommands } = this;

    this._cachedSingleCommands = new Proxy({} as SingleCommands, {
      get: (_, name: string) => {
        const rawCommand = rawCommands[name];
        if (!rawCommand) {
          return () => false;
        }
        return (...args: unknown[]) => {
          const props = this.buildCommandProps();
          return (rawCommand as (...a: unknown[]) => Command)(...args)(props);
        };
      },
    });

    return this._cachedSingleCommands;
  }

  /**
   * Gets cached CanCommands proxy or builds new one
   */
  private buildCanCommands(): CanCommands {
    if (this._cachedCanCommands) {
      return this._cachedCanCommands;
    }

    const { editor, rawCommands, tr } = this;

    this._cachedCanCommands = new Proxy({} as CanCommands, {
      get: (_, name: string) => {
        if (name === 'chain') {
          // Return a function that creates a CanChainBuilder
          return () => this.buildCanChainCommands();
        }

        const rawCommand = rawCommands[name];
        if (!rawCommand) {
          return () => false;
        }
        return (...args: unknown[]) => {
          // Dry run - dispatch is undefined
          const props: CommandProps = {
            editor: editor as CommandProps['editor'],
            state: editor.view.state,
            tr,
            dispatch: undefined,
            chain: () => this.proxy(),
            can: () => this.buildCanCommands(),
            commands: this.buildSingleCommands(),
          };
          return (rawCommand as (...a: unknown[]) => Command)(...args)(props);
        };
      },
    });

    return this._cachedCanCommands;
  }

  /**
   * Builds CanChainedCommands for chained dry-run checks
   */
  private buildCanChainCommands(): ChainedCommands {
    const { editor, rawCommands, tr } = this;
    let allSucceeded = true;

    const canChainProxy = new Proxy({} as ChainedCommands, {
      get: (_, name: string) => {
        if (name === 'run') {
          return () => allSucceeded;
        }

        const rawCommand = rawCommands[name];
        if (!rawCommand) {
          return () => {
            allSucceeded = false;
            return canChainProxy;
          };
        }

        return (...args: unknown[]) => {
          // Dry run - dispatch is undefined
          const props: CommandProps = {
            editor: editor as CommandProps['editor'],
            state: editor.view.state,
            tr,
            dispatch: undefined,
            chain: () => this.proxy(),
            can: () => this.buildCanCommands(),
            commands: this.buildSingleCommands(),
          };
          const result = (rawCommand as (...a: unknown[]) => Command)(...args)(props);
          if (!result) {
            allSucceeded = false;
          }
          return canChainProxy;
        };
      },
    });

    return canChainProxy;
  }

  /**
   * Execute a custom command within the chain
   *
   * @example
   * editor.chain()
   *   .focus()
   *   .command(({ tr }) => {
   *     tr.insertText('custom');
   *     return true;
   *   })
   *   .run();
   */
  command(fn: (props: CommandProps) => boolean): this {
    const commandIndex = this._commandIndex++;
    const props = this.buildCommandProps();
    const result = fn(props);
    if (!result && !this._failure) {
      this.shouldDispatch = false;
      this._failure = { command: 'command', args: [fn], index: commandIndex };
    }
    return this;
  }

  /**
   * Get information about the first command that failed in the chain
   *
   * @returns ChainFailure object or null if no failure occurred
   *
   * @example
   * const chain = editor.chain().toggleBold().setHeading(1);
   * if (!chain.run()) {
   *   console.log('Failed:', chain.getFailure());
   * }
   */
  getFailure(): ChainFailure | null {
    return this._failure;
  }

  /**
   * Execute the command chain
   * Dispatches the accumulated transaction
   *
   * @returns true if chain was executed successfully
   */
  run(): boolean {
    const { editor, tr, shouldDispatch } = this;

    if (editor.isDestroyed) {
      return false;
    }

    if (!shouldDispatch) {
      return false;
    }

    // Only dispatch if there are actual changes
    if (tr.steps.length === 0 && !tr.selectionSet && !tr.storedMarksSet) {
      return true;
    }

    editor.view.dispatch(tr);
    return true;
  }

  /**
   * Creates a Proxy that provides dynamic command methods
   * Each method returns `this` for chaining
   *
   * Caches the proxy instance for performance - avoids creating
   * new Proxy objects for each command in the chain.
   */
  proxy(): ChainedCommands {
    if (this._cachedProxy) {
      return this._cachedProxy;
    }

    const { rawCommands } = this;

    // Create proxy with local const - handlers reference this directly (no assertion needed)
    const proxy: ChainedCommands = new Proxy({} as ChainedCommands, {
      get: (_, name: string) => {
        // Handle special methods
        if (name === 'run') {
          return () => this.run();
        }

        if (name === 'getFailure') {
          return () => this.getFailure();
        }

        if (name === 'command') {
          return (fn: (props: CommandProps) => boolean) => {
            this.command(fn);
            return proxy;
          };
        }

        // Handle dynamic commands
        const rawCommand = rawCommands[name];
        if (!rawCommand) {
          return (...args: unknown[]) => {
            const commandIndex = this._commandIndex++;
            if (!this._failure) {
              this.shouldDispatch = false;
              this._failure = { command: name, args, index: commandIndex };
            }
            return proxy;
          };
        }

        return (...args: unknown[]) => {
          const commandIndex = this._commandIndex++;
          const props = this.buildCommandProps();
          const result = (rawCommand as (...a: unknown[]) => Command)(...args)(props);
          if (!result && !this._failure) {
            this.shouldDispatch = false;
            this._failure = { command: name, args, index: commandIndex };
          }
          return proxy;
        };
      },
    });

    // Cache for subsequent calls
    this._cachedProxy = proxy;
    return proxy;
  }
}

/**
 * Creates a new ChainBuilder instance
 */
export function createChainBuilder(options: ChainBuilderOptions): ChainedCommands {
  const builder = new ChainBuilder(options);
  return builder.proxy();
}
