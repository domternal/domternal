/**
 * Tests for FontSize extension
 */
import { describe, it, expect, afterEach } from 'vitest';
import { FontSize } from './FontSize.js';
import { TextStyle } from '../marks/TextStyle.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Editor } from '../Editor.js';

describe('FontSize', () => {
  describe('configuration', () => {
    it('has correct name', () => {
      expect(FontSize.name).toBe('fontSize');
    });

    it('has default options', () => {
      expect(FontSize.options).toEqual({
        fontSizes: [],
      });
    });

    it('can configure with allowed font sizes', () => {
      const CustomFontSize = FontSize.configure({
        fontSizes: ['12px', '14px', '16px', '18px'],
      });
      expect(CustomFontSize.options.fontSizes).toEqual(['12px', '14px', '16px', '18px']);
    });
  });

  describe('addGlobalAttributes', () => {
    it('provides fontSize attribute for textStyle', () => {
      const globalAttrs = FontSize.config.addGlobalAttributes?.call(FontSize);

      expect(globalAttrs).toHaveLength(1);
      expect(globalAttrs?.[0]?.types).toContain('textStyle');
      expect(globalAttrs?.[0]?.attributes).toHaveProperty('fontSize');
    });

    it('fontSize attribute has correct defaults', () => {
      const globalAttrs = FontSize.config.addGlobalAttributes?.call(FontSize);
      const fontSizeAttr = globalAttrs?.[0]?.attributes['fontSize'];

      expect(fontSizeAttr?.default).toBe(null);
      expect(fontSizeAttr?.parseHTML).toBeDefined();
      expect(fontSizeAttr?.renderHTML).toBeDefined();
    });

    it('parseHTML extracts font-size from style', () => {
      const globalAttrs = FontSize.config.addGlobalAttributes?.call(FontSize);
      const parseHTML = globalAttrs?.[0]?.attributes['fontSize']?.parseHTML;

      const element = document.createElement('span');
      element.style.fontSize = '16px';

      expect(parseHTML?.(element)).toBe('16px');
    });

    it('renderHTML outputs font-size style', () => {
      const globalAttrs = FontSize.config.addGlobalAttributes?.call(FontSize);
      const renderHTML = globalAttrs?.[0]?.attributes['fontSize']?.renderHTML;

      const result = renderHTML?.({ fontSize: '18px' });
      expect(result).toEqual({ style: 'font-size: 18px' });
    });

    it('renderHTML returns null for null fontSize', () => {
      const globalAttrs = FontSize.config.addGlobalAttributes?.call(FontSize);
      const renderHTML = globalAttrs?.[0]?.attributes['fontSize']?.renderHTML;

      const result = renderHTML?.({ fontSize: null });
      expect(result).toBe(null);
    });

    it('renderHTML returns null for disallowed fontSize', () => {
      const CustomFontSize = FontSize.configure({
        fontSizes: ['12px', '14px', '16px'],
      });
      const globalAttrs = CustomFontSize.config.addGlobalAttributes?.call(CustomFontSize);
      const renderHTML = globalAttrs?.[0]?.attributes['fontSize']?.renderHTML;

      const result = renderHTML?.({ fontSize: '24px' });
      expect(result).toBe(null);
    });
  });

  describe('addCommands', () => {
    it('provides setFontSize command', () => {
      const commands = FontSize.config.addCommands?.call(FontSize);

      expect(commands).toHaveProperty('setFontSize');
      expect(typeof commands?.['setFontSize']).toBe('function');
    });

    it('provides unsetFontSize command', () => {
      const commands = FontSize.config.addCommands?.call(FontSize);

      expect(commands).toHaveProperty('unsetFontSize');
      expect(typeof commands?.['unsetFontSize']).toBe('function');
    });
  });

  describe('size validation', () => {
    it('rejects invalid size when fontSizes list is provided', () => {
      const CustomFontSize = FontSize.configure({
        fontSizes: ['12px', '14px', '16px'],
      });

      const commands = CustomFontSize.config.addCommands?.call(CustomFontSize);
      const setFontSize = commands?.['setFontSize'] as (size: string) => unknown;

      const mockContext = {
        commands: {
          setMark: () => true,
        },
      };

      const handler = setFontSize('24px');
      const result = (handler as (ctx: typeof mockContext) => boolean)(mockContext);

      expect(result).toBe(false);
    });
  });

  describe('integration', () => {
    let editor: Editor | undefined;

    afterEach(() => {
      if (editor && !editor.isDestroyed) {
        editor.destroy();
      }
    });

    it('works with Editor and TextStyle', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, TextStyle, FontSize],
        content: '<p><span style="font-size: 18px">Sized text</span></p>',
      });

      expect(editor.getText()).toContain('Sized text');
    });

    it('setFontSize command applies size', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, TextStyle, FontSize],
        content: '<p>Hello world</p>',
      });

      editor.focus('all');

      const result = editor.commands.setFontSize('20px');

      expect(result).toBe(true);
    });

    it('unsetFontSize removes font size', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, TextStyle, FontSize],
        content: '<p><span style="font-size: 20px">Sized</span></p>',
      });

      editor.focus('all');

      const result = editor.commands.unsetFontSize();
      expect(result).toBe(true);
    });
  });
});
