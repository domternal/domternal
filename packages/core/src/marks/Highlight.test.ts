import { describe, it, expect, afterEach } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import { Highlight, DEFAULT_HIGHLIGHT_COLORS } from './Highlight.js';
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

    it('is a mark type', () => {
      expect(Highlight.type).toBe('mark');
    });

    it('has default options', () => {
      expect(Highlight.options.HTMLAttributes).toEqual({});
      expect(Highlight.options.multicolor).toBe(true);
      expect(Highlight.options.colors).toBe(DEFAULT_HIGHLIGHT_COLORS);
      expect(Highlight.options.columns).toBe(5);
    });

    it('can disable multicolor', () => {
      const custom = Highlight.configure({ multicolor: false });
      expect(custom.options.multicolor).toBe(false);
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

    it('DEFAULT_HIGHLIGHT_COLORS has 25 entries', () => {
      expect(DEFAULT_HIGHLIGHT_COLORS).toHaveLength(25);
    });
  });

  describe('addAttributes', () => {
    it('returns color attribute by default (multicolor is true)', () => {
      const attrs = Highlight.config.addAttributes?.call(Highlight);
      expect(attrs).toHaveProperty('color');
      expect(attrs?.['color']).toHaveProperty('default', null);
    });

    it('returns empty object when multicolor disabled', () => {
      const custom = Highlight.configure({ multicolor: false });
      const attrs = custom.config.addAttributes?.call(custom);
      expect(attrs).toEqual({});
    });

    it('renderHTML returns data-color and style', () => {
      const attrs = Highlight.config.addAttributes?.call(Highlight);
      const rendered = attrs?.['color']?.renderHTML?.({ color: 'yellow' });
      expect(rendered).toEqual({
        'data-color': 'yellow',
        style: 'background-color: yellow',
      });
    });

    it('parseHTML reads data-color attribute', () => {
      const attrs = Highlight.config.addAttributes?.call(Highlight);
      const el = document.createElement('mark');
      el.setAttribute('data-color', 'red');
      const parsed = attrs?.['color']?.parseHTML?.(el);
      expect(parsed).toBe('red');
    });

    it('parseHTML falls back to backgroundColor', () => {
      const attrs = Highlight.config.addAttributes?.call(Highlight);
      const el = document.createElement('mark');
      el.style.backgroundColor = 'yellow';
      const parsed = attrs?.['color']?.parseHTML?.(el);
      expect(parsed).toBe('yellow');
    });

    it('renderHTML returns empty for no color', () => {
      const attrs = Highlight.config.addAttributes?.call(Highlight);
      const rendered = attrs?.['color']?.renderHTML?.({ color: null });
      expect(rendered).toEqual({});
    });
  });

  describe('parseHTML', () => {
    it('returns rules for mark and background-color', () => {
      const rules = Highlight.config.parseHTML?.call(Highlight);
      expect(rules).toHaveLength(2);
      expect(rules?.[0]).toEqual({ tag: 'mark' });
      expect(rules?.[1]).toHaveProperty('style', 'background-color');
    });

    it('accepts non-empty background-color', () => {
      const rules = Highlight.config.parseHTML?.call(Highlight);
      const getAttrs = rules?.[1]?.getAttrs;
      expect(getAttrs?.('yellow')).toEqual({});
    });

    it('rejects empty background-color', () => {
      const rules = Highlight.config.parseHTML?.call(Highlight);
      const getAttrs = rules?.[1]?.getAttrs;
      expect(getAttrs?.('')).toBe(false);
    });
  });

  describe('renderHTML', () => {
    it('renders mark element', () => {
      const spec = Highlight.createMarkSpec();
      const result = spec.toDOM?.({ attrs: {} } as never, true) as [string, Record<string, unknown>, number];
      expect(result[0]).toBe('mark');
      expect(result[2]).toBe(0);
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
    it('provides Mod-Shift-h and Mod-Shift-H shortcuts', () => {
      const shortcuts = Highlight.config.addKeyboardShortcuts?.call(Highlight);
      expect(shortcuts).toHaveProperty('Mod-Shift-h');
      expect(shortcuts).toHaveProperty('Mod-Shift-H');
    });

    it('shortcuts return false when no editor', () => {
      const shortcuts = Highlight.config.addKeyboardShortcuts?.call({
        ...Highlight, editor: undefined, options: Highlight.options,
      } as any);
       
      expect((shortcuts?.['Mod-Shift-h'] as any)?.()).toBe(false);
       
      expect((shortcuts?.['Mod-Shift-H'] as any)?.()).toBe(false);
    });
  });

  describe('addInputRules', () => {
    it('returns empty array when no markType', () => {
      const rules = Highlight.config.addInputRules?.call(Highlight);
      expect(rules).toEqual([]);
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
      // 1 reset + 25 colors
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
      expect(swatch.isActive).toEqual({ name: 'highlight', attributes: { color: firstColor } });
      expect(swatch.color).toBe(firstColor);
    });

    it('returns single button when colors is empty', () => {
      const custom = Highlight.configure({ colors: [] });
      const items = custom.config.addToolbarItems!.call(custom);
      expect(items).toHaveLength(1);
      const button = items[0] as ToolbarButton;
      expect(button.type).toBe('button');
      expect(button.command).toBe('toggleHighlight');
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

    it('parses <mark> tags', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Highlight],
        content: '<p><mark>highlighted</mark></p>',
      });
      const textNode = editor.state.doc.child(0).child(0);
      expect(textNode.marks[0]?.type.name).toBe('highlight');
    });

    it('renders to <mark>', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Highlight],
        content: '<p><mark>highlighted</mark></p>',
      });
      expect(editor.getHTML()).toContain('<mark>highlighted</mark>');
    });

    it('setHighlight applies highlight to selected text', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Highlight],
        content: '<p>Hello world</p>',
      });
      const { state } = editor;
      editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 1, 6)));
      editor.commands.setHighlight();
      expect(editor.getHTML()).toContain('<mark>Hello</mark>');
    });

    it('unsetHighlight removes highlight from selected text', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Highlight],
        content: '<p><mark>Hello</mark> world</p>',
      });
      const { state } = editor;
      editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 1, 6)));
      editor.commands.unsetHighlight();
      expect(editor.getHTML()).not.toContain('<mark>');
    });

    it('toggleHighlight toggles on selected text', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Highlight],
        content: '<p>Hello world</p>',
      });
      const { state } = editor;
      editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 1, 6)));
      editor.commands.toggleHighlight();
      expect(editor.getHTML()).toContain('<mark>Hello</mark>');
    });

    it('setHighlight with color applies colored highlight', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Highlight],
        content: '<p>Hello world</p>',
      });
      const { state } = editor;
      editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 1, 6)));
      editor.commands.setHighlight({ color: '#fef08a' });
      const html = editor.getHTML();
      expect(html).toContain('data-color="#fef08a"');
      expect(html).toContain('background-color: #fef08a');
    });

    it('isActive detects specific highlight color', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Highlight],
        content: '<p>Hello world</p>',
      });
      const { state } = editor;
      editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 1, 6)));
      editor.commands.setHighlight({ color: '#fef08a' });
      expect(editor.isActive('highlight', { color: '#fef08a' })).toBe(true);
      expect(editor.isActive('highlight', { color: '#ff0000' })).toBe(false);
    });

    it('unsetHighlight removes colored highlight', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Highlight],
        content: '<p><mark data-color="#fef08a" style="background-color: #fef08a">Hello</mark> world</p>',
      });
      const { state } = editor;
      editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 1, 6)));
      editor.commands.unsetHighlight();
      expect(editor.getHTML()).not.toContain('<mark');
    });
  });
});
