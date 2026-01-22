import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Schema } from 'prosemirror-model';
import { Editor } from './Editor.js';

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

describe('Editor', () => {
  let editor: Editor;

  afterEach(() => {
    if (editor && !editor.isDestroyed) {
      editor.destroy();
    }
  });

  describe('constructor', () => {
    it('creates editor with schema', () => {
      editor = new Editor({ schema: testSchema });

      expect(editor).toBeInstanceOf(Editor);
      expect(editor.schema).toBe(testSchema);
    });

    it('throws error without schema', () => {
      expect(() => new Editor({} as any)).toThrow('Editor requires a schema');
    });

    it('creates editor with content', () => {
      editor = new Editor({
        schema: testSchema,
        content: '<p>Hello world</p>',
      });

      expect(editor.getText()).toBe('Hello world');
    });

    it('creates editor with JSON content', () => {
      editor = new Editor({
        schema: testSchema,
        content: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'JSON content' }],
            },
          ],
        },
      });

      expect(editor.getText()).toBe('JSON content');
    });

    it('creates editor with element', () => {
      const element = document.createElement('div');
      document.body.appendChild(element);

      editor = new Editor({
        schema: testSchema,
        element,
      });

      expect(editor.view.dom.parentElement).toBe(element);
      element.remove();
    });

    it('creates detached editor without element', () => {
      editor = new Editor({ schema: testSchema });

      expect(editor.view.dom).toBeDefined();
    });

    it('sets editable to true by default', () => {
      editor = new Editor({ schema: testSchema });

      expect(editor.isEditable).toBe(true);
    });

    it('respects editable option', () => {
      editor = new Editor({
        schema: testSchema,
        editable: false,
      });

      expect(editor.isEditable).toBe(false);
    });
  });

  describe('getters', () => {
    beforeEach(() => {
      editor = new Editor({
        schema: testSchema,
        content: '<p>Test content</p>',
      });
    });

    it('state returns EditorState', () => {
      expect(editor.state).toBeDefined();
      expect(editor.state.doc).toBeDefined();
    });

    it('schema returns the schema', () => {
      expect(editor.schema).toBe(testSchema);
    });

    it('isEditable returns editable state', () => {
      expect(editor.isEditable).toBe(true);
    });

    it('isEmpty returns false for content', () => {
      expect(editor.isEmpty).toBe(false);
    });

    it('isEmpty returns true for empty content', () => {
      editor.clearContent();
      expect(editor.isEmpty).toBe(true);
    });

    it('isDestroyed returns false initially', () => {
      expect(editor.isDestroyed).toBe(false);
    });

    it('isDestroyed returns true after destroy', () => {
      editor.destroy();
      expect(editor.isDestroyed).toBe(true);
    });

    it('commands returns CommandManager', () => {
      expect(editor.commands).toBeDefined();
      expect(typeof editor.commands.focus).toBe('function');
    });
  });

  describe('content methods', () => {
    beforeEach(() => {
      editor = new Editor({
        schema: testSchema,
        content: '<p>Initial content</p>',
      });
    });

    describe('getJSON', () => {
      it('returns document as JSON', () => {
        const json = editor.getJSON();

        expect(json.type).toBe('doc');
        expect(json.content).toBeDefined();
      });
    });

    describe('getHTML', () => {
      it('returns document as HTML', () => {
        const html = editor.getHTML();

        expect(html).toContain('<p>');
        expect(html).toContain('Initial content');
      });
    });

    describe('getText', () => {
      it('returns plain text', () => {
        const text = editor.getText();

        expect(text).toBe('Initial content');
      });

      it('uses custom block separator', () => {
        editor.setContent('<p>Line 1</p><p>Line 2</p>');
        const text = editor.getText({ blockSeparator: ' | ' });

        expect(text).toBe('Line 1 | Line 2');
      });
    });

    describe('setContent', () => {
      it('sets content and returns this', () => {
        const result = editor.setContent('<p>New content</p>');

        expect(result).toBe(editor);
        expect(editor.getText()).toBe('New content');
      });
    });

    describe('clearContent', () => {
      it('clears content and returns this', () => {
        const result = editor.clearContent();

        expect(result).toBe(editor);
        expect(editor.isEmpty).toBe(true);
      });
    });
  });

  describe('lifecycle methods', () => {
    beforeEach(() => {
      editor = new Editor({ schema: testSchema });
    });

    describe('setEditable', () => {
      it('sets editable state and returns this', () => {
        const result = editor.setEditable(false);

        expect(result).toBe(editor);
        expect(editor.isEditable).toBe(false);
      });

      it('can toggle editable state', () => {
        editor.setEditable(false);
        expect(editor.isEditable).toBe(false);

        editor.setEditable(true);
        expect(editor.isEditable).toBe(true);
      });
    });

    describe('focus', () => {
      it('returns this for chaining', () => {
        const element = document.createElement('div');
        document.body.appendChild(element);

        const ed = new Editor({ schema: testSchema, element });
        const result = ed.focus();

        expect(result).toBe(ed);
        ed.destroy();
        element.remove();
      });
    });

    describe('blur', () => {
      it('returns this for chaining', () => {
        const result = editor.blur();

        expect(result).toBe(editor);
      });
    });

    describe('destroy', () => {
      it('destroys the editor', () => {
        editor.destroy();

        expect(editor.isDestroyed).toBe(true);
      });

      it('can be called multiple times safely', () => {
        editor.destroy();
        expect(() => editor.destroy()).not.toThrow();
      });
    });
  });

  describe('events', () => {
    it('emits create event', () => {
      const onCreate = vi.fn();

      editor = new Editor({
        schema: testSchema,
        onCreate,
      });

      expect(onCreate).toHaveBeenCalledTimes(1);
      expect(onCreate).toHaveBeenCalledWith({ editor });
    });

    it('emits beforeCreate event', () => {
      const onBeforeCreate = vi.fn();

      editor = new Editor({
        schema: testSchema,
        onBeforeCreate,
      });

      expect(onBeforeCreate).toHaveBeenCalledTimes(1);
    });

    it('emits destroy event', () => {
      const onDestroy = vi.fn();

      editor = new Editor({
        schema: testSchema,
        onDestroy,
      });

      editor.destroy();

      expect(onDestroy).toHaveBeenCalledTimes(1);
    });

    it('emits update event on content change', () => {
      const onUpdate = vi.fn();

      editor = new Editor({
        schema: testSchema,
        onUpdate,
      });

      editor.setContent('<p>New content</p>');

      expect(onUpdate).toHaveBeenCalled();
    });

    it('emits transaction event', () => {
      const onTransaction = vi.fn();

      editor = new Editor({
        schema: testSchema,
        onTransaction,
      });

      editor.setContent('<p>New content</p>');

      expect(onTransaction).toHaveBeenCalled();
    });

    it('supports addEventListener style', () => {
      editor = new Editor({ schema: testSchema });

      const handler = vi.fn();
      editor.on('update', handler);

      editor.setContent('<p>New content</p>');

      expect(handler).toHaveBeenCalled();
    });

    it('supports removeEventListener style', () => {
      editor = new Editor({ schema: testSchema });

      const handler = vi.fn();
      editor.on('update', handler);
      editor.off('update', handler);

      editor.setContent('<p>New content</p>');

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('view', () => {
    it('exposes ProseMirror view', () => {
      editor = new Editor({ schema: testSchema });

      expect(editor.view).toBeDefined();
      expect(editor.view.dom).toBeDefined();
    });
  });
});
