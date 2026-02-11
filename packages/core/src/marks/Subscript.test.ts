import { describe, it, expect, afterEach } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import { Subscript } from './Subscript.js';
import { Superscript } from './Superscript.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Editor } from '../Editor.js';

describe('Subscript', () => {
  describe('configuration', () => {
    it('has correct name', () => {
      expect(Subscript.name).toBe('subscript');
    });

    it('is a mark type', () => {
      expect(Subscript.type).toBe('mark');
    });

    it('excludes superscript', () => {
      expect(Subscript.config.excludes).toBe('superscript');
    });

    it('has default options', () => {
      expect(Subscript.options).toEqual({ HTMLAttributes: {} });
    });
  });

  describe('parseHTML', () => {
    it('returns rules for sub and vertical-align', () => {
      const rules = Subscript.config.parseHTML?.call(Subscript);
      expect(rules).toHaveLength(2);
      expect(rules?.[0]).toEqual({ tag: 'sub' });
      expect(rules?.[1]).toHaveProperty('style', 'vertical-align');
    });

    it('accepts vertical-align sub', () => {
      const rules = Subscript.config.parseHTML?.call(Subscript);
      const getAttrs = rules?.[1]?.getAttrs;
      expect(getAttrs?.('sub')).toEqual({});
    });

    it('rejects vertical-align super', () => {
      const rules = Subscript.config.parseHTML?.call(Subscript);
      const getAttrs = rules?.[1]?.getAttrs;
      expect(getAttrs?.('super')).toBe(false);
    });
  });

  describe('renderHTML', () => {
    it('renders sub element', () => {
      const spec = Subscript.createMarkSpec();
      const result = spec.toDOM?.({ attrs: {} } as never, true) as [string, Record<string, unknown>, number];
      expect(result[0]).toBe('sub');
      expect(result[2]).toBe(0);
    });
  });

  describe('addCommands', () => {
    it('provides setSubscript, unsetSubscript, toggleSubscript', () => {
      const commands = Subscript.config.addCommands?.call(Subscript);
      expect(commands).toHaveProperty('setSubscript');
      expect(commands).toHaveProperty('unsetSubscript');
      expect(commands).toHaveProperty('toggleSubscript');
    });
  });

  describe('addKeyboardShortcuts', () => {
    it('provides Mod-, shortcut', () => {
      const shortcuts = Subscript.config.addKeyboardShortcuts?.call(Subscript);
      expect(shortcuts).toHaveProperty('Mod-,');
    });

    it('shortcut returns false when no editor', () => {
      const shortcuts = Subscript.config.addKeyboardShortcuts?.call({
        ...Subscript, editor: undefined, options: Subscript.options,
      } as any);
       
      expect((shortcuts?.['Mod-,'] as any)?.()).toBe(false);
    });
  });

  describe('integration', () => {
    let editor: Editor | undefined;

    afterEach(() => {
      if (editor && !editor.isDestroyed) editor.destroy();
    });

    it('parses <sub> tags', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Subscript, Superscript],
        content: '<p>H<sub>2</sub>O</p>',
      });
      const p = editor.state.doc.child(0);
      expect(p.child(1).marks[0]?.type.name).toBe('subscript');
    });

    it('renders to <sub>', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Subscript, Superscript],
        content: '<p>H<sub>2</sub>O</p>',
      });
      expect(editor.getHTML()).toContain('<sub>2</sub>');
    });

    it('is mutually exclusive with superscript', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Subscript, Superscript],
        content: '<p><sub><sup>text</sup></sub></p>',
      });
      const textNode = editor.state.doc.child(0).child(0);
      const markNames = textNode.marks.map((m) => m.type.name);
      // Should only have one of the two (they exclude each other)
      expect(markNames.length).toBeLessThanOrEqual(1);
    });

    it('setSubscript applies subscript to selected text', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Subscript, Superscript],
        content: '<p>H2O</p>',
      });
      const { state } = editor;
      editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 2, 3)));
      editor.commands.setSubscript();
      expect(editor.getHTML()).toContain('<sub>2</sub>');
    });

    it('unsetSubscript removes subscript from selected text', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Subscript, Superscript],
        content: '<p>H<sub>2</sub>O</p>',
      });
      const { state } = editor;
      editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 2, 3)));
      editor.commands.unsetSubscript();
      expect(editor.getHTML()).not.toContain('<sub>');
    });

    it('toggleSubscript toggles on selected text', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Subscript, Superscript],
        content: '<p>H2O</p>',
      });
      const { state } = editor;
      editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 2, 3)));
      editor.commands.toggleSubscript();
      expect(editor.getHTML()).toContain('<sub>2</sub>');
    });
  });
});
