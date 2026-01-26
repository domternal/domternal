/**
 * CommandManager tests
 *
 * Testing Proxy-based dynamic command API requires flexible typing.
 * ESLint rules for `any` are disabled as this is standard practice for testing dynamic APIs.
 */
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Schema } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { CommandManager } from './CommandManager.js';
import type { RawCommands } from './types/Commands.js';

// Test schema
const testSchema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: {
      content: 'inline*',
      toDOM() {
        return ['p', 0];
      },
      parseDOM: [{ tag: 'p' }],
    },
    text: { group: 'inline' },
  },
});

// Mock editor interface for testing
interface MockEditor {
  view: EditorView;
  state: EditorState;
  isDestroyed: boolean;
  emit: () => void;
  extensionManager: {
    commands: RawCommands;
  };
  cleanup: () => void;
}

// Create mock editor with real ProseMirror view
function createMockEditor(content?: string): MockEditor {
  const element = document.createElement('div');
  document.body.appendChild(element);

  const doc = content
    ? testSchema.node('doc', null, [
        testSchema.node('paragraph', null, [testSchema.text(content)]),
      ])
    : testSchema.node('doc', null, [testSchema.node('paragraph')]);

  const state = EditorState.create({ schema: testSchema, doc });
  const view = new EditorView(element, { state });

  return {
    view,
    get state() {
      return this.view.state;
    },
    isDestroyed: false,
    emit: (): void => {
      // No-op for tests
    },
    extensionManager: {
      commands: {} as RawCommands,
    },
    cleanup: () => {
      view.destroy();
      element.remove();
    },
  };
}

