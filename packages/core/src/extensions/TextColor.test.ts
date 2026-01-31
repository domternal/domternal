/**
 * Tests for TextColor extension
 */
import { describe, it, expect, afterEach } from 'vitest';
import { TextColor } from './TextColor.js';
import { TextStyle } from '../marks/TextStyle.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Editor } from '../Editor.js';

describe('TextColor', () => {
  describe('configuration', () => {
    it('has correct name', () => {
      expect(TextColor.name).toBe('textColor');
    });

    it('has default options', () => {
      expect(TextColor.options).toEqual({
        colors: [],
      });
    });

    it('can configure with allowed colors', () => {
      const CustomTextColor = TextColor.configure({
        colors: ['#ff0000', '#00ff00', '#0000ff'],
      });
      expect(CustomTextColor.options.colors).toEqual(['#ff0000', '#00ff00', '#0000ff']);
    });
  });

  describe('addGlobalAttributes', () => {
    it('provides color attribute for textStyle', () => {
      const globalAttrs = TextColor.config.addGlobalAttributes?.call(TextColor);

      expect(globalAttrs).toHaveLength(1);
      expect(globalAttrs?.[0]?.types).toContain('textStyle');
      expect(globalAttrs?.[0]?.attributes).toHaveProperty('color');
    });

    it('color attribute has correct defaults', () => {
      const globalAttrs = TextColor.config.addGlobalAttributes?.call(TextColor);
      const colorAttr = globalAttrs?.[0]?.attributes?.['color'];

      expect(colorAttr?.default).toBe(null);
      expect(colorAttr?.parseHTML).toBeDefined();
      expect(colorAttr?.renderHTML).toBeDefined();
    });

    it('parseHTML extracts color from style', () => {
      const globalAttrs = TextColor.config.addGlobalAttributes?.call(TextColor);
      const parseHTML = globalAttrs?.[0]?.attributes?.['color']?.parseHTML;

      const element = document.createElement('span');
      element.style.color = 'red';

      expect(parseHTML?.(element)).toBe('red');
    });

    it('renderHTML outputs color style', () => {
      const globalAttrs = TextColor.config.addGlobalAttributes?.call(TextColor);
      const renderHTML = globalAttrs?.[0]?.attributes?.['color']?.renderHTML;

      const result = renderHTML?.({ color: '#ff0000' });
      expect(result).toEqual({ style: 'color: #ff0000' });
    });

    it('renderHTML returns null for null color', () => {
      const globalAttrs = TextColor.config.addGlobalAttributes?.call(TextColor);
      const renderHTML = globalAttrs?.[0]?.attributes?.['color']?.renderHTML;

      const result = renderHTML?.({ color: null });
      expect(result).toBe(null);
    });
  });

  describe('addCommands', () => {
    it('provides setTextColor command', () => {
      const commands = TextColor.config.addCommands?.call(TextColor);

      expect(commands).toHaveProperty('setTextColor');
      expect(typeof commands?.['setTextColor']).toBe('function');
    });

    it('provides unsetTextColor command', () => {
      const commands = TextColor.config.addCommands?.call(TextColor);

      expect(commands).toHaveProperty('unsetTextColor');
      expect(typeof commands?.['unsetTextColor']).toBe('function');
    });
  });

  describe('color validation', () => {
    it('rejects invalid color when colors list is provided', () => {
      const CustomTextColor = TextColor.configure({
        colors: ['#ff0000', '#00ff00'],
      });

      const commands = CustomTextColor.config.addCommands?.call(CustomTextColor);
      const setTextColor = commands?.['setTextColor'] as (color: string) => unknown;

      // Create mock command context
      const mockContext = {
        commands: {
          setMark: () => true,
        },
      };

      const handler = setTextColor('#0000ff');
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
        extensions: [Document, Text, Paragraph, TextStyle, TextColor],
        content: '<p><span style="color: red">Colored text</span></p>',
      });

      expect(editor.getText()).toContain('Colored text');
    });

    it('parses color from styled span', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, TextStyle, TextColor],
        content: '<p><span style="color: rgb(255, 0, 0)">Text</span></p>',
      });

      const doc = editor.state.doc;
      const textNode = doc.child(0).child(0);

      expect(textNode.marks.length).toBeGreaterThan(0);
    });

    it('setTextColor command applies color', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, TextStyle, TextColor],
        content: '<p>Hello world</p>',
      });

      // Select all text
      editor.focus('all');

      // Apply color
      const setTextColor = editor.commands['setTextColor'] as ((color: string) => boolean) | undefined;
      const result = setTextColor?.('#ff0000');

      expect(result).toBe(true);
    });
  });
});
