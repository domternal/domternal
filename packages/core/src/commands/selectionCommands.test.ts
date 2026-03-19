import { describe, it, expect, afterEach } from 'vitest';
import { TextSelection, AllSelection } from '@domternal/pm/state';
import { Editor } from '../Editor.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Heading } from '../nodes/Heading.js';

const extensions = [Document, Text, Paragraph, Heading];

function setSelection(editor: Editor, from: number, to?: number): void {
  const tr = editor.state.tr.setSelection(
    TextSelection.create(editor.state.doc, from, to ?? from)
  );
  editor.view.dispatch(tr);
}

describe('selectionCommands', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) {
      editor.view.dom.remove();
      editor.destroy();
    }
  });

  describe('selectAll', () => {
    it('selects entire document', () => {
      editor = new Editor({ extensions, content: '<p>Hello</p>' });
      document.body.appendChild(editor.view.dom);
      editor.commands.selectAll();
      expect(editor.state.selection).toBeInstanceOf(AllSelection);
    });

    it('can be dry-run checked', () => {
      editor = new Editor({ extensions, content: '<p>Hello</p>' });
      const result = editor.can().selectAll();
      expect(result).toBe(true);
    });
  });

  describe('deleteSelection', () => {
    it('deletes selected text', () => {
      editor = new Editor({ extensions, content: '<p>Hello World</p>' });
      document.body.appendChild(editor.view.dom);
      setSelection(editor, 1, 6); // select "Hello"
      const result = editor.commands.deleteSelection();
      expect(result).toBe(true);
      expect(editor.getHTML()).toBe('<p> World</p>');
    });

    it('returns false for collapsed selection', () => {
      editor = new Editor({ extensions, content: '<p>Hello</p>' });
      document.body.appendChild(editor.view.dom);
      setSelection(editor, 3); // cursor, no range
      const result = editor.commands.deleteSelection();
      expect(result).toBe(false);
    });

    it('can be dry-run checked with range selection', () => {
      editor = new Editor({ extensions, content: '<p>Hello</p>' });
      setSelection(editor, 1, 4);
      expect(editor.can().deleteSelection()).toBe(true);
    });

    it('can check returns false for collapsed', () => {
      editor = new Editor({ extensions, content: '<p>Hello</p>' });
      setSelection(editor, 2);
      expect(editor.can().deleteSelection()).toBe(false);
    });
  });

  describe('focus', () => {
    it('focuses at start position', () => {
      editor = new Editor({ extensions, content: '<p>Hello</p>' });
      document.body.appendChild(editor.view.dom);
      editor.commands.focus('start');
      const { from } = editor.state.selection;
      expect(from).toBe(1);
    });

    it('focuses at end position', () => {
      editor = new Editor({ extensions, content: '<p>Hello</p>' });
      document.body.appendChild(editor.view.dom);
      editor.commands.focus('end');
      const { from } = editor.state.selection;
      // End of "Hello" = position 6 (doc>p>text)
      expect(from).toBe(6);
    });

    it('focuses at numeric position', () => {
      editor = new Editor({ extensions, content: '<p>Hello</p>' });
      document.body.appendChild(editor.view.dom);
      editor.commands.focus(3);
      expect(editor.state.selection.from).toBe(3);
    });

    it('focus all creates AllSelection', () => {
      editor = new Editor({ extensions, content: '<p>Hello</p>' });
      document.body.appendChild(editor.view.dom);
      editor.commands.focus('all');
      expect(editor.state.selection).toBeInstanceOf(AllSelection);
    });

    it('focus with null just focuses without changing selection', () => {
      editor = new Editor({ extensions, content: '<p>Hello</p>' });
      document.body.appendChild(editor.view.dom);
      setSelection(editor, 3);
      editor.commands.focus(null);
      expect(editor.state.selection.from).toBe(3);
    });
  });

  describe('blur', () => {
    it('blurs the editor', () => {
      editor = new Editor({ extensions, content: '<p>Hello</p>' });
      document.body.appendChild(editor.view.dom);
      const result = editor.commands.blur();
      expect(result).toBe(true);
    });
  });
});
