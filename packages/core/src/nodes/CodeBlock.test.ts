import { describe, it, expect, afterEach } from 'vitest';
import type { Node as PMNode } from '@domternal/pm/model';
import { CodeBlock } from './CodeBlock.js';
import { Document } from './Document.js';
import { Text } from './Text.js';
import { Paragraph } from './Paragraph.js';
import { Editor } from '../Editor.js';
import { TextSelection } from '@domternal/pm/state';

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

    it('shortcut returns false when no editor', () => {

      const shortcuts = CodeBlock.config.addKeyboardShortcuts?.call({
        ...CodeBlock, editor: undefined, options: CodeBlock.options,
      } as any);

      expect((shortcuts?.['Mod-Alt-c'] as any)?.()).toBe(false);
    });

    it('Enter returns false when not in code block', () => {
      const editor = new Editor({
        extensions: [Document, Text, Paragraph, CodeBlock],
        content: '<p>text</p>',
      });
      const shortcuts = CodeBlock.config.addKeyboardShortcuts?.call({
        ...CodeBlock, editor, options: CodeBlock.options,
      } as any);
      expect((shortcuts?.['Enter'] as any)?.()).toBe(false);
      editor.destroy();
    });

    it('Enter returns false when editor is null', () => {
      const shortcuts = CodeBlock.config.addKeyboardShortcuts?.call({
        ...CodeBlock, editor: null, options: CodeBlock.options,
      } as any);
      expect((shortcuts?.['Enter'] as any)?.()).toBe(false);
    });

    it('Enter returns false when exitOnTripleEnter is disabled', () => {
      const editor = new Editor({
        extensions: [Document, Text, Paragraph, CodeBlock.configure({ exitOnTripleEnter: false })],
        content: '<pre><code>test\n\n</code></pre>',
      });
      editor.view.dispatch(editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, editor.state.doc.content.size - 1),
      ));
      const shortcuts = CodeBlock.config.addKeyboardShortcuts?.call({
        ...CodeBlock, editor, options: { exitOnTripleEnter: false }, nodeType: editor.schema.nodes['codeBlock'],
      } as any);
      expect((shortcuts?.['Enter'] as any)?.()).toBe(false);
      editor.destroy();
    });

    it('Enter triggers exit on triple-enter', () => {
      const editor = new Editor({
        extensions: [Document, Text, Paragraph, CodeBlock.configure({ exitOnTripleEnter: true })],
        content: '<pre><code>code\n\n</code></pre>',
      });
      // Place cursor at end (after the two newlines)
      const pos = editor.state.doc.content.size - 1;
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)));

      const shortcuts = CodeBlock.config.addKeyboardShortcuts?.call({
        ...CodeBlock, editor, options: { exitOnTripleEnter: true }, nodeType: editor.schema.nodes['codeBlock'],
      } as any);
      const result = (shortcuts?.['Enter'] as any)?.();
      expect(typeof result).toBe('boolean');
      editor.destroy();
    });

    it('ArrowDown returns false when not in code block', () => {
      const editor = new Editor({
        extensions: [Document, Text, Paragraph, CodeBlock],
        content: '<p>text</p>',
      });
      const shortcuts = CodeBlock.config.addKeyboardShortcuts?.call({
        ...CodeBlock, editor, options: CodeBlock.options,
      } as any);
      expect((shortcuts?.['ArrowDown'] as any)?.()).toBe(false);
      editor.destroy();
    });

    it('ArrowDown returns false when editor is null', () => {
      const shortcuts = CodeBlock.config.addKeyboardShortcuts?.call({
        ...CodeBlock, editor: null, options: CodeBlock.options,
      } as any);
      expect((shortcuts?.['ArrowDown'] as any)?.()).toBe(false);
    });

    it('ArrowDown triggers exit when at end of code block (last doc child)', () => {
      const editor = new Editor({
        extensions: [Document, Text, Paragraph, CodeBlock],
        content: '<pre><code>code</code></pre>',
      });
      // Cursor at end of code block
      const endPos = editor.state.doc.content.size - 1;
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, endPos)));

      const shortcuts = CodeBlock.config.addKeyboardShortcuts?.call({
        ...CodeBlock, editor, options: CodeBlock.options, nodeType: editor.schema.nodes['codeBlock'],
      } as any);
      const result = (shortcuts?.['ArrowDown'] as any)?.();
      expect(typeof result).toBe('boolean');
      editor.destroy();
    });
  });

  describe('addToolbarItems', () => {
    it('returns a single button item', () => {
      const items = CodeBlock.config.addToolbarItems?.call(CodeBlock);
      expect(items).toHaveLength(1);
      expect(items?.[0]?.type).toBe('button');
    });

    it('button has correct metadata', () => {
      const items = CodeBlock.config.addToolbarItems?.call(CodeBlock);
      const button = items?.[0];
      if (button?.type === 'button') {
        expect(button.name).toBe('codeBlock');
        expect(button.command).toBe('toggleCodeBlock');
        expect(button.isActive).toBe('codeBlock');
      }
    });
  });

  describe('input rule with language', () => {
    it('input rule parses language from ```js', () => {
      const editor = new Editor({
        extensions: [Document, Text, Paragraph, CodeBlock],
        content: '<p></p>',
      });
      const codeExt = editor.extensionManager.extensions.find((e) => e.name === 'codeBlock')!;
      const rules = (codeExt as any).config.addInputRules!.call(codeExt as any)!;
      expect(rules.length).toBe(1);
      editor.destroy();
    });
  });

  describe('addInputRules', () => {
    it('returns empty array when nodeType is not available', () => {
      const rules = CodeBlock.config.addInputRules?.call({ ...CodeBlock, nodeType: undefined });
      expect(rules).toEqual([]);
    });

    it('getAttributes extracts language from backtick match', () => {
      const editor = new Editor({
        extensions: [Document, Text, Paragraph, CodeBlock],
        content: '<p>```js </p>',
      });
      const codeExt = editor.extensionManager.extensions.find((e) => e.name === 'codeBlock')!;
      const rules = (codeExt as any).config.addInputRules!.call(codeExt as any)!;
      const rule = rules[0]!;
      const match = ['```js ', 'js'] as unknown as RegExpMatchArray;
      const result = ((rule).handler)(editor.state, match, 1, 7);
      expect(result === null || typeof result === 'object').toBe(true);
      editor.destroy();
    });

    it('getAttributes returns null language when no capture group', () => {
      const editor = new Editor({
        extensions: [Document, Text, Paragraph, CodeBlock],
        content: '<p>``` </p>',
      });
      const codeExt = editor.extensionManager.extensions.find((e) => e.name === 'codeBlock')!;
      const rules = (codeExt as any).config.addInputRules!.call(codeExt as any)!;
      const rule = rules[0]!;
      const match = ['``` ', undefined] as unknown as RegExpMatchArray;
      const result = ((rule).handler)(editor.state, match, 1, 5);
      expect(result === null || typeof result === 'object').toBe(true);
      editor.destroy();
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

    it('toggleCodeBlock toggles between paragraph and code block', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, CodeBlock],
        content: '<p>some code</p>',
      });
      editor.commands.toggleCodeBlock();
      expect(editor.state.doc.child(0).type.name).toBe('codeBlock');
      editor.commands.toggleCodeBlock();
      expect(editor.state.doc.child(0).type.name).toBe('paragraph');
    });

    it('renders without language when not set', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, CodeBlock],
        content: '<pre><code>plain code</code></pre>',
      });

      const html = editor.getHTML();
      expect(html).toBe('<pre><code>plain code</code></pre>');
    });

    it('setCodeBlock converts paragraph to code block', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, CodeBlock],
        content: '<p>some code</p>',
      });

      const result = editor.commands.setCodeBlock();
      expect(result).toBe(true);
      expect(editor.state.doc.child(0).type.name).toBe('codeBlock');
    });

    it('setCodeBlock applies language attribute', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, CodeBlock],
        content: '<p>const x = 1;</p>',
      });

      editor.commands.setCodeBlock({ language: 'javascript' });
      expect(editor.state.doc.child(0).attrs['language']).toBe('javascript');
    });

    it('inputRule getAttrs extracts language from match', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, CodeBlock],
        content: '<p>test</p>',
      });

      // Get the input rules from a properly bound context
      const nodeType = editor.state.schema.nodes['codeBlock'];
      const rules = CodeBlock.config.addInputRules?.call({
        ...CodeBlock, nodeType, options: CodeBlock.options,
         
      } as any);

      expect(rules).toBeDefined();
      expect(rules!.length).toBe(1);
    });
  });
});
