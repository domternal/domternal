/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { describe, it, expect, vi } from 'vitest';
import { Schema } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { ChainBuilder, createChainBuilder } from './ChainBuilder.js';
import type { CommandMap, CommandProps } from './types/Commands.js';

// Test schema with toDOM functions
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: {
      group: 'block',
      content: 'inline*',
      toDOM() {
        return ['p', 0];
      },
    },
    text: { group: 'inline' },
  },
});

// Helper to create mock editor
function createMockEditor(options: { isDestroyed?: boolean } = {}) {
  const state = EditorState.create({ schema });
  const container = document.createElement('div');
  const view = new EditorView(container, { state });

  return {
    view,
    state: view.state,
    isDestroyed: options.isDestroyed ?? false,
  };
}

// Test commands
const testCommands: CommandMap = {
  succeed:
    () =>
    ({ dispatch }) => {
      if (dispatch) {
        // Command succeeds
      }
      return true;
    },
  fail:
    () =>
    ({ dispatch }) => {
      if (dispatch) {
        // Command would fail
      }
      return false;
    },
  insertText:
    (...args: unknown[]) =>
    ({ tr, dispatch }: CommandProps) => {
      const text = args[0] as string;
      if (dispatch) {
        tr.insertText(text);
      }
      return true;
    },
  withArgs:
    (...args: unknown[]) =>
    ({ dispatch }: CommandProps) => {
      const [a, b] = args as [number, string];
      if (dispatch) {
        // Use args
      }
      return a > 0 && b.length > 0;
    },
};

