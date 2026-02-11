import { describe, it, expect, afterEach } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';
import { Blockquote } from './Blockquote.js';
import { Document } from './Document.js';
import { Text } from './Text.js';
import { Paragraph } from './Paragraph.js';
import { Editor } from '../Editor.js';

describe('Blockquote', () => {
  describe('configuration', () => {
    it('has correct name', () => {
      expect(Blockquote.name).toBe('blockquote');
    });

    it('is a node type', () => {
      expect(Blockquote.type).toBe('node');
    });

    it('belongs to block group', () => {
      expect(Blockquote.config.group).toBe('block');
    });

    it('has block+ content', () => {
      expect(Blockquote.config.content).toBe('block+');
    });

    it('is defining', () => {
      expect(Blockquote.config.defining).toBe(true);
    });

    it('has default options', () => {
      expect(Blockquote.options).toEqual({
        HTMLAttributes: {},
      });
    });
  });

  describe('parseHTML', () => {
    it('returns rule for blockquote tag', () => {
      const rules = Blockquote.config.parseHTML?.call(Blockquote);

      expect(rules).toEqual([{ tag: 'blockquote' }]);
    });
  });

  describe('renderHTML', () => {
    it('renders blockquote element', () => {
      const spec = Blockquote.createNodeSpec();
      const mockNode = { attrs: {} } as unknown as PMNode;

      const result = spec.toDOM?.(mockNode) as [string, Record<string, unknown>, number];

      expect(result[0]).toBe('blockquote');
      expect(result[2]).toBe(0);
    });

    it('merges HTMLAttributes from options', () => {
      const CustomBlockquote = Blockquote.configure({
        HTMLAttributes: { class: 'custom-quote' },
      });

      const spec = CustomBlockquote.createNodeSpec();
      const mockNode = { attrs: {} } as unknown as PMNode;

      const result = spec.toDOM?.(mockNode) as [string, Record<string, unknown>, number];

      expect(result[0]).toBe('blockquote');
      expect(result[1]).toEqual({ class: 'custom-quote' });
    });
  });

  describe('addCommands', () => {
    it('provides setBlockquote command', () => {
      const commands = Blockquote.config.addCommands?.call(Blockquote);

      expect(commands).toHaveProperty('setBlockquote');
      expect(typeof commands?.['setBlockquote']).toBe('function');
    });

    it('provides toggleBlockquote command', () => {
      const commands = Blockquote.config.addCommands?.call(Blockquote);

      expect(commands).toHaveProperty('toggleBlockquote');
      expect(typeof commands?.['toggleBlockquote']).toBe('function');
    });

    it('provides unsetBlockquote command', () => {
      const commands = Blockquote.config.addCommands?.call(Blockquote);

      expect(commands).toHaveProperty('unsetBlockquote');
      expect(typeof commands?.['unsetBlockquote']).toBe('function');
    });
  });

  describe('addKeyboardShortcuts', () => {
    it('provides Mod-Shift-b shortcut', () => {
      const shortcuts = Blockquote.config.addKeyboardShortcuts?.call(Blockquote);

      expect(shortcuts).toHaveProperty('Mod-Shift-b');
    });

    it('shortcut returns false when no editor', () => {
       
      const shortcuts = Blockquote.config.addKeyboardShortcuts?.call({
        ...Blockquote, editor: undefined, options: Blockquote.options,
      } as any);
       
      expect((shortcuts?.['Mod-Shift-b'] as any)?.()).toBe(false);
    });
  });

  describe('addInputRules', () => {
    it('returns empty array when nodeType is not available', () => {
      const rules = Blockquote.config.addInputRules?.call(Blockquote);
      expect(rules).toEqual([]);
    });
  });

  describe('integration', () => {
    let editor: Editor | undefined;

    afterEach(() => {
      if (editor && !editor.isDestroyed) {
        editor.destroy();
      }
    });

    it('works with Editor using extensions', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Blockquote],
        content: '<blockquote><p>Quote text</p></blockquote>',
      });

      expect(editor.getText()).toContain('Quote text');
    });

    it('parses blockquote correctly', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Blockquote],
        content: '<blockquote><p>Quoted</p></blockquote>',
      });

      const doc = editor.state.doc;
      expect(doc.child(0).type.name).toBe('blockquote');
      expect(doc.child(0).child(0).type.name).toBe('paragraph');
    });

    it('renders blockquote correctly', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Blockquote],
        content: '<blockquote><p>Test quote</p></blockquote>',
      });

      const html = editor.getHTML();
      expect(html).toBe('<blockquote><p>Test quote</p></blockquote>');
    });

    it('supports nested blockquotes', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Blockquote],
        content: '<blockquote><blockquote><p>Nested</p></blockquote></blockquote>',
      });

      const doc = editor.state.doc;
      expect(doc.child(0).type.name).toBe('blockquote');
      expect(doc.child(0).child(0).type.name).toBe('blockquote');
      expect(doc.child(0).child(0).child(0).type.name).toBe('paragraph');
    });

    it('setBlockquote wraps paragraph in blockquote', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Blockquote],
        content: '<p>Quote me</p>',
      });
      editor.commands.setBlockquote();
      expect(editor.state.doc.child(0).type.name).toBe('blockquote');
    });

    it('toggleBlockquote wraps and unwraps', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Blockquote],
        content: '<p>Toggle me</p>',
      });
      editor.commands.toggleBlockquote();
      expect(editor.state.doc.child(0).type.name).toBe('blockquote');
      editor.commands.toggleBlockquote();
      expect(editor.state.doc.child(0).type.name).toBe('paragraph');
    });

    it('unsetBlockquote lifts out of blockquote', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Blockquote],
        content: '<blockquote><p>Lift me</p></blockquote>',
      });
      editor.commands.unsetBlockquote();
      expect(editor.state.doc.child(0).type.name).toBe('paragraph');
    });

    it('can contain multiple paragraphs', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Blockquote],
        content: '<blockquote><p>First</p><p>Second</p></blockquote>',
      });

      const doc = editor.state.doc;
      const blockquote = doc.child(0);
      expect(blockquote.type.name).toBe('blockquote');
      expect(blockquote.childCount).toBe(2);
    });
  });
});
