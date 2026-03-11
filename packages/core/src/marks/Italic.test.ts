import { describe, it, expect, afterEach } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import { Italic } from './Italic.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Editor } from '../Editor.js';

describe('Italic', () => {
  describe('configuration', () => {
    it('has correct name', () => {
      expect(Italic.name).toBe('italic');
    });

    it('is a mark type', () => {
      expect(Italic.type).toBe('mark');
    });

    it('has default options', () => {
      expect(Italic.options).toEqual({ HTMLAttributes: {} });
    });
  });

  describe('parseHTML', () => {
    it('returns rules for em, i, and font-style', () => {
      const rules = Italic.config.parseHTML?.call(Italic);
      expect(rules).toHaveLength(3);
      expect(rules?.[0]).toEqual({ tag: 'em' });
      expect(rules?.[1]).toHaveProperty('tag', 'i');
      expect(rules?.[2]).toHaveProperty('style', 'font-style');
    });

    it('rejects <i> with font-style:normal (Google Docs)', () => {
      const rules = Italic.config.parseHTML?.call(Italic);
      const getAttrs = rules?.[1]?.getAttrs;
      const el = document.createElement('i');
      el.style.fontStyle = 'normal';
      expect(getAttrs?.(el)).toBe(false);
    });

    it('accepts <i> without font-style override', () => {
      const rules = Italic.config.parseHTML?.call(Italic);
      const getAttrs = rules?.[1]?.getAttrs;
      const el = document.createElement('i');
      expect(getAttrs?.(el)).toEqual({});
    });

    it('accepts font-style italic', () => {
      const rules = Italic.config.parseHTML?.call(Italic);
      const getAttrs = rules?.[2]?.getAttrs;
      expect(getAttrs?.('italic')).toEqual({});
    });

    it('rejects font-style normal', () => {
      const rules = Italic.config.parseHTML?.call(Italic);
      const getAttrs = rules?.[2]?.getAttrs;
      expect(getAttrs?.('normal')).toBe(false);
    });
  });

  describe('renderHTML', () => {
    it('renders em element', () => {
      const spec = Italic.createMarkSpec();
      const result = spec.toDOM?.({ attrs: {} } as never, true) as [string, Record<string, unknown>, number];
      expect(result[0]).toBe('em');
      expect(result[2]).toBe(0);
    });
  });

  describe('addCommands', () => {
    it('provides setItalic, unsetItalic, toggleItalic', () => {
      const commands = Italic.config.addCommands?.call(Italic);
      expect(commands).toHaveProperty('setItalic');
      expect(commands).toHaveProperty('unsetItalic');
      expect(commands).toHaveProperty('toggleItalic');
    });
  });

  describe('addKeyboardShortcuts', () => {
    it('provides Mod-i shortcut', () => {
      const shortcuts = Italic.config.addKeyboardShortcuts?.call(Italic);
      expect(shortcuts).toHaveProperty('Mod-i');
    });

    it('shortcuts return false when no editor', () => {
      const shortcuts = Italic.config.addKeyboardShortcuts?.call({
        ...Italic, editor: undefined, options: Italic.options,
      } as any);
       
      expect((shortcuts?.['Mod-i'] as any)?.()).toBe(false);
    });
  });

  describe('addInputRules', () => {
    it('returns empty array when no markType', () => {
      const rules = Italic.config.addInputRules?.call(Italic);
      expect(rules).toEqual([]);
    });
  });

  describe('integration', () => {
    let editor: Editor | undefined;

    afterEach(() => {
      if (editor && !editor.isDestroyed) editor.destroy();
    });

    it('parses <em> tags', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Italic],
        content: '<p><em>italic text</em></p>',
      });
      const textNode = editor.state.doc.child(0).child(0);
      expect(textNode.marks[0]?.type.name).toBe('italic');
    });

    it('parses <i> tags', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Italic],
        content: '<p><i>italic text</i></p>',
      });
      const textNode = editor.state.doc.child(0).child(0);
      expect(textNode.marks[0]?.type.name).toBe('italic');
    });

    it('renders to <em>', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Italic],
        content: '<p><em>italic</em></p>',
      });
      expect(editor.getHTML()).toContain('<em>italic</em>');
    });

    it('toggleItalic toggles italic on selected text', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Italic],
        content: '<p>Hello world</p>',
      });
      const { state } = editor;
      editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 1, 6)));
      editor.commands.toggleItalic();
      expect(editor.getHTML()).toContain('<em>Hello</em>');
    });

    it('setItalic applies italic to selected text', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Italic],
        content: '<p>Hello world</p>',
      });
      const { state } = editor;
      editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 1, 6)));
      editor.commands.setItalic();
      expect(editor.getHTML()).toContain('<em>Hello</em>');
    });

    it('unsetItalic removes italic from selected text', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Italic],
        content: '<p><em>Hello</em> world</p>',
      });
      const { state } = editor;
      editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 1, 6)));
      editor.commands.unsetItalic();
      expect(editor.getHTML()).not.toContain('<em>');
    });

    it('parseHTML getAttrs handles string argument for <i>', () => {
      const rules = Italic.config.parseHTML?.call(Italic);
      const getAttrs = rules?.[1]?.getAttrs;
      expect(getAttrs?.('test')).toEqual({});
    });

    it('parseHTML font-style rejects non-string', () => {
      const rules = Italic.config.parseHTML?.call(Italic);
      const getAttrs = rules?.[2]?.getAttrs;
       
      expect(getAttrs?.(42 as any)).toBe(false);
    });
  });
});
