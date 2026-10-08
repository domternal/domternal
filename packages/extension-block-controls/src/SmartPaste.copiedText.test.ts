/**
 * Text copied from inside a list item, task item or quote. A ProseMirror copy records the
 * container as the slice's context, the paste rebuilds it around the text, and SmartPaste
 * inserted that as a whole block: a word pasted at the end of a paragraph landed after it as a
 * one-item list or a quote. It now joins the paragraph's text, as it does without SmartPaste.
 * Into a list, SmartPaste's list rules still keep a copied item's list and marker, and HTML from
 * outside an editor, without that context, still pastes its blocks as blocks.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Blockquote, BulletList, Document, Editor, Heading, ListItem, Paragraph, TaskItem, TaskList, Text } from '@domternal/core';
import { TextSelection } from '@domternal/pm/state';
import { Fragment, Slice } from '@domternal/pm/model';
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

/** The public paste prop with an already parsed open list slice, isolating its clipboard metadata reader. */
function handleCopiedList(editor: Editor, html: string): boolean | undefined {
  const { schema } = editor;
  const list = schema.node('bulletList', null, [schema.node('listItem', null, [schema.node('paragraph', null, [schema.text('beta')])])]);
  const slice = new Slice(Fragment.from(list), 3, 3);
  const event = new Event('paste') as ClipboardEvent;
  Object.defineProperty(event, 'clipboardData', { value: { getData: () => html } });
  const plugin = editor.state.plugins.find(candidate => candidate.spec.props?.handlePaste);
  return plugin?.spec.props?.handlePaste?.call(plugin, editor.view, event, slice) as boolean | undefined;
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

  // A page that shows a ProseMirror copy's marker in its text, a comment or another attribute, as a page about editors
  // does, is no ProseMirror copy: its list or quote lands as a block after the paragraph, as without the mention.
  it.each([
    ['a list item\'s text', '<meta charset="utf-8"><ul><li>Editors write data-pm-slice="1 1 [x]" on copies</li></ul>',
      'bulletList(listItem(paragraph("Editors write data-pm-slice=\\"1 1 [x]\\" on copies")))'],
    ['a quote\'s text', '<meta charset="utf-8"><blockquote><p>Editors write data-pm-slice="1 1 [x]" on copies</p></blockquote>',
      'blockquote(paragraph("Editors write data-pm-slice=\\"1 1 [x]\\" on copies"))'],
    ['code in a list item', '<ul><li><code>&lt;li data-pm-slice="2 2 [&amp;quot;bulletList&amp;quot;,null]"&gt;</code></li></ul>',
      'bulletList(listItem(paragraph("<li data-pm-slice=\\"2 2 [&quot;bulletList&quot;,null]\\">")))'],
    ['a comment', '<!-- data-pm-slice="1 1 [&quot;bulletList&quot;,null]" --><ul><li>beta</li></ul>', 'bulletList(listItem(paragraph("beta")))'],
    ['another attribute', '<ul title=\'data-pm-slice="1 1 [x]"\'><li>beta</li></ul>', 'bulletList(listItem(paragraph("beta")))'],
  ])('pastes a list or quote whose clipboard HTML shows the marker only in %s as a block', (_name, html, block) => {
    const editor = mount('<p>x</p>');
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.atEnd(editor.state.doc)));
    paste(editor, html);
    expect(editor.state.doc.toString()).toBe(`doc(paragraph("x"), ${block})`);
  });

  // Chromium and WebKit refuse a template's innerHTML on a page that requires Trusted Types and has no default policy.
  // ProseMirror reads the record there with a policy of its own, and the copied word landed beside the paragraph as a list.
  it('reads the record as written where the page\'s Trusted Types refuse the browser\'s parser, as before it was parsed', () => {
    const html = copy('<ul><li><p>alpha beta</p></li></ul>', 'beta');
    const editor = mount('<p>x</p>');
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.atEnd(editor.state.doc)));
    Object.defineProperty(HTMLTemplateElement.prototype, 'innerHTML', {
      ...Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML'),
      configurable: true,
      set() { throw new TypeError('This assignment requires a TrustedHTML'); },
    });
    try {
      paste(editor, html);
    } finally {
      delete (HTMLTemplateElement.prototype as { innerHTML?: string }).innerHTML;
    }
    expect(editor.state.doc.toString()).toBe('doc(paragraph("xbeta"))');
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

  it.each(['tr', 'td'])('reads decoded context on a leading %s without losing the table fragment', tag => {
    const editor = mount('<p>x</p>');
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.atEnd(editor.state.doc)));
    const before = editor.state.doc;
    const html = `<${tag} data-pm-slice="1 1 [&quot;bulletList&quot;,null,&quot;listItem&quot;,null]">beta</${tag}>`;
    expect(handleCopiedList(editor, html)).toBe(false);
    expect(editor.state.doc.eq(before)).toBe(true);
  });

  it('reads only the first parsed slice marker, including an entity-encoded empty context', () => {
    const editor = mount('<p>x</p>');
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.atEnd(editor.state.doc)));
    const html = '<p data-pm-slice="1 1 &#91;&#93;"></p><p data-pm-slice="1 1 [&quot;bulletList&quot;,null]">beta</p>';
    expect(handleCopiedList(editor, html)).toBe(true);
    expect(editor.state.doc.toString()).toBe('doc(paragraph("x"), bulletList(listItem(paragraph("beta"))))');
  });

  it('creates the metadata template in a detached document and keeps its nodes out of the live DOM', () => {
    const editor = mount('<p>x</p>');
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.atEnd(editor.state.doc)));
    const detached = document.implementation.createHTMLDocument('');
    const create = vi.spyOn(document.implementation, 'createHTMLDocument').mockReturnValue(detached);
    const element = vi.spyOn(detached, 'createElement');
    const live = document.documentElement.outerHTML;
    try {
      const html = '<script>document.documentElement.setAttribute("data-paste-script", "ran")</script>'
        + '<p data-pm-slice="1 1 [&quot;bulletList&quot;,null]" onclick="document.body.remove()">beta</p>';
      expect(handleCopiedList(editor, html)).toBe(false);
      expect(create).toHaveBeenCalledTimes(1);
      expect(element).toHaveBeenCalledWith('template');
      expect(detached.defaultView).toBeNull();
      const template = element.mock.results[0]?.value as HTMLTemplateElement;
      expect(template.ownerDocument).toBe(detached);
      expect(template.content.querySelector('script')).not.toBeNull();
      expect(document.documentElement.outerHTML).toBe(live);
    } finally {
      element.mockRestore();
      create.mockRestore();
    }
  });

  it('rejects a document with a browsing context before creating a metadata template', () => {
    const editor = mount('<p>x</p>');
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.atEnd(editor.state.doc)));
    const create = vi.spyOn(document.implementation, 'createHTMLDocument').mockReturnValue(document);
    const element = vi.spyOn(document, 'createElement');
    try {
      expect(handleCopiedList(editor, '<p data-pm-slice="1 1 [&quot;bulletList&quot;,null]">beta</p>')).toBe(true);
      expect(element.mock.calls.some(([tag]) => tag === 'template')).toBe(false);
      expect(editor.state.doc.toString()).toBe('doc(paragraph("x"), bulletList(listItem(paragraph("beta"))))');
    } finally {
      element.mockRestore();
      create.mockRestore();
    }
  });
});
