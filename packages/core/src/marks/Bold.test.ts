import { describe, it, expect, afterEach } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import { Bold } from './Bold.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Italic } from './Italic.js';
import { Editor } from '../Editor.js';

describe('Bold', () => {
  describe('configuration', () => {
    it('has correct name', () => {
      expect(Bold.name).toBe('bold');
    });

    it('is a mark type', () => {
      expect(Bold.type).toBe('mark');
    });

    it('has default options', () => {
      expect(Bold.options).toEqual({ HTMLAttributes: {} });
    });

    it('can configure HTMLAttributes', () => {
      const custom = Bold.configure({ HTMLAttributes: { class: 'bold' } });
      expect(custom.options.HTMLAttributes).toEqual({ class: 'bold' });
    });
  });

  describe('parseHTML', () => {
    it('returns rules for strong, b, and font-weight', () => {
      const rules = Bold.config.parseHTML?.call(Bold);
      expect(rules).toHaveLength(3);
      expect(rules?.[0]).toEqual({ tag: 'strong' });
      expect(rules?.[1]).toHaveProperty('tag', 'b');
      expect(rules?.[2]).toHaveProperty('style', 'font-weight');
    });

    it('rejects <b> with font-weight:normal (Google Docs)', () => {
      const rules = Bold.config.parseHTML?.call(Bold);
      const getAttrs = rules?.[1]?.getAttrs;
      const el = document.createElement('b');
      el.style.fontWeight = 'normal';
      expect(getAttrs?.(el)).toBe(false);
    });

    it('rejects <b> with font-weight:400', () => {
      const rules = Bold.config.parseHTML?.call(Bold);
      const getAttrs = rules?.[1]?.getAttrs;
      const el = document.createElement('b');
      el.style.fontWeight = '400';
      expect(getAttrs?.(el)).toBe(false);
    });

    it('accepts <b> without font-weight override', () => {
      const rules = Bold.config.parseHTML?.call(Bold);
      const getAttrs = rules?.[1]?.getAttrs;
      const el = document.createElement('b');
      expect(getAttrs?.(el)).toEqual({});
    });

    it('accepts font-weight >= 600', () => {
      const rules = Bold.config.parseHTML?.call(Bold);
      const getAttrs = rules?.[2]?.getAttrs;
      expect(getAttrs?.('600')).toEqual({});
      expect(getAttrs?.('700')).toEqual({});
      expect(getAttrs?.('900')).toEqual({});
    });

    it('accepts font-weight bold/bolder', () => {
      const rules = Bold.config.parseHTML?.call(Bold);
      const getAttrs = rules?.[2]?.getAttrs;
      expect(getAttrs?.('bold')).toEqual({});
      expect(getAttrs?.('bolder')).toEqual({});
    });

    it('rejects font-weight < 600', () => {
      const rules = Bold.config.parseHTML?.call(Bold);
      const getAttrs = rules?.[2]?.getAttrs;
      expect(getAttrs?.('400')).toBe(false);
      expect(getAttrs?.('normal')).toBe(false);
    });
  });

  describe('renderHTML', () => {
    it('renders strong element', () => {
      const spec = Bold.createMarkSpec();
      const result = spec.toDOM?.({ attrs: {} } as never, true) as [string, Record<string, unknown>, number];
      expect(result[0]).toBe('strong');
      expect(result[2]).toBe(0);
    });

    it('merges HTMLAttributes', () => {
      const custom = Bold.configure({ HTMLAttributes: { class: 'bold' } });
      const spec = custom.createMarkSpec();
      const result = spec.toDOM?.({ attrs: {} } as never, true) as [string, Record<string, unknown>, number];
      expect(result[1]).toEqual({ class: 'bold' });
    });
  });

  describe('addCommands', () => {
    it('provides setBold, unsetBold, toggleBold', () => {
      const commands = Bold.config.addCommands?.call(Bold);
      expect(commands).toHaveProperty('setBold');
      expect(commands).toHaveProperty('unsetBold');
      expect(commands).toHaveProperty('toggleBold');
    });
  });

  describe('addKeyboardShortcuts', () => {
    it('provides Mod-b shortcut', () => {
      const shortcuts = Bold.config.addKeyboardShortcuts?.call(Bold);
      expect(shortcuts).toHaveProperty('Mod-b');
    });

    it('shortcuts return false when no editor', () => {
      const shortcuts = Bold.config.addKeyboardShortcuts?.call({
        ...Bold, editor: undefined, options: Bold.options,
      } as any);
       
      expect((shortcuts?.['Mod-b'] as any)?.()).toBe(false);
    });
  });

  describe('addInputRules', () => {
    it('returns empty array when no markType', () => {
      const rules = Bold.config.addInputRules?.call(Bold);
      expect(rules).toEqual([]);
    });
  });

  describe('integration', () => {
    let editor: Editor | undefined;

    afterEach(() => {
      if (editor && !editor.isDestroyed) editor.destroy();
    });

    it('parses <strong> tags', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Bold],
        content: '<p><strong>bold text</strong></p>',
      });
      const textNode = editor.state.doc.child(0).child(0);
      expect(textNode.marks[0]?.type.name).toBe('bold');
    });

    it('parses <b> tags', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Bold],
        content: '<p><b>bold text</b></p>',
      });
      const textNode = editor.state.doc.child(0).child(0);
      expect(textNode.marks[0]?.type.name).toBe('bold');
    });

    it('renders to <strong>', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Bold],
        content: '<p><strong>bold</strong></p>',
      });
      expect(editor.getHTML()).toContain('<strong>bold</strong>');
    });

    it('can coexist with other marks', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Bold, Italic],
        content: '<p><strong><em>bold italic</em></strong></p>',
      });
      const textNode = editor.state.doc.child(0).child(0);
      expect(textNode.marks).toHaveLength(2);
    });

    it('toggleBold toggles bold on selected text', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Bold],
        content: '<p>Hello world</p>',
      });
      const { state } = editor;
      editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 1, 6)));
      editor.commands.toggleBold();
      expect(editor.getHTML()).toContain('<strong>Hello</strong>');
      const s2 = editor.state;
      editor.view.dispatch(s2.tr.setSelection(TextSelection.create(s2.doc, 1, 6)));
      editor.commands.toggleBold();
      expect(editor.getHTML()).not.toContain('<strong>');
    });

    it('setBold applies bold to selected text', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Bold],
        content: '<p>Hello world</p>',
      });
      const { state } = editor;
      editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 1, 6)));
      editor.commands.setBold();
      expect(editor.getHTML()).toContain('<strong>Hello</strong>');
    });

    it('unsetBold removes bold from selected text', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Bold],
        content: '<p><strong>Hello</strong> world</p>',
      });
      const { state } = editor;
      editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 1, 6)));
      editor.commands.unsetBold();
      expect(editor.getHTML()).not.toContain('<strong>');
    });

    it('parseHTML getAttrs handles string argument for <b>', () => {
      const rules = Bold.config.parseHTML?.call(Bold);
      const getAttrs = rules?.[1]?.getAttrs;
      expect(getAttrs?.('test')).toEqual({});
    });

    it('parseHTML font-weight rejects non-string', () => {
      const rules = Bold.config.parseHTML?.call(Bold);
      const getAttrs = rules?.[2]?.getAttrs;
       
      expect(getAttrs?.(42 as any)).toBe(false);
    });
  });
});
