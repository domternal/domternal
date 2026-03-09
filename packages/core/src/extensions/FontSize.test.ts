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
import type { ToolbarItem, ToolbarDropdown } from '../types/Toolbar.js';

describe('FontSize', () => {
  describe('configuration', () => {
    it('has correct name', () => {
      expect(FontSize.name).toBe('fontSize');
    });

    it('has default options', () => {
      expect(FontSize.options).toEqual({
        fontSizes: ['12px', '14px', '16px', '18px', '24px', '32px'],
        showReset: false,
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

    it('renderHTML accepts any fontSize (no validation)', () => {
      const CustomFontSize = FontSize.configure({
        fontSizes: ['12px', '14px', '16px'],
      });
      const globalAttrs = CustomFontSize.config.addGlobalAttributes?.call(CustomFontSize);
      const renderHTML = globalAttrs?.[0]?.attributes['fontSize']?.renderHTML;

      const result = renderHTML?.({ fontSize: '24px' });
      expect(result).toEqual({ style: 'font-size: 24px' });
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
    it('accepts any size regardless of fontSizes list', () => {
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

      expect(result).toBe(true);
    });
  });

  describe('addToolbarItems', () => {
    it('returns a dropdown item', () => {
      const items = FontSize.config.addToolbarItems?.call(FontSize) as ToolbarItem[];
      expect(items).toHaveLength(1);
      expect(items[0]?.type).toBe('dropdown');
    });

    it('dropdown has correct base properties', () => {
      const items = FontSize.config.addToolbarItems?.call(FontSize) as ToolbarItem[];
      const dd = items[0] as ToolbarDropdown;
      expect(dd.name).toBe('fontSize');
      expect(dd.icon).toBe('textSize');
      expect(dd.label).toBe('Font Size');
      expect(dd.group).toBe('textStyle');
      expect(dd.priority).toBe(100);
      expect(dd.displayMode).toBe('text');
    });

    it('dropdown has dynamicLabel enabled', () => {
      const items = FontSize.config.addToolbarItems?.call(FontSize) as ToolbarItem[];
      const dd = items[0] as ToolbarDropdown;
      expect(dd.dynamicLabel).toBe(true);
    });

    it('dropdown has computedStyleProperty set to font-size', () => {
      const items = FontSize.config.addToolbarItems?.call(FontSize) as ToolbarItem[];
      const dd = items[0] as ToolbarDropdown;
      expect(dd.computedStyleProperty).toBe('font-size');
    });

    it('dropdown has dynamicLabelFallback of 16px', () => {
      const items = FontSize.config.addToolbarItems?.call(FontSize) as ToolbarItem[];
      const dd = items[0] as ToolbarDropdown;
      expect(dd.dynamicLabelFallback).toBe('16px');
    });

    it('dropdown contains items for all configured font sizes', () => {
      const items = FontSize.config.addToolbarItems?.call(FontSize) as ToolbarItem[];
      const dd = items[0] as ToolbarDropdown;
      expect(dd.items).toHaveLength(6);
      expect(dd.items[0]?.label).toBe('12px');
      expect(dd.items[5]?.label).toBe('32px');
    });

    it('each dropdown item has correct command and isActive', () => {
      const items = FontSize.config.addToolbarItems?.call(FontSize) as ToolbarItem[];
      const dd = items[0] as ToolbarDropdown;
      const item16 = dd.items[2]!;
      expect(item16.command).toBe('setFontSize');
      expect(item16.commandArgs).toEqual(['16px']);
      expect(item16.isActive).toEqual({ name: 'textStyle', attributes: { fontSize: '16px' } });
    });

    it('items have descending priority', () => {
      const items = FontSize.config.addToolbarItems?.call(FontSize) as ToolbarItem[];
      const dd = items[0] as ToolbarDropdown;
      expect(dd.items[0]?.priority).toBe(200);
      expect(dd.items[1]?.priority).toBe(199);
    });

    it('returns empty array when fontSizes is empty', () => {
      const Empty = FontSize.configure({ fontSizes: [], showReset: false });
      const items = Empty.config.addToolbarItems?.call(Empty) as ToolbarItem[];
      expect(items).toHaveLength(0);
    });

    it('prepends 16px if not in configured sizes', () => {
      const Custom = FontSize.configure({ fontSizes: ['12px', '24px'], showReset: false });
      const items = Custom.config.addToolbarItems?.call(Custom) as ToolbarItem[];
      const dd = items[0] as ToolbarDropdown;
      expect(dd.items).toHaveLength(3);
      expect(dd.items[0]?.label).toBe('16px');
      expect(dd.items[1]?.label).toBe('12px');
      expect(dd.items[2]?.label).toBe('24px');
    });

    it('does not duplicate 16px if already in configured sizes', () => {
      const items = FontSize.config.addToolbarItems?.call(FontSize) as ToolbarItem[];
      const dd = items[0] as ToolbarDropdown;
      const labels = dd.items.map(i => i.label);
      expect(labels.filter(l => l === '16px')).toHaveLength(1);
    });

    it('includes reset button when showReset is true', () => {
      const WithReset = FontSize.configure({ fontSizes: ['12px', '16px'], showReset: true });
      const items = WithReset.config.addToolbarItems?.call(WithReset) as ToolbarItem[];
      const dd = items[0] as ToolbarDropdown;
      const last = dd.items[dd.items.length - 1]!;
      expect(last.name).toBe('unsetFontSize');
      expect(last.command).toBe('unsetFontSize');
      expect(last.label).toBe('–');
      expect(last.priority).toBe(0);
    });

    it('excludes reset button when showReset is false', () => {
      const items = FontSize.config.addToolbarItems?.call(FontSize) as ToolbarItem[];
      const dd = items[0] as ToolbarDropdown;
      const names = dd.items.map(i => i.name);
      expect(names).not.toContain('unsetFontSize');
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

      const result = editor.commands.setFontSize('16px');

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
