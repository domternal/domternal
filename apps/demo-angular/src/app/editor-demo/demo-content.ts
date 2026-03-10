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
<p>This paragraph exists to create enough content so the editor has an internal scrollbar at 50vh max-height. Try typing <code>:smile</code> here to trigger the emoji suggestion dropdown, then scroll both the editor and the page.</p>
<ul>
  <li>First item in a list</li>
  <li>Second item with <strong>bold text</strong></li>
  <li>Third item with <em>italic text</em></li>
</ul>
<blockquote><p>A blockquote to add more vertical content to the editor.</p></blockquote>
<p>Another paragraph. Keep scrolling to test positioning behavior of floating elements.</p>
<h3>Even More Content</h3>
<p>This is filler text used to fill the editor so it has enough content to scroll internally at 50vh max-height. It helps test floating elements like the bubble menu, emoji picker, and toolbar dropdowns while scrolling.</p>
<p>Another filler paragraph. The more content here, the easier it is to verify that popups, tooltips, and dropdowns stay correctly positioned during scroll.</p>
<p>One more paragraph to ensure the editor has a visible scrollbar. Try selecting text, inserting emojis, or toggling list types while scrolling.</p>
<h3>Table Example</h3>
<table>
  <tr><th>Feature</th><th>Free</th><th>Pro</th></tr>
  <tr><td>Basic editing</td><td>Yes</td><td>Yes</td></tr>
  <tr><td>Tables</td><td>Yes</td><td>Yes</td></tr>
  <tr><td>Merge / Split cells</td><td>—</td><td>Yes</td></tr>
</table>
<details>
  <summary>Click to expand this accordion</summary>
  <div data-type="detailsContent">
    <p>This is the hidden content inside a details/accordion block. It can contain <strong>rich text</strong>, lists, and other block elements.</p>
    <ul><li>Item one</li><li>Item two</li></ul>
  </div>
</details>
<p>Try typing <code>:wave</code> anywhere to insert an emoji via the suggestion dropdown.</p>
<p><span style="font-size: 17px; font-family: Georgia">This paragraph uses a custom font size and family to test text style rendering.</span></p>`;
