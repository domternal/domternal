import { describe, it, expect, afterEach } from 'vitest';
import { TextSelection } from '@domternal/pm/state';
import { Editor } from '../Editor.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { CodeBlock } from '../nodes/CodeBlock.js';
import { Bold } from '../marks/Bold.js';
import { Italic } from '../marks/Italic.js';
import { Code } from '../marks/Code.js';
import { Link } from '../marks/Link.js';

const extensions = [Document, Text, Paragraph, CodeBlock, Bold, Italic, Code, Link];

function setSelection(editor: Editor, from: number, to?: number): void {
  const tr = editor.state.tr.setSelection(
    TextSelection.create(editor.state.doc, from, to ?? from)
  );
  editor.view.dispatch(tr);
}

describe('markCommands', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) {
      editor.view.dom.remove();
      editor.destroy();
    }
  });

  describe('toggleMark', () => {
    it('applies bold to selected text', () => {
      editor = new Editor({ extensions, content: '<p>Hello World</p>' });
      setSelection(editor, 1, 6); // "Hello"
      editor.commands.toggleMark('bold');
      expect(editor.getHTML()).toContain('<strong>Hello</strong>');
    });

    it('removes bold from selected text', () => {
      editor = new Editor({ extensions, content: '<p><strong>Hello</strong> World</p>' });
      setSelection(editor, 1, 6); // "Hello"
      editor.commands.toggleMark('bold');
      expect(editor.getHTML()).not.toContain('<strong>');
    });

    it('returns false for unknown mark type', () => {
      editor = new Editor({ extensions, content: '<p>Text</p>' });
      setSelection(editor, 1, 5);
      const result = editor.commands.toggleMark('nonexistent');
      expect(result).toBe(false);
    });

    it('returns false inside code block (marks not allowed)', () => {
      editor = new Editor({ extensions, content: '<pre><code>code</code></pre>' });
      setSelection(editor, 1, 5);
      const result = editor.commands.toggleMark('bold');
      expect(result).toBe(false);
    });

    it('toggles stored mark for cursor (empty selection)', () => {
      editor = new Editor({ extensions, content: '<p>Hello</p>' });
      setSelection(editor, 3);
      editor.commands.toggleMark('bold');
      // Stored mark should be set
      const stored = editor.state.storedMarks ?? editor.state.tr.storedMarks;
      const hasBold = stored?.some((m) => m.type.name === 'bold');
      expect(hasBold).toBe(true);
    });
  });

  describe('setMark', () => {
    it('adds mark to selection', () => {
      editor = new Editor({ extensions, content: '<p>Hello World</p>' });
      setSelection(editor, 1, 6);
      editor.commands.setMark('italic');
      expect(editor.getHTML()).toContain('<em>Hello</em>');
    });

    it('returns false for invalid mark name', () => {
      editor = new Editor({ extensions, content: '<p>Text</p>' });
      setSelection(editor, 1, 5);
      expect(editor.commands.setMark('nope')).toBe(false);
    });

    it('adds mark with attributes', () => {
      editor = new Editor({ extensions, content: '<p>Click here</p>' });
      setSelection(editor, 1, 6);
      editor.commands.setMark('link', { href: 'https://example.com' });
      expect(editor.getHTML()).toContain('href="https://example.com"');
    });
  });

  describe('unsetMark', () => {
    it('removes bold mark from selection', () => {
      editor = new Editor({ extensions, content: '<p><strong>Bold</strong> text</p>' });
      setSelection(editor, 1, 5);
      editor.commands.unsetMark('bold');
      expect(editor.getHTML()).not.toContain('<strong>');
    });

    it('returns false for unknown mark', () => {
      editor = new Editor({ extensions, content: '<p>Text</p>' });
      expect(editor.commands.unsetMark('fake')).toBe(false);
    });

    it('removes stored mark on empty selection', () => {
      editor = new Editor({ extensions, content: '<p>Hello</p>' });
      setSelection(editor, 3);
      editor.commands.setMark('bold');
      editor.commands.unsetMark('bold');
      const stored = editor.state.storedMarks ?? [];
      const hasBold = stored.some((m) => m.type.name === 'bold');
      expect(hasBold).toBe(false);
    });
  });

  describe('unsetAllMarks', () => {
    it('removes all formatting marks from selection', () => {
      editor = new Editor({
        extensions,
        content: '<p><strong><em>Bold Italic</em></strong></p>',
      });
      setSelection(editor, 1, 12);
      editor.commands.unsetAllMarks();
      const html = editor.getHTML();
      expect(html).not.toContain('<strong>');
      expect(html).not.toContain('<em>');
    });

    it('returns false for empty selection', () => {
      editor = new Editor({ extensions, content: '<p>Hello</p>' });
      setSelection(editor, 3);
      expect(editor.commands.unsetAllMarks()).toBe(false);
    });
  });
});
