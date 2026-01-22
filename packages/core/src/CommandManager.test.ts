import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Schema } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { CommandManager } from './CommandManager.js';

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
  isDestroyed: boolean;
  emit: () => void;
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
    isDestroyed: false,
    emit: (): void => {
      // No-op for tests
    },
    cleanup: () => {
      view.destroy();
      element.remove();
    },
  };
}

describe('CommandManager', () => {
  let mockEditor: ReturnType<typeof createMockEditor>;
  let manager: CommandManager;

  beforeEach(() => {
    mockEditor = createMockEditor('Hello world');
    manager = new CommandManager(mockEditor);
  });

  afterEach(() => {
    mockEditor.cleanup();
  });

  describe('focus', () => {
    it('returns true when focusing connected editor', () => {
      const result = manager.focus();
      expect(result).toBe(true);
    });

    it('returns false when editor is destroyed', () => {
      mockEditor.isDestroyed = true;
      const result = manager.focus();
      expect(result).toBe(false);
    });

    it('returns false when view is not connected to DOM', () => {
      mockEditor.view.dom.remove();
      const result = manager.focus();
      expect(result).toBe(false);
    });

    it('focuses at start position', () => {
      manager.focus('start');
      const { from } = mockEditor.view.state.selection;
      expect(from).toBe(1);
    });

    it('focuses at end position', () => {
      manager.focus('end');
      const { from } = mockEditor.view.state.selection;
      // End position is doc.content.size - 1
      expect(from).toBeGreaterThan(1);
    });

    it('focuses with true (same as end)', () => {
      manager.focus(true);
      const { from } = mockEditor.view.state.selection;
      expect(from).toBeGreaterThan(1);
    });

    it('selects all with "all" position', () => {
      manager.focus('all');
      const { from, to } = mockEditor.view.state.selection;
      expect(from).toBe(0);
      expect(to).toBe(mockEditor.view.state.doc.content.size);
    });

    it('focuses at numeric position', () => {
      manager.focus(3);
      const { from } = mockEditor.view.state.selection;
      expect(from).toBe(3);
    });
  });

  describe('blur', () => {
    it('returns true when blurring', () => {
      manager.focus();
      const result = manager.blur();
      expect(result).toBe(true);
    });

    it('returns false when editor is destroyed', () => {
      mockEditor.isDestroyed = true;
      const result = manager.blur();
      expect(result).toBe(false);
    });
  });

  describe('setContent', () => {
    it('sets content from HTML string', () => {
      const result = manager.setContent('<p>New content</p>');
      expect(result).toBe(true);

      const text = mockEditor.view.state.doc.textContent;
      expect(text).toBe('New content');
    });

    it('sets content from JSON object', () => {
      const result = manager.setContent({
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

    it('returns false when editor is destroyed', () => {
      mockEditor.isDestroyed = true;
      const result = manager.setContent('<p>Test</p>');
      expect(result).toBe(false);
    });
  });

  describe('clearContent', () => {
    it('clears the editor content', () => {
      const result = manager.clearContent();
      expect(result).toBe(true);

      const text = mockEditor.view.state.doc.textContent;
      expect(text).toBe('');
    });

    it('returns false when editor is destroyed', () => {
      mockEditor.isDestroyed = true;
      const result = manager.clearContent();
      expect(result).toBe(false);
    });
  });

  describe('insertText', () => {
    it('inserts text at current selection', () => {
      manager.focus('start');
      const result = manager.insertText('Inserted ');
      expect(result).toBe(true);

      const text = mockEditor.view.state.doc.textContent;
      expect(text).toContain('Inserted');
    });

    it('returns false when editor is destroyed', () => {
      mockEditor.isDestroyed = true;
      const result = manager.insertText('Test');
      expect(result).toBe(false);
    });
  });

  describe('deleteSelection', () => {
    it('deletes selected text', () => {
      manager.focus('all');
      const result = manager.deleteSelection();
      expect(result).toBe(true);
    });

    it('returns false when selection is empty', () => {
      manager.focus('start');
      const result = manager.deleteSelection();
      expect(result).toBe(false);
    });

    it('returns false when editor is destroyed', () => {
      mockEditor.isDestroyed = true;
      const result = manager.deleteSelection();
      expect(result).toBe(false);
    });
  });

  describe('selectAll', () => {
    it('selects all content', () => {
      const result = manager.selectAll();
      expect(result).toBe(true);

      const { from, to } = mockEditor.view.state.selection;
      expect(from).toBe(0);
      expect(to).toBe(mockEditor.view.state.doc.content.size);
    });

    it('returns false when editor is destroyed', () => {
      mockEditor.isDestroyed = true;
      const result = manager.selectAll();
      expect(result).toBe(false);
    });
  });

  describe('chain', () => {
    it('throws error in Step 1.3', () => {
      expect(() => manager.chain()).toThrow('chain() is not available in Step 1.3');
    });
  });

  describe('can', () => {
    it('throws error in Step 1.3', () => {
      expect(() => manager.can()).toThrow('can() is not available in Step 1.3');
    });
  });
});
