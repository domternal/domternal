/**
 * Extension integration tests: commands, storage, paste plugin behavior, and
 * the download helper, all through a real Editor.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Bold,
  BulletList,
  Code,
  CodeBlock,
  Document,
  Editor,
  Extension,
  HardBreak,
  Heading,
  Italic,
  Link,
  ListItem,
  OrderedList,
  Paragraph,
  Text,
} from '@domternal/core';
import { Plugin, TextSelection } from '@domternal/pm/state';
import { Table, TableCell, TableHeader, TableRow } from '@domternal/extension-table';
import { downloadMarkdown } from './download.js';
import { getMarkdown, Markdown } from './Markdown.js';
import type { MarkdownStorage } from './Markdown.js';
import { looksLikeMarkdown, markdownPastePlugin, markdownPastePluginKey } from './pastePlugin.js';

const baseExtensions = [
  Document,
  Text,
  Paragraph,
  Heading,
  CodeBlock,
  BulletList,
  OrderedList,
  ListItem,
  Bold,
  Italic,
  Code,
  Link,
  HardBreak,
  Table,
  TableRow,
  TableHeader,
  TableCell,
];

let editor: Editor | undefined;
afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

function mount(options: { content?: string; markdownOptions?: Record<string, unknown> } = {}): Editor {
  const markdown =
    options.markdownOptions === undefined
      ? Markdown
      : Markdown.configure(options.markdownOptions);
  editor = new Editor({
    extensions: [...baseExtensions, markdown],
    content: options.content ?? '<p></p>',
  });
  return editor;
}

interface FakeClipboardOptions {
  text: string;
  html?: string;
}

function pasteEvent({ text, html = '' }: FakeClipboardOptions): ClipboardEvent {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: {
      getData: (type: string) => (type === 'text/plain' ? text : type === 'text/html' ? html : ''),
    },
  });
  return event as ClipboardEvent;
}

function pasteClipboard(target: Editor, clipboard: FakeClipboardOptions): void {
  const event = pasteEvent(clipboard);
  target.view.dom.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
}

function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function vscodeHtml(text: string): string {
  const lines = text.replaceAll('\r\n', '\n').split('\n');
  return '<meta charset="utf-8"><div style="color: #d4d4d4; font-family: Consolas, monospace; white-space: pre;">'
    + lines.map((line) => line === '' ? '<br>' : `<div><span style="color: #569cd6">${escapeHtml(line)}</span></div>`).join('')
    + '</div>';
}

function dispatchPaste(target: Editor, event: ClipboardEvent): boolean {
  const plugin = target.state.plugins.find((p) => p.spec.key === markdownPastePluginKey);
  if (plugin === undefined) throw new Error('markdown paste plugin not registered');
  const handler = plugin.props.handlePaste;
  if (handler === undefined) throw new Error('handlePaste missing');
  return handler.call(plugin, target.view, event, target.state.doc.slice(0)) === true;
}

describe('Markdown extension', () => {
  it('registers under the canonical name "markdown"', () => {
    expect(Markdown.name).toBe('markdown');
  });

  it('builds shared parser and serializer instances on create', () => {
    const instance = mount();
    const storage = instance.storage['markdown'] as MarkdownStorage;
    expect(storage.parser).not.toBeNull();
    expect(storage.serializer).not.toBeNull();
  });

  it('insertMarkdown inserts parsed rich content at the selection', () => {
    const instance = mount({ content: '<p>start</p>' });
    instance.commands.selectAll();
    const ok = instance.commands.insertMarkdown('# Hello **world**');
    expect(ok).toBe(true);
    expect(instance.state.doc.firstChild?.type.name).toBe('heading');
    expect(instance.state.doc.textContent).toBe('Hello world');
  });

  it('insertMarkdown merges a single paragraph inline, matching paste', () => {
    const instance = mount({ content: '<p>keep:</p>' });
    instance.commands.focus();
    instance.view.dispatch(
      instance.state.tr.setSelection(
        TextSelection.near(instance.state.doc.resolve(instance.state.doc.content.size - 1))
      )
    );
    const ok = instance.commands.insertMarkdown('has **bold** inline');
    expect(ok).toBe(true);
    expect(instance.state.doc.childCount).toBe(1);
    expect(instance.state.doc.textContent).toBe('keep:has bold inline');
  });

  it('setMarkdownContent replaces the whole document', () => {
    const instance = mount({ content: '<p>old</p>' });
    const ok = instance.commands.setMarkdownContent('- a\n- b');
    expect(ok).toBe(true);
    expect(instance.state.doc.firstChild?.type.name).toBe('bulletList');
    expect(instance.state.doc.firstChild?.childCount).toBe(2);
  });

  it('getMarkdown serializes the current document', () => {
    const instance = mount({ content: '<h2>Hi</h2><p><strong>b</strong></p>' });
    const { markdown, warnings } = getMarkdown(instance);
    expect(markdown).toBe('## Hi\n\n**b**');
    expect(warnings).toEqual([]);
  });

  it('getMarkdown works without the extension installed', () => {
    const bare = new Editor({ extensions: baseExtensions, content: '<p>plain</p>' });
    try {
      expect(getMarkdown(bare).markdown).toBe('plain');
    } finally {
      bare.destroy();
    }
  });
});

describe('markdown paste', () => {
  it('converts markdown-looking plain text pastes', () => {
    const instance = mount();
    const handled = dispatchPaste(instance, pasteEvent({ text: '# Title\n\n- a\n- b' }));
    expect(handled).toBe(true);
    expect(instance.state.doc.firstChild?.type.name).toBe('heading');
    expect(instance.state.doc.lastChild?.type.name).toBe('bulletList');
  });

  it('pastes a single markdown paragraph inline into existing text', () => {
    // DOM parsing trims trailing paragraph whitespace, so join without a space.
    const instance = mount({ content: '<p>keep:</p>' });
    const end = instance.state.doc.content.size - 1;
    instance.commands.focus();
    instance.view.dispatch(
      instance.state.tr.setSelection(TextSelection.near(instance.state.doc.resolve(end)))
    );
    const handled = dispatchPaste(instance, pasteEvent({ text: 'has **bold** inline' }));
    expect(handled).toBe(true);
    expect(instance.state.doc.childCount).toBe(1);
    expect(instance.state.doc.textContent).toBe('keep:has bold inline');
  });

  it('ignores plain prose and rich pastes', () => {
    const instance = mount();
    expect(dispatchPaste(instance, pasteEvent({ text: 'just a sentence.' }))).toBe(false);
    expect(
      dispatchPaste(instance, pasteEvent({ text: '# md', html: '<h1>md</h1>' }))
    ).toBe(false);
  });

  it('leaves pastes inside code blocks literal', () => {
    const instance = mount({ content: '<pre><code>x</code></pre>' });
    instance.commands.focus();
    expect(dispatchPaste(instance, pasteEvent({ text: '# not converted' }))).toBe(false);
  });

  it('can be disabled via the paste option', () => {
    const instance = mount({ markdownOptions: { paste: false } });
    const plugin = instance.state.plugins.find((p) => p.spec.key === markdownPastePluginKey);
    expect(plugin).toBeUndefined();
  });

  it('falls back to default paste handling when the parser throws', () => {
    const instance = mount();
    const plugin = markdownPastePlugin(() => {
      throw new Error('boom');
    });
    const handler = plugin.props.handlePaste;
    if (handler === undefined) throw new Error('handlePaste missing');
    const before = instance.state.doc;
    const handled = handler.call(
      plugin,
      instance.view,
      pasteEvent({ text: '# would convert' }),
      instance.state.doc.slice(0)
    );
    expect(handled).toBe(false);
    expect(instance.state.doc.eq(before)).toBe(true);
  });
});

describe('Markdown source clipboard HTML', () => {
  const readme = [
    '# Clipboard README',
    '',
    'Install **Domternal** and read the [guide](https://domternal.dev).',
    '',
    '- First item',
    '- Second item',
    '',
    '| Package | Status |',
    '| --- | --- |',
    '| core | ready |',
    '',
    '```ts',
    'const value = "<tag>";',
    '  console.log(value);',
    '```',
  ].join('\n');

  it('pastes a VS Code README as headings, marks, lists, tables, and fenced code', () => {
    const instance = mount();
    pasteClipboard(instance, { text: readme, html: vscodeHtml(readme) });

    const doc = instance.state.doc;
    expect(Array.from({ length: doc.childCount }, (_, index) => doc.child(index).type.name))
      .toEqual(['heading', 'paragraph', 'bulletList', 'table', 'codeBlock']);
    expect(doc.firstChild?.attrs['level']).toBe(1);
    expect(doc.child(1).child(1).marks.some((mark) => mark.type.name === 'bold')).toBe(true);
    expect(doc.child(1).child(3).marks.find((mark) => mark.type.name === 'link')?.attrs['href'])
      .toBe('https://domternal.dev');
    expect(doc.child(2).childCount).toBe(2);
    expect(doc.child(3).childCount).toBe(2);
    expect(doc.child(3).firstChild?.firstChild?.type.name).toBe('tableHeader');
    expect(doc.lastChild?.attrs['language']).toBe('ts');
    expect(doc.lastChild?.textContent).toBe('const value = "<tag>";\n  console.log(value);');
  });

  it.each([
    ['a pre element with highlighted spans', '<pre><span># </span><span>Title</span>\n\n<span>- first</span>\n<span>- second</span></pre>'],
    ['preserved lines separated by br', '<div style="white-space: pre-wrap"><span># Title</span><br><br><span>- first</span><br><span>- second</span></div>'],
    ['a preserved span', '<span style="white-space: break-spaces"># Title\n\n- first\n- second</span>'],
  ])('recognizes source presented as %s', (_name, html) => {
    const instance = mount();
    pasteClipboard(instance, { text: '# Title\n\n- first\n- second', html });
    expect(instance.state.doc.firstChild?.type.name).toBe('heading');
    expect(instance.state.doc.lastChild?.type.name).toBe('bulletList');
    expect(instance.state.doc.lastChild?.childCount).toBe(2);
  });

  it('retains blank lines, nested indentation, tabs, and CRLF source when HTML uses nonbreaking spaces', () => {
    const instance = mount();
    const text = '# Whitespace\r\n\r\n- parent\r\n    - child\r\n\r\n```ts\r\n\tconst x = 1;\r\n  x++;\r\n```';
    const html = vscodeHtml(text).replaceAll('    - child', '&nbsp;&nbsp;&nbsp;&nbsp;- child')
      .replaceAll('  x++;', '&nbsp;&nbsp;x++;');
    pasteClipboard(instance, { text, html });
    expect(instance.state.doc.childCount).toBe(3);
    expect(instance.state.doc.child(1).firstChild?.lastChild?.type.name).toBe('bulletList');
    expect(instance.state.doc.child(1).firstChild?.lastChild?.textContent).toBe('child');
    expect(instance.state.doc.lastChild?.textContent).toBe('\tconst x = 1;\n  x++;');
  });

  it('restores original Go source tabs when VS Code expands them to spaces in clipboard HTML', () => {
    const instance = mount();
    const source = [
      '# Go example', '', '```go', 'func main() {',
      '\tfmt.Println("ready")',
      '  \tfmt.Println("mixed")',
      '\t\tfmt.Println("nested")',
      '}', '```',
    ].join('\n');
    const rendered = [
      '# Go example', '', '```go', 'func main() {',
      '\u00a0 \u00a0 fmt.Println("ready")',
      '\u00a0 \u00a0 fmt.Println("mixed")',
      '\u00a0 \u00a0 \u00a0 \u00a0 fmt.Println("nested")',
      '}', '```',
    ].join('\n');
    pasteClipboard(instance, { text: source, html: vscodeHtml(rendered) });
    expect(instance.state.doc.firstChild?.type.name).toBe('heading');
    expect(instance.state.doc.lastChild?.type.name).toBe('codeBlock');
    expect(instance.state.doc.lastChild?.attrs['language']).toBe('go');
    expect(instance.state.doc.lastChild?.textContent).toBe([
      'func main() {', '\tfmt.Println("ready")', '  \tfmt.Println("mixed")',
      '\t\tfmt.Println("nested")', '}',
    ].join('\n'));
  });

  it.each([
    ['\tvalue', ' value'],
    ['\t\tvalue', '  value'],
    ['  \tvalue', '   value'],
    ['\t  \tvalue', '    value'],
  ])('accepts tab expansion at the minimum remaining tab-stop width for %j', (source, rendered) => {
    const instance = mount();
    pasteClipboard(instance, {
      text: `\`\`\`text\n${source}\n\`\`\``,
      html: `<pre>\`\`\`text\n${rendered}\n\`\`\`</pre>`,
    });
    expect(instance.state.doc.firstChild?.textContent).toBe(source);
  });

  it.each([
    ['changed literal spaces', 'left  right', 'left right'],
    ['changed literal spaces after an expanded tab', '\tleft  right', '    left right'],
    ['a missing tab', '\tvalue', 'value'],
    ['two tabs rendered as one space', '\t\tvalue', ' value'],
    ['fewer spaces than the literal spaces and tabs require', ' \t value', '  value'],
    ['a removed line break after a tab', '\tfirst\nsecond', '    first second'],
    ['a removed blank line after a tab', '\tfirst\n\nsecond', '    first\nsecond'],
    ['HTML introducing a tab', '    value', '\tvalue'],
  ])('rejects tab-related flavor conflicts with %s', (_name, source, rendered) => {
    const instance = mount();
    const text = `\`\`\`text\n${source}\n\`\`\``;
    const html = `<pre>\`\`\`text\n${rendered}\n\`\`\`</pre>`;
    const before = instance.state.doc;
    expect(dispatchPaste(instance, pasteEvent({ text, html }))).toBe(false);
    expect(instance.state.doc.eq(before)).toBe(true);
    pasteClipboard(instance, { text, html });
    expect(instance.state.doc.firstChild?.textContent).toBe(`\`\`\`text\n${rendered}\n\`\`\``);
  });

  it('uses the plain flavor as the source of code whitespace after HTML normalization', () => {
    const instance = mount();
    const text = '```text\n\u00a0indented\ntrailing  \n```';
    const html = `<pre>${escapeHtml(text).replaceAll('\u00a0', ' ')}</pre>`;
    pasteClipboard(instance, { text, html });
    expect(instance.state.doc.firstChild?.type.name).toBe('codeBlock');
    expect(instance.state.doc.firstChild?.textContent).toBe('\u00a0indented\ntrailing  ');
  });

  it.each([
    ['# Title\n', '<pre># Title</pre>'],
    ['# Title', '<pre># Title\n</pre>'],
  ])('allows a clipboard line ending without changing source content', (text, html) => {
    const instance = mount();
    pasteClipboard(instance, { text, html });
    expect(instance.state.doc.firstChild?.type.name).toBe('heading');
    expect(instance.state.doc.textContent).toBe('Title');
  });

  it.each(['\n', '\n\n'])('accepts VS Code source ending with %j', (ending) => {
    const instance = mount();
    const text = `# Final lines\n\n- item${ending}`;
    pasteClipboard(instance, { text, html: vscodeHtml(text) });
    expect(instance.state.doc.childCount).toBe(2);
    expect(instance.state.doc.firstChild?.type.name).toBe('heading');
    expect(instance.state.doc.lastChild?.type.name).toBe('bulletList');
    expect(instance.state.doc.lastChild?.textContent).toBe('item');
  });

  it('accepts VS Code tab expansion together with a final source newline', () => {
    const instance = mount();
    const text = '```go\n\tfmt.Println("ready")\n```\n';
    const rendered = '```go\n    fmt.Println("ready")\n```\n';
    pasteClipboard(instance, { text, html: vscodeHtml(rendered) });
    expect(instance.state.doc.firstChild?.type.name).toBe('codeBlock');
    expect(instance.state.doc.firstChild?.attrs['language']).toBe('go');
    expect(instance.state.doc.firstChild?.textContent).toBe('\tfmt.Println("ready")');
  });

  it.each([
    ['two extra HTML line breaks', '# Title', '# Title\n\n'],
    ['three extra HTML line breaks', '# Title', '# Title\n\n\n'],
    ['multiple missing HTML line breaks', '# Title\n\n\n', '# Title'],
  ])('rejects conflicting final source whitespace with %s', (_name, text, rendered) => {
    const instance = mount();
    const html = `<pre>${rendered}</pre>`;
    const before = instance.state.doc;
    expect(dispatchPaste(instance, pasteEvent({ text, html }))).toBe(false);
    expect(instance.state.doc.eq(before)).toBe(true);
    pasteClipboard(instance, { text, html });
    expect(instance.state.doc.firstChild?.type.name).toBe('codeBlock');
    expect(instance.state.doc.firstChild?.textContent).toBe(rendered);
  });

  it.each([
    ['semantic heading', '<h2># Literal heading</h2>', '# Literal heading'],
    ['semantic bold mark', '<div style="white-space: pre"><strong>**Literal bold**</strong></div>', '**Literal bold**'],
    ['semantic link', '<div style="white-space: pre"><a href="https://example.com"># Literal link</a></div>', '# Literal link'],
    ['semantic list', '<ul><li># Literal item</li></ul>', '# Literal item'],
    ['semantic table', '<table><tbody><tr><td># Literal cell</td></tr></tbody></table>', '# Literal cell'],
    ['copied editor code block', '<pre><code># Literal code\n- still code</code></pre>', '# Literal code\n- still code'],
    ['ProseMirror slice', '<div data-pm-slice="0 0 []" style="white-space: pre"># Literal slice</div>', '# Literal slice'],
    ['nested ProseMirror slice', '<div style="white-space: pre"><span data-pm-slice="0 0 []"># Literal slice</span></div>', '# Literal slice'],
    ['editor node marker', '<div data-type="codeBlock" style="white-space: pre"># Literal node</div>', '# Literal node'],
    ['ordinary browser wrapper', '<div><span># Literal text</span></div>', '# Literal text'],
    ['whitespace preservation overridden by a child', '<div style="white-space: pre"><span style="white-space: normal"># Literal text</span></div>', '# Literal text'],
  ])('defers %s to the existing HTML paste pipeline', (_name, html, text) => {
    const instance = mount();
    const before = instance.state.doc;
    expect(dispatchPaste(instance, pasteEvent({ text, html }))).toBe(false);
    expect(instance.state.doc.eq(before)).toBe(true);
    pasteClipboard(instance, { text, html });
    expect(instance.state.doc.textContent).toBe(text);
  });

  it('preserves rendered rich HTML marks and heading level through the paste event', () => {
    const instance = mount();
    pasteClipboard(instance, {
      text: '# **Literal heading**',
      html: '<h3><strong># **Literal heading**</strong></h3>',
    });
    expect(instance.state.doc.firstChild?.type.name).toBe('heading');
    expect(instance.state.doc.firstChild?.attrs['level']).toBe(3);
    expect(instance.state.doc.firstChild?.firstChild?.marks[0]?.type.name).toBe('bold');
    expect(instance.state.doc.textContent).toBe('# **Literal heading**');
  });

  it.each([
    ['different content', '# Plain title', '<pre># HTML title</pre>'],
    ['missing indentation', '```\n  indented\n```', '<pre>```\nindented\n```</pre>'],
    ['missing blank line', '# Title\n\n- item', '<pre># Title\n- item</pre>'],
    ['extra trailing spaces', '# Title  ', '<pre># Title</pre>'],
    ['empty plain flavor', '', '<pre># HTML title</pre>'],
  ])('rejects conflicting clipboard flavors with %s', (_name, text, html) => {
    const instance = mount();
    expect(dispatchPaste(instance, pasteEvent({ text, html }))).toBe(false);
    pasteClipboard(instance, { text, html });
    expect(instance.state.doc.firstChild?.type.name).toBe('codeBlock');
    expect(instance.state.doc.textContent).not.toContain('Plain title');
  });

  it('keeps source HTML literal when pasted inside a code block', () => {
    const instance = mount({ content: '<pre><code>existing:</code></pre>' });
    instance.view.dispatch(instance.state.tr.setSelection(TextSelection.atEnd(instance.state.doc)));
    const text = '# Literal\n\n- item';
    expect(dispatchPaste(instance, pasteEvent({ text, html: vscodeHtml(text) }))).toBe(false);
    pasteClipboard(instance, { text, html: vscodeHtml(text) });
    expect(instance.state.doc.childCount).toBe(1);
    expect(instance.state.doc.firstChild?.type.name).toBe('codeBlock');
    expect(instance.state.doc.textContent).toBe(`existing:${text}`);
  });

  it('honors the disabled paste option for source HTML', () => {
    const instance = mount({ markdownOptions: { paste: false } });
    pasteClipboard(instance, { text: '# Literal title', html: '<pre># Literal title</pre>' });
    expect(instance.state.doc.firstChild?.type.name).toBe('codeBlock');
    expect(instance.state.doc.textContent).toBe('# Literal title');
  });

  it('lets the HTML pipeline recover when parsing eligible source throws', () => {
    const instance = mount();
    const parser = (instance.storage['markdown'] as MarkdownStorage).parser;
    if (parser === null) throw new Error('Markdown parser not initialized');
    const parse = vi.spyOn(parser, 'parse').mockImplementation(() => { throw new Error('parse failure'); });
    try {
      pasteClipboard(instance, { text: '# Recoverable', html: '<pre># Recoverable</pre>' });
      expect(parse).toHaveBeenCalledWith('# Recoverable');
      expect(instance.state.doc.firstChild?.type.name).toBe('codeBlock');
      expect(instance.state.doc.textContent).toBe('# Recoverable');
    } finally {
      parse.mockRestore();
    }
  });

  it.each([false, true])('handles source before a block-paste plugin regardless of registration order (%s)', (markdownFirst) => {
    const fallback = vi.fn();
    // Source HTML becomes a code-block slice before handlePaste runs. This
    // normal-priority fallback models a block-paste plugin claiming that slice.
    const blockPaste = Extension.create({
      name: 'blockPasteFallback',
      addProseMirrorPlugins() {
        return [new Plugin({ props: { handlePaste(view, _event, slice) {
          fallback(slice.content.firstChild?.type.name);
          view.dispatch(view.state.tr.replaceSelection(slice));
          return true;
        } } })];
      },
    });
    editor = new Editor({
      extensions: [...baseExtensions, ...(markdownFirst ? [Markdown, blockPaste] : [blockPaste, Markdown])],
      content: '<p></p>',
    });
    pasteClipboard(editor, { text: '# Title\n\n- item', html: '<pre># Title\n\n- item</pre>' });
    expect(editor.state.doc.firstChild?.type.name).toBe('heading');
    expect(editor.state.doc.lastChild?.type.name).toBe('bulletList');
    expect(fallback).not.toHaveBeenCalled();

    editor.commands.setContent('<p></p>');
    pasteClipboard(editor, { text: '# Literal code', html: '<pre><code># Literal code</code></pre>' });
    expect(fallback).toHaveBeenCalledExactlyOnceWith('codeBlock');
    expect(editor.state.doc.firstChild?.type.name).toBe('codeBlock');
    expect(editor.state.doc.textContent).toBe('# Literal code');
  });

  it('handles a large source clipboard without losing content', () => {
    const instance = mount();
    const body = 'source content '.repeat(15_000);
    const text = `# Large README\n\n${body}`;
    expect(dispatchPaste(instance, pasteEvent({ text, html: `<pre>${text}</pre>` }))).toBe(true);
    expect(instance.state.doc.firstChild?.type.name).toBe('heading');
    expect(instance.state.doc.lastChild?.textContent).toBe(body.trimEnd());
  });

  it('handles deeply nested source decoration without recursive traversal failure', () => {
    const instance = mount();
    const html = `<pre>${'<span>'.repeat(400)}# Nested title${'</span>'.repeat(400)}</pre>`;
    expect(dispatchPaste(instance, pasteEvent({ text: '# Nested title', html }))).toBe(true);
    expect(instance.state.doc.firstChild?.type.name).toBe('heading');
    expect(instance.state.doc.textContent).toBe('Nested title');
  });
});

describe('looksLikeMarkdown', () => {
  it('detects block and inline syntax', () => {
    for (const sample of [
      '# heading',
      '- item',
      '1. item',
      '> quote',
      '```\ncode\n```',
      '$$\nx = 1\n$$',
      '| a | b |',
      'plain with **bold**',
      'a [link](https://x.com/)',
      '![img](https://e.com/i.png)',
    ]) {
      expect(looksLikeMarkdown(sample), sample).toBe(true);
    }
  });

  it('stays linear on pathological bracket floods', () => {
    // Quadratic scanning here froze the paste path on adversarial clipboards;
    // the runner's test timeout is the wall-clock guard (no flaky Date.now).
    expect(looksLikeMarkdown('['.repeat(50_000))).toBe(false);
    expect(looksLikeMarkdown('!['.repeat(25_000))).toBe(false);
  });

  it('rejects plain prose and bare URLs', () => {
    for (const sample of ['just words here.', 'see https://x.com/ for more', 'a*b', 'x _y_z']) {
      expect(looksLikeMarkdown(sample), sample).toBe(false);
    }
  });
});

describe('downloadMarkdown', () => {
  it('serializes and triggers an anchor download', () => {
    const instance = mount({ content: '<h1>Doc</h1>' });
    const createObjectURL = vi.fn(() => 'blob:mock');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    try {
      const result = downloadMarkdown(instance, 'doc.md');
      expect(result.markdown).toBe('# Doc');
      expect(createObjectURL).toHaveBeenCalledOnce();
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock');
      expect(click).toHaveBeenCalledOnce();
    } finally {
      click.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});
