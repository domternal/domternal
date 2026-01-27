import { describe, it, expect, afterEach } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';
import { HorizontalRule } from './HorizontalRule.js';
import { Document } from './Document.js';
import { Text } from './Text.js';
import { Paragraph } from './Paragraph.js';
import { Editor } from '../Editor.js';

describe('HorizontalRule', () => {
  describe('configuration', () => {
    it('has correct name', () => {
      expect(HorizontalRule.name).toBe('horizontalRule');
    });

    it('is a node type', () => {
      expect(HorizontalRule.type).toBe('node');
    });

    it('belongs to block group', () => {
      expect(HorizontalRule.config.group).toBe('block');
    });

    it('has default options', () => {
      expect(HorizontalRule.options).toEqual({
        HTMLAttributes: {},
      });
    });

    it('can configure HTMLAttributes', () => {
      const CustomHR = HorizontalRule.configure({
        HTMLAttributes: { class: 'divider' },
      });
      expect(CustomHR.options.HTMLAttributes).toEqual({ class: 'divider' });
    });
  });

  describe('parseHTML', () => {
    it('returns rule for hr tag', () => {
      const rules = HorizontalRule.config.parseHTML?.call(HorizontalRule);

      expect(rules).toEqual([{ tag: 'hr' }]);
    });
  });

  describe('renderHTML', () => {
    it('renders hr element', () => {
      const spec = HorizontalRule.createNodeSpec();
      const mockNode = { attrs: {} } as unknown as PMNode;

      const result = spec.toDOM?.(mockNode) as [string, Record<string, unknown>];

      expect(result[0]).toBe('hr');
    });

    it('merges HTMLAttributes from options', () => {
      const CustomHR = HorizontalRule.configure({
        HTMLAttributes: { class: 'styled-hr' },
      });

      const spec = CustomHR.createNodeSpec();
      const mockNode = { attrs: {} } as unknown as PMNode;

      const result = spec.toDOM?.(mockNode) as [string, Record<string, unknown>];

      expect(result[0]).toBe('hr');
      expect(result[1]).toEqual({ class: 'styled-hr' });
    });
  });

  describe('addCommands', () => {
    it('provides setHorizontalRule command', () => {
      const commands = HorizontalRule.config.addCommands?.call(HorizontalRule);

      expect(commands).toHaveProperty('setHorizontalRule');
      expect(typeof commands?.['setHorizontalRule']).toBe('function');
    });
  });

  describe('addInputRules', () => {
    it('returns empty array when nodeType is not available', () => {
      const rules = HorizontalRule.config.addInputRules?.call(HorizontalRule);
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
        extensions: [Document, Text, Paragraph, HorizontalRule],
        content: '<p>Before</p><hr><p>After</p>',
      });

      expect(editor.getText()).toContain('Before');
      expect(editor.getText()).toContain('After');
    });

    it('parses horizontal rule correctly', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, HorizontalRule],
        content: '<p>Text</p><hr><p>More text</p>',
      });

      const doc = editor.state.doc;
      expect(doc.child(0).type.name).toBe('paragraph');
      expect(doc.child(1).type.name).toBe('horizontalRule');
      expect(doc.child(2).type.name).toBe('paragraph');
    });

    it('renders horizontal rule correctly', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, HorizontalRule],
        content: '<p>Test</p><hr><p>End</p>',
      });

      const html = editor.getHTML();
      expect(html).toContain('<hr>');
    });

    it('is self-closing (no content)', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, HorizontalRule],
        content: '<hr>',
      });

      const doc = editor.state.doc;
      const hr = doc.child(0);
      expect(hr.type.name).toBe('horizontalRule');
      expect(hr.childCount).toBe(0);
    });
  });
});
