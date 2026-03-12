import { describe, it, expect, afterEach } from 'vitest';
import { TextSelection } from '@domternal/pm/state';
import { Superscript } from './Superscript.js';
import { Subscript } from './Subscript.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Editor } from '../Editor.js';

describe('Superscript', () => {
  describe('configuration', () => {
    it('has correct name', () => {
      expect(Superscript.name).toBe('superscript');
    });

    it('is a mark type', () => {
      expect(Superscript.type).toBe('mark');
    });

    it('does not use schema-level excludes (handled in commands)', () => {
      expect(Superscript.config.excludes).toBe('');
    });

    it('has default options', () => {
      expect(Superscript.options).toEqual({ HTMLAttributes: {} });
    });
  });

  describe('parseHTML', () => {
    it('returns rules for sup and vertical-align', () => {
      const rules = Superscript.config.parseHTML?.call(Superscript);
      expect(rules).toHaveLength(2);
      expect(rules?.[0]).toEqual({ tag: 'sup' });
      expect(rules?.[1]).toHaveProperty('style', 'vertical-align');
    });

    it('accepts vertical-align super', () => {
      const rules = Superscript.config.parseHTML?.call(Superscript);
      const getAttrs = rules?.[1]?.getAttrs;
      expect(getAttrs?.('super')).toEqual({});
    });

    it('rejects vertical-align sub', () => {
      const rules = Superscript.config.parseHTML?.call(Superscript);
      const getAttrs = rules?.[1]?.getAttrs;
      expect(getAttrs?.('sub')).toBe(false);
    });
  });

  describe('renderHTML', () => {
    it('renders sup element', () => {
      const spec = Superscript.createMarkSpec();
      const result = spec.toDOM?.({ attrs: {} } as never, true) as [string, Record<string, unknown>, number];
      expect(result[0]).toBe('sup');
      expect(result[2]).toBe(0);
    });
  });

  describe('addCommands', () => {
    it('provides setSuperscript, unsetSuperscript, toggleSuperscript', () => {
      const commands = Superscript.config.addCommands?.call(Superscript);
      expect(commands).toHaveProperty('setSuperscript');
      expect(commands).toHaveProperty('unsetSuperscript');
      expect(commands).toHaveProperty('toggleSuperscript');
    });
  });

  describe('addKeyboardShortcuts', () => {
    it('provides Mod-. shortcut', () => {
      const shortcuts = Superscript.config.addKeyboardShortcuts?.call(Superscript);
      expect(shortcuts).toHaveProperty('Mod-.');
    });

    it('shortcut returns false when no editor', () => {
      const shortcuts = Superscript.config.addKeyboardShortcuts?.call({
        ...Superscript, editor: undefined, options: Superscript.options,
      } as any);
       
      expect((shortcuts?.['Mod-.'] as any)?.()).toBe(false);
    });
  });

  describe('integration', () => {
    let editor: Editor | undefined;

    afterEach(() => {
      if (editor && !editor.isDestroyed) editor.destroy();
    });

    it('parses <sup> tags', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Superscript, Subscript],
        content: '<p>x<sup>2</sup></p>',
      });
      const p = editor.state.doc.child(0);
      expect(p.child(1).marks[0]?.type.name).toBe('superscript');
    });

    it('renders to <sup>', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Superscript, Subscript],
        content: '<p>x<sup>2</sup></p>',
      });
      expect(editor.getHTML()).toContain('<sup>2</sup>');
    });

    it('setSuperscript applies superscript to selected text', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Superscript, Subscript],
        content: '<p>x2</p>',
      });
      const { state } = editor;
      editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 2, 3)));
      editor.commands.setSuperscript();
      expect(editor.getHTML()).toContain('<sup>2</sup>');
    });

    it('unsetSuperscript removes superscript from selected text', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Superscript, Subscript],
        content: '<p>x<sup>2</sup></p>',
      });
      const { state } = editor;
      editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 2, 3)));
      editor.commands.unsetSuperscript();
      expect(editor.getHTML()).not.toContain('<sup>');
    });

    it('toggleSuperscript toggles on selected text', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Superscript, Subscript],
        content: '<p>x2</p>',
      });
      const { state } = editor;
      editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 2, 3)));
      editor.commands.toggleSuperscript();
      expect(editor.getHTML()).toContain('<sup>2</sup>');
    });
  });
});
