import { describe, it, expect, afterEach } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';
import { CodeBlock } from './CodeBlock.js';
import { Document } from './Document.js';
import { Text } from './Text.js';
import { Paragraph } from './Paragraph.js';
import { Editor } from '../Editor.js';

describe('CodeBlock', () => {
  describe('configuration', () => {
    it('has correct name', () => {
      expect(CodeBlock.name).toBe('codeBlock');
    });

    it('is a node type', () => {
      expect(CodeBlock.type).toBe('node');
    });

    it('belongs to block group', () => {
      expect(CodeBlock.config.group).toBe('block');
    });

    it('has text* content', () => {
      expect(CodeBlock.config.content).toBe('text*');
    });

    it('disallows marks', () => {
      expect(CodeBlock.config.marks).toBe('');
    });

    it('is a code block', () => {
      expect(CodeBlock.config.code).toBe(true);
    });

    it('is defining', () => {
      expect(CodeBlock.config.defining).toBe(true);
    });

    it('has default options', () => {
      expect(CodeBlock.options).toEqual({
        languageClassPrefix: 'language-',
        HTMLAttributes: {},
        exitOnTripleEnter: true,
      });
    });

    it('can configure language prefix', () => {
      const CustomCodeBlock = CodeBlock.configure({ languageClassPrefix: 'lang-' });
      expect(CustomCodeBlock.options.languageClassPrefix).toBe('lang-');
    });
  });

  describe('parseHTML', () => {
    it('returns rule for pre tag', () => {
      const rules = CodeBlock.config.parseHTML?.call(CodeBlock);

      expect(rules).toHaveLength(1);
      const rule = rules?.[0];
      expect(rule?.tag).toBe('pre');
      expect(rule?.preserveWhitespace).toBe('full');
    });
  });

  describe('renderHTML', () => {
    it('renders pre > code structure', () => {
      const spec = CodeBlock.createNodeSpec();
      const mockNode = { attrs: { language: null } } as unknown as PMNode;

      const result = spec.toDOM?.(mockNode) as [string, Record<string, unknown>, [string, Record<string, unknown>, number]];

      expect(result[0]).toBe('pre');
      expect(result[2][0]).toBe('code');
      expect(result[2][2]).toBe(0);
    });

    it('adds language class to code element', () => {
      const spec = CodeBlock.createNodeSpec();
      const mockNode = { attrs: { language: 'javascript' } } as unknown as PMNode;

      const result = spec.toDOM?.(mockNode) as [string, Record<string, unknown>, [string, Record<string, unknown>, number]];

      expect(result[2][1]).toEqual({ class: 'language-javascript' });
    });

    it('uses custom language prefix', () => {
      const CustomCodeBlock = CodeBlock.configure({ languageClassPrefix: 'lang-' });
      const spec = CustomCodeBlock.createNodeSpec();
      const mockNode = { attrs: { language: 'typescript' } } as unknown as PMNode;

      const result = spec.toDOM?.(mockNode) as [string, Record<string, unknown>, [string, Record<string, unknown>, number]];

      expect(result[2][1]).toEqual({ class: 'lang-typescript' });
    });

    it('omits class when no language', () => {
      const spec = CodeBlock.createNodeSpec();
      const mockNode = { attrs: { language: null } } as unknown as PMNode;

      const result = spec.toDOM?.(mockNode) as [string, Record<string, unknown>, [string, Record<string, unknown>, number]];

      expect(result[2][1]).toEqual({});
    });
  });

  describe('addCommands', () => {
    it('provides setCodeBlock command', () => {
      const commands = CodeBlock.config.addCommands?.call(CodeBlock);

      expect(commands).toHaveProperty('setCodeBlock');
      expect(typeof commands?.['setCodeBlock']).toBe('function');
    });

    it('provides toggleCodeBlock command', () => {
      const commands = CodeBlock.config.addCommands?.call(CodeBlock);

      expect(commands).toHaveProperty('toggleCodeBlock');
      expect(typeof commands?.['toggleCodeBlock']).toBe('function');
    });
  });

  describe('addKeyboardShortcuts', () => {
    it('provides Mod-Alt-c shortcut', () => {
      const shortcuts = CodeBlock.config.addKeyboardShortcuts?.call(CodeBlock);

      expect(shortcuts).toHaveProperty('Mod-Alt-c');
    });
  });

  describe('addInputRules', () => {
    it('returns empty array when nodeType is not available', () => {
      const rules = CodeBlock.config.addInputRules?.call(CodeBlock);
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
        extensions: [Document, Text, Paragraph, CodeBlock],
        content: '<pre><code>const x = 1;</code></pre>',
      });

      expect(editor.getText()).toContain('const x = 1;');
    });

    it('parses code block correctly', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, CodeBlock],
        content: '<pre><code>code here</code></pre>',
      });

      const doc = editor.state.doc;
      expect(doc.child(0).type.name).toBe('codeBlock');
    });

    it('extracts language from class', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, CodeBlock],
        content: '<pre><code class="language-javascript">const x = 1;</code></pre>',
      });

      const doc = editor.state.doc;
      expect(doc.child(0).attrs['language']).toBe('javascript');
    });

    it('renders with language class', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, CodeBlock],
        content: '<pre><code class="language-python">print("hello")</code></pre>',
      });

      const html = editor.getHTML();
      expect(html).toContain('language-python');
      expect(html).toContain('print("hello")');
    });

    it('preserves whitespace', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, CodeBlock],
        content: '<pre><code>line1\n  line2\n    line3</code></pre>',
      });

      const text = editor.getText();
      expect(text).toContain('line1');
      expect(text).toContain('line2');
      expect(text).toContain('line3');
    });

    it('renders without language when not set', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, CodeBlock],
        content: '<pre><code>plain code</code></pre>',
      });

      const html = editor.getHTML();
      expect(html).toBe('<pre><code>plain code</code></pre>');
    });
  });
});
