/**
 * Tests for TextStyle mark
 */
import { describe, it, expect, afterEach } from 'vitest';
import { TextStyle } from './TextStyle.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Editor } from '../Editor.js';

describe('TextStyle', () => {
  describe('configuration', () => {
    it('has correct name', () => {
      expect(TextStyle.name).toBe('textStyle');
    });

    it('is a mark type', () => {
      expect(TextStyle.type).toBe('mark');
    });

    it('has priority 101', () => {
      expect(TextStyle.config.priority).toBe(101);
    });

    it('has default options', () => {
      expect(TextStyle.options).toEqual({
        HTMLAttributes: {},
      });
    });

    it('can configure HTMLAttributes', () => {
      const CustomTextStyle = TextStyle.configure({
        HTMLAttributes: { class: 'custom-style' },
      });
      expect(CustomTextStyle.options.HTMLAttributes).toEqual({ class: 'custom-style' });
    });
  });

  describe('parseHTML', () => {
    it('returns rule for span tag with style', () => {
      const rules = TextStyle.config.parseHTML?.call(TextStyle);

      expect(rules).toHaveLength(1);
      expect(rules?.[0]).toHaveProperty('tag', 'span');
      expect(rules?.[0]).toHaveProperty('getAttrs');
    });

    it('parses span with style attribute', () => {
      const rules = TextStyle.config.parseHTML?.call(TextStyle);
      const getAttrs = rules?.[0]?.getAttrs;

      const element = document.createElement('span');
      element.setAttribute('style', 'color: red');

      expect(getAttrs?.(element)).toEqual({});
    });

    it('ignores span without style attribute', () => {
      const rules = TextStyle.config.parseHTML?.call(TextStyle);
      const getAttrs = rules?.[0]?.getAttrs;

      const element = document.createElement('span');

      expect(getAttrs?.(element)).toBe(false);
    });
  });

  describe('renderHTML', () => {
    it('renders span element', () => {
      const spec = TextStyle.createMarkSpec();
      const mockMark = { attrs: {} };

      const result = spec.toDOM?.(mockMark as never, true) as [string, Record<string, unknown>, number];

      expect(result[0]).toBe('span');
      expect(result[2]).toBe(0);
    });

    it('merges HTMLAttributes from options', () => {
      const CustomTextStyle = TextStyle.configure({
        HTMLAttributes: { class: 'styled' },
      });

      const spec = CustomTextStyle.createMarkSpec();
      const mockMark = { attrs: {} };

      const result = spec.toDOM?.(mockMark as never, true) as [string, Record<string, unknown>, number];

      expect(result[0]).toBe('span');
      expect(result[1]).toEqual({ class: 'styled' });
    });
  });

  describe('addCommands', () => {
    it('provides setTextStyle command', () => {
      const commands = TextStyle.config.addCommands?.call(TextStyle);

      expect(commands).toHaveProperty('setTextStyle');
      expect(typeof commands?.['setTextStyle']).toBe('function');
    });

    it('provides removeTextStyle command', () => {
      const commands = TextStyle.config.addCommands?.call(TextStyle);

      expect(commands).toHaveProperty('removeTextStyle');
      expect(typeof commands?.['removeTextStyle']).toBe('function');
    });

    it('provides removeEmptyTextStyle command', () => {
      const commands = TextStyle.config.addCommands?.call(TextStyle);

      expect(commands).toHaveProperty('removeEmptyTextStyle');
      expect(typeof commands?.['removeEmptyTextStyle']).toBe('function');
    });
  });

  describe('integration', () => {
    let editor: Editor | undefined;

    afterEach(() => {
      if (editor && !editor.isDestroyed) {
        editor.destroy();
      }
    });

    it('works with Editor', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, TextStyle],
        content: '<p><span style="color: red">Styled text</span></p>',
      });

      expect(editor.getText()).toContain('Styled text');
    });

    it('parses styled span correctly', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, TextStyle],
        content: '<p><span style="color: red">Text</span></p>',
      });

      const doc = editor.state.doc;
      const paragraph = doc.child(0);
      const textNode = paragraph.child(0);

      expect(textNode.marks.length).toBeGreaterThan(0);
      expect(textNode.marks[0]?.type.name).toBe('textStyle');
    });

    it('renders styled text correctly', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, TextStyle],
        content: '<p><span style="color: red">Text</span></p>',
      });

      const html = editor.getHTML();
      expect(html).toContain('<span');
    });
  });
});
