/**
 * Tests for FontFamily extension
 */
import { describe, it, expect, afterEach } from 'vitest';
import { FontFamily } from './FontFamily.js';
import { TextStyle } from '../marks/TextStyle.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Editor } from '../Editor.js';
import { TextSelection } from 'prosemirror-state';

describe('FontFamily', () => {
  describe('configuration', () => {
    it('has correct name', () => {
      expect(FontFamily.name).toBe('fontFamily');
    });

    it('has default options', () => {
      expect(FontFamily.options).toEqual({
        fontFamilies: [],
      });
    });

    it('can configure with allowed font families', () => {
      const CustomFontFamily = FontFamily.configure({
        fontFamilies: ['Arial', 'Times New Roman', 'Courier New'],
      });
      expect(CustomFontFamily.options.fontFamilies).toEqual([
        'Arial',
        'Times New Roman',
        'Courier New',
      ]);
    });
  });

  describe('addGlobalAttributes', () => {
    it('provides fontFamily attribute for textStyle', () => {
      const globalAttrs = FontFamily.config.addGlobalAttributes?.call(FontFamily);

      expect(globalAttrs).toHaveLength(1);
      expect(globalAttrs?.[0]?.types).toContain('textStyle');
      expect(globalAttrs?.[0]?.attributes).toHaveProperty('fontFamily');
    });

    it('fontFamily attribute has correct defaults', () => {
      const globalAttrs = FontFamily.config.addGlobalAttributes?.call(FontFamily);
      const fontFamilyAttr = globalAttrs?.[0]?.attributes['fontFamily'];

      expect(fontFamilyAttr?.default).toBe(null);
      expect(fontFamilyAttr?.parseHTML).toBeDefined();
      expect(fontFamilyAttr?.renderHTML).toBeDefined();
    });

    it('parseHTML extracts font-family from style', () => {
      const globalAttrs = FontFamily.config.addGlobalAttributes?.call(FontFamily);
      const parseHTML = globalAttrs?.[0]?.attributes['fontFamily']?.parseHTML;

      const element = document.createElement('span');
      element.style.fontFamily = 'Arial';

      expect(parseHTML?.(element)).toBe('Arial');
    });

    it('renderHTML outputs font-family style', () => {
      const globalAttrs = FontFamily.config.addGlobalAttributes?.call(FontFamily);
      const renderHTML = globalAttrs?.[0]?.attributes['fontFamily']?.renderHTML;

      const result = renderHTML?.({ fontFamily: 'Arial' });
      expect(result).toEqual({ style: 'font-family: Arial' });
    });

    it('renderHTML returns null for null fontFamily', () => {
      const globalAttrs = FontFamily.config.addGlobalAttributes?.call(FontFamily);
      const renderHTML = globalAttrs?.[0]?.attributes['fontFamily']?.renderHTML;

      const result = renderHTML?.({ fontFamily: null });
      expect(result).toBe(null);
    });

    it('renderHTML returns null for disallowed fontFamily', () => {
      const CustomFontFamily = FontFamily.configure({
        fontFamilies: ['Arial', 'Times New Roman'],
      });
      const globalAttrs = CustomFontFamily.config.addGlobalAttributes?.call(CustomFontFamily);
      const renderHTML = globalAttrs?.[0]?.attributes['fontFamily']?.renderHTML;

      const result = renderHTML?.({ fontFamily: 'Comic Sans MS' });
      expect(result).toBe(null);
    });
  });

  describe('addCommands', () => {
    it('provides setFontFamily command', () => {
      const commands = FontFamily.config.addCommands?.call(FontFamily);

      expect(commands).toHaveProperty('setFontFamily');
      expect(typeof commands?.['setFontFamily']).toBe('function');
    });

    it('provides unsetFontFamily command', () => {
      const commands = FontFamily.config.addCommands?.call(FontFamily);

      expect(commands).toHaveProperty('unsetFontFamily');
      expect(typeof commands?.['unsetFontFamily']).toBe('function');
    });
  });

  describe('font validation', () => {
    it('rejects invalid font when fontFamilies list is provided', () => {
      const CustomFontFamily = FontFamily.configure({
        fontFamilies: ['Arial', 'Times New Roman'],
      });

      const commands = CustomFontFamily.config.addCommands?.call(CustomFontFamily);
      const setFontFamily = commands?.['setFontFamily'] as (font: string) => unknown;

      const mockContext = {
        commands: {
          setMark: () => true,
        },
      };

      const handler = setFontFamily('Courier New');
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
        extensions: [Document, Text, Paragraph, TextStyle, FontFamily],
        content: '<p><span style="font-family: Arial">Font text</span></p>',
      });

      expect(editor.getText()).toContain('Font text');
    });

    it('setFontFamily command applies font', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, TextStyle, FontFamily],
        content: '<p>Hello world</p>',
      });

      editor.focus('all');

      const result = editor.commands.setFontFamily('Arial');

      expect(result).toBe(true);
    });

    it('unsetFontFamily removes font family', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, TextStyle, FontFamily],
        content: '<p><span style="font-family: Arial">Styled</span></p>',
      });

      editor.focus('all');

      const result = editor.commands.unsetFontFamily();
      expect(result).toBe(true);
    });

    it('setFontFamily actually applies the mark', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, TextStyle, FontFamily],
        content: '<p>Hello</p>',
      });

      // Use TextSelection for more reliable selection
      const tr = editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 6));
      editor.view.dispatch(tr);

      const setResult = editor.commands.setFontFamily('monospace');
      expect(setResult).toBe(true);

      // Check if font-family is in the HTML
      const html = editor.getHTML();
      expect(html).toContain('font-family');
    });

    it('unsetFontFamily via chain removes font family', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, TextStyle, FontFamily],
        content: '<p>Hello</p>',
      });

      // Set font family with explicit selection
      const tr = editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 6));
      editor.view.dispatch(tr);
      editor.commands.setFontFamily('monospace');
      expect(editor.getHTML()).toContain('font-family');

      // Re-select all text, then unset via chain (without focus - not needed in unit test)
      const tr2 = editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 6));
      editor.view.dispatch(tr2);
      const result = editor.chain().unsetFontFamily().run();
      expect(result).toBe(true);

      // Verify font-family is removed from HTML
      const html = editor.getHTML();
      expect(html).not.toContain('font-family');
    });
  });
});
