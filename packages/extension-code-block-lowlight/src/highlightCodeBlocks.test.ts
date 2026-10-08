/**
 * The serialized HTML scanner behind generateHighlightedHTML, driven directly:
 * a DOM serializer never writes some of these shapes (an unclosed comment, a
 * numeric reference), so they are reachable only here.
 */
import { describe, it, expect, vi } from 'vitest';
import { decodeText, highlightCodeBlocks } from './highlightCodeBlocks.js';

const mark = (text: string, language: string | undefined): string => `[${language ?? '-'}:${text}]`;

describe('decodeText', () => {
  it('decodes the named references a serializer writes', () => {
    expect(decodeText('&amp; &lt; &gt; &quot; &apos; &nbsp;')).toBe('& < > " \'  ');
  });

  it('decodes once, so a double-encoded reference stays a reference', () => {
    expect(decodeText('&amp;lt;')).toBe('&lt;');
  });

  it('keeps an unknown named reference as written', () => {
    expect(decodeText('&copy; &unknown;')).toBe('&copy; &unknown;');
  });

  it('decodes decimal and hexadecimal references', () => {
    expect(decodeText('&#65;&#x42;&#X43;&#128512;')).toBe('ABC\u{1f600}');
  });

  it('keeps references beyond Unicode or naming a surrogate as written', () => {
    expect(decodeText('&#1114112; &#xD800; &#xdfff; &#55296;')).toBe('&#1114112; &#xD800; &#xdfff; &#55296;');
  });

  it('decodes the last scalar value and the ones next to the surrogate range', () => {
    expect(decodeText('&#x10FFFF;&#xD7FF;&#xE000;')).toBe('\u{10ffff}퟿');
  });
});

describe('highlightCodeBlocks', () => {
  it('highlights a code block with its language class, or none', () => {
    expect(highlightCodeBlocks('<pre><code class="language-js">a</code></pre><pre><code>b</code></pre>', mark))
      .toBe('<pre><code class="language-js">[js:a]</code></pre><pre><code>[-:b]</code></pre>');
  });

  it('keeps the serialized text when the highlighter returns null', () => {
    expect(highlightCodeBlocks('<pre><code>a &amp; b</code></pre>', () => null)).toBe('<pre><code>a &amp; b</code></pre>');
  });

  it('copies text after the last tag and text without any tag', () => {
    expect(highlightCodeBlocks('<p>a</p>tail', mark)).toBe('<p>a</p>tail');
    expect(highlightCodeBlocks('only text', mark)).toBe('only text');
    expect(highlightCodeBlocks('', mark)).toBe('');
  });

  it('copies a comment whole, never reading a code block inside it', () => {
    const html = '<!-- <pre><code>x</code></pre> --><pre><code>y</code></pre>';
    expect(highlightCodeBlocks(html, mark)).toBe('<!-- <pre><code>x</code></pre> --><pre><code>[-:y]</code></pre>');
  });

  it('copies an unclosed comment to the end', () => {
    expect(highlightCodeBlocks('<p>a</p><!-- <pre><code>x</code></pre>', mark)).toBe('<p>a</p><!-- <pre><code>x</code></pre>');
  });

  it('never reads a code block inside a quoted attribute value', () => {
    const html = '<img title="<pre><code>x</code></pre>" alt=\'<pre><code>y</code></pre>\'><pre><code>z</code></pre>';
    expect(highlightCodeBlocks(html, mark))
      .toBe('<img title="<pre><code>x</code></pre>" alt=\'<pre><code>y</code></pre>\'><pre><code>[-:z]</code></pre>');
  });

  it('copies an unterminated tag to the end', () => {
    expect(highlightCodeBlocks('<p>a</p><img title="x>', mark)).toBe('<p>a</p><img title="x>');
  });

  it('copies raw text elements whole, whatever their text holds', () => {
    const html = '<script>if (a < b) "<pre><code>x</code></pre>"</script><style>p::before { content: "<pre>" }</STYLE><pre><code>y</code></pre>';
    expect(highlightCodeBlocks(html, mark))
      .toBe('<script>if (a < b) "<pre><code>x</code></pre>"</script><style>p::before { content: "<pre>" }</STYLE><pre><code>[-:y]</code></pre>');
  });

  it('copies an unclosed raw text element to the end', () => {
    expect(highlightCodeBlocks('<noscript><pre><code>x</code></pre>', mark)).toBe('<noscript><pre><code>x</code></pre>');
  });

  it('leaves a pre without code, a code block without its close and a code block holding markup as they are', () => {
    const highlight = vi.fn(mark);
    expect(highlightCodeBlocks('<pre>plain</pre>', highlight)).toBe('<pre>plain</pre>');
    expect(highlightCodeBlocks('<pre><code>open', highlight)).toBe('<pre><code>open');
    expect(highlightCodeBlocks('<pre><code><b>x</b></code></pre>', highlight)).toBe('<pre><code><b>x</b></code></pre>');
    expect(highlight).not.toHaveBeenCalled();
  });

  it('reads tag names case-insensitively and ignores closing tags and stray angle brackets', () => {
    expect(highlightCodeBlocks('<PRE><code>x</code></pre></p>< b', mark)).toBe('<PRE><code>[-:x]</code></pre></p>< b');
  });
});
