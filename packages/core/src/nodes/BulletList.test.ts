import { describe, it, expect, afterEach } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';
import { BulletList } from './BulletList.js';
import { Document } from './Document.js';
import { Text } from './Text.js';
import { Paragraph } from './Paragraph.js';
import { ListItem } from './ListItem.js';
import { Editor } from '../Editor.js';

describe('BulletList', () => {
  describe('configuration', () => {
    it('has correct name', () => {
      expect(BulletList.name).toBe('bulletList');
    });

    it('is a node type', () => {
      expect(BulletList.type).toBe('node');
    });

    it('belongs to block list group', () => {
      expect(BulletList.config.group).toBe('block list');
    });

    it('has listItem+ content', () => {
      expect(BulletList.config.content).toBe('listItem+');
    });

    it('has default options', () => {
      expect(BulletList.options).toEqual({
        HTMLAttributes: {},
        itemTypeName: 'listItem',
      });
    });

    it('can configure HTMLAttributes', () => {
      const CustomBulletList = BulletList.configure({
        HTMLAttributes: { class: 'custom-list' },
      });
      expect(CustomBulletList.options.HTMLAttributes).toEqual({ class: 'custom-list' });
    });
  });

  describe('parseHTML', () => {
    it('returns rule for ul tag', () => {
      const rules = BulletList.config.parseHTML?.call(BulletList);

      expect(rules).toEqual([{ tag: 'ul' }]);
    });
  });

  describe('renderHTML', () => {
    it('renders ul element', () => {
      const spec = BulletList.createNodeSpec();
      const mockNode = { attrs: {} } as unknown as PMNode;

      const result = spec.toDOM?.(mockNode) as [string, Record<string, unknown>, number];

      expect(result[0]).toBe('ul');
      expect(result[2]).toBe(0);
    });

    it('merges HTMLAttributes from options', () => {
      const CustomBulletList = BulletList.configure({
        HTMLAttributes: { class: 'styled-list' },
      });

      const spec = CustomBulletList.createNodeSpec();
      const mockNode = { attrs: {} } as unknown as PMNode;

      const result = spec.toDOM?.(mockNode) as [string, Record<string, unknown>, number];

      expect(result[0]).toBe('ul');
      expect(result[1]).toEqual({ class: 'styled-list' });
    });
  });

  describe('addCommands', () => {
    it('provides toggleBulletList command', () => {
      const commands = BulletList.config.addCommands?.call(BulletList);

      expect(commands).toHaveProperty('toggleBulletList');
      expect(typeof commands?.['toggleBulletList']).toBe('function');
    });
  });

  describe('addKeyboardShortcuts', () => {
    it('provides Mod-Shift-8 shortcut', () => {
      const shortcuts = BulletList.config.addKeyboardShortcuts?.call(BulletList);

      expect(shortcuts).toHaveProperty('Mod-Shift-8');
    });

    it('shortcut returns false when no editor', () => {
       
      const shortcuts = BulletList.config.addKeyboardShortcuts?.call({
        ...BulletList, editor: undefined, options: BulletList.options,
      } as any);
       
      expect((shortcuts?.['Mod-Shift-8'] as any)?.()).toBe(false);
    });
  });

  describe('addInputRules', () => {
    it('returns empty array when nodeType is not available', () => {
      const rules = BulletList.config.addInputRules?.call(BulletList);
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
        extensions: [Document, Text, Paragraph, BulletList, ListItem],
        content: '<ul><li><p>Item 1</p></li><li><p>Item 2</p></li></ul>',
      });

      expect(editor.getText()).toContain('Item 1');
      expect(editor.getText()).toContain('Item 2');
    });

    it('parses bullet list correctly', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, BulletList, ListItem],
        content: '<ul><li><p>List item</p></li></ul>',
      });

      const doc = editor.state.doc;
      expect(doc.child(0).type.name).toBe('bulletList');
      expect(doc.child(0).child(0).type.name).toBe('listItem');
    });

    it('renders bullet list correctly', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, BulletList, ListItem],
        content: '<ul><li><p>Test item</p></li></ul>',
      });

      const html = editor.getHTML();
      expect(html).toBe('<ul><li><p>Test item</p></li></ul>');
    });

    it('supports multiple list items', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, BulletList, ListItem],
        content: '<ul><li><p>First</p></li><li><p>Second</p></li><li><p>Third</p></li></ul>',
      });

      const doc = editor.state.doc;
      const list = doc.child(0);
      expect(list.type.name).toBe('bulletList');
      expect(list.childCount).toBe(3);
    });

    it('toggleBulletList wraps paragraph in bullet list', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, BulletList, ListItem],
        content: '<p>List me</p>',
      });
      editor.commands.toggleBulletList();
      expect(editor.state.doc.child(0).type.name).toBe('bulletList');
    });

    it('supports nested lists', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, BulletList, ListItem],
        content: '<ul><li><p>Parent</p><ul><li><p>Child</p></li></ul></li></ul>',
      });

      const doc = editor.state.doc;
      const outerList = doc.child(0);
      expect(outerList.type.name).toBe('bulletList');
      const listItem = outerList.child(0);
      expect(listItem.childCount).toBe(2); // paragraph + nested list
      expect(listItem.child(1).type.name).toBe('bulletList');
    });
  });
});
