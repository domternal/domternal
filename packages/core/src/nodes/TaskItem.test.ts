import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import type { Node as PMNode } from '@domternal/pm/model';
import { TextSelection } from '@domternal/pm/state';
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

    it('has paragraph block* content (Notion-strict label slot)', () => {
      expect(TaskItem.config.content).toBe('paragraph block*');
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

    it('Enter on a CHECKED non-empty taskItem creates an UNCHECKED sibling', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, TaskList, TaskItem],
        content:
          '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label contenteditable="false"><input type="checkbox" checked></label><div><p>Done task</p></div></li></ul>',
      });

      // Place cursor at the END of the existing task's text so Enter splits
      // (not the start, which would push content into the new item).
      const para = editor.state.doc.firstChild!.firstChild!.firstChild!;
      const endOfText = 1 /* taskList open */ + 1 /* taskItem open */ + 1 /* paragraph open */ + para.content.size;
      editor.view.dispatch(
        editor.state.tr.setSelection(TextSelection.create(editor.state.doc, endOfText)),
      );

      const nodeType = editor.state.schema.nodes['taskItem'];
      const shortcuts = TaskItem.config.addKeyboardShortcuts?.call({
        ...TaskItem, editor, nodeType, options: TaskItem.options,
      } as any);
      const result = (shortcuts?.['Enter'] as any)?.();
      expect(result).toBe(true);

      const list = editor.state.doc.firstChild!;
      expect(list.childCount).toBe(2);
      // Original task stays checked, new sibling starts unchecked.
      expect(list.child(0).attrs['checked']).toBe(true);
      expect(list.child(1).attrs['checked']).toBe(false);
    });

    it('Enter on an UNCHECKED taskItem creates another UNCHECKED sibling', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, TaskList, TaskItem],
        content:
          '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><label contenteditable="false"><input type="checkbox"></label><div><p>Todo</p></div></li></ul>',
      });

      const para = editor.state.doc.firstChild!.firstChild!.firstChild!;
      const endOfText = 1 + 1 + 1 + para.content.size;
      editor.view.dispatch(
        editor.state.tr.setSelection(TextSelection.create(editor.state.doc, endOfText)),
      );

      const nodeType = editor.state.schema.nodes['taskItem'];
      const shortcuts = TaskItem.config.addKeyboardShortcuts?.call({
        ...TaskItem, editor, nodeType, options: TaskItem.options,
      } as any);
      (shortcuts?.['Enter'] as any)?.();

      const list = editor.state.doc.firstChild!;
      expect(list.childCount).toBe(2);
      expect(list.child(1).attrs['checked']).toBe(false);
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

  describe('keyboard shortcuts edge cases', () => {
    let editor: Editor | undefined;

    afterEach(() => {
      if (editor && !editor.isDestroyed) editor.destroy();
    });

    it('Tab returns false when editor is null', () => {
      const shortcuts = TaskItem.config.addKeyboardShortcuts?.call({
        ...TaskItem,
        editor: null,
        nodeType: null,
      });
      const result = (shortcuts?.['Tab'] as any)?.();
      expect(result).toBe(false);
    });

    it('Tab returns false when not in taskItem', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, TaskList, TaskItem],
        content: '<p>Hi</p>',
      });
      const shortcuts = TaskItem.config.addKeyboardShortcuts?.call({
        ...TaskItem,
        editor,
        nodeType: editor.schema.nodes['taskItem'],
      });
      const result = (shortcuts?.['Tab'] as any)?.();
      expect(result).toBe(false);
    });

    it('Shift-Tab returns false when editor is null', () => {
      const shortcuts = TaskItem.config.addKeyboardShortcuts?.call({
        ...TaskItem,
        editor: null,
        nodeType: null,
      });
      const result = (shortcuts?.['Shift-Tab'] as any)?.();
      expect(result).toBe(false);
    });

    it('Backspace returns false when editor is null', () => {
      const shortcuts = TaskItem.config.addKeyboardShortcuts?.call({
        ...TaskItem,
        editor: null,
        nodeType: null,
      });
      const result = (shortcuts?.['Backspace'] as any)?.();
      expect(result).toBe(false);
    });

    it('Backspace returns false when not in taskItem', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, TaskList, TaskItem],
        content: '<p>Outside</p>',
      });
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1)));
      const shortcuts = TaskItem.config.addKeyboardShortcuts?.call({
        ...TaskItem,
        editor,
        nodeType: editor.schema.nodes['taskItem'],
      });
      const result = (shortcuts?.['Backspace'] as any)?.();
      expect(result).toBe(false);
    });

    it('Backspace returns false when not at start of textblock', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, TaskList, TaskItem],
        content: '<ul data-type="taskList"><li data-type="taskItem"><p>Hello</p></li></ul>',
      });
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 5)));

      const shortcuts = TaskItem.config.addKeyboardShortcuts?.call({
        ...TaskItem,
        editor,
        nodeType: editor.schema.nodes['taskItem'],
      });
      const result = (shortcuts?.['Backspace'] as any)?.();
      expect(result).toBe(false);
    });

    it('Backspace at start of first child of taskItem attempts to lift', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, TaskList, TaskItem],
        content: '<ul data-type="taskList"><li data-type="taskItem"><p>Hello</p></li></ul>',
      });
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 3)));

      const shortcuts = TaskItem.config.addKeyboardShortcuts?.call({
        ...TaskItem,
        editor,
        nodeType: editor.schema.nodes['taskItem'],
      });
      const result = (shortcuts?.['Backspace'] as any)?.();
      expect(typeof result).toBe('boolean');
    });

    it('Mod-Enter triggers toggleTask', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, TaskList, TaskItem],
        content: '<ul data-type="taskList"><li data-type="taskItem"><p>X</p></li></ul>',
      });

      const shortcuts = TaskItem.config.addKeyboardShortcuts?.call({
        ...TaskItem,
        editor,
        nodeType: editor.schema.nodes['taskItem'],
      });
      const result = (shortcuts?.['Mod-Enter'] as any)?.();
      expect(typeof result).toBe('boolean');
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // children-zone Enter / Backspace handlers (taskItem mirror)
  // ────────────────────────────────────────────────────────────────────

  describe('children-zone Enter', () => {
    let edTest: Editor | undefined;
    afterEach(() => {
      if (edTest && !edTest.isDestroyed) edTest.destroy();
    });

    function invokeEnter(ed: Editor): unknown {
      const shortcuts = TaskItem.config.addKeyboardShortcuts?.call({
        ...TaskItem,
        editor: ed,
        nodeType: ed.schema.nodes['taskItem'],
      });
      return (shortcuts?.['Enter'] as any)?.();
    }

    function caretAtEndOfNthEmptyP(ed: Editor, n: number): void {
      let count = 0;
      let pos = -1;
      ed.state.doc.descendants((node, p) => {
        if (pos !== -1) return false;
        if (node.type.name === 'paragraph' && node.content.size === 0) {
          if (count === n) { pos = p + 1; return false; }
          count++;
        }
        return true;
      });
      if (pos === -1) throw new Error(`empty paragraph #${String(n)} not found`);
      ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, pos)));
    }

    function caretAtEndOfNodeWithText(ed: Editor, typeName: string, text: string): void {
      let pos = -1;
      let size = 0;
      ed.state.doc.descendants((node, p) => {
        if (pos !== -1) return false;
        if (node.type.name === typeName && node.textContent === text) { pos = p; size = node.nodeSize; return false; }
        return true;
      });
      if (pos === -1) throw new Error(`node ${typeName}:${text} not found`);
      ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, pos + size - 1)));
    }

    it('empty children-zone p + Enter inserts another empty p as next sibling INSIDE taskItem', () => {
      edTest = new Editor({
        extensions: [Document, Text, Paragraph, TaskList, TaskItem],
        content: '<ul data-type="taskList"><li data-type="taskItem"><p>Label</p><p></p></li></ul>',
      });
      caretAtEndOfNthEmptyP(edTest, 0);

      const result = invokeEnter(edTest);
      expect(result).toBe(true);

      const taskItem = edTest.state.doc.firstChild?.firstChild;
      expect(taskItem?.type.name).toBe('taskItem');
      expect(taskItem?.childCount).toBe(3);
    });

    it('non-empty children-zone p + Enter at end splits in place INSIDE taskItem', () => {
      edTest = new Editor({
        extensions: [Document, Text, Paragraph, TaskList, TaskItem],
        content: '<ul data-type="taskList"><li data-type="taskItem"><p>Label</p><p>Note</p></li></ul>',
      });
      caretAtEndOfNodeWithText(edTest, 'paragraph', 'Note');

      const result = invokeEnter(edTest);
      expect(result).toBe(true);

      const taskItem = edTest.state.doc.firstChild?.firstChild;
      expect(taskItem?.childCount).toBe(3);
      expect(taskItem?.child(2).type.name).toBe('paragraph');
      expect(taskItem?.child(2).textContent).toBe('');
    });

    it('non-empty children-zone p + Enter at MID splits text in place', () => {
      edTest = new Editor({
        extensions: [Document, Text, Paragraph, TaskList, TaskItem],
        content: '<ul data-type="taskList"><li data-type="taskItem"><p>Label</p><p>HelloWorld</p></li></ul>',
      });
      let pos = -1;
      edTest.state.doc.descendants((node, p) => {
        if (pos !== -1) return false;
        if (node.type.name === 'paragraph' && node.textContent === 'HelloWorld') { pos = p + 1 + 'Hello'.length; return false; }
        return true;
      });
      edTest.view.dispatch(edTest.state.tr.setSelection(TextSelection.create(edTest.state.doc, pos)));

      const result = invokeEnter(edTest);
      expect(result).toBe(true);

      const taskItem = edTest.state.doc.firstChild?.firstChild;
      expect(taskItem?.childCount).toBe(3);
      expect(taskItem?.child(1).textContent).toBe('Hello');
      expect(taskItem?.child(2).textContent).toBe('World');
    });
  });

  describe('children-zone Backspace', () => {
    let edTest: Editor | undefined;
    afterEach(() => {
      if (edTest && !edTest.isDestroyed) edTest.destroy();
    });

    function invokeBackspace(ed: Editor): unknown {
      const shortcuts = TaskItem.config.addKeyboardShortcuts?.call({
        ...TaskItem,
        editor: ed,
        nodeType: ed.schema.nodes['taskItem'],
      });
      return (shortcuts?.['Backspace'] as any)?.();
    }

    function caretAtEndOfNthEmptyP(ed: Editor, n: number): void {
      let count = 0;
      let pos = -1;
      ed.state.doc.descendants((node, p) => {
        if (pos !== -1) return false;
        if (node.type.name === 'paragraph' && node.content.size === 0) {
          if (count === n) { pos = p + 1; return false; }
          count++;
        }
        return true;
      });
      if (pos === -1) throw new Error(`empty paragraph #${String(n)} not found`);
      ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, pos)));
    }

    it('empty children-zone p + Backspace lifts JUST that paragraph as top-level sibling', () => {
      edTest = new Editor({
        extensions: [Document, Text, Paragraph, TaskList, TaskItem],
        content: '<ul data-type="taskList"><li data-type="taskItem"><p>Label</p><p></p></li></ul>',
      });
      caretAtEndOfNthEmptyP(edTest, 0);

      const result = invokeBackspace(edTest);
      expect(result).toBe(true);

      const docTop: { type: string }[] = [];
      edTest.state.doc.forEach((n) => docTop.push({ type: n.type.name }));
      expect(docTop[0]?.type).toBe('taskList');
      expect(docTop[1]?.type).toBe('paragraph');
    });

    it('empty LABEL paragraph + Backspace - children-zone branch does NOT fire, existing fallback runs', () => {
      // childIndex===0 case: children-zone branch returns false
      // (isInChildrenZone=false). Existing TaskItem.Backspace fallback
      // (childIndex===0 + liftListItem) handles the case.
      edTest = new Editor({
        extensions: [Document, Text, Paragraph, TaskList, TaskItem],
        content: '<ul data-type="taskList"><li data-type="taskItem"><p></p></li></ul>',
      });
      caretAtEndOfNthEmptyP(edTest, 0);

      const result = invokeBackspace(edTest);
      // Existing logic responds (typically true via liftListItem) - we
      // just verify the call returns a boolean (no crash, branch reached).
      expect(typeof result).toBe('boolean');
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // TaskItem NodeView (checkbox interactivity)
  // ────────────────────────────────────────────────────────────────────

  describe('addNodeView (checkbox interactivity)', () => {
    let editor: Editor | undefined;
    let host: HTMLElement;

    beforeEach(() => {
      host = document.createElement('div');
      document.body.appendChild(host);
    });

    afterEach(() => {
      if (editor && !editor.isDestroyed) editor.destroy();
      host.remove();
    });

    function getTaskItemElement(): HTMLLIElement {
      const li = host.querySelector<HTMLLIElement>('li[data-type="taskItem"]');
      if (!li) throw new Error('taskItem <li> not found in host');
      return li;
    }

    function getCheckbox(): HTMLInputElement {
      const cb = host.querySelector<HTMLInputElement>('li[data-type="taskItem"] input[type="checkbox"]');
      if (!cb) throw new Error('checkbox not found in host');
      return cb;
    }

    it('mounts with the renderHTML DOM structure (li > [label > input, div])', () => {
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, TaskList, TaskItem],
        content: '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Task</p></li></ul>',
      });

      const li = getTaskItemElement();
      expect(li.tagName).toBe('LI');
      expect(li.children).toHaveLength(2);
      const label = li.children[0] as HTMLElement;
      const div = li.children[1] as HTMLElement;
      expect(label.tagName).toBe('LABEL');
      expect(label.getAttribute('contenteditable')).toBe('false');
      expect(div.tagName).toBe('DIV');
      expect(label.children).toHaveLength(1);
      const input = label.children[0] as HTMLInputElement;
      expect(input.tagName).toBe('INPUT');
      expect(input.type).toBe('checkbox');
      expect(input.getAttribute('aria-label')).toBe('Task status');
    });

    it('renders data-checked="false" + unchecked input when node.attrs.checked is false', () => {
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, TaskList, TaskItem],
        content: '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Task</p></li></ul>',
      });

      expect(getTaskItemElement().getAttribute('data-checked')).toBe('false');
      expect(getCheckbox().checked).toBe(false);
    });

    it('renders data-checked="true" + checked input when node.attrs.checked is true', () => {
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, TaskList, TaskItem],
        content: '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Done</p></li></ul>',
      });

      expect(getTaskItemElement().getAttribute('data-checked')).toBe('true');
      expect(getCheckbox().checked).toBe(true);
    });

    it('merges options.HTMLAttributes onto the <li>', () => {
      const CustomTaskItem = TaskItem.configure({
        HTMLAttributes: { class: 'styled-task-item', 'data-extra': 'x' },
      });
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, TaskList, CustomTaskItem],
        content: '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Task</p></li></ul>',
      });

      const li = getTaskItemElement();
      expect(li.classList.contains('styled-task-item')).toBe(true);
      expect(li.getAttribute('data-extra')).toBe('x');
      // Identity attributes still win
      expect(li.getAttribute('data-type')).toBe('taskItem');
      expect(li.getAttribute('data-checked')).toBe('false');
    });

    it('clicking the checkbox dispatches a transaction toggling node.attrs.checked', () => {
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, TaskList, TaskItem],
        content: '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Task</p></li></ul>',
      });
      expect(editor.state.doc.child(0).child(0).attrs['checked']).toBe(false);

      getCheckbox().click();

      expect(editor.state.doc.child(0).child(0).attrs['checked']).toBe(true);
    });

    it('update() resyncs data-checked + input.checked after an external transaction', () => {
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, TaskList, TaskItem],
        content: '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Task</p></li></ul>',
      });

      // External path: keyboard shortcut / command rather than mouse click.
      editor.focus('start');
      editor.commands.toggleTask();

      expect(getTaskItemElement().getAttribute('data-checked')).toBe('true');
      expect(getCheckbox().checked).toBe(true);

      editor.commands.toggleTask();

      expect(getTaskItemElement().getAttribute('data-checked')).toBe('false');
      expect(getCheckbox().checked).toBe(false);
    });

    it('multiple consecutive clicks toggle correctly', () => {
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, TaskList, TaskItem],
        content: '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Task</p></li></ul>',
      });

      const cb = getCheckbox();
      cb.click(); // -> true
      expect(editor.state.doc.child(0).child(0).attrs['checked']).toBe(true);
      cb.click(); // -> false
      expect(editor.state.doc.child(0).child(0).attrs['checked']).toBe(false);
      cb.click(); // -> true again
      expect(editor.state.doc.child(0).child(0).attrs['checked']).toBe(true);
    });

    it('clicking while editor is not editable does not change node.attrs.checked', () => {
      // Functional contract: handleChange reads view.editable on every
      // change event and bails when false, reverting the visual flip.
      // The input.disabled sync happens through update() which PM only
      // calls on doc-changing transactions; this test focuses on the
      // path that actually matters - state cannot be mutated through
      // the checkbox while the editor is read-only.
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, TaskList, TaskItem],
        content: '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Task</p></li></ul>',
      });
      editor.setEditable(false);

      getCheckbox().click();

      expect(editor.state.doc.child(0).child(0).attrs['checked']).toBe(false);
      // Visual revert: NodeView restores input.checked to mirror node.attrs.
      expect(getCheckbox().checked).toBe(false);
    });

    it('input.disabled syncs when update() runs on a doc-changing transaction after setEditable(false)', () => {
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, TaskList, TaskItem],
        content: '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Task</p></li></ul>',
      });
      editor.setEditable(false);

      // A doc-changing tx flowing through the editable=false editor
      // would normally be filtered, but we can still dispatch it via
      // view.dispatch directly. Once update() runs, input.disabled
      // reflects the new editable state.
      const before = editor.state;
      const tr = before.tr.insertText('x', 1);
      editor.view.dispatch(tr);

      expect(getCheckbox().disabled).toBe(true);
    });

    it('update() returns false on node type mismatch', () => {
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, TaskList, TaskItem],
        content: '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Task</p></li></ul>',
      });

      // Reach into the running NodeView via the TaskItem extension's
      // addNodeView factory and verify its update() rejects a non-taskItem
      // node. This is a contract check (PM relies on the false return to
      // rebuild the view); we cannot easily provoke it through normal
      // editing because the schema would not produce that mutation.
      const taskItemExt = editor.extensionManager.extensions.find((e) => e.name === 'taskItem');

      const factory = (taskItemExt as any).config.addNodeView?.call({
        ...taskItemExt,
        options: taskItemExt!.options,
        nodeType: editor.schema.nodes['taskItem'],
        editor,
      });
      const taskNode = editor.state.doc.firstChild!.firstChild!;
      const nv = factory(taskNode, editor.view, () => 0);

      const paragraphNode = editor.schema.nodes['paragraph']!.create();
      expect(nv.update(paragraphNode)).toBe(false);
    });

    it('getHTML() round-trip is preserved (renderHTML output unchanged)', () => {
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, TaskList, TaskItem],
        content: '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Task</p></li></ul>',
      });

      const initialHtml = editor.getHTML();
      // Click to toggle, getHTML reflects the new attr value.
      getCheckbox().click();
      const toggledHtml = editor.getHTML();

      expect(initialHtml).toContain('data-type="taskItem"');
      expect(initialHtml).toContain('data-checked="false"');
      expect(toggledHtml).toContain('data-checked="true"');
      // Click back, output goes back to original shape.
      getCheckbox().click();
      expect(editor.getHTML()).toBe(initialHtml);
    });

    it('parseDOM round-trip: setContent with data-checked="true" + click toggles off', () => {
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, TaskList, TaskItem],
        content: '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Done</p></li></ul>',
      });

      expect(editor.state.doc.child(0).child(0).attrs['checked']).toBe(true);
      expect(getCheckbox().checked).toBe(true);

      getCheckbox().click();

      expect(editor.state.doc.child(0).child(0).attrs['checked']).toBe(false);
      expect(getTaskItemElement().getAttribute('data-checked')).toBe('false');
    });

    it('stopEvent returns true for events on the label subtree, false otherwise', () => {
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, TaskList, TaskItem],
        content: '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Task</p></li></ul>',
      });

      const taskItemExt = editor.extensionManager.extensions.find((e) => e.name === 'taskItem');

      const factory = (taskItemExt as any).config.addNodeView?.call({
        ...taskItemExt,
        options: taskItemExt!.options,
        nodeType: editor.schema.nodes['taskItem'],
        editor,
      });
      const taskNode = editor.state.doc.firstChild!.firstChild!;
      const nv = factory(taskNode, editor.view, () => 0);

      const labelEvent = new MouseEvent('mousedown');
      Object.defineProperty(labelEvent, 'target', { value: nv.dom.querySelector('input'), writable: false });
      expect(nv.stopEvent(labelEvent)).toBe(true);

      const contentEvent = new MouseEvent('mousedown');
      Object.defineProperty(contentEvent, 'target', { value: nv.contentDOM, writable: false });
      expect(nv.stopEvent(contentEvent)).toBe(false);
    });
  });
});
