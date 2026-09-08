/**
 * Pasted HTML whose data-pm-slice context names wrappers ProseMirror never
 * writes, or wrappers that cannot hold the pasted content, through the Core
 * editor without PasteCleanup. The browser matrix is e2e/paste-slice-context.browser.ts.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Plugin } from '@domternal/pm/state';
import { AllSelection, TextSelection } from '@domternal/pm/state';
import {
  Blockquote, BulletList, CodeBlock, Document, Editor, Extension, HardBreak, Heading, HorizontalRule, ListItem, Node,
  OrderedList, Paragraph, TaskItem, TaskList, Text,
} from '../index.js';

// A container whose content no pasted paragraph can fill, as a details node's summary and content.
const QuotePair = Node.create({
  name: 'quotePair', group: 'block', content: 'blockquote blockquote',
  parseHTML: () => [{ tag: 'div[data-quote-pair]' }],
  renderHTML: () => ['div', { 'data-quote-pair': '' }, 0],
});

const editors: Editor[] = [];
afterEach(() => { for (const editor of editors) editor.destroy(); editors.length = 0; document.body.replaceChildren(); });

function mount(content: string, extensions: Extension[] = []): Editor {
  const element = document.body.appendChild(document.createElement('div'));
  const editor = new Editor({
    element, content,
    extensions: [Document, Paragraph, Text, Heading.configure({ levels: [1, 2, 3, 4] }), BulletList, OrderedList, ListItem,
      TaskList, TaskItem, Blockquote, CodeBlock, HardBreak, HorizontalRule, QuotePair, ...extensions],
  });
  editors.push(editor);
  return editor;
}

type Caret = number | 'start' | 'end' | 'all';
const SEEDS: Record<string, [string, Caret]> = {
  'an empty paragraph': ['<p></p>', 'end'],
  'the middle of a paragraph': ['<p>Hello world</p>', 7],
  'the end of a paragraph': ['<p>Hello</p>', 'end'],
  'the start of a paragraph': ['<p>Hello</p>', 'start'],
  'a heading': ['<h2>Title</h2>', 4],
  'an empty heading': ['<h2></h2>', 'end'],
  'a list item': ['<ul><li><p>Item</p></li></ul>', 4],
  'a blockquote': ['<blockquote><p>Quote</p></blockquote>', 4],
  'a code block': ['<pre><code>code</code></pre>', 3],
  'the whole document': ['<p>One</p><p>Two</p>', 'all'],
};

function seed(name: string): Editor {
  const [content, caret] = SEEDS[name] ?? ['<p></p>', 'end'];
  const editor = mount(content);
  const { doc } = editor.state;
  const selection = caret === 'all' ? new AllSelection(doc)
    : TextSelection.create(doc, caret === 'start' ? 1 : caret === 'end' ? doc.content.size - 1 : caret);
  editor.view.dispatch(editor.state.tr.setSelection(selection));
  return editor;
}

// jsdom has no ClipboardEvent, which pasteHTML creates when it gets no event.
function paste(editor: Editor, html: string): boolean {
  return editor.view.pasteHTML(html, new Event('paste', { cancelable: true }) as ClipboardEvent);
}

function attribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function sliceHTML(open: string, context: string, fragment: 'one' | 'two'): string {
  const marker = `data-pm-slice="${open} ${attribute(context)}"`;
  return fragment === 'one' ? `<p ${marker}>Pasted</p>` : `<p ${marker}>Alpha</p><p>Beta</p>`;
}

function pasteOutcome(seedName: string, html: string): { doc: unknown; text: string } {
  const editor = seed(seedName);
  expect(paste(editor, html)).toBe(true);
  expect(() => { editor.state.doc.check(); }).not.toThrow();
  return { doc: editor.getJSON(), text: editor.state.doc.textContent };
}

// Each of these made prosemirror-transform's replaceRange or prosemirror-view's addContext throw.
const THROWING = [
  '["heading",{"level":2}]', '["heading",null]', '["codeBlock",null]', '["codeBlock",{"language":"js"}]',
  '["blockquote",null,"paragraph",null]', '["hardBreak",null]', '["horizontalRule",null]', '["heading",{"level":9}]',
  '["heading",{"level":"5"}]', '["text",null]', 'null', '["listItem",null,"heading",{"level":1}]', '["quotePair",null]',
  '["blockquote",null,"quotePair",null]',
];
// ProseMirror never writes these: a textblock or the top node. They paste as an empty context does.
const NEVER_WRITTEN = [
  '["paragraph",null]', '["doc",null]', '["doc",null,"paragraph",null]', '["paragraph",null,"doc",null]',
  '["heading",{"level":2}]', '["codeBlock",null]', '["hardBreak",null]', '["text",null]', 'null', '5', '"heading"', '{}',
  '[["heading"],null]', '["blockquote",null,"paragraph",null]',
];
// ProseMirror writes these for its own copies: they keep today's outcome.
const WRITTEN = [
  '["bulletList",null]', '["orderedList",{"start":3}]', '["listItem",null]', '["listItem",null,"listItem",null]',
  '["blockquote",null]', '["bulletList",null,"listItem",null]', '["taskList",null,"taskItem",{"checked":true}]',
  '["blockquote",null,"blockquote",null]',
];

describe('pasting a data-pm-slice context ProseMirror never writes or cannot fill', () => {
  for (const context of THROWING) {
    for (const open of ['0 0', '1 1']) {
      for (const fragment of ['one', 'two'] as const) {
        it.each(Object.keys(SEEDS))(`pastes ${context} ${open} (${fragment}) into %s without throwing`, seedName => {
          const { text } = pasteOutcome(seedName, sliceHTML(open, context, fragment));
          for (const word of fragment === 'one' ? ['Pasted'] : ['Alpha', 'Beta']) expect(text).toContain(word);
        });
      }
    }
  }

  for (const context of NEVER_WRITTEN) {
    it.each(Object.keys(SEEDS))(`pastes ${context} as an empty context into %s`, seedName => {
      for (const open of ['0 0', '1 1']) {
        for (const fragment of ['one', 'two'] as const) {
          expect(pasteOutcome(seedName, sliceHTML(open, context, fragment)))
            .toEqual(pasteOutcome(seedName, sliceHTML(open, '[]', fragment)));
        }
      }
    });
  }

  for (const context of WRITTEN) {
    it.each(Object.keys(SEEDS))(`keeps the ${context} context ProseMirror writes when pasting into %s`, seedName => {
      for (const open of ['0 0', '1 1']) {
        const { text } = pasteOutcome(seedName, sliceHTML(open, context, 'one'));
        expect(text).toContain('Pasted');
      }
    });
  }

  it('keeps a list context around its list item, as a ProseMirror copy of a list item writes it', () => {
    const editor = seed('an empty paragraph');
    expect(paste(editor, `<li data-pm-slice="2 2 ${attribute('["bulletList",null]')}"><p>One</p></li>`)).toBe(true);
    expect(editor.getJSON().content?.[0]).toMatchObject({ type: 'bulletList', content: [{ type: 'listItem' }] });
  });

  it('rebuilds a blockquote context ProseMirror writes around a copied paragraph', () => {
    const editor = seed('an empty paragraph');
    const source = mount('<blockquote><p>Quoted words</p></blockquote>');
    source.view.dispatch(source.state.tr.setSelection(TextSelection.create(source.state.doc, 3, 8)));
    const { dom } = source.view.serializeForClipboard(source.state.selection.content());
    expect(dom.innerHTML).toContain('data-pm-slice');
    expect(paste(editor, dom.innerHTML)).toBe(true);
    expect(editor.state.doc.textContent).toBe('uoted');
  });

  it('stops where ProseMirror stops: at a type the schema lacks', () => {
    // The innermost entry is unknown, so ProseMirror applies nothing and the heading outside it is harmless.
    const unknown = pasteOutcome('an empty paragraph', sliceHTML('0 0', '["heading",null,"unknownType",null]', 'one'));
    expect(unknown).toEqual(pasteOutcome('an empty paragraph', sliceHTML('0 0', '[]', 'one')));
  });

  it('ignores a context that is not JSON or a marker without open depths, as ProseMirror does', () => {
    for (const marker of ['0 0 [heading', '0 0 {', 'x y ["heading",null]', '["heading",null]', '']) {
      const html = `<p data-pm-slice="${attribute(marker)}">Pasted</p>`;
      expect(pasteOutcome('an empty paragraph', html).text).toBe('Pasted');
    }
  });

  it('keeps the table wrapper count while emptying the context', () => {
    // A copied table part descends through its wrappers before reading the context.
    const editor = seed('an empty paragraph');
    const html = `<table><tbody><tr><td data-pm-slice="1 1 -2 ${attribute('["heading",null]')}"><p>Cell</p></td></tr></tbody></table>`;
    expect(paste(editor, html)).toBe(true);
    expect(() => { editor.state.doc.check(); }).not.toThrow();
    expect(editor.state.doc.textContent).toContain('Cell');
  });

  it('judges the first marker in document order, the one ProseMirror reads', () => {
    const first = `<p data-pm-slice="0 0 ${attribute('["heading",null]')}">Pasted</p>`;
    const second = `<p data-pm-slice="0 0 ${attribute('["blockquote",null]')}">Second</p>`;
    const outcome = pasteOutcome('an empty paragraph', first + second);
    expect(outcome.text).toBe('PastedSecond');
    expect(JSON.stringify(outcome.doc)).not.toContain('blockquote');
  });

  it('checks the HTML every paste transform produced, including one that adds a context after Core', () => {
    const Late = Extension.create({
      name: 'lateContext',
      priority: 1,
      addProseMirrorPlugins: () => [new Plugin({ props: {
        transformPastedHTML: html => html.replace('<p>', `<p data-pm-slice="0 0 ${attribute('["text",null]')}">`),
      } })],
    });
    const editor = mount('<p></p>', [Late]);
    expect(paste(editor, '<p>Late</p>')).toBe(true);
    expect(editor.state.doc.textContent).toBe('Late');
  });

  it('gives every transformPasted plugin a slice whose wrappers can hold their content', () => {
    const seen: string[] = [];
    const Observer = Extension.create({
      name: 'sliceObserver',
      addProseMirrorPlugins: () => [new Plugin({ props: {
        transformPasted: slice => { seen.push(slice.content.firstChild?.type.name ?? ''); return slice; },
      } })],
    });
    const editor = mount('<p></p>', [Observer]);
    // A pair is not a textblock, so the HTML guard keeps it; the slice repair removes it.
    expect(paste(editor, sliceHTML('0 0', '["quotePair",null]', 'one'))).toBe(true);
    expect(seen).toEqual(['paragraph']);
  });
});
