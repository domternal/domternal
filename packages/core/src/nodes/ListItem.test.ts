import { describe, it, expect, afterEach } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';
import { ListItem } from './ListItem.js';
import { BulletList } from './BulletList.js';
import { OrderedList } from './OrderedList.js';
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

    it('has paragraph block* content', () => {
      expect(ListItem.config.content).toBe('paragraph block*');
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
    it('provides Enter shortcut via ProseMirror plugin', () => {
      const plugins = ListItem.config.addProseMirrorPlugins?.call(ListItem);

      expect(plugins).toBeDefined();
      expect(plugins!.length).toBeGreaterThan(0);
    });

    it('provides Tab shortcut', () => {
      const shortcuts = ListItem.config.addKeyboardShortcuts?.call(ListItem);

      expect(shortcuts).toHaveProperty('Tab');
    });

    it('provides Shift-Tab shortcut', () => {
      const shortcuts = ListItem.config.addKeyboardShortcuts?.call(ListItem);

      expect(shortcuts).toHaveProperty('Shift-Tab');
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
  });
});
