import { describe, it, expect, afterEach } from 'vitest';
import { createLowlight, common } from 'lowlight';
import { CodeBlockLowlight } from './CodeBlockLowlight.js';
import type { CodeBlockLowlightOptions } from './CodeBlockLowlight.js';
import { lowlightPluginKey } from './lowlightPlugin.js';
import { generateHighlightedHTML } from './generateHighlightedHTML.js';
import { createCodeHighlighter } from './createCodeHighlighter.js';
import { Document, Text, Paragraph, Editor, CodeBlock, History, BulletList, ListIndent } from '@domternal/core';
import type { JSONContent } from '@domternal/core';
import { TextSelection } from '@domternal/pm/state';
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
          lowlight: null,
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

// ─── createCodeHighlighter ────────────────────────────────────────────────────

describe('createCodeHighlighter', () => {
  it('returns a highlighter function', () => {
    const highlighter = createCodeHighlighter(lowlight);
    expect(typeof highlighter).toBe('function');
  });

  it('highlights code with registered language', () => {
    const highlighter = createCodeHighlighter(lowlight);
    const result = highlighter('const x = 1;', 'javascript');
    expect(result).not.toBeNull();
    expect(result).toContain('hljs-');
  });

  it('returns null when no language and no defaults', () => {
    const highlighter = createCodeHighlighter(lowlight);
    const result = highlighter('hello world', null);
    expect(result).toBeNull();
  });

  it('uses defaultLanguage when language is null', () => {
    const highlighter = createCodeHighlighter(lowlight, { defaultLanguage: 'javascript' });
    const result = highlighter('const x = 1;', null);
    expect(result).not.toBeNull();
    expect(result).toContain('hljs-');
  });

  it('uses autoDetect when code is non-empty and no language', () => {
    const highlighter = createCodeHighlighter(lowlight, { autoDetect: true });
    const result = highlighter('function foo() { return 42; }', null);
    expect(result).not.toBeNull();
    expect(result).toContain('hljs-');
  });

  it('autoDetect returns null for empty code', () => {
    const highlighter = createCodeHighlighter(lowlight, { autoDetect: true });
    const result = highlighter('', null);
    expect(result).toBeNull();
  });

  it('returns null when language is not registered', () => {
    const highlighter = createCodeHighlighter(lowlight);
    const result = highlighter('some code', 'nonexistent-lang');
    expect(result).toBeNull();
  });
});

// ─── Keyboard shortcuts ───────────────────────────────────────────────────────

/** Fires a keydown through the editor's real keymap. True when a handler took the key. */
function press(editor: Editor, key: string, init: KeyboardEventInit = {}): boolean {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  return editor.view.someProp('handleKeyDown', (f) => f(editor.view, event)) === true;
}

const pressTab = (editor: Editor): boolean => press(editor, 'Tab');
const pressShiftTab = (editor: Editor): boolean => press(editor, 'Tab', { shiftKey: true });

const SOURCE = 'if (ok) {\nfoo();\nbar();\n}';

const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content });
const paragraph = (text: string): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const code = (text: string): JSONContent => ({
  type: 'codeBlock',
  attrs: { language: 'javascript' },
  content: [{ type: 'text', text }],
});
const bulletList = (...items: JSONContent[][]): JSONContent => ({
  type: 'bulletList',
  content: items.map((content) => ({ type: 'listItem', content })),
});

/** Document position of the code block with the given index. */
function codeBlockPos(editor: Editor, index = 0): number {
  const found: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'codeBlock') return true;
    found.push(pos);
    return false;
  });
  const pos = found[index];
  if (pos === undefined) throw new Error('code block not found');
  return pos;
}

const codeText = (editor: Editor, index = 0): string =>
  editor.state.doc.nodeAt(codeBlockPos(editor, index))!.textContent;

/** Selects from `anchor` to `head`, both offsets into the text of a code block. */
function select(editor: Editor, anchor: number, head = anchor, index = 0): void {
  const start = codeBlockPos(editor, index) + 1;
  const { state } = editor;
  editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, start + anchor, start + head)));
}

function selectedText(editor: Editor): string {
  const { from, to } = editor.state.selection;
  return editor.state.doc.textBetween(from, to, '\n');
}

