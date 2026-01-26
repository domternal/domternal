/**
 * CommandManager tests
 *
 * Testing Proxy-based dynamic command API requires flexible typing.
 * ESLint rules for `any` are disabled as this is standard practice for testing dynamic APIs.
 */
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Schema } from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { CommandManager } from './CommandManager.js';
import type { RawCommands } from './types/Commands.js';

// Mock getClientRects for JSDOM (ProseMirror uses it for scrolling)
Range.prototype.getClientRects = vi.fn(() => ({
  length: 0,
  item: () => null,
  [Symbol.iterator]: function* () {},
})) as any;

// Mock getBoundingClientRect for Range
Range.prototype.getBoundingClientRect = vi.fn(() => ({
  top: 0,
  left: 0,
  bottom: 0,
  right: 0,
  width: 0,
  height: 0,
  x: 0,
  y: 0,
  toJSON: () => ({}),
})) as any;

// Basic test schema (for original tests)
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

// Extended test schema with marks and more node types
const extendedSchema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: {
      group: 'block',
      content: 'inline*',
      toDOM() {
        return ['p', 0];
      },
      parseDOM: [{ tag: 'p' }],
    },
    heading: {
      group: 'block',
      content: 'inline*',
      attrs: { level: { default: 1 } },
      toDOM(node) {
        return [`h${node.attrs['level'] as number}`, 0];
      },
      parseDOM: [
        { tag: 'h1', attrs: { level: 1 } },
        { tag: 'h2', attrs: { level: 2 } },
      ],
    },
    blockquote: {
      group: 'block',
      content: 'block+',
      toDOM() {
        return ['blockquote', 0];
      },
      parseDOM: [{ tag: 'blockquote' }],
    },
    bulletList: {
      group: 'block list',
      content: 'listItem+',
      toDOM() {
        return ['ul', 0];
      },
      parseDOM: [{ tag: 'ul' }],
    },
    orderedList: {
      group: 'block list',
      content: 'listItem+',
      toDOM() {
        return ['ol', 0];
      },
      parseDOM: [{ tag: 'ol' }],
    },
    listItem: {
      content: 'paragraph block*',
      toDOM() {
        return ['li', 0];
      },
      parseDOM: [{ tag: 'li' }],
    },
    horizontalRule: {
      group: 'block',
      toDOM() {
        return ['hr'];
      },
      parseDOM: [{ tag: 'hr' }],
    },
    text: { group: 'inline' },
  },
  marks: {
    bold: {
      toDOM() {
        return ['strong', 0];
      },
      parseDOM: [{ tag: 'strong' }, { tag: 'b' }],
    },
    italic: {
      toDOM() {
        return ['em', 0];
      },
      parseDOM: [{ tag: 'em' }, { tag: 'i' }],
    },
  },
});

