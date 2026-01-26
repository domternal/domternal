import { describe, it, expect, afterEach } from 'vitest';
import { Schema } from 'prosemirror-model';
import { Paragraph } from './Paragraph.js';
import { Document } from './Document.js';
import { Text } from './Text.js';
import { Editor } from '../Editor.js';

describe('Paragraph', () => {
  describe('configuration', () => {
    it('has correct name', () => {
      expect(Paragraph.name).toBe('paragraph');
    });

    it('is a node type', () => {
      expect(Paragraph.type).toBe('node');
    });

    it('belongs to block group', () => {
      expect(Paragraph.config.group).toBe('block');
    });

    it('has inline* content', () => {
      expect(Paragraph.config.content).toBe('inline*');
    });

    it('has priority 1000', () => {
      expect(Paragraph.config.priority).toBe(1000);
    });

    it('has default HTMLAttributes option', () => {
      expect(Paragraph.options).toEqual({ HTMLAttributes: {} });
    });
  });

  describe('parseHTML', () => {
    it('returns rule for p tag', () => {
      const rules = Paragraph.config.parseHTML?.call(Paragraph);

      expect(rules).toEqual([{ tag: 'p' }]);
    });
  });

  describe('renderHTML', () => {
    it('returns correct DOMOutputSpec', () => {
      const spec = Paragraph.createNodeSpec();
      const mockNode = { attrs: {} } as any;

      const result = spec.toDOM?.(mockNode);

      expect(result).toEqual(['p', {}, 0]);
    });

    it('merges HTMLAttributes from options', () => {
      const CustomParagraph = Paragraph.configure({
        HTMLAttributes: { class: 'custom-paragraph' },
      });

      const spec = CustomParagraph.createNodeSpec();
      const mockNode = { attrs: {} } as any;

      const result = spec.toDOM?.(mockNode);

      expect(result).toEqual(['p', { class: 'custom-paragraph' }, 0]);
    });
  });

  describe('addCommands', () => {
    it('provides setParagraph command', () => {
      const commands = Paragraph.config.addCommands?.call(Paragraph);

      expect(commands).toHaveProperty('setParagraph');
      expect(typeof commands?.setParagraph).toBe('function');
    });
  });

  describe('addKeyboardShortcuts', () => {
    it('provides Mod-Alt-0 shortcut', () => {
      const shortcuts = Paragraph.config.addKeyboardShortcuts?.call(Paragraph);

      expect(shortcuts).toHaveProperty('Mod-Alt-0');
    });
  });

  describe('integration', () => {
    let editor: Editor;

    afterEach(() => {
      if (editor && !editor.isDestroyed) {
        editor.destroy();
      }
    });

    it('works with Editor using extensions', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph],
        content: '<p>Hello world</p>',
      });

      expect(editor.getText()).toBe('Hello world');
    });

    it('creates paragraph on empty init', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph],
      });

      const doc = editor.state.doc;
      expect(doc.childCount).toBe(1);
      expect(doc.firstChild?.type.name).toBe('paragraph');
    });

    it('parses HTML content correctly', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph],
        content: '<p>First</p><p>Second</p>',
      });

      const doc = editor.state.doc;
      expect(doc.childCount).toBe(2);
      expect(doc.child(0).type.name).toBe('paragraph');
      expect(doc.child(1).type.name).toBe('paragraph');
    });

    it('renders to HTML correctly', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph],
        content: '<p>Test content</p>',
      });

      const html = editor.getHTML();
      expect(html).toBe('<p>Test content</p>');
    });
  });
});
