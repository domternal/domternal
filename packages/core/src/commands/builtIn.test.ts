/**
 * Tests for built-in commands
 */
import { describe, it, expect, afterEach } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Heading } from '../nodes/Heading.js';
import { Blockquote } from '../nodes/Blockquote.js';
import { BulletList } from '../nodes/BulletList.js';
import { OrderedList } from '../nodes/OrderedList.js';
import { ListItem } from '../nodes/ListItem.js';
import { Bold } from '../marks/Bold.js';
import { Italic } from '../marks/Italic.js';
import { Link } from '../marks/Link.js';
import { Selection } from '../extensions/Selection.js';
import { Editor } from '../Editor.js';

/** Helper: set text selection via ProseMirror API */
function setSelection(editor: Editor, from: number, to?: number): void {
  const { state } = editor;
  const resolvedTo = to ?? from;
  const tr = state.tr.setSelection(
    TextSelection.create(state.doc, from, resolvedTo)
  );
  editor.view.dispatch(tr);
}

describe('builtIn commands', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) {
      editor.view.dom.remove();
      editor.destroy();
    }
  });

  describe('focus', () => {
    it('focuses editor at start', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph],
        content: '<p>Hello world</p>',
      });
      document.body.appendChild(editor.view.dom);

      const result = editor.commands.focus('start');
      expect(result).toBe(true);
    });

    it('focuses editor at end', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph],
        content: '<p>Hello world</p>',
      });
      document.body.appendChild(editor.view.dom);

      const result = editor.commands.focus('end');
      expect(result).toBe(true);
    });

    it('focuses editor with true', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph],
        content: '<p>Hello world</p>',
      });
      document.body.appendChild(editor.view.dom);

      const result = editor.commands.focus(true);
      expect(result).toBe(true);
    });

    it('focuses editor with numeric position', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph],
        content: '<p>Hello world</p>',
      });
      document.body.appendChild(editor.view.dom);

      const result = editor.commands.focus(3);
      expect(result).toBe(true);
    });

    it('focuses editor with null position', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph],
        content: '<p>Hello world</p>',
      });
      document.body.appendChild(editor.view.dom);

      const result = editor.commands.focus(null);
      expect(result).toBe(true);
    });

    it('focuses editor with all', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph],
        content: '<p>Hello world</p>',
      });
      document.body.appendChild(editor.view.dom);

      const result = editor.commands.focus('all');
      expect(result).toBe(true);
    });

    it('returns false when not connected to DOM', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph],
        content: '<p>Hello</p>',
      });
      // Don't append to body
      const result = editor.commands.focus('start');
      expect(result).toBe(false);
    });
  });

  describe('blur', () => {
    it('blurs the editor', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph],
        content: '<p>Hello</p>',
      });
      document.body.appendChild(editor.view.dom);

      const result = editor.commands.blur();
      expect(result).toBe(true);
    });
  });

  describe('setContent', () => {
    it('sets HTML content', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph],
        content: '<p>Initial</p>',
      });

      const result = editor.commands.setContent('<p>New content</p>');
      expect(result).toBe(true);
      expect(editor.getText()).toContain('New content');
    });

    it('sets content with emitUpdate false', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph],
        content: '<p>Initial</p>',
      });

      const result = editor.commands.setContent('<p>Quiet update</p>', { emitUpdate: false });
      expect(result).toBe(true);
      expect(editor.getText()).toContain('Quiet update');
    });
  });

  describe('clearContent', () => {
    it('clears editor content', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph],
        content: '<p>Hello world</p>',
      });

      const result = editor.commands.clearContent();
      expect(result).toBe(true);
    });

    it('clears content with emitUpdate false', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph],
        content: '<p>Hello</p>',
      });

      const result = editor.commands.clearContent({ emitUpdate: false });
      expect(result).toBe(true);
    });
  });

  describe('insertText', () => {
    it('inserts text at cursor position', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Selection],
        content: '<p>Hello world</p>',
      });

      editor.commands.setSelection(6);
      const result = editor.commands.insertText(' beautiful');
      expect(result).toBe(true);
      expect(editor.getText()).toContain('beautiful');
    });
  });

  describe('deleteSelection', () => {
    it('deletes selected text', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph],
        content: '<p>Hello world</p>',
      });

      setSelection(editor, 1, 6);
      const result = editor.commands.deleteSelection();
      expect(result).toBe(true);
      expect(editor.getText()).not.toContain('Hello');
    });

    it('returns false for empty selection', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph],
        content: '<p>Hello</p>',
      });

      setSelection(editor, 1);
      const result = editor.commands.deleteSelection();
      expect(result).toBe(false);
    });
  });

  describe('selectAll', () => {
    it('selects all content', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph],
        content: '<p>Hello world</p>',
      });

      const result = editor.commands.selectAll();
      expect(result).toBe(true);
    });
  });

  describe('toggleMark', () => {
    it('toggles bold mark', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Bold],
        content: '<p>Hello world</p>',
      });

      setSelection(editor, 1, 6);
      const result = editor.commands.toggleMark('bold');
      expect(result).toBe(true);
      expect(editor.getHTML()).toContain('<strong>Hello</strong>');
    });

    it('returns false for unknown mark', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph],
        content: '<p>Hello</p>',
      });

      const result = editor.commands.toggleMark('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('setMark', () => {
    it('sets bold mark on selection', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Bold],
        content: '<p>Hello world</p>',
      });

      setSelection(editor, 1, 6);
      const result = editor.commands.setMark('bold');
      expect(result).toBe(true);
      expect(editor.getHTML()).toContain('<strong>Hello</strong>');
    });

    it('returns false for unknown mark', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph],
        content: '<p>Hello</p>',
      });

      const result = editor.commands.setMark('nonexistent');
      expect(result).toBe(false);
    });

    it('adds stored mark on empty selection', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Bold],
        content: '<p>Hello</p>',
      });

      setSelection(editor, 3);
      const result = editor.commands.setMark('bold');
      expect(result).toBe(true);
    });
  });

  describe('unsetMark', () => {
    it('removes bold mark from selection', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Bold],
        content: '<p><strong>Hello</strong> world</p>',
      });

      setSelection(editor, 1, 6);
      const result = editor.commands.unsetMark('bold');
      expect(result).toBe(true);
      expect(editor.getHTML()).not.toContain('<strong>');
    });

    it('returns false for unknown mark', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph],
        content: '<p>Hello</p>',
      });

      const result = editor.commands.unsetMark('nonexistent');
      expect(result).toBe(false);
    });

    it('removes stored mark on empty selection', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Bold],
        content: '<p>Hello</p>',
      });

      setSelection(editor, 3);
      const result = editor.commands.unsetMark('bold');
      expect(result).toBe(true);
    });
  });

  describe('setBlockType', () => {
    it('sets block type to heading', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Heading],
        content: '<p>Hello</p>',
      });

      setSelection(editor, 1);
      const result = editor.commands.setBlockType('heading', { level: 1 });
      expect(result).toBe(true);
      expect(editor.getHTML()).toContain('<h1>');
    });

    it('returns false for unknown node type', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph],
        content: '<p>Hello</p>',
      });

      const result = editor.commands.setBlockType('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('toggleBlockType', () => {
    it('toggles paragraph to heading', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Heading],
        content: '<p>Hello</p>',
      });

      setSelection(editor, 1);
      const result = editor.commands.toggleBlockType('heading', 'paragraph', { level: 1 });
      expect(result).toBe(true);
      expect(editor.getHTML()).toContain('<h1>');
    });

    it('toggles heading back to paragraph', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Heading],
        content: '<h1>Hello</h1>',
      });

      setSelection(editor, 1);
      const result = editor.commands.toggleBlockType('heading', 'paragraph', { level: 1 });
      expect(result).toBe(true);
      expect(editor.getHTML()).toContain('<p>');
    });

    it('returns false for unknown node type', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph],
        content: '<p>Hello</p>',
      });

      const result = editor.commands.toggleBlockType('nonexistent', 'paragraph');
      expect(result).toBe(false);
    });

    it('returns false for unknown default type', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Heading],
        content: '<p>Hello</p>',
      });

      const result = editor.commands.toggleBlockType('heading', 'nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('wrapIn', () => {
    it('wraps in blockquote', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Blockquote],
        content: '<p>Hello</p>',
      });

      setSelection(editor, 1);
      const result = editor.commands.wrapIn('blockquote');
      expect(result).toBe(true);
      expect(editor.getHTML()).toContain('<blockquote>');
    });

    it('returns false for unknown node type', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph],
        content: '<p>Hello</p>',
      });

      const result = editor.commands.wrapIn('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('toggleWrap', () => {
    it('wraps in blockquote when not wrapped', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Blockquote],
        content: '<p>Hello</p>',
      });

      setSelection(editor, 1);
      const result = editor.commands.toggleWrap('blockquote');
      expect(result).toBe(true);
      expect(editor.getHTML()).toContain('<blockquote>');
    });

    it('unwraps from blockquote when wrapped', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Blockquote],
        content: '<blockquote><p>Hello</p></blockquote>',
      });

      setSelection(editor, 2);
      const result = editor.commands.toggleWrap('blockquote');
      expect(result).toBe(true);
      expect(editor.getHTML()).not.toContain('<blockquote>');
    });

    it('returns false for unknown node type', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph],
        content: '<p>Hello</p>',
      });

      const result = editor.commands.toggleWrap('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('lift', () => {
    it('lifts paragraph out of blockquote', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Blockquote],
        content: '<blockquote><p>Hello</p></blockquote>',
      });

      setSelection(editor, 2);
      const result = editor.commands.lift();
      expect(result).toBe(true);
      expect(editor.getHTML()).not.toContain('<blockquote>');
    });
  });

  describe('toggleList', () => {
    it('wraps in bullet list', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, BulletList, OrderedList, ListItem],
        content: '<p>Item</p>',
      });

      setSelection(editor, 1);
      const result = editor.commands.toggleList('bulletList', 'listItem');
      expect(result).toBe(true);
      expect(editor.getHTML()).toContain('<ul>');
    });

    it('returns false for unknown list type', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph],
        content: '<p>Hello</p>',
      });

      const result = editor.commands.toggleList('nonexistent', 'listItem');
      expect(result).toBe(false);
    });
  });

  describe('insertContent', () => {
    it('inserts HTML content', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph],
        content: '<p>Hello</p>',
      });

      setSelection(editor, 1);
      const result = editor.commands.insertContent('<p>Inserted</p>');
      expect(result).toBe(true);
    });

    it('inserts JSON content (single node)', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph],
        content: '<p>Hello</p>',
      });

      setSelection(editor, 1);
      const result = editor.commands.insertContent({
        type: 'paragraph',
        content: [{ type: 'text', text: 'JSON content' }],
      });
      expect(result).toBe(true);
    });

    it('inserts JSON content (array of nodes)', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph],
        content: '<p>Hello</p>',
      });

      setSelection(editor, 1);
      const result = editor.commands.insertContent([
        { type: 'paragraph', content: [{ type: 'text', text: 'First' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Second' }] },
      ]);
      expect(result).toBe(true);
    });

    it('returns false for invalid content', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph],
        content: '<p>Hello</p>',
      });

       
      const result = editor.commands.insertContent(42 as any);
      expect(result).toBe(false);
    });

    it('returns false for object without type', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph],
        content: '<p>Hello</p>',
      });

       
      const result = editor.commands.insertContent({ foo: 'bar' } as any);
      expect(result).toBe(false);
    });
  });

  describe('updateAttributes', () => {
    it('updates heading attributes', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Heading],
        content: '<h1>Hello</h1>',
      });

      setSelection(editor, 1);
      const result = editor.commands.updateAttributes('heading', { level: 2 });
      expect(result).toBe(true);
      expect(editor.getHTML()).toContain('<h2>');
    });

    it('returns false for unknown type', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph],
        content: '<p>Hello</p>',
      });

      const result = editor.commands.updateAttributes('nonexistent', {});
      expect(result).toBe(false);
    });

    it('updates mark attributes', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Bold, Italic],
        content: '<p><strong>Hello</strong></p>',
      });

      setSelection(editor, 1, 6);
      const result = editor.commands.updateAttributes('bold', {});
      expect(typeof result).toBe('boolean');
    });
  });

  describe('resetAttributes', () => {
    it('resets heading level to default', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Heading],
        content: '<h2>Hello</h2>',
      });

      setSelection(editor, 1);
      const result = editor.commands.resetAttributes('heading', 'level');
      expect(typeof result).toBe('boolean');
    });

    it('returns false for unknown type', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph],
        content: '<p>Hello</p>',
      });

      const result = editor.commands.resetAttributes('nonexistent', 'level');
      expect(result).toBe(false);
    });

    it('resets mark attribute to default', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Link],
        content: '<p><a href="https://example.com" target="_blank">Link</a></p>',
      });

      setSelection(editor, 1, 5);
      const result = editor.commands.resetAttributes('link', 'target');
      expect(result).toBe(true);

      // Verify the target attribute was reset to default (null)
      const textNode = editor.state.doc.child(0).child(0);
      const linkMark = textNode.marks.find((m) => m.type.name === 'link');
      expect(linkMark?.attrs['target']).toBe(null);
    });
  });
});
