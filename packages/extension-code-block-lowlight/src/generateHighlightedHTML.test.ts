/**
 * generateHighlightedHTML reads the generated HTML as markup (K1 to K3): only
 * real code blocks are highlighted, text inside an attribute is never
 * rewritten, code text is decoded once, and every ordinary output stays byte
 * for byte what it was (the snapshot was written by the previous version).
 */
import { describe, it, expect, vi } from 'vitest';
import { createLowlight, common } from 'lowlight';
import { Document, Text, Paragraph, Link, Bold, HardBreak } from '@domternal/core';
import type { AnyExtension, JSONContent } from '@domternal/core';
import { CodeBlockLowlight } from './CodeBlockLowlight.js';
import { generateHighlightedHTML } from './generateHighlightedHTML.js';

const lowlight = createLowlight(common);
const extensions: AnyExtension[] = [Document, Text, Paragraph, Link, Bold, HardBreak, CodeBlockLowlight.configure({ lowlight })];

const code = (text: string, language: string | null = null): JSONContent => ({
  type: 'codeBlock', attrs: { language }, ...(text === '' ? {} : { content: [{ type: 'text', text }] }),
});
const paragraph = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content });
const text = (value: string, marks: JSONContent['marks'] = []): JSONContent => ({ type: 'text', text: value, ...(marks.length > 0 && { marks }) });
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content });
const titled = (title: string): JSONContent => paragraph(text('x', [{ type: 'link', attrs: { href: 'https://ok.example/', title } }]));

const PAYLOADS = [
  '<pre><code>" onerror="alert(1)" x="</code></pre>',
  '<pre><code>x" onload="alert(1)" y="</code></pre>',
  '<pre><code>hello world " autofocus onfocus="alert(1)" z="</code></pre>',
  '<pre class="language-js"><code class="language-javascript">" onclick="alert(1)</code></pre>',
  "<pre><code>' onmouseover='alert(1)</code></pre>",
];
const OPTIONS = [{}, { defaultLanguage: 'plaintext' }, { defaultLanguage: 'markdown' }, { defaultLanguage: 'javascript' }, { autoDetect: true }];

/** The attributes of the link a generated paragraph holds. */
function linkAttributes(html: string): Record<string, string> {
  const host = document.createElement('div');
  host.innerHTML = html;
  const link = host.querySelector('a');
  return Object.fromEntries(Array.from(link?.attributes ?? []).map(attribute => [attribute.name, attribute.value]));
}

describe('generateHighlightedHTML reads markup, not text (K1)', () => {
  for (const options of OPTIONS) {
    it.each(PAYLOADS)(`keeps a title holding %j unchanged with ${JSON.stringify(options)}`, (payload) => {
      const html = generateHighlightedHTML(doc(titled(payload), code('const a = 1;', 'javascript')), extensions, lowlight, options);
      expect(linkAttributes(html)).toEqual({ href: 'https://ok.example/', title: payload });
      expect(html).not.toContain('hljs-attribute');
      // The real code block is still highlighted.
      expect(html).toContain('<span class="hljs-keyword">const</span>');
    });
  }

  it('highlights every real code block around attribute text', () => {
    const html = generateHighlightedHTML(doc(
      code('let a = 1;', 'javascript'), titled(PAYLOADS[0] ?? ''), code('x = 1', 'python'),
    ), extensions, lowlight);
    const host = document.createElement('div');
    host.innerHTML = html;
    expect(host.querySelectorAll('pre > code')).toHaveLength(2);
    expect(host.querySelectorAll('pre > code span[class^="hljs-"]').length).toBeGreaterThan(0);
    expect(html).toContain('<span class="hljs-keyword">let</span>');
    expect(html).toContain('<span class="hljs-number">1</span>');
    expect(linkAttributes(html)['title']).toBe(PAYLOADS[0]);
  });
});

describe('code text is decoded once (K2)', () => {
  it.each([
    ['const s = "&lt;b&gt;";', 'javascript'],
    ['a &amp;&amp; b', 'javascript'],
    ['x = "&quot;"', 'python'],
    ['&#39;&nbsp;&#x3C;', null],
  ])('shows %j literally', (source, language) => {
    const html = generateHighlightedHTML(doc(code(source, language)), extensions, lowlight, { autoDetect: true });
    const host = document.createElement('div');
    host.innerHTML = html;
    expect(host.querySelector('code')?.textContent).toBe(source);
  });

  it('keeps a no-break space as a character', () => {
    const html = generateHighlightedHTML(doc(code('a b', 'javascript')), extensions, lowlight);
    const host = document.createElement('div');
    host.innerHTML = html;
    expect(host.querySelector('code')?.textContent).toBe('a b');
  });

  it.each([
    ['<div class="a">&</div>', 'xml'],
    ['if (a < b && c > d) {}', 'javascript'],
    ['print("<tag>")', 'python'],
  ])('shows markup-like code %j as text', (source, language) => {
    const html = generateHighlightedHTML(doc(code(source, language)), extensions, lowlight);
    const host = document.createElement('div');
    host.innerHTML = html;
    expect(host.querySelector('code')?.textContent).toBe(source);
    expect(host.querySelectorAll('code div, code tag')).toHaveLength(0);
  });
});

describe('ordinary output is unchanged (K3)', () => {
  const CORPUS: [string, JSONContent, Parameters<typeof generateHighlightedHTML>[3]][] = [
    ['javascript', doc(code('function add(a, b) {\n  return a + b; // sum\n}', 'javascript')), {}],
    ['python', doc(code('def f(x):\n    return x * 2\n', 'python')), {}],
    ['css', doc(code('.a > .b { color: red; }', 'css')), {}],
    ['xml', doc(code('<div class="x">Hi & bye</div>', 'xml')), {}],
    ['json', doc(code('{"a": [1, 2, "three"], "b": null}', 'json')), {}],
    ['typescript', doc(code('const x: Map<string, number> = new Map();', 'typescript')), {}],
    ['quotes', doc(code(`it's "quoted" and 'single'`, 'javascript')), {}],
    ['unregistered', doc(code('some code', 'nonexistent')), {}],
    ['no language', doc(code('plain <text> & more', null)), {}],
    ['default language', doc(code('let a = 1;', null)), { defaultLanguage: 'javascript' }],
    ['auto detect', doc(code('SELECT * FROM t WHERE a = 1;', null)), { autoDetect: true }],
    ['empty', doc(code('', 'javascript')), { autoDetect: true }],
    ['mixed', doc(
      paragraph(text('Before '), text('bold', [{ type: 'bold' }]), text(' & "quotes"')),
      code('const a = "<b>";', 'javascript'),
      paragraph(text('link', [{ type: 'link', attrs: { href: 'https://ok.example/?a=1&b=2', title: 'T' } }])),
      code('x', 'nonexistent'),
      paragraph(text('line'), { type: 'hardBreak' }, text('break')),
    ), {}],
  ];

  it.each(CORPUS)('writes %s as before', (_label, content, options) => {
    expect(generateHighlightedHTML(content, extensions, lowlight, options)).toMatchSnapshot();
  });
});

describe('the document option', () => {
  it('serializes with the given document and highlights the same way', () => {
    const other = document.implementation.createHTMLDocument('');
    const createElement = vi.spyOn(other, 'createElement');
    const content = doc(code('const a = 1', 'javascript'));
    expect(generateHighlightedHTML(content, extensions, lowlight, { document: other })).toBe(generateHighlightedHTML(content, extensions, lowlight));
    expect(createElement).toHaveBeenCalled();
  });
});
