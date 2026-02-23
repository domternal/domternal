/**
 * Tests for TextColor extension
 */
import { describe, it, expect, afterEach } from 'vitest';
import { TextColor, DEFAULT_TEXT_COLORS } from './TextColor.js';
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

    it('has default options with 25-color palette', () => {
      expect(TextColor.options.colors).toEqual(DEFAULT_TEXT_COLORS);
      expect(TextColor.options.colors).toHaveLength(25);
      expect(TextColor.options.columns).toBe(5);
    });

    it('can configure with custom colors', () => {
      const CustomTextColor = TextColor.configure({
        colors: ['#ff0000', '#00ff00', '#0000ff'],
      });
      expect(CustomTextColor.options.colors).toEqual(['#ff0000', '#00ff00', '#0000ff']);
    });

    it('can configure with custom column count', () => {
      const CustomTextColor = TextColor.configure({
        columns: 5,
      });
      expect(CustomTextColor.options.columns).toBe(5);
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
      const colorAttr = globalAttrs?.[0]?.attributes['color'];

      expect(colorAttr?.default).toBe(null);
      expect(colorAttr?.parseHTML).toBeDefined();
      expect(colorAttr?.renderHTML).toBeDefined();
    });

    it('parseHTML extracts color from style', () => {
      const globalAttrs = TextColor.config.addGlobalAttributes?.call(TextColor);
      const parseHTML = globalAttrs?.[0]?.attributes['color']?.parseHTML;

      const element = document.createElement('span');
      element.style.color = 'red';

      expect(parseHTML?.(element)).toBe('red');
    });

    it('renderHTML outputs color style', () => {
      const globalAttrs = TextColor.config.addGlobalAttributes?.call(TextColor);
      const renderHTML = globalAttrs?.[0]?.attributes['color']?.renderHTML;

      const result = renderHTML?.({ color: '#ff0000' });
      expect(result).toEqual({ style: 'color: #ff0000' });
    });

    it('renderHTML returns null for null color', () => {
      const globalAttrs = TextColor.config.addGlobalAttributes?.call(TextColor);
      const renderHTML = globalAttrs?.[0]?.attributes['color']?.renderHTML;

      const result = renderHTML?.({ color: null });
      expect(result).toBe(null);
    });

    it('renderHTML accepts any valid color (no palette restriction)', () => {
      const globalAttrs = TextColor.config.addGlobalAttributes?.call(TextColor);
      const renderHTML = globalAttrs?.[0]?.attributes['color']?.renderHTML;

      const result = renderHTML?.({ color: '#123456' });
      expect(result).toEqual({ style: 'color: #123456' });
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

  describe('addToolbarItems', () => {
    it('returns grid-layout dropdown with default palette', () => {
      const items = TextColor.config.addToolbarItems?.call(TextColor);
      expect(items).toHaveLength(1);
      const dropdown = items?.[0];
      expect(dropdown?.type).toBe('dropdown');
      if (dropdown?.type === 'dropdown') {
        expect(dropdown.name).toBe('textColor');
        expect(dropdown.layout).toBe('grid');
        expect(dropdown.gridColumns).toBe(5);
        // 25 color swatches + 1 reset = 26 items
        expect(dropdown.items).toHaveLength(26);
      }
    });

    it('returns empty when colors is empty array', () => {
      const Custom = TextColor.configure({ colors: [] });
      const items = Custom.config.addToolbarItems?.call(Custom);
      expect(items).toHaveLength(0);
    });

    it('color items have color property matching commandArgs', () => {
      const items = TextColor.config.addToolbarItems?.call(TextColor);
      const dropdown = items?.[0];
      if (dropdown?.type === 'dropdown') {
        const colorItems = dropdown.items.filter(i => i.color);
        expect(colorItems).toHaveLength(25);
        for (const item of colorItems) {
          expect(item.color).toBe(item.commandArgs?.[0]);
        }
      }
    });

    it('first item is the reset button without color', () => {
      const items = TextColor.config.addToolbarItems?.call(TextColor);
      const dropdown = items?.[0];
      if (dropdown?.type === 'dropdown') {
        const resetItem = dropdown.items[0]!;
        expect(resetItem.name).toBe('unsetTextColor');
        expect(resetItem.command).toBe('unsetTextColor');
        expect(resetItem.color).toBeUndefined();
      }
    });
  });

  describe('DEFAULT_TEXT_COLORS', () => {
    it('contains 25 colors', () => {
      expect(DEFAULT_TEXT_COLORS).toHaveLength(25);
    });

    it('all colors are valid hex format', () => {
      for (const color of DEFAULT_TEXT_COLORS) {
        expect(color).toMatch(/^#[0-9a-f]{6}$/);
      }
    });

    it('first row starts with black and ends with white', () => {
      expect(DEFAULT_TEXT_COLORS[0]).toBe('#000000');
      expect(DEFAULT_TEXT_COLORS[4]).toBe('#ffffff');
    });

    it('contains vivid red, green, blue, purple', () => {
      expect(DEFAULT_TEXT_COLORS).toContain('#e03131');
      expect(DEFAULT_TEXT_COLORS).toContain('#2f9e44');
      expect(DEFAULT_TEXT_COLORS).toContain('#1971c2');
      expect(DEFAULT_TEXT_COLORS).toContain('#7048e8');
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
      const result = editor.commands.setTextColor('#ff0000');

      expect(result).toBe(true);
    });

    it('unsetTextColor removes text color', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, TextStyle, TextColor],
        content: '<p><span style="color: red">Colored</span></p>',
      });

      editor.focus('all');

      const result = editor.commands.unsetTextColor();
      expect(result).toBe(true);
    });
  });
});
