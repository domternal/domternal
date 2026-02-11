import { describe, it, expect, afterEach } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';
import { OrderedList } from './OrderedList.js';
import { Document } from './Document.js';
import { Text } from './Text.js';
import { Paragraph } from './Paragraph.js';
import { ListItem } from './ListItem.js';
import { Editor } from '../Editor.js';

describe('OrderedList', () => {
  describe('configuration', () => {
    it('has correct name', () => {
      expect(OrderedList.name).toBe('orderedList');
    });

    it('is a node type', () => {
      expect(OrderedList.type).toBe('node');
    });

    it('belongs to block list group', () => {
      expect(OrderedList.config.group).toBe('block list');
    });

    it('has listItem+ content', () => {
      expect(OrderedList.config.content).toBe('listItem+');
    });

    it('has default options', () => {
      expect(OrderedList.options).toEqual({
        HTMLAttributes: {},
        itemTypeName: 'listItem',
      });
    });

    it('can configure HTMLAttributes', () => {
      const CustomOrderedList = OrderedList.configure({
        HTMLAttributes: { class: 'numbered-list' },
      });
      expect(CustomOrderedList.options.HTMLAttributes).toEqual({ class: 'numbered-list' });
    });
  });

  describe('parseHTML', () => {
    it('returns rule for ol tag', () => {
      const rules = OrderedList.config.parseHTML?.call(OrderedList);

      expect(rules).toEqual([{ tag: 'ol' }]);
    });
  });

  describe('renderHTML', () => {
    it('renders ol element', () => {
      const spec = OrderedList.createNodeSpec();
      const mockNode = { attrs: { start: 1 } } as unknown as PMNode;

      const result = spec.toDOM?.(mockNode) as [string, Record<string, unknown>, number];

      expect(result[0]).toBe('ol');
      expect(result[2]).toBe(0);
    });

    it('omits start attribute when start is 1', () => {
      const spec = OrderedList.createNodeSpec();
      const mockNode = { attrs: { start: 1 } } as unknown as PMNode;

      const result = spec.toDOM?.(mockNode) as [string, Record<string, unknown>, number];

      expect(result[1]).toEqual({});
    });

    it('includes start attribute when start is not 1', () => {
      const spec = OrderedList.createNodeSpec();
      const mockNode = { attrs: { start: 5 } } as unknown as PMNode;

      const result = spec.toDOM?.(mockNode) as [string, Record<string, unknown>, number];

      expect(result[1]).toEqual({ start: '5' });
    });

    it('merges HTMLAttributes from options', () => {
      const CustomOrderedList = OrderedList.configure({
        HTMLAttributes: { class: 'styled-list' },
      });

      const spec = CustomOrderedList.createNodeSpec();
      const mockNode = { attrs: { start: 1 } } as unknown as PMNode;

      const result = spec.toDOM?.(mockNode) as [string, Record<string, unknown>, number];

      expect(result[0]).toBe('ol');
      expect(result[1]).toEqual({ class: 'styled-list' });
    });
  });

  describe('addCommands', () => {
    it('provides toggleOrderedList command', () => {
      const commands = OrderedList.config.addCommands?.call(OrderedList);

      expect(commands).toHaveProperty('toggleOrderedList');
      expect(typeof commands?.['toggleOrderedList']).toBe('function');
    });
  });

  describe('addKeyboardShortcuts', () => {
    it('provides Mod-Shift-7 shortcut', () => {
      const shortcuts = OrderedList.config.addKeyboardShortcuts?.call(OrderedList);

      expect(shortcuts).toHaveProperty('Mod-Shift-7');
    });

    it('shortcut returns false when no editor', () => {
       
      const shortcuts = OrderedList.config.addKeyboardShortcuts?.call({
        ...OrderedList, editor: undefined, options: OrderedList.options,
      } as any);
       
      expect((shortcuts?.['Mod-Shift-7'] as any)?.()).toBe(false);
    });
  });

  describe('addInputRules', () => {
    it('returns empty array when nodeType is not available', () => {
      const rules = OrderedList.config.addInputRules?.call(OrderedList);
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
        extensions: [Document, Text, Paragraph, OrderedList, ListItem],
        content: '<ol><li><p>Item 1</p></li><li><p>Item 2</p></li></ol>',
      });

      expect(editor.getText()).toContain('Item 1');
      expect(editor.getText()).toContain('Item 2');
    });

    it('parses ordered list correctly', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, OrderedList, ListItem],
        content: '<ol><li><p>List item</p></li></ol>',
      });

      const doc = editor.state.doc;
      expect(doc.child(0).type.name).toBe('orderedList');
      expect(doc.child(0).child(0).type.name).toBe('listItem');
    });

    it('renders ordered list correctly', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, OrderedList, ListItem],
        content: '<ol><li><p>Test item</p></li></ol>',
      });

      const html = editor.getHTML();
      expect(html).toBe('<ol><li><p>Test item</p></li></ol>');
    });

    it('parses start attribute', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, OrderedList, ListItem],
        content: '<ol start="5"><li><p>Item</p></li></ol>',
      });

      const doc = editor.state.doc;
      expect(doc.child(0).attrs['start']).toBe(5);
    });

    it('renders start attribute when not 1', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, OrderedList, ListItem],
        content: '<ol start="3"><li><p>Item</p></li></ol>',
      });

      const html = editor.getHTML();
      expect(html).toContain('start="3"');
    });

    it('omits start attribute when 1', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, OrderedList, ListItem],
        content: '<ol><li><p>Item</p></li></ol>',
      });

      const html = editor.getHTML();
      expect(html).not.toContain('start');
    });

    it('supports multiple list items', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, OrderedList, ListItem],
        content: '<ol><li><p>First</p></li><li><p>Second</p></li><li><p>Third</p></li></ol>',
      });

      const doc = editor.state.doc;
      const list = doc.child(0);
      expect(list.type.name).toBe('orderedList');
      expect(list.childCount).toBe(3);
    });

    it('toggleOrderedList wraps paragraph in ordered list', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, OrderedList, ListItem],
        content: '<p>List me</p>',
      });
      editor.commands.toggleOrderedList();
      expect(editor.state.doc.child(0).type.name).toBe('orderedList');
    });

    it('supports nested lists', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, OrderedList, ListItem],
        content: '<ol><li><p>Parent</p><ol><li><p>Child</p></li></ol></li></ol>',
      });

      const doc = editor.state.doc;
      const outerList = doc.child(0);
      expect(outerList.type.name).toBe('orderedList');
      const listItem = outerList.child(0);
      expect(listItem.childCount).toBe(2);
      expect(listItem.child(1).type.name).toBe('orderedList');
    });

    it('inputRule handler applies start number from match', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, OrderedList, ListItem],
        content: '<p>5. </p>',
      });

      const nodeType = editor.state.schema.nodes['orderedList'];
       
      const rules = OrderedList.config.addInputRules?.call({
        ...OrderedList, nodeType, options: OrderedList.options,
      } as any);

      const rule = rules![0]!;
      const match = ['5. ', '5'] as unknown as RegExpMatchArray;
       
      const result = (rule as any).handler(editor.state, match, 1, 4);
      expect(result).toBeTruthy();
      if (result) {
        const list = result.doc.child(0);
        expect(list.type.name).toBe('orderedList');
        expect(list.attrs.start).toBe(5);
      }
    });
  });
});
