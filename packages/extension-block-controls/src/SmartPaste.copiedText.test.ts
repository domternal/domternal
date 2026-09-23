/**
 * Text copied from inside a list item, task item or quote. A ProseMirror copy records the
 * container as the slice's context, the paste rebuilds it around the text, and SmartPaste
 * inserted that as a whole block: a word pasted at the end of a paragraph landed after it as a
 * one-item list or a quote. It now joins the paragraph's text, as it does without SmartPaste.
 * Into a list, SmartPaste's list rules still keep a copied item's list and marker, and HTML from
 * outside an editor, without that context, still pastes its blocks as blocks.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Blockquote, BulletList, Document, Editor, Heading, ListItem, Paragraph, TaskItem, TaskList, Text } from '@domternal/core';
import { TextSelection } from '@domternal/pm/state';
import { SmartPaste } from './SmartPaste.js';

const editors: Editor[] = [];
afterEach(() => { for (const editor of editors.splice(0)) editor.destroy(); });

function mount(content: string): Editor {
  const editor = new Editor({
    element: document.body.appendChild(document.createElement('div')),
    extensions: [Document, Paragraph, Text, Heading, Blockquote, BulletList, ListItem, TaskList, TaskItem, SmartPaste],
    content,
  });
  editors.push(editor);
  return editor;
}

/** The position of the first occurrence of `text`, or of its end. */
function textPos(editor: Editor, text: string, end = false): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found < 0 && node.isText && node.text?.includes(text) === true) found = pos + node.text.indexOf(text) + (end ? text.length : 0);
  });
  return found;
}

/** What the editor's copy writes for `content` from the start of `text` to the end of `to`. */
function copy(content: string, text: string, to = text): string {
  const source = mount(content);
  source.view.dispatch(source.state.tr.setSelection(TextSelection.create(source.state.doc, textPos(source, text), textPos(source, to, true))));
  const flavors = new Map<string, string>();
  const event = new Event('copy', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { setData: (type: string, value: string) => { flavors.set(type, value); }, clearData: () => { flavors.clear(); }, getData: (type: string) => flavors.get(type) ?? '' },
  });
  source.view.dom.dispatchEvent(event);
  return flavors.get('text/html') ?? '';
}

function paste(editor: Editor, html: string): void {
  const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, 'clipboardData', {
    value: { types: ['text/html'], files: [], items: [], getData: (type: string) => (type === 'text/html' ? html : '') },
  });
  editor.view.dom.dispatchEvent(event);
}

describe('SmartPaste and text copied from inside a container', () => {
  for (const [name, content] of [
    ['a list item', '<ul><li><p>alpha beta</p></li></ul>'],
    ['a task item', '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>alpha beta</p></li></ul>'],
    ['a quote', '<blockquote><p>alpha beta</p></blockquote>'],
    ['a list in a quote', '<blockquote><ul><li><p>alpha beta</p></li></ul></blockquote>'],
  ] as const) {
    it(`joins a word copied from ${name} to the paragraph and heading it is pasted into`, () => {
      const html = copy(content, 'beta');
      expect(html).toContain('data-pm-slice');
      for (const [target, doc] of [['<p>x</p>', 'doc(paragraph("xbeta"))'], ['<h2>Head</h2>', 'doc(heading("Headbeta"))']] as const) {
        const editor = mount(target);
        editor.view.dispatch(editor.state.tr.setSelection(TextSelection.atEnd(editor.state.doc)));
        paste(editor, html);
        expect(editor.state.doc.toString(), target).toBe(doc);
      }
    });
  }

  it('keeps the list rules for a word copied from a list item into another list, which keep its list and marker', () => {
    const html = copy('<ul><li><p>alpha beta</p></li></ul>', 'beta');
    const editor = mount('<ul><li><p>one</p></li><li><p>two</p></li></ul>');
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 6)));
    paste(editor, html);
    expect(editor.state.doc.toString()).toBe('doc(bulletList(listItem(paragraph("one")), listItem(paragraph("beta")), listItem(paragraph("two"))))');
  });

  it('still pastes items copied across items, and a list from outside an editor, as a list', () => {
    for (const [html, items] of [
      [copy('<ul><li><p>alpha</p></li><li><p>beta</p></li></ul>', 'alpha', 'beta'), 'listItem(paragraph("alpha")), listItem(paragraph("beta"))'],
      ['<ul><li>beta</li></ul>', 'listItem(paragraph("beta"))'],
    ] as const) {
      const editor = mount('<p>x</p>');
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.atEnd(editor.state.doc)));
      paste(editor, html);
      expect(editor.state.doc.toString(), html).toBe(`doc(paragraph("x"), bulletList(${items}))`);
    }
  });
});
