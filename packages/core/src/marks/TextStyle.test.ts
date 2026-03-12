/**
 * Tests for TextStyle mark
 */
import { describe, it, expect, afterEach } from 'vitest';
import { TextStyle } from './TextStyle.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Editor } from '../Editor.js';
import { TextSelection } from 'prosemirror-state';
import { TextColor } from '../extensions/TextColor.js';

const extensions = [Document, Text, Paragraph, TextStyle];

describe('TextStyle', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) editor.destroy();
  });

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
    it('returns rules for span and mark tags', () => {
      const rules = TextStyle.config.parseHTML?.call(TextStyle);
      expect(rules).toHaveLength(2);
      expect(rules?.[0]).toHaveProperty('tag', 'span');
      expect(rules?.[0]).toHaveProperty('getAttrs');
      expect(rules?.[1]).toHaveProperty('tag', 'mark');
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

    it('returns false for string argument', () => {
      const rules = TextStyle.config.parseHTML?.call(TextStyle);
      const getAttrs = rules?.[0]?.getAttrs;
       
      expect(getAttrs?.('span' as any)).toBe(false);
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
    });

    it('provides removeTextStyle command', () => {
      const commands = TextStyle.config.addCommands?.call(TextStyle);
      expect(commands).toHaveProperty('removeTextStyle');
    });

    it('provides removeEmptyTextStyle command', () => {
      const commands = TextStyle.config.addCommands?.call(TextStyle);
      expect(commands).toHaveProperty('removeEmptyTextStyle');
    });
  });

  describe('command integration', () => {
    it('setTextStyle applies mark', () => {
      editor = new Editor({
        extensions,
        content: '<p>Hello world</p>',
      });

      // Select "Hello"
      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, 1, 6)
        )
      );

      editor.commands.setTextStyle({});

      const p = editor.state.doc.child(0);
      const firstChild = p.child(0);
      const hasMark = firstChild.marks.some((m) => m.type.name === 'textStyle');
      expect(hasMark).toBe(true);
    });

    it('removeTextStyle removes mark', () => {
      editor = new Editor({
        extensions,
        content: '<p><span style="color: red">Styled</span> text</p>',
      });

      // Select the styled text
      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, 1, 7)
        )
      );

      editor.commands.removeTextStyle();

      const p = editor.state.doc.child(0);
      const firstChild = p.child(0);
      const hasMark = firstChild.marks.some((m) => m.type.name === 'textStyle');
      expect(hasMark).toBe(false);
    });

    it('removeEmptyTextStyle removes marks with no attributes', () => {
      editor = new Editor({
        extensions,
        content: '<p><span style="color: red">Styled</span></p>',
      });

      // Select all text
      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, 1, 7)
        )
      );

      // The mark parsed from span[style] has empty attrs ({}),
      // so removeEmptyTextStyle should remove it
      const result = editor.commands.removeEmptyTextStyle();
      expect(result).toBe(true);
    });

    it('removeEmptyTextStyle keeps marks with non-null attributes', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, TextStyle, TextColor],
        content: '<p><span style="color: red">Colored</span></p>',
      });

      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, 1, 8)
        )
      );

      const result = editor.commands.removeEmptyTextStyle();
      // The mark has a non-null color attr, so it should NOT be considered empty
      expect(result).toBe(false);
    });

    it('removeEmptyTextStyle preserves non-empty marks on adjacent nodes', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, TextStyle, TextColor],
        content: '<p>RedPlain</p>',
      });

      const markType = editor.state.schema.marks['textStyle']!;

      // Manually apply textStyle with color on "Red" (pos 1-4)
      // and empty textStyle on "Plain" (pos 4-9)
      editor.view.dispatch(
        editor.state.tr
          .addMark(1, 4, markType.create({ color: '#ff0000' }))
          .addMark(4, 9, markType.create({ color: null }))
      );

      // Select entire text range: "RedPlain"
      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, 1, 9)
        )
      );

      const result = editor.commands.removeEmptyTextStyle();
      expect(result).toBe(true);

      // "Red" should still have its color mark
      const p = editor.state.doc.child(0);
      const redNode = p.child(0);
      const redMark = redNode.marks.find(m => m.type === markType);
      expect(redMark).toBeDefined();
      expect(redMark!.attrs['color']).toBe('#ff0000');
    });

    it('removeEmptyTextStyle returns false when no empty text styles exist', () => {
      editor = new Editor({
        extensions,
        content: '<p>Plain text</p>',
      });

      // Select all
      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, 1, 11)
        )
      );

      const result = editor.commands.removeEmptyTextStyle();
      expect(result).toBe(false);
    });
  });

  describe('integration', () => {
    it('works with Editor', () => {
      editor = new Editor({
        extensions,
        content: '<p><span style="color: red">Styled text</span></p>',
      });
      expect(editor.getText()).toContain('Styled text');
    });

    it('parses styled span correctly', () => {
      editor = new Editor({
        extensions,
        content: '<p><span style="color: red">Text</span></p>',
      });

      const p = editor.state.doc.child(0);
      const textNode = p.child(0);
      expect(textNode.marks.length).toBeGreaterThan(0);
      expect(textNode.marks[0]?.type.name).toBe('textStyle');
    });

    it('renders styled text correctly', () => {
      editor = new Editor({
        extensions,
        content: '<p><span style="color: red">Text</span></p>',
      });

      const html = editor.getHTML();
      expect(html).toContain('<span');
    });

    it('ignores plain spans without style', () => {
      editor = new Editor({
        extensions,
        content: '<p><span>No style</span></p>',
      });

      const p = editor.state.doc.child(0);
      const textNode = p.child(0);
      // Should have no textStyle mark since span has no style attribute
      const hasMark = textNode.marks.some((m) => m.type.name === 'textStyle');
      expect(hasMark).toBe(false);
    });
  });
});
