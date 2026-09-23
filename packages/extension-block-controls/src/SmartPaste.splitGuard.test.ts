/**
 * SmartPaste splits the caret's block, or its list item, only where the split
 * leaves content the schema allows. Elsewhere the pasted content lands at the
 * caret as any other block does, or through ProseMirror's own paste, instead
 * of throwing and inserting nothing.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  Blockquote, BulletList, CodeBlock, Document, Editor, HardBreak, Heading, ListItem, Node, OrderedList, Paragraph,
  TaskItem, TaskList, Text,
} from '@domternal/core';
import { TextSelection } from '@domternal/pm/state';
import { SmartPaste } from './SmartPaste.js';

// A details-like pair: an isolating summary of inline content, then block content.
const Box = Node.create({
  name: 'box', group: 'block', content: 'boxSummary boxContent',
  parseHTML: () => [{ tag: 'details' }], renderHTML: () => ['details', 0],
});
const BoxSummary = Node.create({
  name: 'boxSummary', content: 'inline*', defining: true, isolating: true,
  parseHTML: () => [{ tag: 'summary' }], renderHTML: () => ['summary', 0],
});
const BoxContent = Node.create({
  name: 'boxContent', content: 'block+', defining: true,
  parseHTML: () => [{ tag: 'div[data-box]' }], renderHTML: () => ['div', { 'data-box': '' }, 0],
});

const editors: Editor[] = [];
const reported: string[] = [];
const report = (event: ErrorEvent): void => {
  event.preventDefault();
  reported.push(event.error instanceof Error ? event.error.message : event.message);
};
window.addEventListener('error', report);
afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors.length = 0;
  reported.length = 0;
  document.body.replaceChildren();
});

/** Mounts the content and places the caret right after `before`, the first match in document order. */
function mount(content: string, before: string): Editor {
  const editor = new Editor({
    element: document.body.appendChild(document.createElement('div')),
    extensions: [Document, Paragraph, Text, Heading, Blockquote, CodeBlock, HardBreak, BulletList, OrderedList, ListItem,
      TaskList, TaskItem, Box, BoxSummary, BoxContent, SmartPaste],
    content,
  });
  editors.push(editor);
  let caret = -1;
  editor.state.doc.descendants((node, pos) => {
    if (caret < 0 && node.isText && node.text?.includes(before)) caret = pos + (node.text.indexOf(before)) + before.length;
  });
  if (caret < 0) throw new Error(`No text ${before}`);
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, caret)));
  return editor;
}

