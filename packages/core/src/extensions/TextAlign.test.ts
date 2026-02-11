import { describe, it, expect, afterEach } from 'vitest';
import { TextAlign } from './TextAlign.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Heading } from '../nodes/Heading.js';
import { Editor } from '../Editor.js';
import { TextSelection } from 'prosemirror-state';

const extensions = [Document, Text, Paragraph, Heading, TextAlign];

describe('TextAlign', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) editor.destroy();
  });

  describe('configuration', () => {
    it('has correct name', () => {
      expect(TextAlign.name).toBe('textAlign');
    });

    it('is an extension type', () => {
      expect(TextAlign.type).toBe('extension');
    });

    it('has default options', () => {
      const opts = TextAlign.config.addOptions?.call(TextAlign);
      expect(opts).toEqual({
        types: ['heading', 'paragraph'],
        alignments: ['left', 'center', 'right', 'justify'],
        defaultAlignment: 'left',
      });
    });

    it('can configure types', () => {
      const custom = TextAlign.configure({ types: ['paragraph'] });
      expect(custom.options.types).toEqual(['paragraph']);
    });

    it('can configure alignments', () => {
      const custom = TextAlign.configure({ alignments: ['left', 'center'] });
      expect(custom.options.alignments).toEqual(['left', 'center']);
    });

    it('can configure defaultAlignment', () => {
      const custom = TextAlign.configure({ defaultAlignment: 'center' });
      expect(custom.options.defaultAlignment).toBe('center');
    });
  });

  describe('addGlobalAttributes', () => {
    it('returns global attributes for configured types', () => {
      const attrs = TextAlign.config.addGlobalAttributes?.call(TextAlign);
      expect(attrs).toHaveLength(1);
      expect(attrs?.[0]).toHaveProperty('types', ['heading', 'paragraph']);
      expect(attrs?.[0]).toHaveProperty('attributes');
      expect(attrs?.[0]?.attributes).toHaveProperty('textAlign');
    });

    it('textAlign attribute has correct default', () => {
      const attrs = TextAlign.config.addGlobalAttributes?.call(TextAlign);
      expect(attrs?.[0]?.attributes['textAlign']?.default).toBe('left');
    });

    it('renderHTML returns null for default alignment', () => {
      const attrs = TextAlign.config.addGlobalAttributes?.call(TextAlign);
      const renderHTML = attrs?.[0]?.attributes['textAlign']?.renderHTML;
      expect(renderHTML?.({ textAlign: 'left' })).toBeNull();
    });

    it('renderHTML returns style for non-default alignment', () => {
      const attrs = TextAlign.config.addGlobalAttributes?.call(TextAlign);
      const renderHTML = attrs?.[0]?.attributes['textAlign']?.renderHTML;
      expect(renderHTML?.({ textAlign: 'center' })).toEqual({
        style: 'text-align: center',
      });
    });

    it('renderHTML returns style for right alignment', () => {
      const attrs = TextAlign.config.addGlobalAttributes?.call(TextAlign);
      const renderHTML = attrs?.[0]?.attributes['textAlign']?.renderHTML;
      expect(renderHTML?.({ textAlign: 'right' })).toEqual({
        style: 'text-align: right',
      });
    });

    it('renderHTML returns style for justify alignment', () => {
      const attrs = TextAlign.config.addGlobalAttributes?.call(TextAlign);
      const renderHTML = attrs?.[0]?.attributes['textAlign']?.renderHTML;
      expect(renderHTML?.({ textAlign: 'justify' })).toEqual({
        style: 'text-align: justify',
      });
    });

    it('parseHTML extracts textAlign from element style', () => {
      const attrs = TextAlign.config.addGlobalAttributes?.call(TextAlign);
      const parseHTML = attrs?.[0]?.attributes['textAlign']?.parseHTML;

      const element = document.createElement('p');
      element.style.textAlign = 'center';
      expect(parseHTML?.(element)).toBe('center');
    });

    it('parseHTML returns default alignment when no style', () => {
      const attrs = TextAlign.config.addGlobalAttributes?.call(TextAlign);
      const parseHTML = attrs?.[0]?.attributes['textAlign']?.parseHTML;

      const element = document.createElement('p');
      expect(parseHTML?.(element)).toBe('left');
    });
  });

  describe('addCommands', () => {
    it('provides setTextAlign and unsetTextAlign commands', () => {
      const commands = TextAlign.config.addCommands?.call(TextAlign);
      expect(commands).toHaveProperty('setTextAlign');
      expect(commands).toHaveProperty('unsetTextAlign');
    });
  });

  describe('addKeyboardShortcuts', () => {
    it('provides alignment shortcuts', () => {
      const shortcuts = TextAlign.config.addKeyboardShortcuts?.call(TextAlign);
      expect(shortcuts).toHaveProperty('Mod-Shift-l');
      expect(shortcuts).toHaveProperty('Mod-Shift-e');
      expect(shortcuts).toHaveProperty('Mod-Shift-r');
      expect(shortcuts).toHaveProperty('Mod-Shift-j');
    });

    it('shortcuts return false when no editor', () => {
       
      const shortcuts = TextAlign.config.addKeyboardShortcuts!.call({
        ...TextAlign,
        editor: null,
        options: TextAlign.config.addOptions!.call(TextAlign),
       
      } as never) as Record<string, any>;

      expect(shortcuts['Mod-Shift-l']({ editor: null })).toBe(false);
      expect(shortcuts['Mod-Shift-e']({ editor: null })).toBe(false);
      expect(shortcuts['Mod-Shift-r']({ editor: null })).toBe(false);
      expect(shortcuts['Mod-Shift-j']({ editor: null })).toBe(false);
    });
  });

  describe('command integration', () => {
    it('setTextAlign sets alignment on paragraph', () => {
      editor = new Editor({
        extensions,
        content: '<p>Hello world</p>',
      });

      editor.commands.setTextAlign('center');

      const html = editor.getHTML();
      expect(html).toContain('text-align: center');
    });

    it('setTextAlign sets alignment on heading', () => {
      editor = new Editor({
        extensions,
        content: '<h1>Title</h1>',
      });

      editor.commands.setTextAlign('right');

      const html = editor.getHTML();
      expect(html).toContain('text-align: right');
    });

    it('setTextAlign rejects invalid alignment', () => {
      editor = new Editor({
        extensions,
        content: '<p>Hello</p>',
      });

      const result = editor.commands.setTextAlign('invalid');
      expect(result).toBe(false);
    });

    it('unsetTextAlign resets to default', () => {
      editor = new Editor({
        extensions,
        content: '<p style="text-align: center">Centered</p>',
      });

      editor.commands.unsetTextAlign();

      const html = editor.getHTML();
      expect(html).not.toContain('text-align');
    });

    it('setTextAlign works on selection spanning multiple paragraphs', () => {
      editor = new Editor({
        extensions,
        content: '<p>First</p><p>Second</p>',
      });

      // Select across both paragraphs
      const docSize = editor.state.doc.content.size;
      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, 1, docSize - 1)
        )
      );

      editor.commands.setTextAlign('justify');

      const html = editor.getHTML();
      const matches = html.match(/text-align: justify/g);
      expect(matches?.length).toBe(2);
    });
  });
});
