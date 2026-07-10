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
  Heading,
  Italic,
  Link,
  ListItem,
  OrderedList,
  Paragraph,
  Text,
} from '@domternal/core';
import { TextSelection } from '@domternal/pm/state';
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
  return {
    clipboardData: {
      getData: (type: string) => (type === 'text/plain' ? text : type === 'text/html' ? html : ''),
    },
    preventDefault: () => undefined,
  } as unknown as ClipboardEvent;
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
