import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Schema } from 'prosemirror-model';
import { TextSelection } from 'prosemirror-state';
import { Editor } from './Editor.js';
import type { EditorOptions } from './types/index.js';

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
    if (!editor.isDestroyed) {
      editor.destroy();
    }
  });

  describe('constructor', () => {
    it('creates editor with schema', () => {
      editor = new Editor({ schema: testSchema });

      expect(editor).toBeInstanceOf(Editor);
      expect(editor.schema).toBe(testSchema);
    });

    it('throws error without schema or extensions', () => {
      const invalidOptions = {} as Omit<EditorOptions, 'schema'>;
      expect(() => new Editor(invalidOptions)).toThrow(
        'Editor requires either schema or extensions'
      );
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

    it('commands returns SingleCommands', () => {
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

        expect(json['type']).toBe('doc');
        expect(json['content']).toBeDefined();
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
      it('sets content and returns true on success', () => {
        const result = editor.setContent('<p>New content</p>');

        expect(result).toBe(true);
        expect(editor.getText()).toBe('New content');
      });
    });

    describe('clearContent', () => {
      it('clears content and returns true on success', () => {
        const result = editor.clearContent();

        expect(result).toBe(true);
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
        expect(() => { editor.destroy(); }).not.toThrow();
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

    it('emits mount event after view is attached', () => {
      const onMount = vi.fn();
      const element = document.createElement('div');
      document.body.appendChild(element);

      editor = new Editor({
        schema: testSchema,
        element,
        onMount,
      });

      expect(onMount).toHaveBeenCalledTimes(1);
      expect(onMount).toHaveBeenCalledWith({ editor, view: editor.view });
      element.remove();
    });

    it('emits selectionUpdate event when selection changes', () => {
      const onSelectionUpdate = vi.fn();
      const element = document.createElement('div');
      document.body.appendChild(element);

      editor = new Editor({
        schema: testSchema,
        element,
        content: '<p>Hello world</p>',
        onSelectionUpdate,
      });

      // Change selection without changing content
      const { state, view } = editor;
      const tr = state.tr.setSelection(
        TextSelection.create(state.doc, 3)
      );
      view.dispatch(tr);

      expect(onSelectionUpdate).toHaveBeenCalled();
      element.remove();
    });

    it('emits focus event when editor receives focus', () => {
      const onFocus = vi.fn();
      const element = document.createElement('div');
      document.body.appendChild(element);

      editor = new Editor({
        schema: testSchema,
        element,
        onFocus,
      });

      // Simulate focus event
      const focusEvent = new FocusEvent('focus');
      editor.view.dom.dispatchEvent(focusEvent);

      expect(onFocus).toHaveBeenCalled();
      element.remove();
    });

    it('emits blur event when editor loses focus', () => {
      const onBlur = vi.fn();
      const element = document.createElement('div');
      document.body.appendChild(element);

      editor = new Editor({
        schema: testSchema,
        element,
        onBlur,
      });

      // Simulate blur event
      const blurEvent = new FocusEvent('blur');
      editor.view.dom.dispatchEvent(blurEvent);

      expect(onBlur).toHaveBeenCalled();
      element.remove();
    });
  });

  describe('view', () => {
    it('exposes ProseMirror view', () => {
      editor = new Editor({ schema: testSchema });

      expect(editor.view).toBeDefined();
      expect(editor.view.dom).toBeDefined();
    });
  });

  describe('isActive', () => {
    // Schema with heading (has level attribute) for testing
    const schemaWithHeading = new Schema({
      nodes: {
        doc: { content: 'block+' },
        paragraph: {
          group: 'block',
          content: 'inline*',
          toDOM() { return ['p', 0]; },
          parseDOM: [{ tag: 'p' }],
        },
        heading: {
          group: 'block',
          content: 'inline*',
          attrs: { level: { default: 1 } },
          toDOM(node) { return [`h${String(node.attrs['level'])}`, 0]; },
          parseDOM: [
            { tag: 'h1', attrs: { level: 1 } },
            { tag: 'h2', attrs: { level: 2 } },
            { tag: 'h3', attrs: { level: 3 } },
          ],
        },
        text: { group: 'inline' },
      },
      marks: {
        bold: {
          toDOM() { return ['strong', 0]; },
          parseDOM: [{ tag: 'strong' }],
        },
      },
    });

    describe('for nodes', () => {
      beforeEach(() => {
        // Reset editor before each test
      });

      afterEach(() => {
        editor.destroy();
      });

      it('returns true when cursor is inside the node type', () => {
        editor = new Editor({
          schema: schemaWithHeading,
          content: '<h2>Heading</h2>',
        });

        expect(editor.isActive('heading')).toBe(true);
      });

      it('returns false when cursor is not inside the node type', () => {
        editor = new Editor({
          schema: schemaWithHeading,
          content: '<p>Paragraph</p>',
        });

        expect(editor.isActive('heading')).toBe(false);
      });

      it('returns true when node attributes match', () => {
        editor = new Editor({
          schema: schemaWithHeading,
          content: '<h2>Heading</h2>',
        });

        expect(editor.isActive('heading', { level: 2 })).toBe(true);
      });

      it('returns false when node attributes do not match', () => {
        editor = new Editor({
          schema: schemaWithHeading,
          content: '<h2>Heading</h2>',
        });

        expect(editor.isActive('heading', { level: 1 })).toBe(false);
      });

      it('returns false for unknown node type', () => {
        editor = new Editor({
          schema: schemaWithHeading,
          content: '<p>Text</p>',
        });

        expect(editor.isActive('unknownNode')).toBe(false);
      });

      it('supports object syntax { name, attributes }', () => {
        editor = new Editor({
          schema: schemaWithHeading,
          content: '<h2>Heading</h2>',
        });

        expect(editor.isActive({ name: 'heading', attributes: { level: 2 } })).toBe(true);
        expect(editor.isActive({ name: 'heading', attributes: { level: 3 } })).toBe(false);
      });
    });

    describe('for marks', () => {
      afterEach(() => {
        editor.destroy();
      });

      it('returns true when mark is active at cursor (empty selection)', () => {
        editor = new Editor({
          schema: schemaWithHeading,
          content: '<p><strong>Bold text</strong></p>',
        });

        // Move cursor inside bold text
        const { state, view } = editor;
        const tr = state.tr.setSelection(TextSelection.create(state.doc, 3));
        view.dispatch(tr);

        expect(editor.isActive('bold')).toBe(true);
      });

      it('returns false when mark is not active at cursor', () => {
        editor = new Editor({
          schema: schemaWithHeading,
          content: '<p>Normal text</p>',
        });

        expect(editor.isActive('bold')).toBe(false);
      });

      it('returns true when entire range selection has the mark', () => {
        editor = new Editor({
          schema: schemaWithHeading,
          content: '<p><strong>Bold text</strong></p>',
        });

        // Select "Bold" (positions 1-5)
        const { state, view } = editor;
        const tr = state.tr.setSelection(TextSelection.create(state.doc, 1, 5));
        view.dispatch(tr);

        expect(editor.isActive('bold')).toBe(true);
      });

      it('returns false when only part of range has the mark', () => {
        editor = new Editor({
          schema: schemaWithHeading,
          content: '<p><strong>Bold</strong> normal</p>',
        });

        // Select across bold and normal text (positions 1-12)
        const { state, view } = editor;
        const tr = state.tr.setSelection(TextSelection.create(state.doc, 1, 12));
        view.dispatch(tr);

        expect(editor.isActive('bold')).toBe(false);
      });
    });
  });

  describe('getAttributes', () => {
    const schemaWithLink = new Schema({
      nodes: {
        doc: { content: 'block+' },
        paragraph: {
          group: 'block',
          content: 'inline*',
          toDOM() { return ['p', 0]; },
          parseDOM: [{ tag: 'p' }],
        },
        heading: {
          group: 'block',
          content: 'inline*',
          attrs: { level: { default: 1 } },
          toDOM(node) { return [`h${String(node.attrs['level'])}`, 0]; },
          parseDOM: [
            { tag: 'h1', attrs: { level: 1 } },
            { tag: 'h2', attrs: { level: 2 } },
          ],
        },
        text: { group: 'inline' },
      },
      marks: {
        link: {
          attrs: { href: { default: '' }, target: { default: null } },
          toDOM(mark) {
            return ['a', {
              href: String(mark.attrs['href'] ?? ''),
              target: mark.attrs['target'] ? String(mark.attrs['target']) : null,
            }, 0];
          },
          parseDOM: [{
            tag: 'a',
            getAttrs(dom: HTMLElement) {
              return {
                href: dom.getAttribute('href'),
                target: dom.getAttribute('target'),
              };
            },
          }],
        },
      },
    });

    describe('for nodes', () => {
      afterEach(() => {
        editor.destroy();
      });

      it('returns node attributes when inside the node', () => {
        editor = new Editor({
          schema: schemaWithLink,
          content: '<h2>Heading</h2>',
        });

        const attrs = editor.getAttributes('heading');
        expect(attrs).toEqual({ level: 2 });
      });

      it('returns empty object when not inside the node', () => {
        editor = new Editor({
          schema: schemaWithLink,
          content: '<p>Paragraph</p>',
        });

        const attrs = editor.getAttributes('heading');
        expect(attrs).toEqual({});
      });

      it('returns empty object for unknown node type', () => {
        editor = new Editor({
          schema: schemaWithLink,
          content: '<p>Text</p>',
        });

        const attrs = editor.getAttributes('unknownNode');
        expect(attrs).toEqual({});
      });
    });

    describe('for marks', () => {
      afterEach(() => {
        editor.destroy();
      });

      it('returns mark attributes when mark is active', () => {
        editor = new Editor({
          schema: schemaWithLink,
          content: '<p><a href="https://example.com" target="_blank">Link</a></p>',
        });

        // Move cursor inside the link
        const { state, view } = editor;
        const tr = state.tr.setSelection(TextSelection.create(state.doc, 2));
        view.dispatch(tr);

        const attrs = editor.getAttributes('link');
        expect(attrs).toEqual({ href: 'https://example.com', target: '_blank' });
      });

      it('returns empty object when mark is not active', () => {
        editor = new Editor({
          schema: schemaWithLink,
          content: '<p>Normal text</p>',
        });

        const attrs = editor.getAttributes('link');
        expect(attrs).toEqual({});
      });
    });
  });
});