// Mock editor interface for testing
interface MockEditor {
  view: EditorView;
  state: EditorState;
  schema: Schema;
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
    schema: testSchema,
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

// Create mock editor with extended schema (marks, blockquote, lists, etc.)
function createExtendedMockEditor(content?: string): MockEditor {
  const element = document.createElement('div');
  document.body.appendChild(element);

  const doc = content
    ? extendedSchema.node('doc', null, [
        extendedSchema.node('paragraph', null, [extendedSchema.text(content)]),
      ])
    : extendedSchema.node('doc', null, [extendedSchema.node('paragraph')]);

  const state = EditorState.create({ schema: extendedSchema, doc });
  const view = new EditorView(element, { state });

  return {
    view,
    get state() {
      return this.view.state;
    },
    schema: extendedSchema,
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

// =============================================================================
// Extended Command Tests (Mark, Block, List commands)
// =============================================================================

describe('CommandManager - Mark Commands', () => {
  let mockEditor: MockEditor;
  let manager: CommandManager;
  let commands: any;

  beforeEach(() => {
    mockEditor = createExtendedMockEditor('Hello world');
    manager = new CommandManager(mockEditor as any);
    commands = manager.commands;
  });

  afterEach(() => {
    mockEditor.cleanup();
  });

  describe('toggleMark', () => {
    it('applies mark to selection', () => {
      // Use TextSelection instead of AllSelection for marks
      const { state, view } = mockEditor;
      const tr = state.tr.setSelection(TextSelection.create(state.doc, 1, state.doc.content.size - 1));
      view.dispatch(tr);

      const result = commands.toggleMark('bold');
      expect(result).toBe(true);

      // Check that bold mark is applied
      const { doc } = mockEditor.view.state;
      const textNode = doc.firstChild?.firstChild;
      expect(textNode?.marks.some((m: any) => m.type.name === 'bold')).toBe(true);
    });

    it('removes mark when already applied', () => {
      // First apply bold with TextSelection
      const { state, view } = mockEditor;
      const tr = state.tr.setSelection(TextSelection.create(state.doc, 1, state.doc.content.size - 1));
      view.dispatch(tr);
      commands.toggleMark('bold');

      // Reselect (state changed after toggleMark)
      const state2 = mockEditor.view.state;
      const tr2 = state2.tr.setSelection(TextSelection.create(state2.doc, 1, state2.doc.content.size - 1));
      mockEditor.view.dispatch(tr2);

      // Then toggle again to remove
      const result = commands.toggleMark('bold');
      expect(result).toBe(true);

      // Check that bold mark is removed
      const { doc } = mockEditor.view.state;
      const textNode = doc.firstChild?.firstChild;
      expect(textNode?.marks.some((m: any) => m.type.name === 'bold')).toBe(false);
    });

    it('returns false for unknown mark', () => {
      commands.focus('start');
      const result = commands.toggleMark('unknownMark');
      expect(result).toBe(false);
    });
  });

  describe('setMark', () => {
    it('adds mark to selection', () => {
      // Use TextSelection for marks
      const { state, view } = mockEditor;
      const tr = state.tr.setSelection(TextSelection.create(state.doc, 1, state.doc.content.size - 1));
      view.dispatch(tr);

      const result = commands.setMark('italic');
      expect(result).toBe(true);

      const { doc } = mockEditor.view.state;
      const textNode = doc.firstChild?.firstChild;
      expect(textNode?.marks.some((m: any) => m.type.name === 'italic')).toBe(true);
    });

    it('adds stored mark on empty selection', () => {
      commands.focus('start');
      const result = commands.setMark('bold');
      expect(result).toBe(true);

      // Check stored marks
      const storedMarks = mockEditor.view.state.storedMarks;
      expect(storedMarks?.some((m: any) => m.type.name === 'bold')).toBe(true);
    });

    it('returns false for unknown mark', () => {
      commands.focus('start');
      const result = commands.setMark('unknownMark');
      expect(result).toBe(false);
    });
  });

  describe('unsetMark', () => {
    it('removes mark from selection', () => {
      // First apply mark with TextSelection
      const { state, view } = mockEditor;
      const tr = state.tr.setSelection(TextSelection.create(state.doc, 1, state.doc.content.size - 1));
      view.dispatch(tr);
      commands.setMark('bold');

      // Reselect and unset
      const state2 = mockEditor.view.state;
      const tr2 = state2.tr.setSelection(TextSelection.create(state2.doc, 1, state2.doc.content.size - 1));
      mockEditor.view.dispatch(tr2);

      const result = commands.unsetMark('bold');
      expect(result).toBe(true);

      const { doc } = mockEditor.view.state;
      const textNode = doc.firstChild?.firstChild;
      expect(textNode?.marks.some((m: any) => m.type.name === 'bold')).toBe(false);
    });

    it('removes stored mark on empty selection', () => {
      // First add stored mark
      commands.focus('start');
      commands.setMark('bold');

      // Then unset it
      const result = commands.unsetMark('bold');
      expect(result).toBe(true);

      const storedMarks = mockEditor.view.state.storedMarks;
      expect(storedMarks?.some((m: any) => m.type.name === 'bold')).toBeFalsy();
    });

    it('returns false for unknown mark', () => {
      const result = commands.unsetMark('unknownMark');
      expect(result).toBe(false);
    });
  });
});

describe('CommandManager - Block Commands', () => {
  let mockEditor: MockEditor;
  let manager: CommandManager;
  let commands: any;

  beforeEach(() => {
    mockEditor = createExtendedMockEditor('Hello world');
    manager = new CommandManager(mockEditor as any);
    commands = manager.commands;
  });

  afterEach(() => {
    mockEditor.cleanup();
  });

  describe('setBlockType', () => {
    it('changes paragraph to heading', () => {
      commands.focus('start');
      const result = commands.setBlockType('heading', { level: 1 });
      expect(result).toBe(true);

      const { doc } = mockEditor.view.state;
      expect(doc.firstChild?.type.name).toBe('heading');
      expect(doc.firstChild?.attrs['level']).toBe(1);
    });

    it('returns false for unknown node type', () => {
      commands.focus('start');
      const result = commands.setBlockType('unknownNode');
      expect(result).toBe(false);
    });
  });

  describe('toggleBlockType', () => {
    it('toggles paragraph to heading', () => {
      commands.focus('start');
      const result = commands.toggleBlockType('heading', 'paragraph', { level: 2 });
      expect(result).toBe(true);

      const { doc } = mockEditor.view.state;
      expect(doc.firstChild?.type.name).toBe('heading');
    });

    it('toggles heading back to paragraph', () => {
      // First change to heading
      commands.focus('start');
      commands.setBlockType('heading', { level: 1 });

      // Then toggle back
      const result = commands.toggleBlockType('heading', 'paragraph', { level: 1 });
      expect(result).toBe(true);

      const { doc } = mockEditor.view.state;
      expect(doc.firstChild?.type.name).toBe('paragraph');
    });
  });

  describe('wrapIn', () => {
    it('wraps paragraph in blockquote', () => {
      commands.focus('start');
      const result = commands.wrapIn('blockquote');
      expect(result).toBe(true);

      const { doc } = mockEditor.view.state;
      expect(doc.firstChild?.type.name).toBe('blockquote');
      expect(doc.firstChild?.firstChild?.type.name).toBe('paragraph');
    });

    it('returns false for unknown node type', () => {
      commands.focus('start');
      const result = commands.wrapIn('unknownNode');
      expect(result).toBe(false);
    });
  });

  describe('toggleWrap', () => {
    it('wraps paragraph in blockquote', () => {
      commands.focus('start');
      const result = commands.toggleWrap('blockquote');
      expect(result).toBe(true);

      const { doc } = mockEditor.view.state;
      expect(doc.firstChild?.type.name).toBe('blockquote');
    });

    it('unwraps blockquote when already wrapped', () => {
      // First wrap
      commands.focus('start');
      commands.wrapIn('blockquote');

      // Then toggle to unwrap
      commands.focus('start');
      const result = commands.toggleWrap('blockquote');
      expect(result).toBe(true);

      const { doc } = mockEditor.view.state;
      expect(doc.firstChild?.type.name).toBe('paragraph');
    });
  });

  describe('lift', () => {
    it('lifts paragraph out of blockquote', () => {
      // First wrap in blockquote
      commands.focus('start');
      commands.wrapIn('blockquote');

      // Then lift out
      commands.focus('start');
      const result = commands.lift();
      expect(result).toBe(true);

      const { doc } = mockEditor.view.state;
      expect(doc.firstChild?.type.name).toBe('paragraph');
    });

    it('returns false when nothing to lift', () => {
      commands.focus('start');
      const result = commands.lift();
      expect(result).toBe(false);
    });
  });
});

describe('CommandManager - List Commands', () => {
  let mockEditor: MockEditor;
  let manager: CommandManager;
  let commands: any;

  beforeEach(() => {
    mockEditor = createExtendedMockEditor('Hello world');
    manager = new CommandManager(mockEditor as any);
    commands = manager.commands;
  });

  afterEach(() => {
    mockEditor.cleanup();
  });

  describe('toggleList', () => {
    it('wraps paragraph in bullet list', () => {
      commands.focus('start');
      const result = commands.toggleList('bulletList', 'listItem');
      expect(result).toBe(true);

      const { doc } = mockEditor.view.state;
      expect(doc.firstChild?.type.name).toBe('bulletList');
      expect(doc.firstChild?.firstChild?.type.name).toBe('listItem');
    });

    it('wraps paragraph in ordered list', () => {
      commands.focus('start');
      const result = commands.toggleList('orderedList', 'listItem');
      expect(result).toBe(true);

      const { doc } = mockEditor.view.state;
      expect(doc.firstChild?.type.name).toBe('orderedList');
    });

    it('returns false for unknown list type', () => {
      commands.focus('start');
      const result = commands.toggleList('unknownList', 'listItem');
      expect(result).toBe(false);
    });
  });
});

describe('CommandManager - Insert Commands', () => {
  let mockEditor: MockEditor;
  let manager: CommandManager;
  let commands: any;

  beforeEach(() => {
    mockEditor = createExtendedMockEditor('Hello world');
    manager = new CommandManager(mockEditor as any);
    commands = manager.commands;
  });

  afterEach(() => {
    mockEditor.cleanup();
  });

  describe('insertContent', () => {
    it('inserts HTML content', () => {
      commands.focus('end');
      const result = commands.insertContent('<p>Inserted</p>');
      expect(result).toBe(true);

      const text = mockEditor.view.state.doc.textContent;
      expect(text).toContain('Inserted');
    });

    it('inserts JSON node content', () => {
      commands.focus('end');
      const result = commands.insertContent({
        type: 'paragraph',
        content: [{ type: 'text', text: 'JSON inserted' }],
      });
      expect(result).toBe(true);

      const text = mockEditor.view.state.doc.textContent;
      expect(text).toContain('JSON inserted');
    });

    it('inserts array of JSON nodes', () => {
      commands.focus('end');
      const result = commands.insertContent([
        { type: 'paragraph', content: [{ type: 'text', text: 'First' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Second' }] },
      ]);
      expect(result).toBe(true);

      const text = mockEditor.view.state.doc.textContent;
      expect(text).toContain('First');
      expect(text).toContain('Second');
    });

    it('returns false for invalid content', () => {
      commands.focus('start');
      const result = commands.insertContent(null);
      expect(result).toBe(false);
    });
  });
});

describe('CommandManager - Selection Commands', () => {
  let mockEditor: MockEditor;
  let manager: CommandManager;
  let commands: any;

  beforeEach(() => {
    mockEditor = createExtendedMockEditor('Hello world');
    manager = new CommandManager(mockEditor as any);
    commands = manager.commands;
  });

  afterEach(() => {
    mockEditor.cleanup();
  });

  describe('selectNodeBackward', () => {
    it('exists and is callable', () => {
      // selectNodeBackward is a ProseMirror command that selects the node
      // before the cursor when at the start of a textblock
      expect(typeof commands.selectNodeBackward).toBe('function');

      // At the start of document, there's no node to select backward
      commands.focus('start');
      const result = commands.selectNodeBackward();
      // Should return false when there's nothing to select
      expect(result).toBe(false);
    });
  });
});

describe('CommandManager - can() for new commands', () => {
  let mockEditor: MockEditor;
  let manager: CommandManager;
  let can: any;
  let commands: any;

  beforeEach(() => {
    mockEditor = createExtendedMockEditor('Hello world');
    manager = new CommandManager(mockEditor as any);
    can = manager.can();
    commands = manager.commands;
  });

  afterEach(() => {
    mockEditor.cleanup();
  });

  it('can.toggleMark() returns true with selection', () => {
    commands.selectAll();
    expect(can.toggleMark('bold')).toBe(true);
  });

  it('can.setBlockType() returns true for valid node', () => {
    commands.focus('start');
    expect(can.setBlockType('heading', { level: 1 })).toBe(true);
  });

  it('can.wrapIn() returns true for valid wrapper', () => {
    commands.focus('start');
    expect(can.wrapIn('blockquote')).toBe(true);
  });

  it('can.lift() returns false when nothing to lift', () => {
    commands.focus('start');
    expect(can.lift()).toBe(false);
  });

  it('can.lift() returns true when wrapped', () => {
    commands.focus('start');
    commands.wrapIn('blockquote');
    commands.focus('start');
    expect(can.lift()).toBe(true);
  });

  it('can.toggleList() returns true', () => {
    commands.focus('start');
    expect(can.toggleList('bulletList', 'listItem')).toBe(true);
  });

  it('can.insertContent() returns true for valid content', () => {
    commands.focus('start');
    expect(can.insertContent('<p>Test</p>')).toBe(true);
  });

  it('can() does not modify document', () => {
    const initialContent = mockEditor.view.state.doc.textContent;

    commands.selectAll();
    can.toggleMark('bold');
    can.setBlockType('heading');
    can.wrapIn('blockquote');
    can.insertContent('<p>Should not appear</p>');

    expect(mockEditor.view.state.doc.textContent).toBe(initialContent);
  });
});
