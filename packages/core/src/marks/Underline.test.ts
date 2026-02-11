import { describe, it, expect, afterEach } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import { Underline } from './Underline.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Editor } from '../Editor.js';

describe('Underline', () => {
  describe('configuration', () => {
    it('has correct name', () => {
      expect(Underline.name).toBe('underline');
    });

    it('is a mark type', () => {
      expect(Underline.type).toBe('mark');
    });

    it('has default options', () => {
      expect(Underline.options).toEqual({ HTMLAttributes: {} });
    });
  });

  describe('parseHTML', () => {
    it('returns rules for u and text-decoration', () => {
      const rules = Underline.config.parseHTML?.call(Underline);
      expect(rules).toHaveLength(2);
      expect(rules?.[0]).toEqual({ tag: 'u' });
      expect(rules?.[1]).toHaveProperty('style', 'text-decoration');
    });

    it('accepts text-decoration underline', () => {
      const rules = Underline.config.parseHTML?.call(Underline);
      const getAttrs = rules?.[1]?.getAttrs;
      expect(getAttrs?.('underline')).toEqual({});
      expect(getAttrs?.('underline dotted')).toEqual({});
    });

    it('rejects text-decoration line-through', () => {
      const rules = Underline.config.parseHTML?.call(Underline);
      const getAttrs = rules?.[1]?.getAttrs;
      expect(getAttrs?.('line-through')).toBe(false);
    });
  });

  describe('renderHTML', () => {
    it('renders u element', () => {
      const spec = Underline.createMarkSpec();
      const result = spec.toDOM?.({ attrs: {} } as never, true) as [string, Record<string, unknown>, number];
      expect(result[0]).toBe('u');
      expect(result[2]).toBe(0);
    });
  });

  describe('addCommands', () => {
    it('provides setUnderline, unsetUnderline, toggleUnderline', () => {
      const commands = Underline.config.addCommands?.call(Underline);
      expect(commands).toHaveProperty('setUnderline');
      expect(commands).toHaveProperty('unsetUnderline');
      expect(commands).toHaveProperty('toggleUnderline');
    });
  });

  describe('addKeyboardShortcuts', () => {
    it('provides Mod-u and Mod-U shortcuts', () => {
      const shortcuts = Underline.config.addKeyboardShortcuts?.call(Underline);
      expect(shortcuts).toHaveProperty('Mod-u');
      expect(shortcuts).toHaveProperty('Mod-U');
    });

    it('shortcuts return false when no editor', () => {
      const shortcuts = Underline.config.addKeyboardShortcuts?.call({
        ...Underline, editor: undefined, options: Underline.options,
      } as any);
       
      expect((shortcuts?.['Mod-u'] as any)?.()).toBe(false);
       
      expect((shortcuts?.['Mod-U'] as any)?.()).toBe(false);
    });
  });

  describe('integration', () => {
    let editor: Editor | undefined;

    afterEach(() => {
      if (editor && !editor.isDestroyed) editor.destroy();
    });

    it('parses <u> tags', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Underline],
        content: '<p><u>underlined</u></p>',
      });
      const textNode = editor.state.doc.child(0).child(0);
      expect(textNode.marks[0]?.type.name).toBe('underline');
    });

    it('renders to <u>', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Underline],
        content: '<p><u>underlined</u></p>',
      });
      expect(editor.getHTML()).toContain('<u>underlined</u>');
    });

    it('setUnderline applies underline to selected text', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Underline],
        content: '<p>Hello world</p>',
      });
      const { state } = editor;
      editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 1, 6)));
      editor.commands.setUnderline();
      expect(editor.getHTML()).toContain('<u>Hello</u>');
    });

    it('unsetUnderline removes underline from selected text', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Underline],
        content: '<p><u>Hello</u> world</p>',
      });
      const { state } = editor;
      editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 1, 6)));
      editor.commands.unsetUnderline();
      expect(editor.getHTML()).not.toContain('<u>');
    });

    it('toggleUnderline toggles on selected text', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Underline],
        content: '<p>Hello world</p>',
      });
      const { state } = editor;
      editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 1, 6)));
      editor.commands.toggleUnderline();
      expect(editor.getHTML()).toContain('<u>Hello</u>');
    });

    it('parseHTML text-decoration rejects non-string', () => {
      const rules = Underline.config.parseHTML?.call(Underline);
      const getAttrs = rules?.[1]?.getAttrs;
       
      expect(getAttrs?.(42 as any)).toBe(false);
    });
  });
});
