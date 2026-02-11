import { describe, it, expect, afterEach } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import { Strike } from './Strike.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Editor } from '../Editor.js';

describe('Strike', () => {
  describe('configuration', () => {
    it('has correct name', () => {
      expect(Strike.name).toBe('strike');
    });

    it('is a mark type', () => {
      expect(Strike.type).toBe('mark');
    });

    it('has default options', () => {
      expect(Strike.options).toEqual({ HTMLAttributes: {} });
    });
  });

  describe('parseHTML', () => {
    it('returns rules for s, del, strike, and text-decoration', () => {
      const rules = Strike.config.parseHTML?.call(Strike);
      expect(rules).toHaveLength(4);
      expect(rules?.[0]).toEqual({ tag: 's' });
      expect(rules?.[1]).toEqual({ tag: 'del' });
      expect(rules?.[2]).toEqual({ tag: 'strike' });
      expect(rules?.[3]).toHaveProperty('style', 'text-decoration');
    });

    it('accepts text-decoration line-through', () => {
      const rules = Strike.config.parseHTML?.call(Strike);
      const getAttrs = rules?.[3]?.getAttrs;
      expect(getAttrs?.('line-through')).toEqual({});
    });

    it('rejects text-decoration underline', () => {
      const rules = Strike.config.parseHTML?.call(Strike);
      const getAttrs = rules?.[3]?.getAttrs;
      expect(getAttrs?.('underline')).toBe(false);
    });
  });

  describe('renderHTML', () => {
    it('renders s element', () => {
      const spec = Strike.createMarkSpec();
      const result = spec.toDOM?.({ attrs: {} } as never, true) as [string, Record<string, unknown>, number];
      expect(result[0]).toBe('s');
      expect(result[2]).toBe(0);
    });
  });

  describe('addCommands', () => {
    it('provides setStrike, unsetStrike, toggleStrike', () => {
      const commands = Strike.config.addCommands?.call(Strike);
      expect(commands).toHaveProperty('setStrike');
      expect(commands).toHaveProperty('unsetStrike');
      expect(commands).toHaveProperty('toggleStrike');
    });
  });

  describe('addKeyboardShortcuts', () => {
    it('provides Mod-Shift-s and Mod-Shift-S shortcuts', () => {
      const shortcuts = Strike.config.addKeyboardShortcuts?.call(Strike);
      expect(shortcuts).toHaveProperty('Mod-Shift-s');
      expect(shortcuts).toHaveProperty('Mod-Shift-S');
    });

    it('shortcuts return false when no editor', () => {
      const shortcuts = Strike.config.addKeyboardShortcuts?.call({
        ...Strike, editor: undefined, options: Strike.options,
      } as any);
       
      expect((shortcuts?.['Mod-Shift-s'] as any)?.()).toBe(false);
       
      expect((shortcuts?.['Mod-Shift-S'] as any)?.()).toBe(false);
    });
  });

  describe('addInputRules', () => {
    it('returns empty array when no markType', () => {
      const rules = Strike.config.addInputRules?.call(Strike);
      expect(rules).toEqual([]);
    });
  });

  describe('integration', () => {
    let editor: Editor | undefined;

    afterEach(() => {
      if (editor && !editor.isDestroyed) editor.destroy();
    });

    it('parses <s> tags', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Strike],
        content: '<p><s>struck</s></p>',
      });
      const textNode = editor.state.doc.child(0).child(0);
      expect(textNode.marks[0]?.type.name).toBe('strike');
    });

    it('parses <del> tags', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Strike],
        content: '<p><del>deleted</del></p>',
      });
      const textNode = editor.state.doc.child(0).child(0);
      expect(textNode.marks[0]?.type.name).toBe('strike');
    });

    it('renders to <s>', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Strike],
        content: '<p><s>struck</s></p>',
      });
      expect(editor.getHTML()).toContain('<s>struck</s>');
    });

    it('setStrike applies strike to selected text', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Strike],
        content: '<p>Hello world</p>',
      });
      const { state } = editor;
      editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 1, 6)));
      editor.commands.setStrike();
      expect(editor.getHTML()).toContain('<s>Hello</s>');
    });

    it('unsetStrike removes strike from selected text', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Strike],
        content: '<p><s>Hello</s> world</p>',
      });
      const { state } = editor;
      editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 1, 6)));
      editor.commands.unsetStrike();
      expect(editor.getHTML()).not.toContain('<s>');
    });

    it('toggleStrike toggles on selected text', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Strike],
        content: '<p>Hello world</p>',
      });
      const { state } = editor;
      editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 1, 6)));
      editor.commands.toggleStrike();
      expect(editor.getHTML()).toContain('<s>Hello</s>');
    });

    it('parseHTML text-decoration rejects non-string', () => {
      const rules = Strike.config.parseHTML?.call(Strike);
      const getAttrs = rules?.[3]?.getAttrs;
       
      expect(getAttrs?.(42 as any)).toBe(false);
    });
  });
});
