/**
 * ProseMirror's clipboard parse leaves a slice open where the pasted HTML
 * starts or ends inside a node, and an open node can lack what its schema
 * requires on that side. A web page copy that starts inside a nested list item
 * gives a list whose first item starts with the nested list, with no label
 * paragraph. SmartPaste inserts whole nodes, so it completes those sides first:
 * before, the paste inserted nothing (UniqueID threw on the broken item) or
 * committed a document that fails its schema check.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  Blockquote, BulletList, CodeBlock, Document, Editor, HardBreak, Heading, ListItem, OrderedList, Paragraph,
  TaskItem, TaskList, Text, UniqueID,
} from '@domternal/core';
import { Fragment, Slice } from '@domternal/pm/model';
import { TextSelection } from '@domternal/pm/state';
import { SmartPaste } from './SmartPaste.js';

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

/** Mounts `content` with the caret at `caret`, a position or the end of the document's last textblock. */
function mount(content: string, caret: number | 'end', ids = false): Editor {
  const editor = new Editor({
    element: document.body.appendChild(document.createElement('div')),
    extensions: [Document, Paragraph, Text, Heading, Blockquote, CodeBlock, HardBreak, BulletList, OrderedList, ListItem,
      TaskList, TaskItem, SmartPaste, ...(ids ? [UniqueID] : [])],
    content,
  });
  editors.push(editor);
  const at = caret === 'end' ? editor.state.doc.content.size - 1 - closingDepth(editor) : caret;
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, at)));
  return editor;
}

/** How many nodes close between the end of the last textblock and the end of the document, past the textblock's own. */
function closingDepth(editor: Editor): number {
  let depth = 0;
  for (let node = editor.state.doc.lastChild; node && !node.isTextblock; node = node.lastChild) depth++;
  return depth;
}

/** Pastes through ProseMirror's own clipboard parse, which is what leaves the slice open. */
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

const NESTED_FIRST = '<ul><li><ul><li>a</li></ul></li><li>b</li></ul>';
const NESTED_FIRST_DOC = 'bulletList(listItem(paragraph, bulletList(listItem(paragraph("a")))), listItem(paragraph("b")))';

