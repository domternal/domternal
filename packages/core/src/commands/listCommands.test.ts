import { describe, it, expect, afterEach } from 'vitest';
import { TextSelection } from '@domternal/pm/state';
import { Editor } from '../Editor.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { BulletList } from '../nodes/BulletList.js';
import { OrderedList } from '../nodes/OrderedList.js';
import { ListItem } from '../nodes/ListItem.js';
import { TaskList } from '../nodes/TaskList.js';
import { TaskItem } from '../nodes/TaskItem.js';

const extensions = [Document, Text, Paragraph, BulletList, OrderedList, ListItem, TaskList, TaskItem];

function setSelection(editor: Editor, from: number, to?: number): void {
  const tr = editor.state.tr.setSelection(
    TextSelection.create(editor.state.doc, from, to ?? from)
  );
  editor.view.dispatch(tr);
}

describe('listCommands', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) {
      editor.view.dom.remove();
      editor.destroy();
    }
  });

  describe('toggleList', () => {
    it('wraps paragraph in bullet list', () => {
      editor = new Editor({ extensions, content: '<p>Item</p>' });
      setSelection(editor, 2);
      editor.commands.toggleList('bulletList', 'listItem');
      expect(editor.getHTML()).toContain('<ul>');
      expect(editor.getHTML()).toContain('<li>');
    });

    it('wraps paragraph in ordered list', () => {
      editor = new Editor({ extensions, content: '<p>Item</p>' });
      setSelection(editor, 2);
      editor.commands.toggleList('orderedList', 'listItem');
      expect(editor.getHTML()).toContain('<ol>');
    });

    it('unwraps bullet list back to paragraph', () => {
      editor = new Editor({ extensions, content: '<ul><li><p>Item</p></li></ul>' });
      setSelection(editor, 3);
      editor.commands.toggleList('bulletList', 'listItem');
      expect(editor.getHTML()).not.toContain('<ul>');
      expect(editor.getHTML()).toContain('Item');
    });

    it('converts bullet list to ordered list', () => {
      editor = new Editor({ extensions, content: '<ul><li><p>Item</p></li></ul>' });
      setSelection(editor, 3);
      editor.commands.toggleList('orderedList', 'listItem');
      expect(editor.getHTML()).toContain('<ol>');
      expect(editor.getHTML()).not.toContain('<ul>');
    });

    it('returns false for unknown list type', () => {
      editor = new Editor({ extensions, content: '<p>Text</p>' });
      setSelection(editor, 2);
      expect(editor.commands.toggleList('fakeList', 'listItem')).toBe(false);
    });

    it('handles multi-paragraph selection', () => {
      editor = new Editor({ extensions, content: '<p>One</p><p>Two</p>' });
      setSelection(editor, 2, 8);
      editor.commands.toggleList('bulletList', 'listItem');
      const html = editor.getHTML();
      expect(html).toContain('<ul>');
      // Both items should be in the list
      expect(html).toContain('One');
      expect(html).toContain('Two');
    });

    it('wraps in task list', () => {
      editor = new Editor({ extensions, content: '<p>Task</p>' });
      setSelection(editor, 2);
      editor.commands.toggleList('taskList', 'taskItem');
      expect(editor.getHTML()).toContain('data-type="taskList"');
    });

    it('mixed: bullet list + paragraphs → toggle bullet list flattens and wraps', () => {
      editor = new Editor({
        extensions,
        content: '<ul><li><p>first</p></li></ul><p>second</p><p>third</p>',
      });
      // Select all content
      const docSize = editor.state.doc.content.size;
      setSelection(editor, 0, docSize);
      const result = editor.commands.toggleList('bulletList', 'listItem');
      const html = editor.getHTML();
      expect(result).toBe(true);
      expect(html).toContain('first');
      expect(html).toContain('second');
      expect(html).toContain('third');
      // Should be a single flat bullet list, NOT nested
      const ulCount = (html.match(/<ul>/g) ?? []).length;
      expect(ulCount).toBe(1);
    });

    it('mixed: bullet list + paragraphs → toggle ordered list', () => {
      editor = new Editor({
        extensions,
        content: '<ul><li><p>first</p></li></ul><p>second</p><p>third</p>',
      });
      const docSize = editor.state.doc.content.size;
      setSelection(editor, 0, docSize);
      editor.commands.toggleList('orderedList', 'listItem');
      const html = editor.getHTML();
      expect(html).toContain('<ol>');
      expect(html).not.toContain('<ul>');
      expect(html).toContain('first');
      expect(html).toContain('second');
    });
  });
});
