import { describe, it, expect } from 'vitest';
import { inlineStyles } from './inlineStyles.js';

describe('inlineStyles', () => {
  // === Edge cases ===

  it('returns empty string for empty input', () => {
    expect(inlineStyles('')).toBe('');
  });

  it('returns plain text unchanged', () => {
    expect(inlineStyles('hello')).toBe('hello');
  });

  // === Blockquote ===

  it('adds border-left and color to blockquote', () => {
    const result = inlineStyles('<blockquote><p>Quote</p></blockquote>');
    expect(result).toContain('border-left: 3px solid #6a6a6a');
    expect(result).toContain('color: #6a6a6a');
    expect(result).toContain('padding: 0.25em 0 0.25em 1em');
  });

  // === Table ===

  it('adds border-collapse to table', () => {
    const result = inlineStyles('<table><tbody><tr><td>cell</td></tr></tbody></table>');
    expect(result).toContain('<table style="border-collapse: collapse');
  });

  it('adds border and padding to td', () => {
    const result = inlineStyles('<table><tbody><tr><td>cell</td></tr></tbody></table>');
    expect(result).toContain('border: 1px solid #e5e7eb');
    expect(result).toContain('padding: 0.5em 0.75em');
  });

  it('adds font-weight and background to th', () => {
    const result = inlineStyles('<table><tbody><tr><th>header</th></tr></tbody></table>');
    expect(result).toContain('font-weight: 600');
    expect(result).toContain('background: #f8f9fa');
  });

  it('converts data-text-align to inline text-align on td', () => {
    const result = inlineStyles('<table><tbody><tr><td data-text-align="center">cell</td></tr></tbody></table>');
    expect(result).toContain('text-align: center');
  });

  it('converts data-vertical-align to inline vertical-align on th', () => {
    const result = inlineStyles('<table><tbody><tr><th data-vertical-align="bottom">header</th></tr></tbody></table>');
    expect(result).toContain('vertical-align: bottom');
  });

  // === Code ===

  it('adds background and font-family to inline code', () => {
    const result = inlineStyles('<p>Some <code>code</code> here</p>');
    expect(result).toContain('background: #f0f0f0');
    expect(result).toContain('font-family:');
    expect(result).toContain('border: 1px solid #e5e7eb');
  });

  it('resets styles for code inside pre', () => {
    const result = inlineStyles('<pre><code>block</code></pre>');
    const codeMatch = /<code style="([^"]*)"/.exec(result);
    expect(codeMatch).toBeTruthy();
    const codeStyle = codeMatch![1];
    expect(codeStyle).toContain('background: none');
    expect(codeStyle).toContain('border: none');
    expect(codeStyle).toContain('padding: 0');
  });

  // === Code block (pre) ===

  it('adds background, font-family, padding to pre', () => {
    const result = inlineStyles('<pre><code>code</code></pre>');
    const preMatch = /<pre style="([^"]*)"/.exec(result);
    expect(preMatch).toBeTruthy();
    const preStyle = preMatch![1];
    expect(preStyle).toContain('background: #f0f0f0');
    expect(preStyle).toContain('font-family:');
    expect(preStyle).toContain('padding: 1em');
    expect(preStyle).toContain('border-radius: 0.375rem');
  });

  // === Horizontal rule ===

  it('adds border-top to hr', () => {
    const result = inlineStyles('<hr>');
    expect(result).toContain('border: none');
    expect(result).toContain('border-top: 2px solid #e5e7eb');
  });

  // === Links ===

  it('adds color and text-decoration to links', () => {
    const result = inlineStyles('<p><a href="https://example.com">link</a></p>');
    expect(result).toContain('color: #2563eb');
    expect(result).toContain('text-decoration: underline');
  });

  // === Images ===

  it('adds max-width and display to img', () => {
    const result = inlineStyles('<img src="test.png">');
    expect(result).toContain('max-width: 100%');
    expect(result).toContain('display: block');
  });

  it('preserves existing float style on img', () => {
    const result = inlineStyles('<img src="test.png" style="float: left; margin: 0 1em 1em 0;">');
    expect(result).toContain('max-width: 100%');
    expect(result).toContain('float: left');
  });

  // === Headings ===

  it('adds font-size to h1', () => {
    const result = inlineStyles('<h1>Title</h1>');
    expect(result).toContain('font-size: 2em');
    expect(result).toContain('font-weight: 700');
  });

  it('adds font-size to h2', () => {
    const result = inlineStyles('<h2>Title</h2>');
    expect(result).toContain('font-size: 1.5em');
  });

  it('adds font-size to h3', () => {
    const result = inlineStyles('<h3>Title</h3>');
    expect(result).toContain('font-size: 1.25em');
  });

  it('adds font-size to h4', () => {
    const result = inlineStyles('<h4>Title</h4>');
    expect(result).toContain('font-size: 1.1em');
  });

  it('adds font-size to h5', () => {
    const result = inlineStyles('<h5>Title</h5>');
    expect(result).toContain('font-size: 1em');
  });

  it('adds font-size to h6', () => {
    const result = inlineStyles('<h6>Title</h6>');
    expect(result).toContain('font-size: 0.9em');
  });

  // === Lists ===

  it('adds margin and padding to ul', () => {
    const result = inlineStyles('<ul><li>item</li></ul>');
    expect(result).toContain('<ul style="margin: 0.75em 0; padding-left: 1.5em');
  });

  it('adds margin and padding to ol', () => {
    const result = inlineStyles('<ol><li>item</li></ol>');
    expect(result).toContain('<ol style="margin: 0.75em 0; padding-left: 1.5em');
  });

  it('adds margin to li', () => {
    const result = inlineStyles('<ul><li>item</li></ul>');
    expect(result).toContain('margin: 0.25em 0');
  });

  // === Task list ===

  it('adds list-style none to task list', () => {
    const result = inlineStyles('<ul data-type="taskList"><li data-type="taskItem"><label><input type="checkbox"></label><div><p>task</p></div></li></ul>');
    expect(result).toContain('list-style: none');
    expect(result).toContain('padding-left: 0');
  });

  it('adds display flex to task item', () => {
    const result = inlineStyles('<ul data-type="taskList"><li data-type="taskItem"><label><input type="checkbox"></label><div><p>task</p></div></li></ul>');
    expect(result).toContain('display: flex');
    expect(result).toContain('gap: 0.5em');
  });

  it('adds line-through to checked task item content div', () => {
    const result = inlineStyles('<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked></label><div><p>done</p></div></li></ul>');
    expect(result).toContain('text-decoration: line-through');
    expect(result).toContain('opacity: 0.6');
  });

  it('does not add line-through to unchecked task item content div', () => {
    const result = inlineStyles('<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><label><input type="checkbox"></label><div><p>todo</p></div></li></ul>');
    expect(result).not.toContain('line-through');
  });

  // === Details / Accordion ===

  it('adds border and border-radius to details', () => {
    const result = inlineStyles('<details><summary>Title</summary><div data-details-content><p>Content</p></div></details>');
    expect(result).toContain('border: 1px solid #e5e7eb');
    expect(result).toContain('border-radius: 0.375rem');
  });

  it('adds font-weight and background to summary', () => {
    const result = inlineStyles('<details><summary>Title</summary></details>');
    expect(result).toContain('font-weight: 600');
    expect(result).toContain('background: #f8f9fa');
  });

  it('adds padding and border-top to details-content div', () => {
    const result = inlineStyles('<details><summary>Title</summary><div data-details-content><p>Content</p></div></details>');
    const divMatch = /<div data-details-content[^>]*style="([^"]*)"/.exec(result);
    expect(divMatch).toBeTruthy();
    expect(divMatch![1]).toContain('padding: 0.5em 0.75em');
    expect(divMatch![1]).toContain('border-top: 1px solid #e5e7eb');
  });

  // === Existing inline styles preserved ===

  it('preserves existing inline styles on td (background-color)', () => {
    const result = inlineStyles('<table><tbody><tr><td style="background-color: #ff0000">cell</td></tr></tbody></table>');
    expect(result).toContain('border: 1px solid #e5e7eb');
    expect(result).toContain('background-color: #ff0000');
  });

  it('preserves existing text-align style on element', () => {
    const result = inlineStyles('<p style="text-align: center">centered</p>');
    expect(result).toContain('text-align: center');
  });

  // === Overrides ===

  it('applies custom blockquote border override', () => {
    const result = inlineStyles('<blockquote><p>Quote</p></blockquote>', {
      blockquoteBorder: '5px solid red',
    });
    expect(result).toContain('border-left: 5px solid red');
    expect(result).not.toContain('3px solid #6a6a6a');
  });

  it('applies custom table border override', () => {
    const result = inlineStyles('<table><tbody><tr><td>cell</td></tr></tbody></table>', {
      tableBorder: '2px solid blue',
    });
    expect(result).toContain('border: 2px solid blue');
  });

  it('applies custom link color override', () => {
    const result = inlineStyles('<p><a href="#">link</a></p>', {
      linkColor: '#ff6600',
    });
    expect(result).toContain('color: #ff6600');
  });

  it('applies custom code background override', () => {
    const result = inlineStyles('<p><code>code</code></p>', {
      codeBg: '#fff3cd',
    });
    expect(result).toContain('background: #fff3cd');
  });

  it('applies multiple overrides simultaneously', () => {
    const html = '<blockquote><p>Quote</p></blockquote><table><tbody><tr><td>cell</td></tr></tbody></table>';
    const result = inlineStyles(html, {
      blockquoteBorder: '4px solid green',
      tableBorder: '3px dashed purple',
    });
    expect(result).toContain('border-left: 4px solid green');
    expect(result).toContain('border: 3px dashed purple');
  });

  it('non-overridden values use defaults', () => {
    const result = inlineStyles('<blockquote><p>Quote</p></blockquote><pre><code>code</code></pre>', {
      blockquoteBorder: '5px solid red',
    });
    // blockquote uses override
    expect(result).toContain('border-left: 5px solid red');
    // pre uses default
    expect(result).toContain('background: #f0f0f0');
  });

  // === Syntax highlighting ===

  it('adds inline color to hljs-keyword span', () => {
    const result = inlineStyles('<pre><code><span class="hljs-keyword">const</span></code></pre>');
    expect(result).toContain('color: #d73a49');
    expect(result).toContain('hljs-keyword');
  });

  it('adds inline color to hljs-string span', () => {
    const result = inlineStyles('<pre><code><span class="hljs-string">"hello"</span></code></pre>');
    expect(result).toContain('color: #032f62');
  });

  it('adds inline color to hljs-title span (function name)', () => {
    const result = inlineStyles('<pre><code><span class="hljs-title function_">greet</span></code></pre>');
    expect(result).toContain('color: #6f42c1');
  });

  it('adds inline color to hljs-comment span', () => {
    const result = inlineStyles('<pre><code><span class="hljs-comment">// note</span></code></pre>');
    expect(result).toContain('color: #6a737d');
  });

  it('adds inline color to hljs-number span', () => {
    const result = inlineStyles('<pre><code><span class="hljs-number">42</span></code></pre>');
    expect(result).toContain('color: #005cc5');
  });

  it('adds inline color to hljs-name (tag) span', () => {
    const result = inlineStyles('<pre><code><span class="hljs-name">div</span></code></pre>');
    expect(result).toContain('color: #22863a');
  });

  it('adds inline color to hljs-variable (built-in) span', () => {
    const result = inlineStyles('<pre><code><span class="hljs-variable">x</span></code></pre>');
    expect(result).toContain('color: #e36209');
  });

  it('adds bold to hljs-section span', () => {
    const result = inlineStyles('<pre><code><span class="hljs-section"># Title</span></code></pre>');
    expect(result).toContain('font-weight: bold');
    expect(result).toContain('color: #005cc5');
  });

  it('adds italic to hljs-emphasis span', () => {
    const result = inlineStyles('<pre><code><span class="hljs-emphasis">*text*</span></code></pre>');
    expect(result).toContain('font-style: italic');
  });

  it('adds background to hljs-addition span', () => {
    const result = inlineStyles('<pre><code><span class="hljs-addition">+line</span></code></pre>');
    expect(result).toContain('background-color: #f0fff4');
    expect(result).toContain('color: #22863a');
  });

  it('adds background to hljs-deletion span', () => {
    const result = inlineStyles('<pre><code><span class="hljs-deletion">-line</span></code></pre>');
    expect(result).toContain('background-color: #ffeef0');
    expect(result).toContain('color: #b31d28');
  });

  it('handles span with multiple hljs classes (picks first match)', () => {
    const result = inlineStyles('<pre><code><span class="hljs-meta hljs-keyword">@import</span></code></pre>');
    // hljs-meta matches first
    expect(result).toContain('color: #005cc5');
  });

  it('ignores spans without hljs classes', () => {
    const result = inlineStyles('<p><span class="custom">text</span></p>');
    expect(result).not.toContain('style=');
  });

  // === Summary cursor + list-style ===

  it('adds cursor pointer and list-style none to summary', () => {
    const result = inlineStyles('<details><summary>Title</summary></details>');
    expect(result).toContain('cursor: pointer');
    expect(result).toContain('list-style: none');
  });

  // === codeHighlighter callback ===

  it('calls codeHighlighter for pre>code blocks', () => {
    const result = inlineStyles('<pre><code>const x = 1;</code></pre>', {
      codeHighlighter: (code, lang) => {
        expect(code).toBe('const x = 1;');
        expect(lang).toBeNull();
        return '<span class="hljs-keyword">const</span> x = <span class="hljs-number">1</span>;';
      },
    });
    // Should contain the highlighted spans with inline styles
    expect(result).toContain('color: #d73a49'); // hljs-keyword
    expect(result).toContain('color: #005cc5'); // hljs-number
  });

  it('passes language from code class to codeHighlighter', () => {
    const result = inlineStyles('<pre><code class="language-javascript">let y</code></pre>', {
      codeHighlighter: (_code, lang) => {
        expect(lang).toBe('javascript');
        return '<span class="hljs-keyword">let</span> y';
      },
    });
    expect(result).toContain('color: #d73a49');
  });

  it('does not replace code content when codeHighlighter returns null', () => {
    const result = inlineStyles('<pre><code>plain code</code></pre>', {
      codeHighlighter: () => null,
    });
    expect(result).toContain('plain code');
    expect(result).not.toContain('hljs-');
  });

  it('does not call codeHighlighter for inline code', () => {
    let called = false;
    inlineStyles('<p><code>inline</code></p>', {
      codeHighlighter: () => { called = true; return null; },
    });
    expect(called).toBe(false);
  });
});
