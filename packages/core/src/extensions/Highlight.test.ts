/**
 * Tests for Highlight extension
 */
import { describe, it, expect, afterEach } from 'vitest';
import { TextSelection } from '@domternal/pm/state';
import { Highlight, DEFAULT_HIGHLIGHT_COLORS } from './Highlight.js';
import { TextColor } from './TextColor.js';
import { TextStyle } from '../marks/TextStyle.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Editor } from '../Editor.js';
import type { ToolbarButton, ToolbarDropdown } from '../types/Toolbar.js';

describe('Highlight', () => {
  describe('configuration', () => {
    it('has correct name', () => {
      expect(Highlight.name).toBe('highlight');
    });

    it('is an extension type', () => {
      expect(Highlight.type).toBe('extension');
    });

    it('has default options', () => {
      expect(Highlight.options.colors).toBe(DEFAULT_HIGHLIGHT_COLORS);
      expect(Highlight.options.columns).toBe(5);
      expect(Highlight.options.defaultColor).toBe('#fef08a');
    });

    it('can configure custom colors', () => {
      const colors = ['#ff0000', '#00ff00'];
      const custom = Highlight.configure({ colors });
      expect(custom.options.colors).toEqual(colors);
    });

    it('can configure columns', () => {
      const custom = Highlight.configure({ columns: 8 });
      expect(custom.options.columns).toBe(8);
    });

    it('can configure defaultColor', () => {
      const custom = Highlight.configure({ defaultColor: '#ff0000' });
      expect(custom.options.defaultColor).toBe('#ff0000');
    });

    it('DEFAULT_HIGHLIGHT_COLORS has 25 entries', () => {
      expect(DEFAULT_HIGHLIGHT_COLORS).toHaveLength(25);
    });

    it('all colors are valid hex format', () => {
      for (const color of DEFAULT_HIGHLIGHT_COLORS) {
        expect(color).toMatch(/^#[0-9a-f]{6}$/);
      }
    });
  });

  describe('addGlobalAttributes', () => {
    it('provides backgroundColor attribute for textStyle', () => {
      const globalAttrs = Highlight.config.addGlobalAttributes?.call(Highlight);
      expect(globalAttrs).toHaveLength(1);
      expect(globalAttrs?.[0]?.types).toContain('textStyle');
      expect(globalAttrs?.[0]?.attributes).toHaveProperty('backgroundColor');
    });

    it('backgroundColor attribute has correct defaults', () => {
      const globalAttrs = Highlight.config.addGlobalAttributes?.call(Highlight);
      const bgAttr = globalAttrs?.[0]?.attributes['backgroundColor'];
      expect(bgAttr?.default).toBe(null);
      expect(bgAttr?.parseHTML).toBeDefined();
      expect(bgAttr?.renderHTML).toBeDefined();
    });

    it('renderHTML outputs background-color style', () => {
      const globalAttrs = Highlight.config.addGlobalAttributes?.call(Highlight);
      const renderHTML = globalAttrs?.[0]?.attributes['backgroundColor']?.renderHTML;
      const result = renderHTML?.({ backgroundColor: '#fef08a' });
      expect(result).toEqual({ style: 'background-color: #fef08a' });
    });

    it('renderHTML returns null for null backgroundColor', () => {
      const globalAttrs = Highlight.config.addGlobalAttributes?.call(Highlight);
      const renderHTML = globalAttrs?.[0]?.attributes['backgroundColor']?.renderHTML;
      const result = renderHTML?.({ backgroundColor: null });
      expect(result).toBe(null);
    });

    it('parseHTML reads backgroundColor from element style', () => {
      const globalAttrs = Highlight.config.addGlobalAttributes?.call(Highlight);
      const parseHTML = globalAttrs?.[0]?.attributes['backgroundColor']?.parseHTML;
      const el = document.createElement('span');
      el.style.backgroundColor = 'yellow';
      expect(parseHTML?.(el)).toBe('yellow');
    });

    it('parseHTML returns defaultColor for plain <mark> element', () => {
      const globalAttrs = Highlight.config.addGlobalAttributes?.call(Highlight);
      const parseHTML = globalAttrs?.[0]?.attributes['backgroundColor']?.parseHTML;
      const el = document.createElement('mark');
      expect(parseHTML?.(el)).toBe('#fef08a');
    });
  });

  describe('addCommands', () => {
    it('provides setHighlight, unsetHighlight, toggleHighlight', () => {
      const commands = Highlight.config.addCommands?.call(Highlight);
      expect(commands).toHaveProperty('setHighlight');
      expect(commands).toHaveProperty('unsetHighlight');
      expect(commands).toHaveProperty('toggleHighlight');
    });
  });

  describe('addKeyboardShortcuts', () => {
    it('provides Mod-Shift-h shortcut', () => {
      const shortcuts = Highlight.config.addKeyboardShortcuts?.call(Highlight);
      expect(shortcuts).toHaveProperty('Mod-Shift-h');
    });

    it('shortcut returns false when no editor', () => {
      const shortcuts = Highlight.config.addKeyboardShortcuts?.call({
        ...Highlight, editor: undefined, options: Highlight.options,
      } as any);
      expect((shortcuts?.['Mod-Shift-h'] as any)?.()).toBe(false);
    });
  });

  describe('addInputRules', () => {
    it('returns array with one rule', () => {
      const rules = Highlight.config.addInputRules?.call(Highlight);
      expect(rules).toHaveLength(1);
    });
  });

  describe('addToolbarItems', () => {
    it('returns dropdown with grid layout by default', () => {
      const items = Highlight.config.addToolbarItems!.call(Highlight);
      expect(items).toHaveLength(1);
      const dropdown = items[0] as ToolbarDropdown;
      expect(dropdown.type).toBe('dropdown');
      expect(dropdown.name).toBe('highlight');
      expect(dropdown.layout).toBe('grid');
      expect(dropdown.gridColumns).toBe(5);
    });

    it('dropdown has reset button + one swatch per color', () => {
      const items = Highlight.config.addToolbarItems!.call(Highlight);
      const dropdown = items[0] as ToolbarDropdown;
      expect(dropdown.items).toHaveLength(1 + DEFAULT_HIGHLIGHT_COLORS.length);
      const reset = dropdown.items[0]!;
      expect(reset.name).toBe('unsetHighlight');
      expect(reset.command).toBe('unsetHighlight');
      expect(reset.icon).toBe('prohibit');
    });

    it('color swatches have correct command and isActive', () => {
      const items = Highlight.config.addToolbarItems!.call(Highlight);
      const dropdown = items[0] as ToolbarDropdown;
      const firstColor = DEFAULT_HIGHLIGHT_COLORS[0]!;
      const swatch = dropdown.items[1]!;
      expect(swatch.name).toBe(`highlight-${firstColor}`);
      expect(swatch.command).toBe('setHighlight');
      expect(swatch.commandArgs).toEqual([{ color: firstColor }]);
      expect(swatch.isActive).toEqual({ name: 'textStyle', attributes: { backgroundColor: firstColor } });
      expect(swatch.color).toBe(firstColor);
    });

    it('returns single button when colors is empty', () => {
      const custom = Highlight.configure({ colors: [] });
      const items = custom.config.addToolbarItems!.call(custom);
      expect(items).toHaveLength(1);
      const button = items[0] as ToolbarButton;
      expect(button.type).toBe('button');
      expect(button.command).toBe('toggleHighlight');
      expect(button.isActive).toEqual({ name: 'textStyle', attributes: { backgroundColor: '#fef08a' } });
    });

    it('respects custom colors and columns', () => {
      const colors = ['#ff0000', '#00ff00', '#0000ff'];
      const custom = Highlight.configure({ colors, columns: 3 });
      const items = custom.config.addToolbarItems!.call(custom);
      const dropdown = items[0] as ToolbarDropdown;
      expect(dropdown.gridColumns).toBe(3);
      expect(dropdown.items).toHaveLength(1 + 3);
    });
  });

  describe('integration', () => {
    let editor: Editor | undefined;

    afterEach(() => {
      if (editor && !editor.isDestroyed) editor.destroy();
    });

    it('parses <mark> tags as textStyle with backgroundColor', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, TextStyle, Highlight],
        content: '<p><mark>highlighted</mark></p>',
      });
      const textNode = editor.state.doc.child(0).child(0);
      expect(textNode.marks[0]?.type.name).toBe('textStyle');
      expect(textNode.marks[0]?.attrs['backgroundColor']).toBe('#fef08a');
    });

    it('parses <span style="background-color"> as textStyle with backgroundColor', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, TextStyle, Highlight],
        content: '<p><span style="background-color: rgb(254, 240, 138)">highlighted</span></p>',
      });
      const textNode = editor.state.doc.child(0).child(0);
      expect(textNode.marks[0]?.type.name).toBe('textStyle');
      expect(textNode.marks[0]?.attrs['backgroundColor']).toBe('#fef08a');
    });

    it('renders as <span> with background-color (not <mark>)', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, TextStyle, Highlight],
        content: '<p><mark>highlighted</mark></p>',
      });
      const html = editor.getHTML();
      expect(html).not.toContain('<mark');
      expect(html).toContain('<span');
      expect(html).toContain('background-color');
      expect(html).toContain('>highlighted</span>');
    });

    it('setHighlight applies background-color to selected text', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, TextStyle, Highlight],
        content: '<p>Hello world</p>',
      });
      const { state } = editor;
      editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 1, 6)));
      editor.commands.setHighlight({ color: '#fef08a' });
      const html = editor.getHTML();
      expect(html).toContain('background-color: #fef08a');
      expect(html).not.toContain('<mark');
    });

    it('unsetHighlight removes background-color', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, TextStyle, Highlight],
        content: '<p><span style="background-color: #fef08a">Hello</span> world</p>',
      });
      const { state } = editor;
      editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 1, 6)));
      editor.commands.unsetHighlight();
      expect(editor.getHTML()).not.toContain('background-color');
    });

    it('unsetHighlight preserves text color when both are set', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, TextStyle, TextColor, Highlight],
        content: '<p><span style="color: #e03131; background-color: #fef08a">Hello</span> world</p>',
      });
      const { state } = editor;
      editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 1, 6)));
      editor.commands.unsetHighlight();
      const html = editor.getHTML();
      expect(html).not.toContain('background-color');
      expect(html).toContain('color: #e03131');
    });

    it('highlight + textColor renders on same <span>', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, TextStyle, TextColor, Highlight],
        content: '<p>Hello world</p>',
      });
      const { state } = editor;
      editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 1, 12)));
      editor.commands.setTextColor('#e03131');
      editor.commands.setHighlight({ color: '#fef08a' });
      const html = editor.getHTML();
      // Both styles on same span — no nesting
      expect(html).toContain('color: #e03131');
      expect(html).toContain('background-color: #fef08a');
      expect(html).not.toContain('<mark');
    });

    it('isActive detects specific backgroundColor', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, TextStyle, Highlight],
        content: '<p>Hello world</p>',
      });
      const { state } = editor;
      editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 1, 6)));
      editor.commands.setHighlight({ color: '#fef08a' });
      expect(editor.isActive('textStyle', { backgroundColor: '#fef08a' })).toBe(true);
      expect(editor.isActive('textStyle', { backgroundColor: '#ff0000' })).toBe(false);
    });
  });
});
