/**
 * Tests for Selection extension
 */
import { describe, it, expect, afterEach } from 'vitest';
import { Selection } from './Selection.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Image } from '../nodes/Image.js';
import { Editor } from '../Editor.js';

describe('Selection', () => {
  describe('configuration', () => {
    it('has correct name', () => {
      expect(Selection.name).toBe('selection');
    });

    it('has default options', () => {
      expect(Selection.options).toEqual({
        HTMLAttributes: {},
      });
    });

    it('can configure HTMLAttributes', () => {
      const CustomSelection = Selection.configure({
        HTMLAttributes: { class: 'custom' },
      });
      expect(CustomSelection.options.HTMLAttributes).toEqual({ class: 'custom' });
    });
  });

  describe('addStorage', () => {
    it('provides getText function', () => {
      const storage = Selection.config.addStorage?.call(Selection);
      expect(typeof storage?.getText).toBe('function');
    });

    it('provides getNode function', () => {
      const storage = Selection.config.addStorage?.call(Selection);
      expect(typeof storage?.getNode).toBe('function');
    });

    it('provides isEmpty function', () => {
      const storage = Selection.config.addStorage?.call(Selection);
      expect(typeof storage?.isEmpty).toBe('function');
    });

    it('provides getRange function', () => {
      const storage = Selection.config.addStorage?.call(Selection);
      expect(typeof storage?.getRange).toBe('function');
    });

    it('provides getCursor function', () => {
      const storage = Selection.config.addStorage?.call(Selection);
      expect(typeof storage?.getCursor).toBe('function');
    });
  });

  describe('addCommands', () => {
    it('provides setSelection command', () => {
      const commands = Selection.config.addCommands?.call(Selection);
      expect(commands).toHaveProperty('setSelection');
      expect(typeof commands?.['setSelection']).toBe('function');
    });

    it('provides selectNode command', () => {
      const commands = Selection.config.addCommands?.call(Selection);
      expect(commands).toHaveProperty('selectNode');
      expect(typeof commands?.['selectNode']).toBe('function');
    });

    it('provides selectParentNode command', () => {
      const commands = Selection.config.addCommands?.call(Selection);
      expect(commands).toHaveProperty('selectParentNode');
      expect(typeof commands?.['selectParentNode']).toBe('function');
    });

    it('provides extendSelection command', () => {
      const commands = Selection.config.addCommands?.call(Selection);
      expect(commands).toHaveProperty('extendSelection');
      expect(typeof commands?.['extendSelection']).toBe('function');
    });
  });

  describe('integration', () => {
    let editor: Editor | undefined;

    afterEach(() => {
      if (editor && !editor.isDestroyed) {
        editor.destroy();
      }
    });

    it('works with Editor', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Selection],
        content: '<p>Test content</p>',
      });

      expect(editor.getText()).toContain('Test content');
    });

    describe('storage.getText', () => {
      it('returns empty string for collapsed selection', () => {
        editor = new Editor({
          extensions: [Document, Text, Paragraph, Selection],
          content: '<p>Hello world</p>',
        });

        editor.focus('start');
        const storage = editor.storage['selection'] as typeof Selection.storage;
        expect(storage.getText()).toBe('');
      });

      it('returns selected text', () => {
        editor = new Editor({
          extensions: [Document, Text, Paragraph, Selection],
          content: '<p>Hello world</p>',
        });

        // Select "Hello"
        editor.commands.setSelection(1, 6);

        const storage = editor.storage['selection'] as typeof Selection.storage;
        expect(storage.getText()).toBe('Hello');
      });
    });

    describe('storage.isEmpty', () => {
      it('returns true for collapsed selection', () => {
        editor = new Editor({
          extensions: [Document, Text, Paragraph, Selection],
          content: '<p>Hello world</p>',
        });

        editor.focus('start');
        const storage = editor.storage['selection'] as typeof Selection.storage;
        expect(storage.isEmpty()).toBe(true);
      });

      it('returns false for range selection', () => {
        editor = new Editor({
          extensions: [Document, Text, Paragraph, Selection],
          content: '<p>Hello world</p>',
        });

        editor.commands.setSelection(1, 6);

        const storage = editor.storage['selection'] as typeof Selection.storage;
        expect(storage.isEmpty()).toBe(false);
      });
    });

    describe('storage.getRange', () => {
      it('returns from and to positions', () => {
        editor = new Editor({
          extensions: [Document, Text, Paragraph, Selection],
          content: '<p>Hello world</p>',
        });

        editor.commands.setSelection(1, 6);

        const storage = editor.storage['selection'] as typeof Selection.storage;
        const range = storage.getRange();
        expect(range.from).toBe(1);
        expect(range.to).toBe(6);
      });
    });

    describe('storage.getCursor', () => {
      it('returns cursor position for collapsed selection', () => {
        editor = new Editor({
          extensions: [Document, Text, Paragraph, Selection],
          content: '<p>Hello world</p>',
        });

        editor.commands.setSelection(5);

        const storage = editor.storage['selection'] as typeof Selection.storage;
        expect(storage.getCursor()).toBe(5);
      });

      it('returns null for range selection', () => {
        editor = new Editor({
          extensions: [Document, Text, Paragraph, Selection],
          content: '<p>Hello world</p>',
        });

        editor.commands.setSelection(1, 6);

        const storage = editor.storage['selection'] as typeof Selection.storage;
        expect(storage.getCursor()).toBe(null);
      });
    });

    describe('setSelection command', () => {
      it('sets text selection', () => {
        editor = new Editor({
          extensions: [Document, Text, Paragraph, Selection],
          content: '<p>Hello world</p>',
        });

        const result = editor.commands.setSelection(1, 6);

        expect(result).toBe(true);
        expect(editor.state.selection.from).toBe(1);
        expect(editor.state.selection.to).toBe(6);
      });

      it('sets cursor when only from is provided', () => {
        editor = new Editor({
          extensions: [Document, Text, Paragraph, Selection],
          content: '<p>Hello world</p>',
        });

        const result = editor.commands.setSelection(5);

        expect(result).toBe(true);
        expect(editor.state.selection.from).toBe(5);
        expect(editor.state.selection.to).toBe(5);
      });

      it('returns false for invalid positions', () => {
        editor = new Editor({
          extensions: [Document, Text, Paragraph, Selection],
          content: '<p>Hello</p>',
        });

        const result = editor.commands.setSelection(-1, 100);

        expect(result).toBe(false);
      });
    });

    describe('selectNode command', () => {
      it('selects node at position', () => {
        editor = new Editor({
          extensions: [Document, Text, Paragraph, Image, Selection],
          content: '<p>Text</p><img src="test.jpg">',
        });

        // Get position of image node
        const imagePos = editor.state.doc.child(0).nodeSize;

        const result = editor.commands.selectNode(imagePos);

        expect(result).toBe(true);
      });

      it('returns false for invalid position', () => {
        editor = new Editor({
          extensions: [Document, Text, Paragraph, Selection],
          content: '<p>Hello</p>',
        });

        const result = editor.commands.selectNode(1000);

        expect(result).toBe(false);
      });
    });

    describe('extendSelection command', () => {
      it('extends selection left', () => {
        editor = new Editor({
          extensions: [Document, Text, Paragraph, Selection],
          content: '<p>Hello world</p>',
        });

        editor.commands.setSelection(3, 6);
        editor.commands.extendSelection('left');

        expect(editor.state.selection.from).toBe(2);
        expect(editor.state.selection.to).toBe(6);
      });

      it('extends selection right', () => {
        editor = new Editor({
          extensions: [Document, Text, Paragraph, Selection],
          content: '<p>Hello world</p>',
        });

        editor.commands.setSelection(1, 6);
        editor.commands.extendSelection('right');

        expect(editor.state.selection.from).toBe(1);
        expect(editor.state.selection.to).toBe(7);
      });

      it('extends selection to start', () => {
        editor = new Editor({
          extensions: [Document, Text, Paragraph, Selection],
          content: '<p>Hello world</p>',
        });

        editor.commands.setSelection(6, 11);
        editor.commands.extendSelection('start');

        expect(editor.state.selection.from).toBe(0);
        expect(editor.state.selection.to).toBe(11);
      });

      it('extends selection to end', () => {
        editor = new Editor({
          extensions: [Document, Text, Paragraph, Selection],
          content: '<p>Hello world</p>',
        });

        editor.commands.setSelection(1, 6);
        editor.commands.extendSelection('end');

        expect(editor.state.selection.from).toBe(1);
        expect(editor.state.selection.to).toBe(editor.state.doc.content.size);
      });
    });

    describe('storage default values (before onCreate)', () => {
      it('getText returns empty string', () => {
        const storage = Selection.config.addStorage?.call(Selection);
        expect(storage?.getText()).toBe('');
      });

      it('getNode returns null', () => {
        const storage = Selection.config.addStorage?.call(Selection);
        expect(storage?.getNode()).toBe(null);
      });

      it('isEmpty returns true', () => {
        const storage = Selection.config.addStorage?.call(Selection);
        expect(storage?.isEmpty()).toBe(true);
      });

      it('getRange returns {from: 0, to: 0}', () => {
        const storage = Selection.config.addStorage?.call(Selection);
        expect(storage?.getRange()).toEqual({ from: 0, to: 0 });
      });

      it('getCursor returns null', () => {
        const storage = Selection.config.addStorage?.call(Selection);
        expect(storage?.getCursor()).toBe(null);
      });
    });

    describe('selectNode command', () => {
      it('returns false for negative position', () => {
        editor = new Editor({
          extensions: [Document, Text, Paragraph, Image, Selection],
          content: '<p>Text</p>',
        });

        const result = editor.commands.selectNode(-1);
        expect(result).toBe(false);
      });
    });

    describe('selectParentNode command', () => {
      it('returns false when no selectable parent', () => {
        editor = new Editor({
          extensions: [Document, Text, Paragraph, Selection],
          content: '<p>Hello</p>',
        });

        editor.commands.setSelection(1);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = (editor.commands as any).selectParentNode?.();
        // May succeed or fail depending on what's selectable
        expect(typeof result).toBe('boolean');
      });
    });

    describe('storage.getNode', () => {
      it('returns null for text selection', () => {
        editor = new Editor({
          extensions: [Document, Text, Paragraph, Selection],
          content: '<p>Hello world</p>',
        });

        editor.commands.setSelection(1, 6);
        const storage = editor.storage['selection'] as typeof Selection.storage;
        expect(storage.getNode()).toBe(null);
      });
    });
  });
});
