/**
 * PasteCleanup renames a heading to a level the editor supports only where the editor keeps it
 * as a heading, and reports only such a rename. Where the heading stands follows the editor's
 * schema, as Core's Heading decides: at the start of a list item, in a summary or in a
 * preformatted block it parses as that block's text when the schema holds the block, and stays
 * a heading when it does not; after an explicit item paragraph, even an empty one, it stays one.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { BulletList, CodeBlock, Document, Editor, Heading, History, ListItem, Paragraph, Text } from '@domternal/core';
import type { AnyExtension } from '@domternal/core';
import { TextSelection } from '@domternal/pm/state';
import { PasteCleanup } from './index.js';
import type { PasteOperationResult } from './index.js';

const ADAPTED = 'destination-heading-level-adapted';
const editors: Editor[] = [];
afterEach(() => { editors.splice(0).forEach(editor => { editor.destroy(); }); document.body.replaceChildren(); });

function mount(extensions: AnyExtension[]): { editor: Editor; completed: PasteOperationResult[] } {
  const completed: PasteOperationResult[] = [];
  const editor = new Editor({
    element: document.body.appendChild(document.createElement('div')), content: '<p></p>',
    extensions: [Document, Paragraph, Text, History, Heading, ...extensions, PasteCleanup.configure({ onPasteResult: result => { completed.push(result); } })],
  });
  editors.push(editor);
  return { editor, completed };
}

async function paste(editor: Editor, html: string): Promise<void> {
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1)));
  editor.view.pasteHTML(html, new Event('paste', { cancelable: true }) as ClipboardEvent);
  // onPasteResult follows in a microtask.
  await new Promise(resolve => { setTimeout(resolve, 0); });
}

const codes = (completed: PasteOperationResult[]): string[] => completed.flatMap(result => result.diagnostics.map(diagnostic => diagnostic.code));

describe('heading renames that follow where the editor keeps a heading', () => {
  it('renames and reports a heading at a list item start in an editor without lists, which keeps it as a heading', async () => {
    const { editor, completed } = mount([]);
    await paste(editor, '<ul><li><h6>Item</h6></li></ul>');
    expect(editor.getHTML()).toBe('<h4>Item</h4>');
    expect(codes(completed)).toContain(ADAPTED);
  });

  it('leaves a heading at a list item start alone in an editor with lists, which parses it as the item text', async () => {
    const { editor, completed } = mount([BulletList, ListItem]);
    await paste(editor, '<ul><li><h6>Item</h6></li></ul>');
    expect(editor.getHTML()).toBe('<ul><li><p>Item</p></li></ul>');
    expect(codes(completed)).not.toContain(ADAPTED);
  });

  it('renames and reports a heading after an empty item paragraph, which the editor keeps', async () => {
    const { editor, completed } = mount([BulletList, ListItem]);
    await paste(editor, '<ul><li><p></p><h6>Item</h6></li></ul>');
    expect(editor.getHTML()).toBe('<ul><li><p></p><h4>Item</h4></li></ul>');
    expect(codes(completed)).toContain(ADAPTED);
  });

  it('follows a code block the editor holds, or lacks, for a heading in a preformatted block', async () => {
    const withCode = mount([CodeBlock]);
    await paste(withCode.editor, '<pre><h6>code</h6></pre>');
    expect(withCode.editor.getHTML()).toBe('<pre><code>code</code></pre>');
    expect(codes(withCode.completed)).not.toContain(ADAPTED);

    const withoutCode = mount([]);
    await paste(withoutCode.editor, '<pre><h6>code</h6></pre>');
    expect(withoutCode.editor.getHTML()).toBe('<h4>code</h4>');
    expect(codes(withoutCode.completed)).toContain(ADAPTED);
  });
});