describe('SmartPaste completes the open sides of a pasted slice', () => {
  it('gives a list whose first item starts with a nested list an empty label, keeping the nesting', () => {
    const editor = mount('<p></p>', 1);
    paste(editor, NESTED_FIRST);
    expect(editor.state.doc.toString()).toBe(`doc(${NESTED_FIRST_DOC})`);
    // The caret lands at the end of the pasted content.
    expect(editor.state.selection.$from.parent.textContent).toBe('b');
  });

  it('pastes the nested-first list exactly as the same list with an explicit empty label', () => {
    const explicit = mount('<p></p>', 1);
    paste(explicit, '<ul><li><p></p><ul><li>a</li></ul></li><li>b</li></ul>');
    const nested = mount('<p></p>', 1);
    paste(nested, NESTED_FIRST);
    expect(nested.state.doc.toJSON()).toEqual(explicit.state.doc.toJSON());
  });

  it('keeps the items Firefox copies without their list in one nested list', () => {
    const editor = mount('<p></p>', 1);
    paste(editor, '<li><ul><li>a</li></ul></li><li>b</li>');
    expect(editor.state.doc.toString()).toBe(`doc(${NESTED_FIRST_DOC})`);
  });

  it('keeps an ordered list one numbered list with its start', () => {
    const editor = mount('<p></p>', 1);
    paste(editor, '<ol start="3"><li><ol><li>a</li></ol></li><li>b</li></ol>');
    expect(editor.state.doc.toString())
      .toBe('doc(orderedList(listItem(paragraph, orderedList(listItem(paragraph("a")))), listItem(paragraph("b"))))');
    expect(editor.state.doc.firstChild?.attrs['start']).toBe(3);
  });

  it('keeps the checked state of to-dos whose first item starts with a nested task list', () => {
    const editor = mount('<p></p>', 1);
    paste(editor, '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><ul data-type="taskList">'
      + '<li data-type="taskItem" data-checked="true"><p>a</p></li></ul></li>'
      + '<li data-type="taskItem" data-checked="false"><p>b</p></li></ul>');
    expect(editor.state.doc.toString())
      .toBe('doc(taskList(taskItem(paragraph, taskList(taskItem(paragraph("a")))), taskItem(paragraph("b"))))');
    const checked: unknown[] = [];
    editor.state.doc.descendants(node => { if (node.type.name === 'taskItem') checked.push(node.attrs['checked']); });
    expect(checked).toEqual([true, true, false]);
  });

  it.each([
    ['a quote', '<ul><li><blockquote><p>a</p></blockquote></li><li>b</li></ul>', 'blockquote(paragraph("a"))'],
    ['a code block', '<ul><li><pre>a</pre></li><li>b</li></ul>', 'codeBlock("a")'],
  ])('keeps %s that starts an item in place under an empty label', (_name, html, block) => {
    const editor = mount('<p></p>', 1);
    paste(editor, html);
    expect(editor.state.doc.toString()).toBe(`doc(bulletList(listItem(paragraph, ${block}), listItem(paragraph("b"))))`);
  });

  it('keeps the text after the nested list in the first item', () => {
    const editor = mount('<p></p>', 1);
    paste(editor, '<ul><li><ul><li>a</li></ul>tail</li><li>b</li></ul>');
    expect(editor.state.doc.toString()).toBe(
      'doc(bulletList(listItem(paragraph, bulletList(listItem(paragraph("a"))), paragraph("tail")), listItem(paragraph("b"))))');
  });

  it('pastes a list in a list, as a partial Google Docs selection may write it, as separate lists after an empty item', () => {
    const editor = mount('<p></p>', 1);
    paste(editor, '<ul><ul><li>a</li></ul><li>b</li></ul>');
    expect(editor.state.doc.toString()).toBe(
      'doc(bulletList(listItem(paragraph)), bulletList(listItem(paragraph("a"))), bulletList(listItem(paragraph("b"))))');
  });

  it.each([
    ['an empty last item', '<ul><li>a</li><li></li></ul>', 'bulletList(listItem(paragraph("a")), listItem(paragraph))'],
    ['an empty first item', '<ul><li></li><li>b</li></ul>', 'bulletList(listItem(paragraph), listItem(paragraph("b")))'],
    ['an empty last quote', '<p>a</p><blockquote></blockquote>', 'paragraph("a"), blockquote(paragraph)'],
    ['an empty first quote', '<blockquote></blockquote><p>b</p>', 'blockquote(paragraph), paragraph("b")'],
  ])('keeps %s as an empty node its schema allows', (_name, html, expected) => {
    const editor = mount('<p></p>', 1);
    paste(editor, html);
    expect(editor.state.doc.toString()).toBe(`doc(${expected})`);
  });

  it('completes a nested-first list followed by a paragraph and one inside a quote', () => {
    const after = mount('<p></p>', 1);
    paste(after, `${NESTED_FIRST}<p>y</p>`);
    expect(after.state.doc.toString()).toBe(`doc(${NESTED_FIRST_DOC}, paragraph("y"))`);
    const quoted = mount('<p></p>', 1);
    paste(quoted, `<blockquote>${NESTED_FIRST}</blockquote>`);
    expect(quoted.state.doc.toString()).toBe(`doc(blockquote(${NESTED_FIRST_DOC}))`);
  });

  it('completes a slice open at its end only, below a single node', () => {
    const editor = mount('<p></p>', 1);
    paste(editor, '<p>x</p><blockquote><ul><li>a</li><li></li></ul></blockquote>');
    expect(editor.state.doc.toString())
      .toBe('doc(paragraph("x"), blockquote(bulletList(listItem(paragraph("a")), listItem(paragraph))))');
  });

  it('merges the completed items into a list item of the same kind as siblings', () => {
    const editor = mount('<ul><li><p>host</p></li></ul>', 'end');
    paste(editor, NESTED_FIRST);
    expect(editor.state.doc.toString()).toBe('doc(bulletList(listItem(paragraph("host")), '
      + 'listItem(paragraph, bulletList(listItem(paragraph("a")))), listItem(paragraph("b"))))');
  });

  it('splits a paragraph around the completed list when the caret is in its middle', () => {
    const editor = mount('<p>host</p>', 3);
    paste(editor, NESTED_FIRST);
    expect(editor.state.doc.toString()).toBe(`doc(paragraph("ho"), ${NESTED_FIRST_DOC}, paragraph("st"))`);
  });

  it('pastes an own copy that starts inside a nested item, which keeps its open depths, as one valid list', () => {
    const source = mount('<ul><li><p>one</p><ul><li><p>nested item</p></li></ul></li><li><p>top item</p></li></ul>', 1);
    let from = 0;
    let to = 0;
    source.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === 'nested item') from = pos + 2;
      if (node.isText && node.text === 'top item') to = pos + 3;
    });
    const { dom } = source.view.serializeForClipboard(source.state.doc.slice(from, to, true));
    expect(dom.innerHTML).toContain('data-pm-slice="5 3 []"');
    const editor = mount('<p></p>', 1);
    paste(editor, dom.innerHTML);
    expect(editor.state.doc.toString()).toBe(
      'doc(bulletList(listItem(paragraph, bulletList(listItem(paragraph("sted item")))), listItem(paragraph("top"))))');
  });

  it('gives every completed block an id with UniqueID instead of throwing on the broken item', () => {
    const editor = mount('<p></p>', 1, true);
    paste(editor, NESTED_FIRST);
    expect(editor.state.doc.toString()).toBe(`doc(${NESTED_FIRST_DOC})`);
    const ids: unknown[] = [];
    editor.state.doc.descendants(node => { if (node.isBlock) ids.push(node.attrs['id']); });
    expect(ids.every(id => typeof id === 'string' && id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('SmartPaste leaves a slice it cannot complete to ProseMirror', () => {
  /** Calls SmartPaste's paste handler with a hand-built slice, as the existing unit tests do. */
  function handle(editor: Editor, slice: Slice): boolean | undefined {
    const plugin = editor.state.plugins.find(candidate => candidate.spec.props?.handlePaste);
    return plugin?.spec.props?.handlePaste?.call(plugin, editor.view, new Event('paste') as ClipboardEvent, slice) as boolean | undefined;
  }

  it('returns false for an open side that no content before or after its children can make valid', () => {
    const editor = mount('<p>host</p>', 5);
    const { schema } = editor;
    // Text directly in a quote: no node the schema can create before it lets a quote hold it.
    const quote = schema.nodes['blockquote']?.create(null, schema.text('a'));
    if (quote === undefined) throw new Error('No quote type');
    const before = editor.state.doc;
    expect(handle(editor, new Slice(Fragment.from(quote), 1, 0))).toBe(false);
    expect(editor.state.doc.eq(before)).toBe(true);
  });

  it('returns false for a closed slice that holds a node its schema does not allow', () => {
    const editor = mount('<p>host</p>', 5);
    const { schema } = editor;
    const nested = schema.node('bulletList', null, [schema.node('listItem', null, [schema.node('paragraph', null, [schema.text('a')])])]);
    const broken = schema.nodes['bulletList']?.create(null, [schema.nodes['listItem']?.create(null, [nested])].filter(node => node !== undefined));
    if (broken === undefined) throw new Error('No list types');
    const before = editor.state.doc;
    expect(handle(editor, new Slice(Fragment.from(broken), 0, 0))).toBe(false);
    expect(editor.state.doc.eq(before)).toBe(true);
  });
});

const SHAPES: Record<string, string> = {
  'nested list first': NESTED_FIRST,
  'nested list only': '<ul><li><ul><li>a</li></ul></li></ul>',
  'ordered nested first': '<ol><li><ol><li>a</li></ol></li><li>b</li></ol>',
  'mixed kinds nested first': '<ol><li><ul><li>a</li></ul></li><li>b</li></ol>',
  'three levels nested first': '<ul><li><ul><li><ul><li>a</li></ul></li></ul></li><li>b</li></ul>',
  'list in a list': '<ul><ul><li>a</li></ul><li>b</li></ul>',
  'bare items with a nested list first': '<li><ul><li>a</li></ul></li><li>b</li>',
  'task list nested first': '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>a</p></li></ul></li><li data-type="taskItem" data-checked="false"><p>b</p></li></ul>',
  'bullet list first in a to-do': '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><ul><li>a</li></ul></li><li data-type="taskItem" data-checked="false"><p>b</p></li></ul>',
  'quote first in an item': '<ul><li><blockquote><p>a</p></blockquote></li><li>b</li></ul>',
  'code block first in an item': '<ul><li><pre>a</pre></li><li>b</li></ul>',
  'nested list first, then a paragraph': `${NESTED_FIRST}<p>y</p>`,
  'nested list first inside a quote': `<blockquote>${NESTED_FIRST}</blockquote>`,
  'empty last item': '<ul><li>a</li><li></li></ul>',
  'paragraph, then an empty quote': '<p>a</p><blockquote></blockquote>',
  'empty first item': '<ul><li></li><li>b</li></ul>',
  'empty quote first': '<blockquote></blockquote><p>b</p>',
};

const HOSTS: Record<string, [string, number | 'end']> = {
  'an empty paragraph': ['<p></p>', 1],
  'the end of a paragraph': ['<p>host</p>', 5],
  'the middle of a paragraph': ['<p>host</p>', 3],
  'the start of a paragraph': ['<p>host</p>', 1],
  'the end of a bullet item': ['<ul><li><p>host</p></li></ul>', 'end'],
  'the end of a numbered item': ['<ol><li><p>host</p></li></ol>', 'end'],
  'an empty bullet item': ['<ul><li><p></p></li></ul>', 'end'],
  'the end of a heading': ['<h2>host</h2>', 5],
};

for (const ids of [false, true]) {
  describe(`SmartPaste inserts every open slice shape${ids ? ' with UniqueID' : ''}`, () => {
    for (const [shape, html] of Object.entries(SHAPES)) {
      for (const [host, [content, caret]] of Object.entries(HOSTS)) {
        it(`${shape} into ${host}`, () => {
          const editor = mount(content, caret, ids);
          const before = editor.state.doc.textContent;
          paste(editor, html);
          const pasted = new DOMParser().parseFromString(html, 'text/html').body.textContent;
          expect(editor.state.doc.textContent.length).toBe(before.length + pasted.length);
          for (const letter of pasted) expect(editor.state.doc.textContent).toContain(letter);
        });
      }
    }
  });
}
