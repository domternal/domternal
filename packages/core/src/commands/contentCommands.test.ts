import { describe, it, expect, afterEach } from 'vitest';
import { TextSelection } from '@domternal/pm/state';
import { Editor } from '../Editor.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Heading } from '../nodes/Heading.js';
import { Bold } from '../marks/Bold.js';

const extensions = [Document, Text, Paragraph, Heading, Bold];

function setSelection(editor: Editor, from: number, to?: number): void {
  const tr = editor.state.tr.setSelection(
    TextSelection.create(editor.state.doc, from, to ?? from)
  );
  editor.view.dispatch(tr);
}

describe('contentCommands', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) {
      editor.view.dom.remove();
      editor.destroy();
    }
  });

  describe('setContent', () => {
    it('replaces document with HTML string', () => {
      editor = new Editor({ extensions, content: '<p>Old</p>' });
      editor.commands.setContent('<p>New content</p>');
      expect(editor.getHTML()).toBe('<p>New content</p>');
    });

    it('replaces document with JSON content', () => {
      editor = new Editor({ extensions, content: '<p>Old</p>' });
      editor.commands.setContent({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'JSON' }] }],
      });
      expect(editor.getHTML()).toBe('<p>JSON</p>');
    });

    it('can set empty content', () => {
      editor = new Editor({ extensions, content: '<p>Hello</p>' });
      editor.commands.setContent('<p></p>');
      expect(editor.state.doc.textContent).toBe('');
    });
  });

  describe('clearContent', () => {
    it('clears all content to empty state', () => {
      editor = new Editor({ extensions, content: '<p>Hello <strong>World</strong></p>' });
      editor.commands.clearContent();
      expect(editor.state.doc.textContent).toBe('');
      expect(editor.state.doc.childCount).toBe(1); // empty paragraph
    });
  });

  describe('insertText', () => {
    it('inserts text at cursor', () => {
      editor = new Editor({ extensions, content: '<p>Hello</p>' });
      setSelection(editor, 6); // after "Hello"
      editor.commands.insertText(' World');
      expect(editor.getHTML()).toBe('<p>Hello World</p>');
    });

    it('replaces selected text', () => {
      editor = new Editor({ extensions, content: '<p>Hello World</p>' });
      setSelection(editor, 1, 6); // "Hello"
      editor.commands.insertText('Hi');
      expect(editor.getHTML()).toBe('<p>Hi World</p>');
    });

    it('inserts at beginning', () => {
      editor = new Editor({ extensions, content: '<p>World</p>' });
      setSelection(editor, 1);
      editor.commands.insertText('Hello ');
      expect(editor.getHTML()).toBe('<p>Hello World</p>');
    });
  });

  describe('insertContent', () => {
    it('inserts HTML content', () => {
      editor = new Editor({ extensions, content: '<p>Before</p>' });
      setSelection(editor, 7); // after "Before"
      editor.commands.insertContent('<p>After</p>');
      const text = editor.state.doc.textContent;
      expect(text).toContain('After');
    });

    it('inserts JSON node', () => {
      editor = new Editor({ extensions, content: '<p>Text</p>' });
      setSelection(editor, 5);
      editor.commands.insertContent({
        type: 'paragraph',
        content: [{ type: 'text', text: 'Inserted' }],
      });
      expect(editor.state.doc.textContent).toContain('Inserted');
    });

    it('returns false for invalid content', () => {
      editor = new Editor({ extensions, content: '<p>Text</p>' });
      const result = editor.commands.insertContent(42 as any);
      expect(result).toBe(false);
    });
  });
});