function paste(editor: Editor, html: string): void {
  let thrown: unknown;
  try {
    editor.view.pasteHTML(html, new Event('paste', { cancelable: true }) as ClipboardEvent);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeUndefined();
  expect(reported).toEqual([]);
  expect(() => { editor.state.doc.check(); }).not.toThrow();
}

const LISTS = {
  'a bullet': '<ul><li><p>Item</p></li></ul>',
  'an ordered': '<ol><li><p>Item</p></li></ol>',
  'a task': '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Item</p></li></ul>',
};

describe('SmartPaste split guard', () => {
  describe('a list pasted in the middle of a later block of a list item', () => {
    it.each(Object.entries(LISTS))('lands %s list between the halves of a heading, which cannot start an item', (_kind, list) => {
      const editor = mount('<ul><li><p>Label</p><h4>Hello world</h4></li></ul>', 'Hello ');
      paste(editor, list);
      const item = editor.state.doc.firstChild?.firstChild;
      expect(item?.childCount).toBe(4);
      expect([item?.child(0).textContent, item?.child(1).type.name, item?.child(1).textContent, item?.child(3).textContent])
        .toEqual(['Label', 'heading', 'Hello ', 'world']);
      expect(item?.child(2).textContent).toBe('Item');
      expect(editor.state.doc.childCount).toBe(1);
    });

    it.each(Object.entries(LISTS))('lands %s list between the halves of a code block', (_kind, list) => {
      const editor = mount('<ul><li><p>Label</p><pre><code>Hello world</code></pre></li></ul>', 'Hello ');
      paste(editor, list);
      const item = editor.state.doc.firstChild?.firstChild;
      expect(item?.textContent).toBe('LabelHello Itemworld');
      expect(editor.state.doc.childCount).toBe(1);
    });

    it.each(Object.entries(LISTS))('lands %s list at the caret inside a blockquote of the item', (_kind, list) => {
      const editor = mount('<ul><li><p>Label</p><blockquote><p>Hello world</p></blockquote></li></ul>', 'Hello ');
      paste(editor, list);
      const item = editor.state.doc.firstChild?.firstChild;
      expect(item?.childCount).toBe(2);
      expect(item?.child(1).type.name).toBe('blockquote');
      expect(item?.child(1).textContent).toBe('Hello Itemworld');
    });

    it.each(Object.entries(LISTS))('lands %s list between the halves of a heading in a task item', (_kind, list) => {
      const editor = mount('<ul data-type="taskList"><li data-type="taskItem"><p>Label</p><h4>Hello world</h4></li></ul>', 'Hello ');
      paste(editor, list);
      const item = editor.state.doc.firstChild?.firstChild;
      expect(item?.type.name).toBe('taskItem');
      expect(item?.childCount).toBe(4);
      expect(item?.textContent).toBe('LabelHello Itemworld');
    });

    it('still splits the item when the caret is in its label or a later paragraph', () => {
      const label = mount('<ul><li><p>Hello world</p></li></ul>', 'Hello ');
      paste(label, LISTS['a bullet']);
      expect(label.getHTML()).toBe('<ul><li><p>Hello </p></li><li><p>Item</p></li><li><p>world</p></li></ul>');
      const later = mount('<ul><li><p>Label</p><p>Hello world</p></li></ul>', 'Hello ');
      paste(later, LISTS['a bullet']);
      expect(later.getHTML()).toBe('<ul><li><p>Label</p><p>Hello </p></li><li><p>Item</p></li><li><p>world</p></li></ul>');
    });
  });

  describe('a block pasted into a block that cannot be split', () => {
    it.each([['start', '|'], ['end', 'Hello world']])('keeps the summary whole when pasting at its %s', (_name, before) => {
      const editor = before === '|'
        ? mount('<details><summary>Hello world</summary><div data-box><p>Body</p></div></details>', '')
        : mount('<details><summary>Hello world</summary><div data-box><p>Body</p></div></details>', before);
      paste(editor, '<h2>Item</h2>');
      expect(editor.state.doc.firstChild?.childCount).toBe(2);
      expect(editor.state.doc.textContent).toContain('Item');
    });

    // SmartPaste inserted the block beside the summary, where the box takes none, so the box split in
    // two: the content went to a second box with an empty summary. It leaves such a paste to the
    // summary's owner, which Details is for its summary, or to ProseMirror's own paste, which joins
    // one block's text to the summary.
    it.each([['start', '|'], ['end', 'Hello world'], ['middle', 'Hello ']])('leaves a heading pasted at the %s of the summary to ProseMirror, which joins its text', (name, before) => {
      const editor = mount('<details><summary>Hello world</summary><div data-box><p>Body</p></div></details>', before === '|' ? '' : before);
      if (before === '|') editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2)));
      paste(editor, '<h2>Item</h2>');
      const summary = { start: 'ItemHello world', end: 'Hello worldItem', middle: 'Hello Itemworld' }[name];
      expect(editor.state.doc.toString()).toBe(`doc(box(boxSummary("${String(summary)}"), boxContent(paragraph("Body"))))`);
    });

    it.each([
      ['a heading', '<h2>Item</h2>'], ['a blockquote', '<blockquote><p>Item</p></blockquote>'], ['a code block', '<pre><code>Item</code></pre>'],
      ['blocks', '<p>Item</p><h2>Second</h2>'], ...Object.entries(LISTS).map(([kind, list]) => [`${kind} list`, list]),
    ])('pastes %s into the middle of an isolating summary through ProseMirror, keeping one summary', (_name, html) => {
      const editor = mount('<details><summary>Hello world</summary><div data-box><p>Body</p></div></details>', 'Hello ');
      paste(editor, html);
      const box = editor.state.doc.firstChild;
      expect(box?.type.name).toBe('box');
      expect(box?.childCount).toBe(2);
      expect(editor.state.doc.textContent).toContain('Item');
    });
  });
});
