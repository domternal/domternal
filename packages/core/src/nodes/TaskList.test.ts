import { describe, it, expect, afterEach } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';
import { TaskList } from './TaskList.js';
import { TaskItem } from './TaskItem.js';
import { Document } from './Document.js';
import { Text } from './Text.js';
import { Paragraph } from './Paragraph.js';
import { Editor } from '../Editor.js';

describe('TaskList', () => {
  describe('configuration', () => {
    it('has correct name', () => {
      expect(TaskList.name).toBe('taskList');
    });

    it('is a node type', () => {
      expect(TaskList.type).toBe('node');
    });

    it('belongs to block list group', () => {
      expect(TaskList.config.group).toBe('block list');
    });

    it('has taskItem+ content', () => {
      expect(TaskList.config.content).toBe('taskItem+');
    });

    it('has default options', () => {
      expect(TaskList.options).toEqual({
        HTMLAttributes: {},
        itemTypeName: 'taskItem',
      });
    });

    it('can configure HTMLAttributes', () => {
      const CustomTaskList = TaskList.configure({
        HTMLAttributes: { class: 'custom-task-list' },
      });
      expect(CustomTaskList.options.HTMLAttributes).toEqual({ class: 'custom-task-list' });
    });
  });

  describe('parseHTML', () => {
    it('returns rule for ul with data-type attribute', () => {
      const rules = TaskList.config.parseHTML?.call(TaskList);

      expect(rules).toEqual([
        {
          tag: 'ul[data-type="taskList"]',
          priority: 51,
        },
      ]);
    });
  });

  describe('renderHTML', () => {
    it('renders ul element with data-type', () => {
      const spec = TaskList.createNodeSpec();
      const mockNode = { attrs: {} } as unknown as PMNode;

      const result = spec.toDOM?.(mockNode) as [string, Record<string, unknown>, number];

      expect(result[0]).toBe('ul');
      expect(result[1]['data-type']).toBe('taskList');
      expect(result[2]).toBe(0);
    });

    it('merges HTMLAttributes from options', () => {
      const CustomTaskList = TaskList.configure({
        HTMLAttributes: { class: 'styled-task-list' },
      });

      const spec = CustomTaskList.createNodeSpec();
      const mockNode = { attrs: {} } as unknown as PMNode;

      const result = spec.toDOM?.(mockNode) as [string, Record<string, unknown>, number];

      expect(result[0]).toBe('ul');
      expect(result[1]).toEqual({
        class: 'styled-task-list',
        'data-type': 'taskList',
      });
    });
  });

  describe('addCommands', () => {
    it('provides toggleTaskList command', () => {
      const commands = TaskList.config.addCommands?.call(TaskList);

      expect(commands).toHaveProperty('toggleTaskList');
      expect(typeof commands?.['toggleTaskList']).toBe('function');
    });
  });

  describe('addKeyboardShortcuts', () => {
    it('provides Mod-Shift-9 shortcut', () => {
      const shortcuts = TaskList.config.addKeyboardShortcuts?.call(TaskList);

      expect(shortcuts).toHaveProperty('Mod-Shift-9');
    });
  });

  describe('addInputRules', () => {
    it('returns empty array when nodeType is not available', () => {
      const rules = TaskList.config.addInputRules?.call(TaskList);
      expect(rules).toEqual([]);
    });
  });

  describe('integration', () => {
    let editor: Editor | undefined;

    afterEach(() => {
      if (editor && !editor.isDestroyed) {
        editor.destroy();
      }
    });

    it('works with Editor using extensions', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, TaskList, TaskItem],
        content:
          '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><label contenteditable="false"><input type="checkbox"></label><div><p>Task 1</p></div></li></ul>',
      });

      expect(editor.getText()).toContain('Task 1');
    });

    it('parses task list correctly', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, TaskList, TaskItem],
        content:
          '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><label contenteditable="false"><input type="checkbox"></label><div><p>Task item</p></div></li></ul>',
      });

      const doc = editor.state.doc;
      expect(doc.child(0).type.name).toBe('taskList');
      expect(doc.child(0).child(0).type.name).toBe('taskItem');
    });

    it('renders task list correctly', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, TaskList, TaskItem],
        content:
          '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><label contenteditable="false"><input type="checkbox"></label><div><p>Test task</p></div></li></ul>',
      });

      const html = editor.getHTML();
      expect(html).toContain('data-type="taskList"');
      expect(html).toContain('data-type="taskItem"');
      expect(html).toContain('Test task');
    });

    it('supports checked attribute', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, TaskList, TaskItem],
        content:
          '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label contenteditable="false"><input type="checkbox" checked></label><div><p>Done task</p></div></li></ul>',
      });

      const doc = editor.state.doc;
      const taskItem = doc.child(0).child(0);
      expect(taskItem.attrs['checked']).toBe(true);
    });

    it('supports multiple task items', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, TaskList, TaskItem],
        content: `
          <ul data-type="taskList">
            <li data-type="taskItem" data-checked="false"><label contenteditable="false"><input type="checkbox"></label><div><p>First</p></div></li>
            <li data-type="taskItem" data-checked="true"><label contenteditable="false"><input type="checkbox" checked></label><div><p>Second</p></div></li>
            <li data-type="taskItem" data-checked="false"><label contenteditable="false"><input type="checkbox"></label><div><p>Third</p></div></li>
          </ul>
        `,
      });

      const doc = editor.state.doc;
      const list = doc.child(0);
      expect(list.type.name).toBe('taskList');
      expect(list.childCount).toBe(3);
    });
  });
});
