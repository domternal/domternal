import { describe, it, expect, afterEach } from 'vitest';
import { createLowlight, common } from 'lowlight';
import { CodeBlockLowlight } from './CodeBlockLowlight.js';
import { lowlightPluginKey } from './lowlightPlugin.js';
import { generateHighlightedHTML } from './generateHighlightedHTML.js';
import { Document, Text, Paragraph, Editor, CodeBlock } from '@domternal/core';
import type { DecorationSet } from '@domternal/pm/view';

const lowlight = createLowlight(common);

describe('CodeBlockLowlight', () => {
  describe('configuration', () => {
    it('has correct name (inherits codeBlock)', () => {
      expect(CodeBlockLowlight.name).toBe('codeBlock');
    });

    it('is a node type', () => {
      expect(CodeBlockLowlight.type).toBe('node');
    });

    it('has default options including parent options', () => {
      expect(CodeBlockLowlight.options.languageClassPrefix).toBe('language-');
      expect(CodeBlockLowlight.options.HTMLAttributes).toEqual({});
      expect(CodeBlockLowlight.options.exitOnTripleEnter).toBe(true);
    });

    it('has lowlight-specific default options', () => {
      expect(CodeBlockLowlight.options.defaultLanguage).toBeNull();
      expect(CodeBlockLowlight.options.autoDetect).toBe(true);
      expect(CodeBlockLowlight.options.tabIndentation).toBe(true);
      expect(CodeBlockLowlight.options.tabSize).toBe(2);
    });

    it('can configure lowlight instance', () => {
      const configured = CodeBlockLowlight.configure({ lowlight });
      expect(configured.options.lowlight).toBe(lowlight);
    });

    it('can configure defaultLanguage', () => {
      const configured = CodeBlockLowlight.configure({ lowlight, defaultLanguage: 'javascript' });
      expect(configured.options.defaultLanguage).toBe('javascript');
    });

    it('can configure autoDetect', () => {
      const configured = CodeBlockLowlight.configure({ lowlight, autoDetect: true });
      expect(configured.options.autoDetect).toBe(true);
    });

    it('can configure tabSize', () => {
      const configured = CodeBlockLowlight.configure({ lowlight, tabSize: 4 });
      expect(configured.options.tabSize).toBe(4);
    });

    it('can disable tab indentation', () => {
      const configured = CodeBlockLowlight.configure({ lowlight, tabIndentation: false });
      expect(configured.options.tabIndentation).toBe(false);
    });
  });

  describe('plugin validation', () => {
    it('throws when lowlight not provided', async () => {
      const { lowlightPlugin } = await import('./lowlightPlugin.js');
      expect(() => {
        lowlightPlugin({
          name: 'codeBlock',
          lowlight: null as any,
          defaultLanguage: null,
          autoDetect: false,
        });
      }).toThrow('lowlight');
    });

    it('throws when lowlight is null', async () => {
      const { lowlightPlugin } = await import('./lowlightPlugin.js');
      expect(() => {
        lowlightPlugin({
          name: 'codeBlock',
          lowlight: null,
          defaultLanguage: null,
          autoDetect: false,
        });
      }).toThrow('lowlight');
    });
  });

  describe('integration', () => {
    let editor: Editor | undefined;

    afterEach(() => {
      if (editor && !editor.isDestroyed) {
        editor.destroy();
      }
    });

    it('works with Editor', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, CodeBlockLowlight.configure({ lowlight })],
        content: '<pre><code>const x = 1;</code></pre>',
      });

      expect(editor.getText()).toContain('const x = 1;');
    });

    it('parses code block correctly', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, CodeBlockLowlight.configure({ lowlight })],
        content: '<pre><code>code here</code></pre>',
      });

      expect(editor.state.doc.child(0).type.name).toBe('codeBlock');
    });

    it('preserves language attribute', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, CodeBlockLowlight.configure({ lowlight })],
        content: '<pre><code class="language-javascript">const x = 1;</code></pre>',
      });

      expect(editor.state.doc.child(0).attrs['language']).toBe('javascript');
    });

    it('setCodeBlock command works', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, CodeBlockLowlight.configure({ lowlight })],
        content: '<p>some code</p>',
      });

      const result = editor.commands.setCodeBlock();
      expect(result).toBe(true);
      expect(editor.state.doc.child(0).type.name).toBe('codeBlock');
    });

    it('toggleCodeBlock command works', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, CodeBlockLowlight.configure({ lowlight })],
        content: '<p>some code</p>',
      });

      editor.commands.toggleCodeBlock();
      expect(editor.state.doc.child(0).type.name).toBe('codeBlock');

      editor.commands.toggleCodeBlock();
      expect(editor.state.doc.child(0).type.name).toBe('paragraph');
    });

    it('renders with language class', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, CodeBlockLowlight.configure({ lowlight })],
        content: '<pre><code class="language-python">print("hello")</code></pre>',
      });

      const html = editor.getHTML();
      expect(html).toContain('language-python');
    });
  });

  describe('highlighting (decorations)', () => {
    let editor: Editor | undefined;

    afterEach(() => {
      if (editor && !editor.isDestroyed) {
        editor.destroy();
      }
    });

    it('creates decorations for registered languages', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, CodeBlockLowlight.configure({ lowlight })],
        content: '<pre><code class="language-javascript">const x = 1;</code></pre>',
      });

      const decoSet = lowlightPluginKey.getState(editor.state) as DecorationSet;
      const decos = decoSet.find();
      expect(decos.length).toBeGreaterThan(0);
    });

    it('decoration classes contain hljs prefixes', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, CodeBlockLowlight.configure({ lowlight })],
        content: '<pre><code class="language-javascript">const x = 1;</code></pre>',
      });

      const decoSet = lowlightPluginKey.getState(editor.state) as DecorationSet;
      const decos = decoSet.find();
      const classes = decos.map((d) => (d as any).type.attrs.class as string);
      expect(classes.some((c) => c.includes('hljs-'))).toBe(true);
    });

    it('no decorations when language not registered and autoDetect=false', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, CodeBlockLowlight.configure({ lowlight, autoDetect: false })],
        content: '<pre><code class="language-nonexistent">some code</code></pre>',
      });

      const decoSet = lowlightPluginKey.getState(editor.state) as DecorationSet;
      const decos = decoSet.find();
      expect(decos.length).toBe(0);
    });

    it('no decorations when no language and autoDetect=false', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, CodeBlockLowlight.configure({ lowlight, autoDetect: false })],
        content: '<pre><code>const x = 1;</code></pre>',
      });

      const decoSet = lowlightPluginKey.getState(editor.state) as DecorationSet;
      const decos = decoSet.find();
      expect(decos.length).toBe(0);
    });

    it('creates decorations with autoDetect=true and no language', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, CodeBlockLowlight.configure({ lowlight, autoDetect: true })],
        content: '<pre><code>function hello() { return "world"; }</code></pre>',
      });

      const decoSet = lowlightPluginKey.getState(editor.state) as DecorationSet;
      const decos = decoSet.find();
      expect(decos.length).toBeGreaterThan(0);
    });

    it('creates decorations with defaultLanguage', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, CodeBlockLowlight.configure({ lowlight, defaultLanguage: 'javascript' })],
        content: '<pre><code>const x = 1;</code></pre>',
      });

      const decoSet = lowlightPluginKey.getState(editor.state) as DecorationSet;
      const decos = decoSet.find();
      expect(decos.length).toBeGreaterThan(0);
    });

    it('decorations update when content changes', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, CodeBlockLowlight.configure({ lowlight })],
        content: '<pre><code class="language-javascript">const x = 1;</code></pre>',
      });

      const decosBefore = (lowlightPluginKey.getState(editor.state) as DecorationSet).find();

      // Change content
      editor.commands.setContent('<pre><code class="language-javascript">function hello() { return true; }</code></pre>');

      const decosAfter = (lowlightPluginKey.getState(editor.state) as DecorationSet).find();
      expect(decosAfter.length).toBeGreaterThan(0);
      // Decorations should differ since content changed
      expect(decosAfter.length).not.toBe(decosBefore.length);
    });

    it('no decorations for empty code block', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, CodeBlockLowlight.configure({ lowlight })],
        content: '<pre><code class="language-javascript"></code></pre>',
      });

      const decoSet = lowlightPluginKey.getState(editor.state) as DecorationSet;
      const decos = decoSet.find();
      expect(decos.length).toBe(0);
    });
  });

  describe('tab indentation', () => {
    it('provides Tab keyboard shortcut', () => {
      const configured = CodeBlockLowlight.configure({ lowlight });
      const shortcuts = configured.config.addKeyboardShortcuts?.call({
        ...configured,
        editor: undefined,
        options: configured.options,
      } as any);

      expect(shortcuts).toHaveProperty('Tab');
      expect(shortcuts).toHaveProperty('Shift-Tab');
    });

    it('Tab shortcut returns false when no editor', () => {
      const configured = CodeBlockLowlight.configure({ lowlight });
      const shortcuts = configured.config.addKeyboardShortcuts?.call({
        ...configured,
        editor: undefined,
        options: configured.options,
      } as any);

      expect((shortcuts?.['Tab'] as any)?.()).toBe(false);
    });

    it('inherits Mod-Alt-c shortcut from CodeBlock', () => {
      const configured = CodeBlockLowlight.configure({ lowlight });
      const shortcuts = configured.config.addKeyboardShortcuts?.call({
        ...configured,
        editor: undefined,
        options: configured.options,
      } as any);

      expect(shortcuts).toHaveProperty('Mod-Alt-c');
    });

    it('does not provide Tab shortcut when tabIndentation=false', () => {
      const configured = CodeBlockLowlight.configure({ lowlight, tabIndentation: false });
      const shortcuts = configured.config.addKeyboardShortcuts?.call({
        ...configured,
        editor: undefined,
        options: configured.options,
      } as any);

      expect(shortcuts).not.toHaveProperty('Tab');
      expect(shortcuts).not.toHaveProperty('Shift-Tab');
      // Still has parent shortcuts
      expect(shortcuts).toHaveProperty('Mod-Alt-c');
    });
  });

  describe('storage', () => {
    let editor: Editor | undefined;

    afterEach(() => {
      if (editor && !editor.isDestroyed) {
        editor.destroy();
      }
    });

    it('listLanguages returns registered languages', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, CodeBlockLowlight.configure({ lowlight })],
        content: '<p>test</p>',
      });

      const storage = editor.storage['codeBlock'] as { listLanguages: () => string[] } | undefined;
      expect(storage).toBeDefined();

      const languages = storage!.listLanguages();
      expect(languages).toBeInstanceOf(Array);
      expect(languages.length).toBeGreaterThan(0);
      expect(languages).toContain('javascript');
    });
  });

  describe('extends CodeBlock', () => {
    it('inherits from CodeBlock', () => {
      expect(CodeBlockLowlight.config.group).toBe('block');
      expect(CodeBlockLowlight.config.content).toBe('text*');
      expect(CodeBlockLowlight.config.marks).toBe('');
      expect(CodeBlockLowlight.config.code).toBe(true);
      expect(CodeBlockLowlight.config.defining).toBe(true);
    });

    it('replaces CodeBlock in extensions (same name)', () => {
      expect(CodeBlockLowlight.name).toBe(CodeBlock.name);
    });
  });
});