describe('CodeBlockLowlight keyboard shortcuts', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) editor.destroy();
  });

  it('Tab inserts spaces when inside code block', () => {
    editor = new Editor({
      extensions: [Document, Text, Paragraph, CodeBlockLowlight.configure({ lowlight, tabSize: 2 })],
      content: '<pre><code>foo</code></pre>',
    });

    // Place cursor inside code block
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2)));

    expect(pressTab(editor)).toBe(true);
    expect(editor.state.doc.child(0).textContent).toBe('f  oo');
  });

  it('Tab returns false when not in code block', () => {
    editor = new Editor({
      extensions: [Document, Text, Paragraph, CodeBlockLowlight.configure({ lowlight })],
      content: '<p>regular text</p>',
    });

    const shortcuts = CodeBlockLowlight.config.addKeyboardShortcuts?.call({ ...CodeBlockLowlight, editor, options: CodeBlockLowlight.options });
    const result = (shortcuts?.['Tab'] as any)?.();

    expect(result).toBe(false);
  });

  it('Tab returns false when editor is null', () => {
    const shortcuts = CodeBlockLowlight.config.addKeyboardShortcuts?.call({ ...CodeBlockLowlight, editor: null, options: CodeBlockLowlight.options });
    const result = (shortcuts?.['Tab'] as any)?.();
    expect(result).toBe(false);
  });

  it('Shift-Tab removes spaces when inside code block with leading whitespace', () => {
    editor = new Editor({
      extensions: [Document, Text, Paragraph, CodeBlockLowlight.configure({ lowlight, tabSize: 2 })],
      content: '<pre><code>  indented</code></pre>',
    });

    // Place cursor after the leading spaces
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 4)));

    expect(pressShiftTab(editor)).toBe(true);
    expect(editor.state.doc.child(0).textContent).toBe('indented');
  });

  it('Shift-Tab returns false when no leading spaces', () => {
    editor = new Editor({
      extensions: [Document, Text, Paragraph, CodeBlockLowlight.configure({ lowlight, tabSize: 2 })],
      content: '<pre><code>nospaces</code></pre>',
    });

    // Place cursor at start of line (no spaces to remove)
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2)));

    const shortcuts = CodeBlockLowlight.config.addKeyboardShortcuts?.call({ ...CodeBlockLowlight, editor, options: { ...CodeBlockLowlight.options, tabSize: 2 } });
    const result = (shortcuts?.['Shift-Tab'] as any)?.();

    expect(result).toBe(false);
  });

  it('Shift-Tab returns false when not in code block', () => {
    editor = new Editor({
      extensions: [Document, Text, Paragraph, CodeBlockLowlight.configure({ lowlight })],
      content: '<p>text</p>',
    });

    const shortcuts = CodeBlockLowlight.config.addKeyboardShortcuts?.call({ ...CodeBlockLowlight, editor, options: CodeBlockLowlight.options });
    const result = (shortcuts?.['Shift-Tab'] as any)?.();

    expect(result).toBe(false);
  });

  it('Shift-Tab returns false when editor is null', () => {
    const shortcuts = CodeBlockLowlight.config.addKeyboardShortcuts?.call({ ...CodeBlockLowlight, editor: null, options: CodeBlockLowlight.options });
    const result = (shortcuts?.['Shift-Tab'] as any)?.();
    expect(result).toBe(false);
  });
});

