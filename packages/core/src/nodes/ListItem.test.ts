import { describe, it, expect, afterEach } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';
import { TextSelection } from 'prosemirror-state';
import { splitListItem, liftListItem } from 'prosemirror-schema-list';
import { ListItem } from './ListItem.js';
import { BulletList } from './BulletList.js';
import { OrderedList } from './OrderedList.js';
import { TaskList } from './TaskList.js';
import { TaskItem } from './TaskItem.js';
import { Document } from './Document.js';
import { Text } from './Text.js';
import { Paragraph } from './Paragraph.js';
import { Editor } from '../Editor.js';

describe('ListItem', () => {
  describe('configuration', () => {
    it('has correct name', () => {
      expect(ListItem.name).toBe('listItem');
    });

    it('is a node type', () => {
      expect(ListItem.type).toBe('node');
    });

    it('has block+ content', () => {
      expect(ListItem.config.content).toBe('block+');
    });

    it('is defining', () => {
      expect(ListItem.config.defining).toBe(true);
    });

    it('has default options', () => {
      expect(ListItem.options).toEqual({
        HTMLAttributes: {},
      });
    });

    it('can configure HTMLAttributes', () => {
      const CustomListItem = ListItem.configure({
        HTMLAttributes: { class: 'custom-item' },
      });
      expect(CustomListItem.options.HTMLAttributes).toEqual({ class: 'custom-item' });
    });
  });

  describe('parseHTML', () => {
    it('returns rule for li tag', () => {
      const rules = ListItem.config.parseHTML?.call(ListItem);

      expect(rules).toEqual([{ tag: 'li' }]);
    });
  });

  describe('renderHTML', () => {
    it('renders li element', () => {
      const spec = ListItem.createNodeSpec();
      const mockNode = { attrs: {} } as unknown as PMNode;

      const result = spec.toDOM?.(mockNode) as [string, Record<string, unknown>, number];

      expect(result[0]).toBe('li');
      expect(result[2]).toBe(0);
    });

    it('merges HTMLAttributes from options', () => {
      const CustomListItem = ListItem.configure({
        HTMLAttributes: { class: 'styled-item' },
      });

      const spec = CustomListItem.createNodeSpec();
      const mockNode = { attrs: {} } as unknown as PMNode;

      const result = spec.toDOM?.(mockNode) as [string, Record<string, unknown>, number];

      expect(result[0]).toBe('li');
      expect(result[1]).toEqual({ class: 'styled-item' });
    });
  });

  describe('addKeyboardShortcuts', () => {
    it('provides Enter shortcut', () => {
      const shortcuts = ListItem.config.addKeyboardShortcuts?.call(ListItem);

      expect(shortcuts).toHaveProperty('Enter');
    });

    it('provides Tab shortcut', () => {
      const shortcuts = ListItem.config.addKeyboardShortcuts?.call(ListItem);

      expect(shortcuts).toHaveProperty('Tab');
    });

    it('provides Shift-Tab shortcut', () => {
      const shortcuts = ListItem.config.addKeyboardShortcuts?.call(ListItem);

      expect(shortcuts).toHaveProperty('Shift-Tab');
    });

    it('Tab returns false when no editor/nodeType', () => {
       
      const shortcuts = ListItem.config.addKeyboardShortcuts?.call({
        ...ListItem, editor: undefined, nodeType: undefined, options: ListItem.options,
      } as any);
       
      expect((shortcuts?.['Tab'] as any)?.()).toBe(false);
    });

    it('Shift-Tab returns false when no editor/nodeType', () => {
       
      const shortcuts = ListItem.config.addKeyboardShortcuts?.call({
        ...ListItem, editor: undefined, nodeType: undefined, options: ListItem.options,
      } as any);
       
      expect((shortcuts?.['Shift-Tab'] as any)?.()).toBe(false);
    });
  });

  describe('integration', () => {
    let editor: Editor | undefined;

    afterEach(() => {
      if (editor && !editor.isDestroyed) {
        editor.destroy();
      }
    });

    it('works in bullet list', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, BulletList, ListItem],
        content: '<ul><li><p>Item</p></li></ul>',
      });

      expect(editor.getText()).toContain('Item');
    });

    it('works in ordered list', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, OrderedList, ListItem],
        content: '<ol><li><p>Item</p></li></ol>',
      });

      expect(editor.getText()).toContain('Item');
    });

    it('parses list item correctly', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, BulletList, ListItem],
        content: '<ul><li><p>List item</p></li></ul>',
      });

      const doc = editor.state.doc;
      const list = doc.child(0);
      expect(list.child(0).type.name).toBe('listItem');
    });

    it('renders list item correctly', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, BulletList, ListItem],
        content: '<ul><li><p>Test</p></li></ul>',
      });

      const html = editor.getHTML();
      expect(html).toBe('<ul><li><p>Test</p></li></ul>');
    });

    it('can contain multiple blocks', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, BulletList, ListItem],
        content: '<ul><li><p>First para</p><p>Second para</p></li></ul>',
      });

      const doc = editor.state.doc;
      const listItem = doc.child(0).child(0);
      expect(listItem.childCount).toBe(2);
      expect(listItem.child(0).type.name).toBe('paragraph');
      expect(listItem.child(1).type.name).toBe('paragraph');
    });

    it('can contain nested lists', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, BulletList, ListItem],
        content: '<ul><li><p>Parent</p><ul><li><p>Child</p></li></ul></li></ul>',
      });

      const doc = editor.state.doc;
      const outerListItem = doc.child(0).child(0);
      expect(outerListItem.childCount).toBe(2);
      expect(outerListItem.child(0).type.name).toBe('paragraph');
      expect(outerListItem.child(1).type.name).toBe('bulletList');
    });

    it('Tab sinks list item when editor is available', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, BulletList, ListItem],
        content: '<ul><li><p>Item 1</p></li><li><p>Item 2</p></li></ul>',
      });

      // Position cursor in second list item
      // Structure: ul > li > p > "Item 1" | li > p > "Item 2"
      // doc(0) > bulletList(1) > listItem(2) > p(3) > "Item 1"(4-9) > /p(10) > /li(11) > li(12) > p(13) > "Item 2"(14-19)
      editor.view.dispatch(
        editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 14))
      );

      const nodeType = editor.state.schema.nodes['listItem'];
       
      const shortcuts = ListItem.config.addKeyboardShortcuts?.call({
        ...ListItem, editor, nodeType, options: ListItem.options,
      } as any);

       
      const result = (shortcuts?.['Tab'] as any)?.();
      expect(result).toBe(true);
    });

    it('Shift-Tab lifts nested list item', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, BulletList, ListItem],
        content: '<ul><li><p>Parent</p><ul><li><p>Child</p></li></ul></li></ul>',
      });

      // Position cursor in nested (child) list item
      // doc > ul > li > p > "Parent" > /p > ul > li > p > "Child"
      // Find position inside "Child"
      const doc = editor.state.doc;
      // Find a text position inside "Child"
      let childPos = 0;
      doc.descendants((node, pos) => {
        if (node.isText && node.text === 'Child') {
          childPos = pos;
        }
      });

      editor.view.dispatch(
        editor.state.tr.setSelection(TextSelection.create(doc, childPos))
      );

      const nodeType = editor.state.schema.nodes['listItem'];
       
      const shortcuts = ListItem.config.addKeyboardShortcuts?.call({
        ...ListItem, editor, nodeType, options: ListItem.options,
      } as any);

       
      const result = (shortcuts?.['Shift-Tab'] as any)?.();
      expect(result).toBe(true);
    });

    it('Enter splits list item via keymap plugin', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, BulletList, ListItem],
        content: '<ul><li><p>Hello world</p></li></ul>',
      });

      // Position cursor in the middle of the text
      editor.view.dispatch(
        editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 8))
      );

      // The Enter key is handled by addKeyboardShortcuts
      // We can invoke the splitListItem command directly to test the same code path
      const nodeType = editor.state.schema.nodes['listItem']!;
      const result = splitListItem(nodeType)(editor.state, editor.view.dispatch);
      expect(result).toBe(true);

      // Should now have two list items
      expect(editor.state.doc.child(0).childCount).toBe(2);
    });

    it('Enter guard: returns false when cursor parent is not listItem', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, BulletList, ListItem],
        content: '<p>Not in a list</p>',
      });

      editor.focus('start');

      const nodeType = editor.state.schema.nodes['listItem'];
      const shortcuts = ListItem.config.addKeyboardShortcuts?.call({
        ...ListItem, editor, nodeType, options: ListItem.options,
      } as any);

      const result = (shortcuts?.['Enter'] as any)?.();
      expect(result).toBe(false);
    });

    it('Tab guard: returns false when cursor parent is not listItem', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, BulletList, ListItem],
        content: '<p>Not in a list</p>',
      });

      editor.focus('start');

      const nodeType = editor.state.schema.nodes['listItem'];
      const shortcuts = ListItem.config.addKeyboardShortcuts?.call({
        ...ListItem, editor, nodeType, options: ListItem.options,
      } as any);

      const result = (shortcuts?.['Tab'] as any)?.();
      expect(result).toBe(false);
    });

    it('liftListItem on empty item in bullet list inside taskItem', () => {
      // This tests the scenario where liftListItem would place bare paragraph in taskItem
      editor = new Editor({
        extensions: [Document, Text, Paragraph, BulletList, OrderedList, ListItem, TaskList, TaskItem],
        content: `
          <ul data-type="taskList">
            <li data-type="taskItem" data-checked="false">
              <label contenteditable="false"><input type="checkbox"></label>
              <div><p>Task</p>
                <ul><li><p></p></li></ul>
              </div>
            </li>
          </ul>
        `,
      });

      // Find the empty paragraph position inside the nested bullet
      let emptyPos = 0;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'paragraph' && node.content.size === 0) {
          // Find the empty paragraph that's inside the nested bulletList
          const $pos = editor!.state.doc.resolve(pos);
          if ($pos.depth >= 4) { // deep enough to be in nested list
            emptyPos = pos + 1; // inside the paragraph
          }
        }
      });

      if (emptyPos > 0) {
        editor.view.dispatch(
          editor.state.tr.setSelection(TextSelection.create(editor.state.doc, emptyPos))
        );

        // Invoke Enter handler
        const nodeType = editor.state.schema.nodes['listItem'];
        const shortcuts = ListItem.config.addKeyboardShortcuts?.call({
          ...ListItem, editor, nodeType, options: ListItem.options,
        } as any);

        const result = (shortcuts?.['Enter'] as any)?.();
        expect(result).toBe(true);

        // Should have created a new taskItem, not a bare paragraph
        const html = editor.getHTML();
        expect(html).toContain('Task');
        // The taskList should have 2 task items now
        const taskList = editor.state.doc.child(0);
        expect(taskList.type.name).toBe('taskList');
        expect(taskList.childCount).toBe(2);
      }
    });

    it('multiple items in nested list: only removes empty item', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, BulletList, OrderedList, ListItem, TaskList, TaskItem],
        content: `
          <ul data-type="taskList">
            <li data-type="taskItem" data-checked="false">
              <label contenteditable="false"><input type="checkbox"></label>
              <div><p>Task</p>
                <ul><li><p>Keep me</p></li><li><p></p></li></ul>
              </div>
            </li>
          </ul>
        `,
      });

      // Find the second (empty) listItem paragraph
      let emptyPos = 0;
      let foundKeepMe = false;
      editor.state.doc.descendants((node, pos) => {
        if (node.isText && node.text === 'Keep me') foundKeepMe = true;
        if (foundKeepMe && node.type.name === 'paragraph' && node.content.size === 0) {
          emptyPos = pos + 1;
          foundKeepMe = false; // only find the first one after "Keep me"
        }
      });

      if (emptyPos > 0) {
        editor.view.dispatch(
          editor.state.tr.setSelection(TextSelection.create(editor.state.doc, emptyPos))
        );

        const nodeType = editor.state.schema.nodes['listItem'];
        const shortcuts = ListItem.config.addKeyboardShortcuts?.call({
          ...ListItem, editor, nodeType, options: ListItem.options,
        } as any);

        const result = (shortcuts?.['Enter'] as any)?.();
        expect(result).toBe(true);

        const html = editor.getHTML();
        expect(html).toContain('Keep me');
        expect(html).toContain('Task');
      }
    });
  });
});
