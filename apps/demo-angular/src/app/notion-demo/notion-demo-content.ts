export const NOTION_DEMO_CONTENT = `
<h1>Untitled</h1>
<p>Welcome to a clean, distraction-free editor. Select any text to format it via the bubble menu, or move the cursor to an empty line to bring up the floating menu for inserting blocks.</p>

<h2>Playground</h2>
<p>Hover any block in this page to reveal the drag handle on the left. Grab it to reorder the block, or click it to open actions: <strong>Delete</strong>, <strong>Duplicate</strong>, <strong>Copy link</strong>, block colors, and <strong>Turn into</strong>.</p>
<p>You can also press <code>Mod+Shift+↑</code> / <code>Mod+Shift+↓</code> to move the current block without the mouse.</p>

<h2>Things to try</h2>
<ul>
  <li><p>Drag this list item above another one - nested handles are enabled</p></li>
  <li><p>Click the drag handle, open Colors, pick yellow background</p></li>
  <li><p>Type <code>/</code> on an empty line to insert a new block</p></li>
</ul>

<h2>Checklist</h2>
<ul data-type="taskList">
  <li data-type="taskItem" data-checked="false"><p>Basic formatting (bold, italic, code, link)</p></li>
  <li data-type="taskItem" data-checked="true"><p>Block drag handle + context menu</p></li>
  <li data-type="taskItem" data-checked="false">
    <p>AI autocomplete integration</p>
    <ul data-type="taskList">
      <li data-type="taskItem" data-checked="true"><p>Wire up provider abstraction</p></li>
      <li data-type="taskItem" data-checked="false"><p>Streaming completions</p></li>
      <li data-type="taskItem" data-checked="false"><p>Inline accept/reject UI</p></li>
    </ul>
  </li>
  <li data-type="taskItem" data-checked="false"><p>Real-time collaboration</p></li>
</ul>

<h2>A quote</h2>
<blockquote><p>Simplicity is the ultimate sophistication.</p></blockquote>

<h2>Sample code</h2>
<pre><code class="language-typescript">function greet(name: string): string {
  return \`Hello, \${name}!\`;
}
</code></pre>

<p></p>
`;