describe('CodeBlockLowlight tab indentation with a selection', () => {
  const editors: Editor[] = [];

  afterEach(() => {
    for (const editor of editors.splice(0)) editor.destroy();
  });

  function createEditor(content: JSONContent, options: Partial<CodeBlockLowlightOptions> = {}): Editor {
    const editor = new Editor({
      extensions: [Document, Text, Paragraph, History, CodeBlockLowlight.configure({ lowlight, ...options })],
      content,
    });
    editors.push(editor);
    return editor;
  }

  describe('Tab', () => {
    it('inserts tabSize spaces at a caret', () => {
      const editor = createEditor(doc(code(SOURCE)));
      select(editor, 12);
      expect(pressTab(editor)).toBe(true);
      expect(codeText(editor)).toBe('if (ok) {\nfo  o();\nbar();\n}');
      expect(editor.state.selection.empty).toBe(true);
      expect(editor.state.selection.head).toBe(codeBlockPos(editor) + 1 + 14);
    });

    it('indents every line the selection touches and keeps the selected code', () => {
      const editor = createEditor(doc(code(SOURCE)));
      select(editor, 10, 23);
      expect(pressTab(editor)).toBe(true);
      expect(codeText(editor)).toBe('if (ok) {\n  foo();\n  bar();\n}');
      expect(selectedText(editor)).toBe('foo();\n  bar();');
    });

    it('indents a partly selected first line from its start', () => {
      const editor = createEditor(doc(code(SOURCE)));
      select(editor, 12, 19);
      expect(pressTab(editor)).toBe(true);
      expect(codeText(editor)).toBe('if (ok) {\n  foo();\n  bar();\n}');
      expect(selectedText(editor)).toBe('o();\n  ba');
    });

    it('skips a line the selection only reaches at its first column', () => {
      const editor = createEditor(doc(code(SOURCE)));
      select(editor, 10, 24);
      expect(pressTab(editor)).toBe(true);
      expect(codeText(editor)).toBe('if (ok) {\n  foo();\n  bar();\n}');
      expect(selectedText(editor)).toBe('foo();\n  bar();\n');
    });

    it('indents the line of a selection inside one line and keeps the selected text', () => {
      const editor = createEditor(doc(code(SOURCE)));
      select(editor, 11, 13);
      expect(pressTab(editor)).toBe(true);
      expect(codeText(editor)).toBe('if (ok) {\n  foo();\nbar();\n}');
      expect(selectedText(editor)).toBe('oo');
    });

    it('indents only the first line when the selection is just its line break', () => {
      const editor = createEditor(doc(code(SOURCE)));
      select(editor, 9, 10);
      expect(pressTab(editor)).toBe(true);
      expect(codeText(editor)).toBe('  if (ok) {\nfoo();\nbar();\n}');
    });

    it('indents every line, the first one too, when the whole block is selected', () => {
      const editor = createEditor(doc(code(SOURCE)));
      select(editor, 0, SOURCE.length);
      expect(pressTab(editor)).toBe(true);
      expect(codeText(editor)).toBe('  if (ok) {\n  foo();\n  bar();\n  }');
    });

    it('indents an empty first line', () => {
      const editor = createEditor(doc(code('\nx\ny')));
      select(editor, 0, 4);
      expect(pressTab(editor)).toBe(true);
      expect(codeText(editor)).toBe('  \n  x\n  y');
    });

    it('skips the empty line after a trailing line break when everything is selected', () => {
      const editor = createEditor(doc(code('a\nb\n')));
      select(editor, 0, 4);
      expect(pressTab(editor)).toBe(true);
      expect(codeText(editor)).toBe('  a\n  b\n');
    });

    it('keeps indenting the same lines on repeated presses', () => {
      const editor = createEditor(doc(code(SOURCE)));
      select(editor, 10, 23);
      expect(pressTab(editor)).toBe(true);
      expect(pressTab(editor)).toBe(true);
      expect(codeText(editor)).toBe('if (ok) {\n    foo();\n    bar();\n}');
      expect(selectedText(editor)).toBe('foo();\n    bar();');
    });

    it('keeps a backward selection backward', () => {
      const editor = createEditor(doc(code(SOURCE)));
      select(editor, 13, 10);
      expect(pressTab(editor)).toBe(true);
      expect(codeText(editor)).toBe('if (ok) {\n  foo();\nbar();\n}');
      expect(selectedText(editor)).toBe('foo');
      expect(editor.state.selection.anchor).toBeGreaterThan(editor.state.selection.head);
    });

    it('honours tabSize', () => {
      const editor = createEditor(doc(code(SOURCE)), { tabSize: 4 });
      select(editor, 10, 23);
      expect(pressTab(editor)).toBe(true);
      expect(codeText(editor)).toBe('if (ok) {\n    foo();\n    bar();\n}');
    });

    it('is one undo step that restores the code and the selection', () => {
      const editor = createEditor(doc(code(SOURCE)));
      select(editor, 10, 23);
      const { anchor, head } = editor.state.selection;
      expect(pressTab(editor)).toBe(true);
      expect(codeText(editor)).toBe('if (ok) {\n  foo();\n  bar();\n}');
      expect(editor.commands.undo()).toBe(true);
      expect(codeText(editor)).toBe(SOURCE);
      expect([editor.state.selection.anchor, editor.state.selection.head]).toEqual([anchor, head]);
      expect(editor.commands.undo()).toBe(false);
    });
  });

  describe('Shift-Tab', () => {
    it('removes up to tabSize leading spaces from every selected line', () => {
      const editor = createEditor(doc(code('    a\n b\nc\n  d')));
      select(editor, 0, 14);
      expect(pressShiftTab(editor)).toBe(true);
      expect(codeText(editor)).toBe('  a\nb\nc\nd');
    });

    it('outdents every line of a backward selection', () => {
      const editor = createEditor(doc(code('  a\n  b')));
      select(editor, 7, 0);
      expect(pressShiftTab(editor)).toBe(true);
      expect(codeText(editor)).toBe('a\nb');
    });

    it('outdents the line with the caret before the indentation', () => {
      const editor = createEditor(doc(code('  foo')));
      select(editor, 0);
      expect(pressShiftTab(editor)).toBe(true);
      expect(codeText(editor)).toBe('foo');
    });

    it('removes a full step with the caret inside the indentation', () => {
      const editor = createEditor(doc(code('    foo')));
      select(editor, 1);
      expect(pressShiftTab(editor)).toBe(true);
      expect(codeText(editor)).toBe('  foo');
    });

    it('removes only the spaces a line has when it has fewer than tabSize', () => {
      const editor = createEditor(doc(code(' a\n   b')));
      select(editor, 0, 7);
      expect(pressShiftTab(editor)).toBe(true);
      expect(codeText(editor)).toBe('a\n b');
    });

    it('honours tabSize', () => {
      const editor = createEditor(doc(code('      x\n  y')), { tabSize: 4 });
      select(editor, 0, 11);
      expect(pressShiftTab(editor)).toBe(true);
      expect(codeText(editor)).toBe('  x\ny');
    });

    it('restores the text and the selection after Tab', () => {
      const editor = createEditor(doc(code(SOURCE)));
      select(editor, 10, 24);
      expect(pressTab(editor)).toBe(true);
      expect(pressShiftTab(editor)).toBe(true);
      expect(codeText(editor)).toBe(SOURCE);
      expect(selectedText(editor)).toBe('foo();\nbar();\n');
    });

    it('leaves the key unhandled when no selected line has leading spaces', () => {
      const editor = createEditor(doc(code('a\nb')));
      select(editor, 0, 3);
      expect(pressShiftTab(editor)).toBe(false);
      expect(codeText(editor)).toBe('a\nb');
    });

    it('does not remove tab characters', () => {
      const editor = createEditor(doc(code('\tfoo\n\tbar')));
      select(editor, 0, 9);
      expect(pressShiftTab(editor)).toBe(false);
      expect(codeText(editor)).toBe('\tfoo\n\tbar');
    });
  });

  it('indents and outdents CRLF lines without touching the carriage returns', () => {
    const editor = createEditor(doc(code('a\r\nb\r\nc')));
    select(editor, 0, 7);
    expect(pressTab(editor)).toBe(true);
    expect(codeText(editor)).toBe('  a\r\n  b\r\n  c');
    expect(pressShiftTab(editor)).toBe(true);
    expect(codeText(editor)).toBe('a\r\nb\r\nc');
  });

  describe('a selection that leaves the code block', () => {
    it('from a paragraph into the block is not handled and deletes nothing', () => {
      const editor = createEditor(doc(paragraph('Intro'), code(SOURCE)));
      const { state } = editor;
      editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 3, codeBlockPos(editor) + 1 + 12)));
      const before = editor.state.doc;
      expect(pressTab(editor)).toBe(false);
      expect(pressShiftTab(editor)).toBe(false);
      expect(editor.state.doc.eq(before)).toBe(true);
    });

    it('across two code blocks is not handled and deletes nothing', () => {
      const editor = createEditor(doc(code(SOURCE), paragraph('between'), code('  block')));
      const { state } = editor;
      const anchor = codeBlockPos(editor, 0) + 1 + 10;
      const head = codeBlockPos(editor, 1) + 1 + 4;
      editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, anchor, head)));
      const before = editor.state.doc;
      expect(pressTab(editor)).toBe(false);
      expect(pressShiftTab(editor)).toBe(false);
      expect(editor.state.doc.eq(before)).toBe(true);
    });

    it('backward from the next paragraph into the block is not handled by either key', () => {
      const editor = createEditor(doc(code(SOURCE), paragraph('after')));
      const { state } = editor;
      const anchor = state.doc.content.size - 1;
      editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, anchor, codeBlockPos(editor) + 1 + 12)));
      const before = editor.state.doc;
      expect(pressTab(editor)).toBe(false);
      expect(pressShiftTab(editor)).toBe(false);
      expect(editor.state.doc.eq(before)).toBe(true);
    });
  });

  describe('with ListIndent registered after CodeBlockLowlight', () => {
    function createListEditor(content: JSONContent): Editor {
      const editor = new Editor({
        extensions: [Document, Text, Paragraph, BulletList, CodeBlockLowlight.configure({ lowlight }), ListIndent],
        content,
      });
      editors.push(editor);
      return editor;
    }

    const blockTypes = (editor: Editor): string[] => {
      const types: string[] = [];
      editor.state.doc.forEach((node) => types.push(node.type.name));
      return types;
    };

    it('Tab with a selection in a code block after a list indents its lines and leaves the block in place', () => {
      const editor = createListEditor(doc(bulletList([paragraph('item')]), code(SOURCE)));
      select(editor, 10, 23);
      expect(pressTab(editor)).toBe(true);
      expect(blockTypes(editor)).toEqual(['bulletList', 'codeBlock']);
      expect(codeText(editor)).toBe('if (ok) {\n  foo();\n  bar();\n}');
    });

    it('Shift-Tab with a selection in a code block that ends a list item outdents its lines and leaves the block there', () => {
      const editor = createListEditor(doc(bulletList([paragraph('item'), code('x\n  y\n  z')])));
      select(editor, 2, 9);
      expect(pressShiftTab(editor)).toBe(true);
      expect(blockTypes(editor)).toEqual(['bulletList']);
      const item = editor.state.doc.firstChild!.firstChild!;
      expect([item.child(0).type.name, item.child(1).type.name]).toEqual(['paragraph', 'codeBlock']);
      expect(codeText(editor)).toBe('x\ny\nz');
    });
  });

  describe('an invalid tabSize', () => {
    it.each([0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])(
      '%s keeps the inherited shortcuts and binds no Tab',
      (tabSize) => {
        const configured = CodeBlockLowlight.configure({ lowlight, tabSize });
        const shortcuts = configured.config.addKeyboardShortcuts?.call({
          ...configured,
          editor: undefined,
          options: configured.options,
        } as any);

        expect(shortcuts).toHaveProperty('Mod-Alt-c');
        expect(shortcuts).toHaveProperty('Enter');
        expect(shortcuts).toHaveProperty('ArrowDown');
        expect(shortcuts).not.toHaveProperty('Tab');
        expect(shortcuts).not.toHaveProperty('Shift-Tab');
      },
    );

    it('leaves Tab with a selection to the browser and keeps the selected code', () => {
      const editor = createEditor(doc(code(SOURCE)), { tabSize: 0 });
      select(editor, 10, 16);
      expect(pressTab(editor)).toBe(false);
      expect(codeText(editor)).toBe(SOURCE);
    });

    it('keeps the inherited ArrowDown exit in a live editor and reports no error', () => {
      const errors: Error[] = [];
      const editor = new Editor({
        extensions: [Document, Text, Paragraph, CodeBlockLowlight.configure({ lowlight, tabSize: -1 })],
        content: doc(code('x')),
        onError: ({ error }) => errors.push(error),
      });
      editors.push(editor);
      select(editor, 1);
      expect(press(editor, 'ArrowDown')).toBe(true);
      expect(editor.state.doc.lastChild?.type.name).toBe('paragraph');
      expect(errors).toEqual([]);
    });

    it('steps by the whole part of a fractional tabSize in both directions', () => {
      const editor = createEditor(doc(code('     x')), { tabSize: 2.5 });
      select(editor, 0, 6);
      expect(pressShiftTab(editor)).toBe(true);
      expect(codeText(editor)).toBe('   x');
      expect(pressTab(editor)).toBe(true);
      expect(codeText(editor)).toBe('     x');
    });
  });
});