describe('ChainBuilder', () => {
  describe('constructor', () => {
    it('creates instance with provided options', () => {
      const editor = createMockEditor();
      const builder = new ChainBuilder({
        editor,
        rawCommands: testCommands,
      });

      expect(builder).toBeInstanceOf(ChainBuilder);
    });

    it('uses provided transaction if given', () => {
      const editor = createMockEditor();
      const customTr = editor.state.tr;
      customTr.insertText('test');

      const builder = new ChainBuilder({
        editor,
        rawCommands: testCommands,
        tr: customTr,
      });

      const chain = builder.proxy() as any;
      chain.run();

      // The custom transaction should have been used
      expect(customTr.steps.length).toBeGreaterThan(0);
    });
  });

  describe('proxy()', () => {
    it('returns chainable commands', () => {
      const editor = createMockEditor();
      const chain = createChainBuilder({
        editor,
        rawCommands: testCommands,
      }) as any;

      // Should be able to chain commands
      const result = chain.succeed().succeed();
      expect(result).toBeDefined();
      expect(typeof result.run).toBe('function');
    });

    it('caches proxy instance', () => {
      const editor = createMockEditor();
      const builder = new ChainBuilder({
        editor,
        rawCommands: testCommands,
      });

      const proxy1 = builder.proxy();
      const proxy2 = builder.proxy();

      expect(proxy1).toBe(proxy2);
    });

    it('returns same proxy after command execution', () => {
      const editor = createMockEditor();
      const chain = createChainBuilder({
        editor,
        rawCommands: testCommands,
      }) as any;

      const afterSucceed = chain.succeed();
      const afterSecond = afterSucceed.succeed();

      expect(afterSucceed).toBe(afterSecond);
    });
  });

  describe('run()', () => {
    it('dispatches transaction when commands succeed', () => {
      const editor = createMockEditor();
      const dispatchSpy = vi.spyOn(editor.view, 'dispatch');

      const chain = createChainBuilder({
        editor,
        rawCommands: testCommands,
      }) as any;

      const result = chain.insertText('hello').run();

      expect(result).toBe(true);
      expect(dispatchSpy).toHaveBeenCalled();
    });

    it('returns false when editor is destroyed', () => {
      const editor = createMockEditor({ isDestroyed: true });

      const chain = createChainBuilder({
        editor,
        rawCommands: testCommands,
      }) as any;

      const result = chain.succeed().run();

      expect(result).toBe(false);
    });

    it('returns false when a command failed', () => {
      const editor = createMockEditor();

      const chain = createChainBuilder({
        editor,
        rawCommands: testCommands,
      }) as any;

      const result = chain.succeed().fail().run();

      expect(result).toBe(false);
    });

    it('returns true without dispatching when no changes', () => {
      const editor = createMockEditor();
      const dispatchSpy = vi.spyOn(editor.view, 'dispatch');

      const chain = createChainBuilder({
        editor,
        rawCommands: testCommands,
      }) as any;

      const result = chain.succeed().run();

      expect(result).toBe(true);
      expect(dispatchSpy).not.toHaveBeenCalled();
    });
  });

  describe('command()', () => {
    it('executes custom command function', () => {
      const editor = createMockEditor();
      const customFn = vi.fn(() => true);

      const chain = createChainBuilder({
        editor,
        rawCommands: testCommands,
      }) as any;

      chain.command(customFn).run();

      expect(customFn).toHaveBeenCalled();
    });

    it('receives CommandProps', () => {
      const editor = createMockEditor();
      let receivedProps: CommandProps | null = null;

      const chain = createChainBuilder({
        editor,
        rawCommands: testCommands,
      }) as any;

      chain
        .command((props: CommandProps) => {
          receivedProps = props;
          return true;
        })
        .run();

      expect(receivedProps).not.toBeNull();
      expect(receivedProps!.tr).toBeDefined();
      expect(receivedProps!.state).toBeDefined();
      expect(receivedProps!.dispatch).toBeDefined();
    });

    it('sets shouldDispatch to false when custom command fails', () => {
      const editor = createMockEditor();

      const chain = createChainBuilder({
        editor,
        rawCommands: testCommands,
      }) as any;

      const result = chain.command(() => false).run();

      expect(result).toBe(false);
    });

    it('returns chainable proxy', () => {
      const editor = createMockEditor();

      const chain = createChainBuilder({
        editor,
        rawCommands: testCommands,
      }) as any;

      const afterCommand = chain.command(() => true);

      expect(typeof afterCommand.run).toBe('function');
      expect(typeof afterCommand.succeed).toBe('function');
    });
  });

  describe('unknown commands', () => {
    it('returns proxy for unknown commands (no-op)', () => {
      const editor = createMockEditor();

      const chain = createChainBuilder({
        editor,
        rawCommands: testCommands,
      }) as any;

      const result = chain.unknownCommand();

      expect(result).toBeDefined();
      expect(typeof result.run).toBe('function');
    });
  });

  describe('command arguments', () => {
    it('passes arguments to commands', () => {
      const editor = createMockEditor();

      const chain = createChainBuilder({
        editor,
        rawCommands: testCommands,
      }) as any;

      // withArgs returns true when a > 0 and b.length > 0
      const result1 = chain.withArgs(1, 'test').run();
      expect(result1).toBe(true);

      const chain2 = createChainBuilder({
        editor,
        rawCommands: testCommands,
      }) as any;

      // withArgs returns false when a <= 0
      const result2 = chain2.withArgs(0, 'test').run();
      expect(result2).toBe(false);
    });
  });

  describe('getFailure()', () => {
    it('returns null when no failure', () => {
      const editor = createMockEditor();

      const chain = createChainBuilder({
        editor,
        rawCommands: testCommands,
      }) as any;

      chain.succeed();
      expect(chain.getFailure()).toBeNull();
    });

    it('returns failure info for failed command', () => {
      const editor = createMockEditor();

      const chain = createChainBuilder({
        editor,
        rawCommands: testCommands,
      }) as any;

      chain.fail();
      const failure = chain.getFailure();

      expect(failure).not.toBeNull();
      expect(failure.command).toBe('fail');
      expect(failure.index).toBe(0);
    });

    it('returns failure info for unknown command', () => {
      const editor = createMockEditor();

      const chain = createChainBuilder({
        editor,
        rawCommands: testCommands,
      }) as any;

      chain.succeed().nonExistentCommand('arg1', 'arg2');
      const failure = chain.getFailure();

      expect(failure).not.toBeNull();
      expect(failure.command).toBe('nonExistentCommand');
      expect(failure.args).toEqual(['arg1', 'arg2']);
      expect(failure.index).toBe(1);
    });

    it('only records first failure', () => {
      const editor = createMockEditor();

      const chain = createChainBuilder({
        editor,
        rawCommands: testCommands,
      }) as any;

      chain.fail().nonExistentCommand();
      const failure = chain.getFailure();

      expect(failure.command).toBe('fail');
      expect(failure.index).toBe(0);
    });
  });

  describe('can()', () => {
    it('can() is accessible from CommandProps', () => {
      const editor = createMockEditor();
      let canResult: boolean | undefined;

      const chain = createChainBuilder({
        editor,
        rawCommands: testCommands,
      }) as any;

      chain.command((props: CommandProps) => {
        canResult = (props.can() as any).succeed();
        return true;
      }).run();

      expect(canResult).toBe(true);
    });

    it('can() returns false for failing command', () => {
      const editor = createMockEditor();
      let canResult: boolean | undefined;

      const chain = createChainBuilder({
        editor,
        rawCommands: testCommands,
      }) as any;

      chain.command((props: CommandProps) => {
        canResult = (props.can() as any).fail();
        return true;
      }).run();

      expect(canResult).toBe(false);
    });

    it('can() returns false for unknown command', () => {
      const editor = createMockEditor();
      let canResult: boolean | undefined;

      const chain = createChainBuilder({
        editor,
        rawCommands: testCommands,
      }) as any;

      chain.command((props: CommandProps) => {
        canResult = (props.can() as any).nonExistent();
        return true;
      }).run();

      expect(canResult).toBe(false);
    });

    it('can().chain() checks chained commands dry-run', () => {
      const editor = createMockEditor();
      let canChainResult: boolean | undefined;

      const chain = createChainBuilder({
        editor,
        rawCommands: testCommands,
      }) as any;

      chain.command((props: CommandProps) => {
        canChainResult = (props.can().chain() as any).succeed().succeed().run();
        return true;
      }).run();

      expect(canChainResult).toBe(true);
    });

    it('can().chain() returns false when a command fails', () => {
      const editor = createMockEditor();
      let canChainResult: boolean | undefined;

      const chain = createChainBuilder({
        editor,
        rawCommands: testCommands,
      }) as any;

      chain.command((props: CommandProps) => {
        canChainResult = (props.can().chain() as any).succeed().fail().run();
        return true;
      }).run();

      expect(canChainResult).toBe(false);
    });

    it('can().chain() returns false for unknown command', () => {
      const editor = createMockEditor();
      let canChainResult: boolean | undefined;

      const chain = createChainBuilder({
        editor,
        rawCommands: testCommands,
      }) as any;

      chain.command((props: CommandProps) => {
        canChainResult = (props.can().chain() as any).nonExistent().run();
        return true;
      }).run();

      expect(canChainResult).toBe(false);
    });
  });

  describe('commands()', () => {
    it('commands() is accessible from CommandProps', () => {
      const editor = createMockEditor();
      let cmdResult: boolean | undefined;

      const chain = createChainBuilder({
        editor,
        rawCommands: testCommands,
      }) as any;

      chain.command((props: CommandProps) => {
        cmdResult = (props.commands as any).succeed();
        return true;
      }).run();

      expect(cmdResult).toBe(true);
    });

    it('commands() returns false for failing command', () => {
      const editor = createMockEditor();
      let cmdResult: boolean | undefined;

      const chain = createChainBuilder({
        editor,
        rawCommands: testCommands,
      }) as any;

      chain.command((props: CommandProps) => {
        cmdResult = (props.commands as any).fail();
        return true;
      }).run();

      expect(cmdResult).toBe(false);
    });

    it('commands() returns false for unknown command', () => {
      const editor = createMockEditor();
      let cmdResult: boolean | undefined;

      const chain = createChainBuilder({
        editor,
        rawCommands: testCommands,
      }) as any;

      chain.command((props: CommandProps) => {
        cmdResult = (props.commands as any).nonExistent();
        return true;
      }).run();

      expect(cmdResult).toBe(false);
    });

    it('commands() caches SingleCommands proxy', () => {
      const editor = createMockEditor();
      let cmds1: any;
      let cmds2: any;

      const chain = createChainBuilder({
        editor,
        rawCommands: testCommands,
      }) as any;

      chain.command((props: CommandProps) => {
        cmds1 = props.commands;
        return true;
      }).command((props: CommandProps) => {
        cmds2 = props.commands;
        return true;
      }).run();

      expect(cmds1).toBe(cmds2);
    });
  });

  describe('chain() from CommandProps', () => {
    it('chain() is accessible from CommandProps', () => {
      const editor = createMockEditor();
      let chainResult: boolean | undefined;

      const chain = createChainBuilder({
        editor,
        rawCommands: testCommands,
      }) as any;

      chain.command((props: CommandProps) => {
        chainResult = typeof props.chain === 'function';
        return true;
      }).run();

      expect(chainResult).toBe(true);
    });
  });
});

describe('createChainBuilder', () => {
  it('returns ChainedCommands proxy', () => {
    const editor = createMockEditor();

    const chain = createChainBuilder({
      editor,
      rawCommands: testCommands,
    }) as any;

    expect(typeof chain.run).toBe('function');
  });
});
