import { describe, it, expect, afterEach } from 'vitest';
import { TextSelection } from '@domternal/pm/state';
import { Editor } from '../Editor.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Heading } from '../nodes/Heading.js';
import { Blockquote } from '../nodes/Blockquote.js';
import { CodeBlock } from '../nodes/CodeBlock.js';

const extensions = [Document, Text, Paragraph, Heading, Blockquote, CodeBlock];

function setSelection(editor: Editor, from: number, to?: number): void {
  const tr = editor.state.tr.setSelection(
    TextSelection.create(editor.state.doc, from, to ?? from)
  );
  editor.view.dispatch(tr);
}

describe('nodeCommands', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) {
      editor.view.dom.remove();
      editor.destroy();
    }
  });

  describe('setBlockType', () => {
    it('converts paragraph to heading', () => {
      editor = new Editor({ extensions, content: '<p>Hello</p>' });
      setSelection(editor, 2);
      editor.commands.setBlockType('heading', { level: 2 });
      expect(editor.getHTML()).toBe('<h2>Hello</h2>');
    });

    it('converts heading to paragraph', () => {
      editor = new Editor({ extensions, content: '<h2>Title</h2>' });
      setSelection(editor, 2);
      editor.commands.setBlockType('paragraph');
      expect(editor.getHTML()).toBe('<p>Title</p>');
    });

    it('returns false for unknown node type', () => {
      editor = new Editor({ extensions, content: '<p>Text</p>' });
      setSelection(editor, 2);
      expect(editor.commands.setBlockType('nonexistent')).toBe(false);
    });

    it('converts paragraph to code block', () => {
      editor = new Editor({ extensions, content: '<p>code here</p>' });
      setSelection(editor, 3);
      editor.commands.setBlockType('codeBlock');
      expect(editor.getHTML()).toContain('<pre><code>code here</code></pre>');
    });
  });

  describe('toggleBlockType', () => {
    it('toggles paragraph to heading', () => {
      editor = new Editor({ extensions, content: '<p>Title</p>' });
      setSelection(editor, 2);
      editor.commands.toggleBlockType('heading', 'paragraph', { level: 1 });
      expect(editor.getHTML()).toBe('<h1>Title</h1>');
    });

    it('toggles heading back to paragraph', () => {
      editor = new Editor({ extensions, content: '<h1>Title</h1>' });
      setSelection(editor, 2);
      editor.commands.toggleBlockType('heading', 'paragraph', { level: 1 });
      expect(editor.getHTML()).toBe('<p>Title</p>');
    });

    it('returns false for unknown type', () => {
      editor = new Editor({ extensions, content: '<p>Text</p>' });
      setSelection(editor, 2);
      expect(editor.commands.toggleBlockType('fake', 'paragraph')).toBe(false);
    });
  });

  describe('wrapIn', () => {
    it('wraps paragraph in blockquote', () => {
      editor = new Editor({ extensions, content: '<p>Quote me</p>' });
      setSelection(editor, 3);
      editor.commands.wrapIn('blockquote');
      expect(editor.getHTML()).toBe('<blockquote><p>Quote me</p></blockquote>');
    });

    it('returns false for unknown node type', () => {
      editor = new Editor({ extensions, content: '<p>Text</p>' });
      setSelection(editor, 2);
      expect(editor.commands.wrapIn('nonexistent')).toBe(false);
    });
  });

  describe('toggleWrap', () => {
    it('wraps in blockquote when not wrapped', () => {
      editor = new Editor({ extensions, content: '<p>Text</p>' });
      setSelection(editor, 2);
      editor.commands.toggleWrap('blockquote');
      expect(editor.getHTML()).toBe('<blockquote><p>Text</p></blockquote>');
    });

    it('unwraps blockquote when already wrapped', () => {
      editor = new Editor({ extensions, content: '<blockquote><p>Text</p></blockquote>' });
      setSelection(editor, 3);
      editor.commands.toggleWrap('blockquote');
      expect(editor.getHTML()).toBe('<p>Text</p>');
    });
  });

  describe('lift', () => {
    it('lifts paragraph out of blockquote', () => {
      editor = new Editor({ extensions, content: '<blockquote><p>Lifted</p></blockquote>' });
      setSelection(editor, 3);
      editor.commands.lift();
      expect(editor.getHTML()).toBe('<p>Lifted</p>');
    });

    it('returns false when nothing to lift', () => {
      editor = new Editor({ extensions, content: '<p>Top level</p>' });
      setSelection(editor, 3);
      expect(editor.commands.lift()).toBe(false);
    });
  });
});
