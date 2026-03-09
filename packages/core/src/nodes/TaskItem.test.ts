import { describe, it, expect, afterEach } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';
import { TextSelection } from 'prosemirror-state';
import { TaskItem } from './TaskItem.js';
import { TaskList } from './TaskList.js';
import { BulletList } from './BulletList.js';
import { OrderedList } from './OrderedList.js';
import { ListItem } from './ListItem.js';
import { Document } from './Document.js';
import { Text } from './Text.js';
import { Paragraph } from './Paragraph.js';
import { Editor } from '../Editor.js';

// Helper type for DOM output spec - tag, attrs, children structure
type DOMArray = [string, Record<string, unknown>, ...unknown[]];

describe('TaskItem', () => {
  describe('configuration', () => {
    it('has correct name', () => {
      expect(TaskItem.name).toBe('taskItem');
    });

    it('is a node type', () => {
      expect(TaskItem.type).toBe('node');
    });

    it('has block+ content', () => {
      expect(TaskItem.config.content).toBe('block+');
    });

    it('is defining', () => {
      expect(TaskItem.config.defining).toBe(true);
    });

    it('has default options', () => {
      expect(TaskItem.options).toEqual({
        HTMLAttributes: {},
        nested: true,
      });
    });

    it('can configure HTMLAttributes', () => {
      const CustomTaskItem = TaskItem.configure({
        HTMLAttributes: { class: 'custom-task-item' },
      });
      expect(CustomTaskItem.options.HTMLAttributes).toEqual({ class: 'custom-task-item' });
    });
  });

  describe('addAttributes', () => {
    it('defines checked attribute', () => {
      const attrs = TaskItem.config.addAttributes?.call(TaskItem);

      expect(attrs).toHaveProperty('checked');
      expect(attrs?.['checked']?.default).toBe(false);
      expect(attrs?.['checked']?.keepOnSplit).toBe(false);
    });

    it('parses checked="true" from data attribute', () => {
      const attrs = TaskItem.config.addAttributes?.call(TaskItem);
      const parseHTML = attrs?.['checked']?.parseHTML;

      const element = document.createElement('li');
      element.setAttribute('data-checked', 'true');

      expect(parseHTML?.(element)).toBe(true);
    });

    it('parses checked="" (empty) as true', () => {
      const attrs = TaskItem.config.addAttributes?.call(TaskItem);
      const parseHTML = attrs?.['checked']?.parseHTML;

      const element = document.createElement('li');
      element.setAttribute('data-checked', '');

      expect(parseHTML?.(element)).toBe(true);
    });

    it('parses checked="false" as false', () => {
      const attrs = TaskItem.config.addAttributes?.call(TaskItem);
      const parseHTML = attrs?.['checked']?.parseHTML;

      const element = document.createElement('li');
      element.setAttribute('data-checked', 'false');

      expect(parseHTML?.(element)).toBe(false);
    });

    it('renders checked=true as data-checked="true"', () => {
      const attrs = TaskItem.config.addAttributes?.call(TaskItem);
      const renderHTML = attrs?.['checked']?.renderHTML;

      expect(renderHTML?.({ checked: true })).toEqual({ 'data-checked': 'true' });
    });

    it('renders checked=false as data-checked="false"', () => {
      const attrs = TaskItem.config.addAttributes?.call(TaskItem);
      const renderHTML = attrs?.['checked']?.renderHTML;

      expect(renderHTML?.({ checked: false })).toEqual({ 'data-checked': 'false' });
    });
  });

  describe('parseHTML', () => {
    it('returns rule for li with data-type attribute', () => {
      const rules = TaskItem.config.parseHTML?.call(TaskItem);

      expect(rules).toEqual([
        {
          tag: 'li[data-type="taskItem"]',
          priority: 51,
        },
      ]);
    });
  });

  describe('renderHTML', () => {
    it('renders li element with checkbox structure', () => {
      const spec = TaskItem.createNodeSpec();
      const mockNode = { attrs: { checked: false } } as unknown as PMNode;

      const result = spec.toDOM?.(mockNode) as DOMArray;

      expect(result[0]).toBe('li');
      expect(result[1]['data-type']).toBe('taskItem');
    });

    it('renders checkbox as checked when checked=true', () => {
      const spec = TaskItem.createNodeSpec();
      const mockNode = { attrs: { checked: true } } as unknown as PMNode;

      const result = spec.toDOM?.(mockNode) as DOMArray;

      // Find the input element in the nested structure: [li, attrs, [label, {...}, [input, {...}]], [div, 0]]
      const label = result[2] as DOMArray;
      const input = label[2] as DOMArray;

      expect(input[0]).toBe('input');
      expect(input[1]['type']).toBe('checkbox');
      expect(input[1]['checked']).toBe('checked');
    });

    it('renders checkbox as unchecked when checked=false', () => {
      const spec = TaskItem.createNodeSpec();
      const mockNode = { attrs: { checked: false } } as unknown as PMNode;

      const result = spec.toDOM?.(mockNode) as DOMArray;

      const label = result[2] as DOMArray;
      const input = label[2] as DOMArray;

      expect(input[0]).toBe('input');
      expect(input[1]['type']).toBe('checkbox');
      expect(input[1]['checked']).toBe(null);
    });

    it('merges HTMLAttributes from options', () => {
      const CustomTaskItem = TaskItem.configure({
        HTMLAttributes: { class: 'styled-task-item' },
      });

      const spec = CustomTaskItem.createNodeSpec();
      const mockNode = { attrs: { checked: false } } as unknown as PMNode;

      const result = spec.toDOM?.(mockNode) as DOMArray;

      expect(result[0]).toBe('li');
      expect(result[1]['class']).toBe('styled-task-item');
      expect(result[1]['data-type']).toBe('taskItem');
    });
  });

  describe('addCommands', () => {
    it('provides toggleTask command', () => {
      const commands = TaskItem.config.addCommands?.call(TaskItem);

      expect(commands).toHaveProperty('toggleTask');
      expect(typeof commands?.['toggleTask']).toBe('function');
    });
  });

  describe('addKeyboardShortcuts', () => {
    it('provides Enter shortcut', () => {
      const shortcuts = TaskItem.config.addKeyboardShortcuts?.call(TaskItem);

      expect(shortcuts).toHaveProperty('Enter');
    });

    it('provides Tab shortcut', () => {
      const shortcuts = TaskItem.config.addKeyboardShortcuts?.call(TaskItem);

      expect(shortcuts).toHaveProperty('Tab');
    });

    it('provides Shift-Tab shortcut', () => {
      const shortcuts = TaskItem.config.addKeyboardShortcuts?.call(TaskItem);

      expect(shortcuts).toHaveProperty('Shift-Tab');
    });

    it('provides Mod-Enter shortcut for toggle', () => {
      const shortcuts = TaskItem.config.addKeyboardShortcuts?.call(TaskItem);

      expect(shortcuts).toHaveProperty('Mod-Enter');
    });

    it('Enter returns false when no editor', () => {
       
      const shortcuts = TaskItem.config.addKeyboardShortcuts?.call({
        ...TaskItem, editor: undefined, nodeType: undefined, options: TaskItem.options,
      } as any);
       
      expect((shortcuts?.['Enter'] as any)?.()).toBe(false);
    });

    it('Tab returns false when no editor', () => {
       
      const shortcuts = TaskItem.config.addKeyboardShortcuts?.call({
        ...TaskItem, editor: undefined, nodeType: undefined, options: TaskItem.options,
      } as any);
       
      expect((shortcuts?.['Tab'] as any)?.()).toBe(false);
    });

    it('Shift-Tab returns false when no editor', () => {
       
      const shortcuts = TaskItem.config.addKeyboardShortcuts?.call({
        ...TaskItem, editor: undefined, nodeType: undefined, options: TaskItem.options,
      } as any);
       
      expect((shortcuts?.['Shift-Tab'] as any)?.()).toBe(false);
    });

    it('Mod-Enter returns false when no editor', () => {
       
      const shortcuts = TaskItem.config.addKeyboardShortcuts?.call({
        ...TaskItem, editor: undefined, nodeType: undefined, options: TaskItem.options,
      } as any);
       
      expect((shortcuts?.['Mod-Enter'] as any)?.()).toBe(false);
    });
  });

  describe('integration', () => {
    let editor: Editor | undefined;

    afterEach(() => {
      if (editor && !editor.isDestroyed) {
        editor.destroy();
      }
    });

    it('works in task list', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, TaskList, TaskItem],
        content:
          '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><label contenteditable="false"><input type="checkbox"></label><div><p>Task</p></div></li></ul>',
      });

      expect(editor.getText()).toContain('Task');
    });

    it('parses task item correctly', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, TaskList, TaskItem],
        content:
          '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><label contenteditable="false"><input type="checkbox"></label><div><p>Task item</p></div></li></ul>',
      });

      const doc = editor.state.doc;
      const list = doc.child(0);
      expect(list.child(0).type.name).toBe('taskItem');
    });

    it('preserves checked state on parse', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, TaskList, TaskItem],
        content:
          '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label contenteditable="false"><input type="checkbox" checked></label><div><p>Done</p></div></li></ul>',
      });

      const doc = editor.state.doc;
      const taskItem = doc.child(0).child(0);
      expect(taskItem.attrs['checked']).toBe(true);
    });

    it('renders task item correctly', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, TaskList, TaskItem],
        content:
          '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><label contenteditable="false"><input type="checkbox"></label><div><p>Test</p></div></li></ul>',
      });

      const html = editor.getHTML();
      expect(html).toContain('data-type="taskItem"');
      expect(html).toContain('data-checked="false"');
    });

    it('can contain multiple blocks', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, TaskList, TaskItem],
        content:
          '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><label contenteditable="false"><input type="checkbox"></label><div><p>First para</p><p>Second para</p></div></li></ul>',
      });

      const doc = editor.state.doc;
      const taskItem = doc.child(0).child(0);
      // Task item should have the paragraph content
      expect(taskItem.textContent).toContain('First para');
      expect(taskItem.textContent).toContain('Second para');
    });

    it('toggleTask command toggles checked state', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, TaskList, TaskItem],
        content:
          '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><label contenteditable="false"><input type="checkbox"></label><div><p>Task</p></div></li></ul>',
      });

      // Focus in the task item - this places cursor inside the content
      editor.focus('start');

      // Toggle task
      const result = editor.commands.toggleTask();
      expect(result).toBe(true);

      // Check that checked state changed
      const taskItem = editor.state.doc.child(0).child(0);
      expect(taskItem.attrs['checked']).toBe(true);
    });

    it('Enter guard: returns false when cursor parent is not taskItem', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, TaskList, TaskItem],
        content: '<p>Not a task</p>',
      });

      editor.focus('start');

      const nodeType = editor.state.schema.nodes['taskItem'];
      const shortcuts = TaskItem.config.addKeyboardShortcuts?.call({
        ...TaskItem, editor, nodeType, options: TaskItem.options,
      } as any);

      const result = (shortcuts?.['Enter'] as any)?.();
      expect(result).toBe(false);
    });

    it('Tab guard: returns false when cursor parent is not taskItem', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, TaskList, TaskItem],
        content: '<p>Not a task</p>',
      });

      editor.focus('start');

      const nodeType = editor.state.schema.nodes['taskItem'];
      const shortcuts = TaskItem.config.addKeyboardShortcuts?.call({
        ...TaskItem, editor, nodeType, options: TaskItem.options,
      } as any);

      const result = (shortcuts?.['Tab'] as any)?.();
      expect(result).toBe(false);
    });

    it('empty taskItem inside listItem: Enter creates new listItem', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, BulletList, OrderedList, ListItem, TaskList, TaskItem],
        content: `
          <ol>
            <li><p>Parent</p>
              <ul data-type="taskList">
                <li data-type="taskItem" data-checked="false">
                  <label contenteditable="false"><input type="checkbox"></label>
                  <div><p></p></div>
                </li>
              </ul>
            </li>
          </ol>
        `,
      });

      // Find the empty paragraph inside the taskItem
      let emptyPos = 0;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'paragraph' && node.content.size === 0) {
          const $pos = editor!.state.doc.resolve(pos);
          if ($pos.depth >= 4) {
            emptyPos = pos + 1;
          }
        }
      });

      if (emptyPos > 0) {
        editor.view.dispatch(
          editor.state.tr.setSelection(TextSelection.create(editor.state.doc, emptyPos))
        );

        const nodeType = editor.state.schema.nodes['taskItem'];
        const shortcuts = TaskItem.config.addKeyboardShortcuts?.call({
          ...TaskItem, editor, nodeType, options: TaskItem.options,
        } as any);

        const result = (shortcuts?.['Enter'] as any)?.();
        expect(result).toBe(true);

        // Should have created a new listItem in the orderedList
        const html = editor.getHTML();
        expect(html).toContain('Parent');
        expect(html).toContain('<ol>');
      }
    });

    it('multi-content taskItem with trailing empty paragraph: only deletes empty paragraph', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, BulletList, OrderedList, ListItem, TaskList, TaskItem],
        content: `
          <ol>
            <li><p>Above</p>
              <ul data-type="taskList">
                <li data-type="taskItem" data-checked="false">
                  <label contenteditable="false"><input type="checkbox"></label>
                  <div><p>Task content</p>
                    <ul><li><p>Nested</p></li></ul>
                    <p></p>
                  </div>
                </li>
              </ul>
            </li>
          </ol>
        `,
      });

      // Find the trailing empty paragraph inside the taskItem
      let emptyPos = 0;
      let foundNested = false;
      editor.state.doc.descendants((node, pos) => {
        if (node.isText && node.text === 'Nested') foundNested = true;
        if (foundNested && node.type.name === 'paragraph' && node.content.size === 0) {
          emptyPos = pos + 1;
          foundNested = false;
        }
      });

      if (emptyPos > 0) {
        editor.view.dispatch(
          editor.state.tr.setSelection(TextSelection.create(editor.state.doc, emptyPos))
        );

        const nodeType = editor.state.schema.nodes['taskItem'];
        const shortcuts = TaskItem.config.addKeyboardShortcuts?.call({
          ...TaskItem, editor, nodeType, options: TaskItem.options,
        } as any);

        const result = (shortcuts?.['Enter'] as any)?.();
        expect(result).toBe(true);

        // All content should be preserved
        const html = editor.getHTML();
        expect(html).toContain('Task content');
        expect(html).toContain('Nested');
        expect(html).toContain('Above');
      }
    });

    it('Enter on empty taskItem in multi-child taskList inside listItem: deletes only empty taskItem', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, BulletList, OrderedList, ListItem, TaskList, TaskItem],
        content: `
          <ol>
            <li><p>Parent</p>
              <ul data-type="taskList">
                <li data-type="taskItem" data-checked="true">
                  <label contenteditable="false"><input type="checkbox" checked></label>
                  <div><p>Done task</p></div>
                </li>
                <li data-type="taskItem" data-checked="false">
                  <label contenteditable="false"><input type="checkbox"></label>
                  <div><p></p></div>
                </li>
              </ul>
            </li>
          </ol>
        `,
      });

      // Find the empty paragraph inside the second (empty) taskItem
      let emptyPos = 0;
      let foundDone = false;
      editor.state.doc.descendants((node, pos) => {
        if (node.isText && node.text === 'Done task') foundDone = true;
        if (foundDone && node.type.name === 'paragraph' && node.content.size === 0) {
          emptyPos = pos + 1;
          foundDone = false;
        }
      });

      if (emptyPos > 0) {
        editor.view.dispatch(
          editor.state.tr.setSelection(TextSelection.create(editor.state.doc, emptyPos))
        );

        const nodeType = editor.state.schema.nodes['taskItem'];
        const shortcuts = TaskItem.config.addKeyboardShortcuts?.call({
          ...TaskItem, editor, nodeType, options: TaskItem.options,
        } as any);

        const result = (shortcuts?.['Enter'] as any)?.();
        expect(result).toBe(true);

        // The "Done task" taskItem should be preserved
        const html = editor.getHTML();
        expect(html).toContain('Done task');
        expect(html).toContain('Parent');
        // taskList should now have only 1 taskItem (the empty one was deleted)
        let taskListCount = 0;
        editor.state.doc.descendants((node) => {
          if (node.type.name === 'taskList') taskListCount++;
        });
        // The taskList should still exist with the remaining task
        expect(taskListCount).toBe(1);
        // A new listItem should have been created in the parent orderedList
        expect(html).toContain('<ol>');
      }
    });

    it('Enter on empty top-level taskItem: liftListItem exits task list', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, TaskList, TaskItem],
        content: `
          <ul data-type="taskList">
            <li data-type="taskItem" data-checked="false">
              <label contenteditable="false"><input type="checkbox"></label>
              <div><p>Task above</p></div>
            </li>
            <li data-type="taskItem" data-checked="false">
              <label contenteditable="false"><input type="checkbox"></label>
              <div><p></p></div>
            </li>
          </ul>
        `,
      });

      // Find the empty paragraph in the second taskItem
      let emptyPos = 0;
      let foundAbove = false;
      editor.state.doc.descendants((node, pos) => {
        if (node.isText && node.text === 'Task above') foundAbove = true;
        if (foundAbove && node.type.name === 'paragraph' && node.content.size === 0) {
          emptyPos = pos + 1;
          foundAbove = false;
        }
      });

      if (emptyPos > 0) {
        editor.view.dispatch(
          editor.state.tr.setSelection(TextSelection.create(editor.state.doc, emptyPos))
        );

        const nodeType = editor.state.schema.nodes['taskItem'];
        const shortcuts = TaskItem.config.addKeyboardShortcuts?.call({
          ...TaskItem, editor, nodeType, options: TaskItem.options,
        } as any);

        const result = (shortcuts?.['Enter'] as any)?.();
        expect(result).toBe(true);

        // "Task above" should be preserved in the taskList
        expect(editor.getHTML()).toContain('Task above');
        // The empty taskItem should have been lifted out of the list (now a paragraph)
        const doc = editor.state.doc;
        // First child should still be a taskList with the remaining task
        expect(doc.child(0).type.name).toBe('taskList');
        // Second child should be a paragraph (the lifted empty item)
        expect(doc.child(1).type.name).toBe('paragraph');
      }
    });

    it('Shift-Tab guard: returns false when cursor parent is not taskItem (with editor)', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, TaskList, TaskItem],
        content: '<p>Not a task</p>',
      });

      editor.focus('start');

      const nodeType = editor.state.schema.nodes['taskItem'];
      const shortcuts = TaskItem.config.addKeyboardShortcuts?.call({
        ...TaskItem, editor, nodeType, options: TaskItem.options,
      } as any);

      const result = (shortcuts?.['Shift-Tab'] as any)?.();
      expect(result).toBe(false);
    });

    it('toggleTask toggles back from true to false', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, TaskList, TaskItem],
        content: `
          <ul data-type="taskList">
            <li data-type="taskItem" data-checked="true">
              <label contenteditable="false"><input type="checkbox" checked></label>
              <div><p>Done</p></div>
            </li>
          </ul>
        `,
      });

      editor.focus('start');

      // Toggle off
      editor.commands.toggleTask();
      expect(editor.state.doc.child(0).child(0).attrs['checked']).toBe(false);

      // Toggle on again
      editor.commands.toggleTask();
      expect(editor.state.doc.child(0).child(0).attrs['checked']).toBe(true);
    });
  });
});
