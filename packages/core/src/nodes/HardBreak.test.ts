import { describe, it, expect, afterEach } from 'vitest';
import type { Node as PMNode } from '@domternal/pm/model';
import { HardBreak } from './HardBreak.js';
import { Document } from './Document.js';
import { Text } from './Text.js';
import { Paragraph } from './Paragraph.js';
import { Editor } from '../Editor.js';

describe('HardBreak', () => {
  describe('configuration', () => {
    it('has correct name', () => {
      expect(HardBreak.name).toBe('hardBreak');
    });

    it('is a node type', () => {
      expect(HardBreak.type).toBe('node');
    });

    it('belongs to inline group', () => {
      expect(HardBreak.config.group).toBe('inline');
    });

    it('is inline', () => {
      expect(HardBreak.config.inline).toBe(true);
    });

    it('is not selectable', () => {
      expect(HardBreak.config.selectable).toBe(false);
    });

    it('has default options', () => {
      expect(HardBreak.options).toEqual({
        HTMLAttributes: {},
      });
    });

    it('can configure HTMLAttributes', () => {
      const CustomBreak = HardBreak.configure({
        HTMLAttributes: { class: 'line-break' },
      });
      expect(CustomBreak.options.HTMLAttributes).toEqual({ class: 'line-break' });
    });
  });

  describe('parseHTML', () => {
    it('returns rule for br tag', () => {
      const rules = HardBreak.config.parseHTML?.call(HardBreak);

      expect(rules).toEqual([{ tag: 'br' }]);
    });
  });

  describe('renderHTML', () => {
    it('renders br element', () => {
      const spec = HardBreak.createNodeSpec();
      const mockNode = { attrs: {} } as unknown as PMNode;

      const result = spec.toDOM?.(mockNode) as [string, Record<string, unknown>];

      expect(result[0]).toBe('br');
    });

    it('merges HTMLAttributes from options', () => {
      const CustomBreak = HardBreak.configure({
        HTMLAttributes: { class: 'styled-br' },
      });

      const spec = CustomBreak.createNodeSpec();
      const mockNode = { attrs: {} } as unknown as PMNode;

      const result = spec.toDOM?.(mockNode) as [string, Record<string, unknown>];

      expect(result[0]).toBe('br');
      expect(result[1]).toEqual({ class: 'styled-br' });
    });
  });

  describe('addCommands', () => {
    it('provides setHardBreak command', () => {
      const commands = HardBreak.config.addCommands?.call(HardBreak);

      expect(commands).toHaveProperty('setHardBreak');
      expect(typeof commands?.['setHardBreak']).toBe('function');
    });
  });

  describe('addKeyboardShortcuts', () => {
    it('provides Mod-Enter shortcut', () => {
      const shortcuts = HardBreak.config.addKeyboardShortcuts?.call(HardBreak);

      expect(shortcuts).toHaveProperty('Mod-Enter');
    });

    it('provides Shift-Enter shortcut', () => {
      const shortcuts = HardBreak.config.addKeyboardShortcuts?.call(HardBreak);

      expect(shortcuts).toHaveProperty('Shift-Enter');
    });

    it('Mod-Enter returns false when no editor', () => {
       
      const shortcuts = HardBreak.config.addKeyboardShortcuts?.call({
        ...HardBreak, editor: undefined, options: HardBreak.options,
      } as any);
       
      expect((shortcuts?.['Mod-Enter'] as any)?.()).toBe(false);
    });

    it('Shift-Enter returns false when no editor', () => {
       
      const shortcuts = HardBreak.config.addKeyboardShortcuts?.call({
        ...HardBreak, editor: undefined, options: HardBreak.options,
      } as any);
       
      expect((shortcuts?.['Shift-Enter'] as any)?.()).toBe(false);
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
        extensions: [Document, Text, Paragraph, HardBreak],
        content: '<p>Line one<br>Line two</p>',
      });

      expect(editor.getText()).toContain('Line one');
      expect(editor.getText()).toContain('Line two');
    });

    it('parses hard break correctly', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, HardBreak],
        content: '<p>First<br>Second</p>',
      });

      const doc = editor.state.doc;
      const paragraph = doc.child(0);
      expect(paragraph.type.name).toBe('paragraph');

      // Paragraph should contain: text, hardBreak, text
      let hasHardBreak = false;
      paragraph.forEach((node) => {
        if (node.type.name === 'hardBreak') {
          hasHardBreak = true;
        }
      });
      expect(hasHardBreak).toBe(true);
    });

    it('renders hard break correctly', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, HardBreak],
        content: '<p>Test<br>Break</p>',
      });

      const html = editor.getHTML();
      expect(html).toContain('<br>');
    });

    it('is inline element inside paragraph', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, HardBreak],
        content: '<p>A<br>B</p>',
      });

      const doc = editor.state.doc;
      expect(doc.childCount).toBe(1);
      expect(doc.child(0).type.name).toBe('paragraph');
    });

    it('setHardBreak inserts a break', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, HardBreak],
        content: '<p>Hello world</p>',
      });

      editor.commands.setSelection(6);
      editor.commands.setHardBreak();

      const html = editor.getHTML();
      expect(html).toContain('<br>');
    });
  });
});
