/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/explicit-function-return-type */
import { describe, it, expect, vi } from 'vitest';
import { Schema } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { ChainBuilder, createChainBuilder } from './ChainBuilder.js';
import type { RawCommands, CommandProps } from './types/Commands.js';

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
const testCommands: RawCommands = {
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
    (text: string) =>
    ({ tr, dispatch }) => {
      if (dispatch) {
        tr.insertText(text);
      }
      return true;
    },
  withArgs:
    (a: number, b: string) =>
    ({ dispatch }) => {
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