describe('generateHighlightedHTML', () => {
  it('produces highlighted HTML with hljs classes', () => {
    const content = {
      type: 'doc',
      content: [{
        type: 'codeBlock',
        attrs: { language: 'javascript' },
        content: [{ type: 'text', text: 'const x = 1;' }],
      }],
    };

    const html = generateHighlightedHTML(
      content,
      [Document, Text, Paragraph, CodeBlockLowlight.configure({ lowlight })],
      lowlight,
    );

    expect(html).toContain('hljs-');
    expect(html).toContain('<pre');
    expect(html).toContain('<code');
  });

  it('handles unregistered languages (returns plain)', () => {
    const content = {
      type: 'doc',
      content: [{
        type: 'codeBlock',
        attrs: { language: 'nonexistent' },
        content: [{ type: 'text', text: 'some code' }],
      }],
    };

    const html = generateHighlightedHTML(
      content,
      [Document, Text, Paragraph, CodeBlockLowlight.configure({ lowlight })],
      lowlight,
    );

    expect(html).toContain('some code');
    expect(html).not.toContain('hljs-');
  });

  it('handles auto-detection', () => {
    const content = {
      type: 'doc',
      content: [{
        type: 'codeBlock',
        attrs: { language: null },
        content: [{ type: 'text', text: 'function hello() { return "world"; }' }],
      }],
    };

    const html = generateHighlightedHTML(
      content,
      [Document, Text, Paragraph, CodeBlockLowlight.configure({ lowlight })],
      lowlight,
      { autoDetect: true },
    );

    expect(html).toContain('hljs-');
  });

  it('handles empty code blocks', () => {
    const content = {
      type: 'doc',
      content: [{
        type: 'codeBlock',
        attrs: { language: 'javascript' },
      }],
    };

    const html = generateHighlightedHTML(
      content,
      [Document, Text, Paragraph, CodeBlockLowlight.configure({ lowlight })],
      lowlight,
    );

    expect(html).toContain('<pre');
    expect(html).toContain('<code');
  });

  it('preserves non-code content', () => {
    const content = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Hello world' }],
        },
        {
          type: 'codeBlock',
          attrs: { language: 'javascript' },
          content: [{ type: 'text', text: 'const x = 1;' }],
        },
      ],
    };

    const html = generateHighlightedHTML(
      content,
      [Document, Text, Paragraph, CodeBlockLowlight.configure({ lowlight })],
      lowlight,
    );

    expect(html).toContain('<p>Hello world</p>');
    expect(html).toContain('hljs-');
  });

  it('applies defaultLanguage option', () => {
    const content = {
      type: 'doc',
      content: [{
        type: 'codeBlock',
        attrs: { language: null },
        content: [{ type: 'text', text: 'const x = 1;' }],
      }],
    };

    const html = generateHighlightedHTML(
      content,
      [Document, Text, Paragraph, CodeBlockLowlight.configure({ lowlight })],
      lowlight,
      { defaultLanguage: 'javascript' },
    );

    expect(html).toContain('hljs-');
  });
});
