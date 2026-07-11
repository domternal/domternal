export const DEMO_CONTENT = `
<h2>Rich Text Editor</h2>
<p>Hello <strong>World</strong>! Try the toolbar buttons above.</p>
<pre><code class="language-javascript">function greet(name) {
  const message = \`Hello, \${name}!\`;
  console.log(message);
  return message;
}</code></pre>
<p>Code blocks now have <em>syntax highlighting</em>.</p>
<h3>More Content for Scrolling</h3>
<p>This paragraph adds more content to the editor. Try typing <code>:smile</code> here to trigger the emoji suggestion dropdown.</p>
<ul>
  <li>First item in a list</li>
  <li>Second item with <strong>bold text</strong></li>
  <li>Third item with <em>italic text</em></li>
</ul>
<blockquote><p>A blockquote to add more vertical content to the editor.</p></blockquote>
<p>Another paragraph. Keep scrolling to test positioning behavior of floating elements.</p>
<h3>Even More Content</h3>
<p>Try selecting text to see the bubble menu, or insert emojis and toggle list types with the toolbar.</p>
<h3>Table Example</h3>
<table>
  <tr><th>Feature</th><th>Free</th><th>Pro</th></tr>
  <tr><td>Basic editing</td><td>Yes</td><td>Yes</td></tr>
  <tr><td>Tables</td><td>Yes</td><td>Yes</td></tr>
  <tr><td>Merge / Split cells</td><td>-</td><td>Yes</td></tr>
</table>
<details>
  <summary>Click to expand this accordion</summary>
  <div data-type="detailsContent">
    <p>This is the hidden content inside a details/accordion block. It can contain <strong>rich text</strong>, lists, and other block elements.</p>
    <ul><li>Item one</li><li>Item two</li></ul>
  </div>
</details>
<h3>Mentions</h3>
<p>Type <code>@</code> followed by a name to mention someone: <span data-type="mention" data-id="1" data-label="Alice Johnson" data-mention-type="user" class="mention">@Alice Johnson</span> and <span data-type="mention" data-id="7" data-label="Grace Hopper" data-mention-type="user" class="mention">@Grace Hopper</span> are already mentioned here.</p>
<p>Try typing <code>:wave</code> anywhere to insert an emoji via the suggestion dropdown.</p>
<p><span style="font-size: 17px; font-family: Georgia">This paragraph uses a custom font size and family to test text style rendering.</span></p>
<h3>Math (KaTeX)</h3>
<p>Inline math like <span data-type="math-inline" data-latex="E = mc^2"></span> and <span data-type="math-inline" data-latex="\\frac{a}{b}"></span> flow with the text, and a long inline sum <span data-type="math-inline" data-latex="\\alpha_1 + \\alpha_2 + \\alpha_3 + \\cdots + \\alpha_n"></span> wraps across lines.</p>
<p>Block equations center when they fit:</p>
<div data-type="math-block" data-latex="\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}"></div>
<p>and scroll horizontally when they are too wide, instead of being clipped:</p>
<div data-type="math-block" data-latex="P(x) = c_0 + c_1 x + c_2 x^2 + c_3 x^3 + c_4 x^4 + c_5 x^5 + c_6 x^6 + c_7 x^7 + c_8 x^8 + c_9 x^9 + c_{10} x^{10} + c_{11} x^{11} + c_{12} x^{12} + c_{13} x^{13} + c_{14} x^{14}"></div>`;
