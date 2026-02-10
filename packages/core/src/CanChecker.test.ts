/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return, @typescript-eslint/explicit-function-return-type */
import { describe, it, expect } from 'vitest';
import { Schema } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { CanChecker, createCanChecker } from './CanChecker.js';
import type { CommandMap } from './types/Commands.js';

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
  canExecute:
    () =>
    () => {
      // This command can always execute (regardless of dispatch)
      return true;
    },
  cannotExecute:
    () =>
    () => {
      // This command can never execute
      return false;
    },
  checkDispatch:
    () =>
    ({ dispatch }) => {
      // Returns true only in dry-run mode (dispatch undefined)
      return dispatch === undefined;
    },
  withArgs:
    (...args: unknown[]) =>
    () => {
      const [a, b] = args as [number, string];
      return a > 0 && b.length > 0;
    },
};

// Mock chain builder
function createMockChainBuilder() {
  return {
    run: () => true,
  } as any;
}

describe('CanChecker', () => {
  describe('constructor', () => {
    it('creates instance with provided options', () => {
      const editor = createMockEditor();
      const checker = new CanChecker({
        editor,
        rawCommands: testCommands,
        createChainBuilder: createMockChainBuilder,
      });

      expect(checker).toBeInstanceOf(CanChecker);
    });
  });

  describe('proxy()', () => {
    it('returns CanCommands with dynamic methods', () => {
      const editor = createMockEditor();
      const can = createCanChecker({
        editor,
        rawCommands: testCommands,
        createChainBuilder: createMockChainBuilder,
      }) as any;

      expect(typeof can.canExecute).toBe('function');
      expect(typeof can.chain).toBe('function');
    });

    it('returns true for command that can execute', () => {
      const editor = createMockEditor();
      const can = createCanChecker({
        editor,
        rawCommands: testCommands,
        createChainBuilder: createMockChainBuilder,
      }) as any;

      expect(can.canExecute()).toBe(true);
    });

    it('returns false for command that cannot execute', () => {
      const editor = createMockEditor();
      const can = createCanChecker({
        editor,
        rawCommands: testCommands,
        createChainBuilder: createMockChainBuilder,
      }) as any;

      expect(can.cannotExecute()).toBe(false);
    });

    it('returns false for unknown commands', () => {
      const editor = createMockEditor();
      const can = createCanChecker({
        editor,
        rawCommands: testCommands,
        createChainBuilder: createMockChainBuilder,
      }) as any;

      expect(can.unknownCommand()).toBe(false);
    });

    it('returns false when editor is destroyed', () => {
      const editor = createMockEditor({ isDestroyed: true });
      const can = createCanChecker({
        editor,
        rawCommands: testCommands,
        createChainBuilder: createMockChainBuilder,
      }) as any;

      expect(can.canExecute()).toBe(false);
    });

    it('passes dispatch=undefined for dry-run mode', () => {
      const editor = createMockEditor();
      const can = createCanChecker({
        editor,
        rawCommands: testCommands,
        createChainBuilder: createMockChainBuilder,
      }) as any;

      // checkDispatch returns true only when dispatch is undefined
      expect(can.checkDispatch()).toBe(true);
    });

    it('passes arguments to commands', () => {
      const editor = createMockEditor();
      const can = createCanChecker({
        editor,
        rawCommands: testCommands,
        createChainBuilder: createMockChainBuilder,
      }) as any;

      expect(can.withArgs(1, 'test')).toBe(true);
      expect(can.withArgs(0, 'test')).toBe(false);
      expect(can.withArgs(1, '')).toBe(false);
    });
  });

  describe('chainProxy()', () => {
    it('returns CanChainedCommands from can().chain()', () => {
      const editor = createMockEditor();
      const can = createCanChecker({
        editor,
        rawCommands: testCommands,
        createChainBuilder: createMockChainBuilder,
      }) as any;

      const chain = can.chain();

      expect(chain).toBeDefined();
      expect(typeof chain.run).toBe('function');
    });

    it('returns true when all commands can execute', () => {
      const editor = createMockEditor();
      const can = createCanChecker({
        editor,
        rawCommands: testCommands,
        createChainBuilder: createMockChainBuilder,
      }) as any;

      const result = can.chain().canExecute().canExecute().run();

      expect(result).toBe(true);
    });

    it('returns false when any command cannot execute', () => {
      const editor = createMockEditor();
      const can = createCanChecker({
        editor,
        rawCommands: testCommands,
        createChainBuilder: createMockChainBuilder,
      }) as any;

      const result = can.chain().canExecute().cannotExecute().run();

      expect(result).toBe(false);
    });

    it('returns false for unknown commands in chain', () => {
      const editor = createMockEditor();
      const can = createCanChecker({
        editor,
        rawCommands: testCommands,
        createChainBuilder: createMockChainBuilder,
      }) as any;

      const result = can.chain().canExecute().unknownCommand().run();

      expect(result).toBe(false);
    });

    it('returns false when editor is destroyed during chain', () => {
      const editor = createMockEditor({ isDestroyed: true });
      const can = createCanChecker({
        editor,
        rawCommands: testCommands,
        createChainBuilder: createMockChainBuilder,
      }) as any;

      const result = can.chain().canExecute().run();

      expect(result).toBe(false);
    });

    it('returns chainable proxy after each command', () => {
      const editor = createMockEditor();
      const can = createCanChecker({
        editor,
        rawCommands: testCommands,
        createChainBuilder: createMockChainBuilder,
      }) as any;

      const chain = can.chain();
      const afterFirst = chain.canExecute();
      const afterSecond = afterFirst.canExecute();

      expect(afterFirst).toBe(chain);
      expect(afterSecond).toBe(chain);
    });
  });
});

describe('createCanChecker', () => {
  it('returns CanCommands proxy', () => {
    const editor = createMockEditor();
    const can = createCanChecker({
      editor,
      rawCommands: testCommands,
      createChainBuilder: createMockChainBuilder,
    }) as any;

    expect(typeof can.canExecute).toBe('function');
    expect(typeof can.chain).toBe('function');
  });
});
