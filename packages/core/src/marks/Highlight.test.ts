import { describe, it, expect, afterEach } from 'vitest';
import { Highlight } from './Highlight.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Editor } from '../Editor.js';

describe('Highlight', () => {
  describe('configuration', () => {
    it('has correct name', () => {
      expect(Highlight.name).toBe('highlight');
    });

    it('is a mark type', () => {
      expect(Highlight.type).toBe('mark');
    });

    it('has default options', () => {
      expect(Highlight.options).toEqual({
        HTMLAttributes: {},
        multicolor: false,
      });
    });

    it('can enable multicolor', () => {
      const custom = Highlight.configure({ multicolor: true });
      expect(custom.options.multicolor).toBe(true);
    });
  });

  describe('addAttributes', () => {
    it('returns empty object when multicolor disabled', () => {
      const attrs = Highlight.config.addAttributes?.call(Highlight);
      expect(attrs).toEqual({});
    });

    it('returns color attribute when multicolor enabled', () => {
      const custom = Highlight.configure({ multicolor: true });
      const attrs = custom.config.addAttributes?.call(custom);
      expect(attrs).toHaveProperty('color');
      expect(attrs?.color).toHaveProperty('default', null);
    });

    it('multicolor renderHTML returns data-color and style', () => {
      const custom = Highlight.configure({ multicolor: true });
      const attrs = custom.config.addAttributes?.call(custom);
      const rendered = attrs?.color?.renderHTML?.({ color: 'yellow' });
      expect(rendered).toEqual({
        'data-color': 'yellow',
        style: 'background-color: yellow',
      });
    });

    it('multicolor renderHTML returns empty for no color', () => {
      const custom = Highlight.configure({ multicolor: true });
      const attrs = custom.config.addAttributes?.call(custom);
      const rendered = attrs?.color?.renderHTML?.({ color: null });
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
  });

  describe('addInputRules', () => {
    it('returns empty array when no markType', () => {
      const rules = Highlight.config.addInputRules?.call(Highlight);
      expect(rules).toEqual([]);
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
  });
});