describe('CommandManager', () => {
  let mockEditor: MockEditor;
  let manager: CommandManager;

  beforeEach(() => {
    mockEditor = createMockEditor('Hello world');
    // Cast to any to satisfy TypeScript - mock doesn't need full interface
    manager = new CommandManager(mockEditor as any);
  });

  afterEach(() => {
    mockEditor.cleanup();
  });

  describe('rawCommands', () => {
    it('includes built-in commands', () => {
      const commands = manager.rawCommands;
      expect(commands['focus']).toBeDefined();
      expect(commands['blur']).toBeDefined();
      expect(commands['setContent']).toBeDefined();
      expect(commands['clearContent']).toBeDefined();
      expect(commands['insertText']).toBeDefined();
      expect(commands['deleteSelection']).toBeDefined();
      expect(commands['selectAll']).toBeDefined();
    });

    it('merges extension commands', () => {
      const customCommand = () => () => true;
      mockEditor.extensionManager.commands = {
        customCommand,
      } as unknown as RawCommands;

      // Clear cache to pick up new commands
      manager.clearCache();

      const commands = manager.rawCommands;
      expect(commands['customCommand']).toBe(customCommand);
    });
  });

  describe('commands (SingleCommands)', () => {
    let commands: any;

    beforeEach(() => {
      commands = manager.commands;
    });

    describe('focus', () => {
      it('returns true when focusing connected editor', () => {
        const result = commands.focus();
        expect(result).toBe(true);
      });

      it('returns false when editor is destroyed', () => {
        mockEditor.isDestroyed = true;
        const result = commands.focus();
        expect(result).toBe(false);
      });

      it('returns false when view is not connected to DOM', () => {
        mockEditor.view.dom.remove();
        const result = commands.focus();
        expect(result).toBe(false);
      });

      it('focuses at start position', () => {
        commands.focus('start');
        const { from } = mockEditor.view.state.selection;
        expect(from).toBe(1);
      });

      it('focuses at end position', () => {
        commands.focus('end');
        const { from } = mockEditor.view.state.selection;
        expect(from).toBeGreaterThan(1);
      });

      it('selects all with "all" position', () => {
        commands.focus('all');
        const { from, to } = mockEditor.view.state.selection;
        expect(from).toBe(0);
        expect(to).toBe(mockEditor.view.state.doc.content.size);
      });
    });

    describe('blur', () => {
      it('returns true when blurring', () => {
        commands.focus();
        const result = commands.blur();
        expect(result).toBe(true);
      });

      it('returns false when editor is destroyed', () => {
        mockEditor.isDestroyed = true;
        const result = commands.blur();
        expect(result).toBe(false);
      });
    });

    describe('setContent', () => {
      it('sets content from HTML string', () => {
        const result = commands.setContent('<p>New content</p>');
        expect(result).toBe(true);

        const text = mockEditor.view.state.doc.textContent;
        expect(text).toBe('New content');
      });

      it('sets content from JSON object', () => {
        const result = commands.setContent({
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'JSON content' }],
            },
          ],
        });
        expect(result).toBe(true);

        const text = mockEditor.view.state.doc.textContent;
        expect(text).toBe('JSON content');
      });
    });

    describe('clearContent', () => {
      it('clears the editor content', () => {
        const result = commands.clearContent();
        expect(result).toBe(true);

        const text = mockEditor.view.state.doc.textContent;
        expect(text).toBe('');
      });
    });

    describe('insertText', () => {
      it('inserts text at current selection', () => {
        commands.focus('start');
        const result = commands.insertText('Inserted ');
        expect(result).toBe(true);

        const text = mockEditor.view.state.doc.textContent;
        expect(text).toContain('Inserted');
      });
    });

    describe('deleteSelection', () => {
      it('deletes selected text', () => {
        commands.focus('all');
        const result = commands.deleteSelection();
        expect(result).toBe(true);
      });

      it('returns false when selection is empty', () => {
        commands.focus('start');
        const result = commands.deleteSelection();
        expect(result).toBe(false);
      });
    });

    describe('selectAll', () => {
      it('selects all content', () => {
        const result = commands.selectAll();
        expect(result).toBe(true);

        const { from, to } = mockEditor.view.state.selection;
        expect(from).toBe(0);
        expect(to).toBe(mockEditor.view.state.doc.content.size);
      });
    });

    describe('unknown command', () => {
      it('returns false for unknown commands', () => {
        const result = commands.unknownCommand();
        expect(result).toBe(false);
      });
    });
  });

  describe('chain()', () => {
    it('returns ChainedCommands proxy', () => {
      const chain = manager.chain() as any;
      expect(chain).toBeDefined();
      expect(typeof chain.focus).toBe('function');
      expect(typeof chain.run).toBe('function');
    });

    it('chains multiple commands', () => {
      const chain = manager.chain() as any;
      const result = chain.focus('start').insertText('Chain ').run();
      expect(result).toBe(true);

      const text = mockEditor.view.state.doc.textContent;
      expect(text).toContain('Chain');
    });

    it('executes all commands in single transaction', () => {
      const chain = manager.chain() as any;
      chain.focus('start').insertText('A').insertText('B').insertText('C').run();

      const text = mockEditor.view.state.doc.textContent;
      expect(text).toContain('ABC');
    });

    it('does not dispatch if a command fails', () => {
      const initialContent = mockEditor.view.state.doc.textContent;

      // deleteSelection will fail because selection is empty after focus('start')
      const chain = manager.chain() as any;
      const result = chain.focus('start').deleteSelection().run();

      expect(result).toBe(false);
      // Content should be unchanged because chain failed
      expect(mockEditor.view.state.doc.textContent).toBe(initialContent);
    });

    it('supports command() helper for inline commands', () => {
      const chain = manager.chain() as any;
      const result = chain
        .focus('start')
        .command(({ tr }: any) => {
          tr.insertText('Custom ');
          return true;
        })
        .run();

      expect(result).toBe(true);
      const text = mockEditor.view.state.doc.textContent;
      expect(text).toContain('Custom');
    });
  });

  describe('can()', () => {
    it('returns CanCommands proxy', () => {
      const can = manager.can() as any;
      expect(can).toBeDefined();
      expect(typeof can.focus).toBe('function');
      expect(typeof can.chain).toBe('function');
    });

    it('checks if command can be executed', () => {
      const can = manager.can() as any;
      const commands = manager.commands as any;

      // focus can always be executed
      expect(can.focus()).toBe(true);

      // deleteSelection can only be executed if there's a selection
      commands.focus('start');
      expect(can.deleteSelection()).toBe(false);

      commands.focus('all');
      expect(can.deleteSelection()).toBe(true);
    });

    it('does not modify document state', () => {
      const initialContent = mockEditor.view.state.doc.textContent;
      const can = manager.can() as any;

      // These are dry-run checks - should not change anything
      can.focus();
      can.insertText('Should not appear');
      can.clearContent();

      expect(mockEditor.view.state.doc.textContent).toBe(initialContent);
    });

    it('supports chained can() checks', () => {
      const commands = manager.commands as any;
      const can = manager.can() as any;

      commands.focus('all');

      // Chain of commands that should all succeed
      const canExecute = can.chain().focus().insertText('Test').run();
      expect(canExecute).toBe(true);

      // Chain with a failing command
      commands.focus('start'); // Reset to empty selection
      const cannotExecute = can.chain().deleteSelection().run();
      expect(cannotExecute).toBe(false);
    });
  });

  describe('clearCache', () => {
    it('clears cached rawCommands', () => {
      // Access to cache commands
      const commands1 = manager.rawCommands;

      // Add new extension command
      mockEditor.extensionManager.commands = {
        newCommand: () => () => true,
      } as unknown as RawCommands;

      // Without clearing, should still return old cache
      const commands2 = manager.rawCommands;
      expect(commands2).toBe(commands1);

      // After clearing, should return new commands
      manager.clearCache();
      const commands3 = manager.rawCommands;
      expect(commands3).not.toBe(commands1);
      expect(commands3['newCommand']).toBeDefined();
    });
  });
});
