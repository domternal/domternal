import { describe, it, expect, afterEach } from 'vitest';
import { TextSelection } from '@domternal/pm/state';
import { Code } from './Code.js';
import { Bold } from './Bold.js';
import { Link } from './Link.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Editor } from '../Editor.js';
import { Mark } from '../Mark.js';

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

    it('excludes the formatting mark group', () => {
      expect(Code.config.excludes).toBe('formatting');
      expect(Code.config.group).toBe('formatting');
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
    it('provides Mod-e shortcut', () => {
      const shortcuts = Code.config.addKeyboardShortcuts?.call(Code);
      expect(shortcuts).toHaveProperty('Mod-e');
    });

    it('shortcuts return false when no editor', () => {
      const shortcuts = Code.config.addKeyboardShortcuts?.call({
        ...Code, editor: undefined, options: Code.options,
      } as any);
       
      expect((shortcuts?.['Mod-e'] as any)?.()).toBe(false);
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
      // Code excludes the formatting group, so bold should be stripped
      const markNames = textNode.marks.map((m) => m.type.name);
      expect(markNames).toContain('code');
      expect(markNames).not.toContain('bold');
    });

    it('constructs with a minimal schema (group excludes resolve safely)', () => {
      // A name-list excludes would throw 'Unknown mark type' here; the
      // group form must resolve to just [code] in a Code-only schema.
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Code],
        content: '<p>hello</p>',
      });
      const codeType = editor.state.schema.marks['code'];
      expect(codeType).toBeDefined();
      expect(codeType?.excludes(codeType)).toBe(true);
    });

    it('semantic marks outside the formatting group survive setCode', () => {
      const Note = Mark.create({
        name: 'note',
        isFormatting: false,
        addAttributes() {
          return { ids: { default: [] } };
        },
        parseHTML() {
          return [{ tag: 'span[data-note]' }];
        },
        renderHTML() {
          return ['span', { 'data-note': 'true' }, 0];
        },
      });
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Code, Bold, Note],
        content: '<p><span data-note="true">Hello</span> world</p>',
      });
      const { state } = editor;
      editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 1, 6)));
      editor.commands.setCode();
      const textNode = editor.state.doc.child(0).child(0);
      const markNames = textNode.marks.map((m) => m.type.name).sort();
      expect(markNames).toEqual(['code', 'note']);
    });

    it('links survive setCode', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Code, Link],
        content: '<p><a href="https://example.com">Hello</a> world</p>',
      });
      const { state } = editor;
      editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 1, 6)));
      editor.commands.setCode();
      const textNode = editor.state.doc.child(0).child(0);
      const markNames = textNode.marks.map((m) => m.type.name).sort();
      expect(markNames).toEqual(['code', 'link']);
    });

    it('compiled schema excludes formatting marks but not semantic ones', () => {
      const Note = Mark.create({
        name: 'note',
        isFormatting: false,
        parseHTML() {
          return [{ tag: 'span[data-note]' }];
        },
        renderHTML() {
          return ['span', { 'data-note': 'true' }, 0];
        },
      });
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Code, Bold, Note],
        content: '<p>hello</p>',
      });
      const { marks } = editor.state.schema;
      const codeType = marks['code'];
      const boldType = marks['bold'];
      const noteType = marks['note'];
      if (!codeType || !boldType || !noteType) throw new Error('Schema is missing marks');
      expect(codeType.excludes(boldType)).toBe(true);
      expect(codeType.excludes(noteType)).toBe(false);
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
