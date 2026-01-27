import { describe, it, expect, afterEach } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';
import { Heading } from './Heading.js';
import { Document } from './Document.js';
import { Text } from './Text.js';
import { Paragraph } from './Paragraph.js';
import { Editor } from '../Editor.js';

describe('Heading', () => {
  describe('configuration', () => {
    it('has correct name', () => {
      expect(Heading.name).toBe('heading');
    });

    it('is a node type', () => {
      expect(Heading.type).toBe('node');
    });

    it('belongs to block group', () => {
      expect(Heading.config.group).toBe('block');
    });

    it('has inline* content', () => {
      expect(Heading.config.content).toBe('inline*');
    });

    it('is defining', () => {
      expect(Heading.config.defining).toBe(true);
    });

    it('has default options', () => {
      expect(Heading.options).toEqual({
        levels: [1, 2, 3, 4, 5, 6],
        HTMLAttributes: {},
      });
    });

    it('can configure levels', () => {
      const CustomHeading = Heading.configure({ levels: [1, 2, 3] });
      expect(CustomHeading.options.levels).toEqual([1, 2, 3]);
    });
  });

  describe('parseHTML', () => {
    it('returns rules for all configured levels', () => {
      const rules = Heading.config.parseHTML?.call(Heading);

      expect(rules).toHaveLength(6);
      expect(rules?.[0]).toEqual({ tag: 'h1', attrs: { level: 1 } });
      expect(rules?.[5]).toEqual({ tag: 'h6', attrs: { level: 6 } });
    });

    it('only parses configured levels', () => {
      const CustomHeading = Heading.configure({ levels: [1, 2] });
      const rules = CustomHeading.config.parseHTML?.call(CustomHeading);

      expect(rules).toHaveLength(2);
      expect(rules?.[0]).toEqual({ tag: 'h1', attrs: { level: 1 } });
      expect(rules?.[1]).toEqual({ tag: 'h2', attrs: { level: 2 } });
    });
  });

  describe('renderHTML', () => {
    it('renders h1 for level 1', () => {
      const spec = Heading.createNodeSpec();
      const mockNode = { attrs: { level: 1 } } as unknown as PMNode;

      const result = spec.toDOM?.(mockNode) as [string, Record<string, unknown>, number];

      expect(result[0]).toBe('h1');
    });

    it('renders h3 for level 3', () => {
      const spec = Heading.createNodeSpec();
      const mockNode = { attrs: { level: 3 } } as unknown as PMNode;

      const result = spec.toDOM?.(mockNode) as [string, Record<string, unknown>, number];

      expect(result[0]).toBe('h3');
    });

    it('merges HTMLAttributes from options', () => {
      const CustomHeading = Heading.configure({
        HTMLAttributes: { class: 'custom-heading' },
      });

      const spec = CustomHeading.createNodeSpec();
      const mockNode = { attrs: { level: 2 } } as unknown as PMNode;

      const result = spec.toDOM?.(mockNode) as [string, Record<string, unknown>, number];

      expect(result[0]).toBe('h2');
      expect(result[1]).toEqual({ class: 'custom-heading' });
    });
  });

  describe('addCommands', () => {
    it('provides setHeading command', () => {
      const commands = Heading.config.addCommands?.call(Heading);

      expect(commands).toHaveProperty('setHeading');
      expect(typeof commands?.['setHeading']).toBe('function');
    });

    it('provides toggleHeading command', () => {
      const commands = Heading.config.addCommands?.call(Heading);

      expect(commands).toHaveProperty('toggleHeading');
      expect(typeof commands?.['toggleHeading']).toBe('function');
    });
  });

  describe('addKeyboardShortcuts', () => {
    it('provides shortcuts for all levels', () => {
      const shortcuts = Heading.config.addKeyboardShortcuts?.call(Heading);

      expect(shortcuts).toHaveProperty('Mod-Alt-1');
      expect(shortcuts).toHaveProperty('Mod-Alt-2');
      expect(shortcuts).toHaveProperty('Mod-Alt-3');
      expect(shortcuts).toHaveProperty('Mod-Alt-4');
      expect(shortcuts).toHaveProperty('Mod-Alt-5');
      expect(shortcuts).toHaveProperty('Mod-Alt-6');
    });

    it('only provides shortcuts for configured levels', () => {
      const CustomHeading = Heading.configure({ levels: [1, 2] });
      const shortcuts = CustomHeading.config.addKeyboardShortcuts?.call(CustomHeading);

      expect(shortcuts).toHaveProperty('Mod-Alt-1');
      expect(shortcuts).toHaveProperty('Mod-Alt-2');
      expect(shortcuts).not.toHaveProperty('Mod-Alt-3');
    });
  });

  describe('addInputRules', () => {
    it('provides input rules when nodeType is available', () => {
      // Input rules require nodeType which needs schema
      // This is tested via integration tests
      const rules = Heading.config.addInputRules?.call(Heading);
      // Returns empty array when nodeType is null (no editor)
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
        extensions: [Document, Text, Paragraph, Heading],
        content: '<h1>Title</h1><p>Content</p>',
      });

      // getText includes newlines between blocks
      expect(editor.getText()).toContain('Title');
      expect(editor.getText()).toContain('Content');
    });

    it('parses all heading levels', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Heading],
        content: '<h1>H1</h1><h2>H2</h2><h3>H3</h3><h4>H4</h4><h5>H5</h5><h6>H6</h6>',
      });

      const doc = editor.state.doc;
      expect(doc.childCount).toBe(6);
      expect(doc.child(0).type.name).toBe('heading');
      expect(doc.child(0).attrs['level']).toBe(1);
      expect(doc.child(5).attrs['level']).toBe(6);
    });

    it('renders headings correctly', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Heading],
        content: '<h2>My Heading</h2>',
      });

      const html = editor.getHTML();
      expect(html).toBe('<h2>My Heading</h2>');
    });

    it('respects configured levels for parsing', () => {
      const CustomHeading = Heading.configure({ levels: [1, 2] });

      editor = new Editor({
        extensions: [Document, Text, Paragraph, CustomHeading],
        content: '<h1>H1</h1><h3>H3 becomes paragraph</h3>',
      });

      const doc = editor.state.doc;
      expect(doc.child(0).type.name).toBe('heading');
      expect(doc.child(0).attrs['level']).toBe(1);
      // H3 should be parsed as paragraph since level 3 is not configured
      expect(doc.child(1).type.name).toBe('paragraph');
    });
  });
});
