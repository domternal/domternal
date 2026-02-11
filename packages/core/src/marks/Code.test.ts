import { describe, it, expect, afterEach } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import { Code } from './Code.js';
import { Bold } from './Bold.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Editor } from '../Editor.js';

describe('Code', () => {
  describe('configuration', () => {
    it('has correct name', () => {
      expect(Code.name).toBe('code');
    });

    it('is a mark type', () => {
      expect(Code.type).toBe('mark');
    });

    it('has default options', () => {
      expect(Code.options).toEqual({ HTMLAttributes: {} });
    });

    it('excludes all other marks', () => {
      expect(Code.config.excludes).toBe('_');
    });

    it('does not span across nodes', () => {
      expect(Code.config.spanning).toBe(false);
    });
  });

  describe('parseHTML', () => {
    it('returns rule for code tag', () => {
      const rules = Code.config.parseHTML?.call(Code);
      expect(rules).toHaveLength(1);
      expect(rules?.[0]).toEqual({ tag: 'code' });
    });
  });

  describe('renderHTML', () => {
    it('renders code element', () => {
      const spec = Code.createMarkSpec();
      const result = spec.toDOM?.({ attrs: {} } as never, true) as [string, Record<string, unknown>, number];
      expect(result[0]).toBe('code');
      expect(result[2]).toBe(0);
    });
  });

  describe('addCommands', () => {
    it('provides setCode, unsetCode, toggleCode', () => {
      const commands = Code.config.addCommands?.call(Code);
      expect(commands).toHaveProperty('setCode');
      expect(commands).toHaveProperty('unsetCode');
      expect(commands).toHaveProperty('toggleCode');
    });
  });

  describe('addKeyboardShortcuts', () => {
    it('provides Mod-e and Mod-E shortcuts', () => {
      const shortcuts = Code.config.addKeyboardShortcuts?.call(Code);
      expect(shortcuts).toHaveProperty('Mod-e');
      expect(shortcuts).toHaveProperty('Mod-E');
    });

    it('shortcuts return false when no editor', () => {
      const shortcuts = Code.config.addKeyboardShortcuts?.call({
        ...Code, editor: undefined, options: Code.options,
      } as any);
       
      expect((shortcuts?.['Mod-e'] as any)?.()).toBe(false);
       
      expect((shortcuts?.['Mod-E'] as any)?.()).toBe(false);
    });
  });

  describe('addInputRules', () => {
    it('returns empty array when no markType', () => {
      const rules = Code.config.addInputRules?.call(Code);
      expect(rules).toEqual([]);
    });
  });

  describe('integration', () => {
    let editor: Editor | undefined;

    afterEach(() => {
      if (editor && !editor.isDestroyed) editor.destroy();
    });

    it('parses <code> tags', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Code],
        content: '<p><code>inline code</code></p>',
      });
      const textNode = editor.state.doc.child(0).child(0);
      expect(textNode.marks[0]?.type.name).toBe('code');
    });

    it('renders to <code>', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Code],
        content: '<p><code>code</code></p>',
      });
      expect(editor.getHTML()).toContain('<code>code</code>');
    });

    it('excludes other marks (code is exclusive)', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Code, Bold],
        content: '<p><code><strong>bold code</strong></code></p>',
      });
      const textNode = editor.state.doc.child(0).child(0);
      // Code excludes all, so bold should be stripped
      const markNames = textNode.marks.map((m) => m.type.name);
      expect(markNames).toContain('code');
      expect(markNames).not.toContain('bold');
    });

    it('setCode applies code to selected text', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Code],
        content: '<p>Hello world</p>',
      });
      const { state } = editor;
      editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 1, 6)));
      editor.commands.setCode();
      expect(editor.getHTML()).toContain('<code>Hello</code>');
    });

    it('unsetCode removes code from selected text', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Code],
        content: '<p><code>Hello</code> world</p>',
      });
      const { state } = editor;
      editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 1, 6)));
      editor.commands.unsetCode();
      expect(editor.getHTML()).not.toContain('<code>');
    });

    it('toggleCode toggles on selected text', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Code],
        content: '<p>Hello world</p>',
      });
      const { state } = editor;
      editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 1, 6)));
      editor.commands.toggleCode();
      expect(editor.getHTML()).toContain('<code>Hello</code>');
    });
  });
});
