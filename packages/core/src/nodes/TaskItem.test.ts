import { describe, it, expect, afterEach } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';
import { TaskItem } from './TaskItem.js';
import { TaskList } from './TaskList.js';
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

    it('has paragraph block* content', () => {
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
  });
});
