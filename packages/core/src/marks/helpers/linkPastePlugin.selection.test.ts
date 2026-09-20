/**
 * A URL pasted over a selection that holds nothing a link can mark, such as a selected horizontal
 * rule or image, used to add the link to nothing: the paste changed nothing and the URL was lost.
 * It now replaces the selection with the linked address, as a pasted text replaces it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { NodeSelection, TextSelection } from '@domternal/pm/state';
import { pasteClipboard } from '@domternal/tests-clipboard-slices';
import { Editor } from '../../Editor.js';
import { CodeBlock, Document, HorizontalRule, Link, Paragraph, Text } from '../../index.js';

const URL = 'https://example.com/page';
const editors: Editor[] = [];
afterEach(() => { for (const editor of editors.splice(0)) editor.destroy(); });

function mount(content: string): Editor {
  const editor = new Editor({ extensions: [Document, Paragraph, Text, HorizontalRule, CodeBlock, Link], content });
  editors.push(editor);
  return editor;
}

describe('linkPastePlugin over a selection nothing in which takes a link', () => {
  it('replaces a selected horizontal rule with the linked address', () => {
    const editor = mount('<p>before</p><hr><p>after</p>');
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 8)));
    expect(editor.state.selection.toJSON()).toEqual({ type: 'node', anchor: 8 });

    expect(pasteClipboard(editor.view, { text: URL }).defaultPrevented).toBe(true);

    expect(editor.getHTML()).toBe(`<p>before</p><p><a href="${URL}">${URL}</a></p><p>after</p>`);
  });

  it('still links selected text, and the selected text keeps its words', () => {
    const editor = mount('<p>read this</p>');
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 6, 10)));
    pasteClipboard(editor.view, { text: URL });
    expect(editor.getHTML()).toBe(`<p>read <a href="${URL}">this</a></p>`);
  });

  it('puts the address as plain text over a selection in a code block, which takes no link', () => {
    const editor = mount('<pre><code>const a = 1;</code></pre>');
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 7, 8)));
    pasteClipboard(editor.view, { text: URL });
    expect(editor.state.doc.textContent).toBe(`const ${URL} = 1;`);
    expect(editor.getHTML()).not.toContain('<a ');
  });
});
