/**
 * Link sinks and entries against the URL policy: what renders, what a click
 * opens, and what setLink, toggleLink and HTML parsing store.
 */
import { describe, it, expect, vi, afterEach, type MockInstance } from 'vitest';
import { parseHTML } from 'linkedom';
import { DOMParser as PMDOMParser } from '@domternal/pm/model';
import { TextSelection } from '@domternal/pm/state';
import { Editor } from '../Editor.js';
import { Document } from '../nodes/Document.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Text } from '../nodes/Text.js';
import { HardBreak } from '../nodes/HardBreak.js';
import { Heading } from '../nodes/Heading.js';
import { Blockquote } from '../nodes/Blockquote.js';
import { BulletList } from '../nodes/BulletList.js';
import { ListItem } from '../nodes/ListItem.js';
import { Bold } from './Bold.js';
import { Link, type LinkOptions } from './Link.js';
import { linkClickPluginKey } from './helpers/linkClickPlugin.js';
import { generateHTML } from '../helpers/ssr.js';
import type { JSONContent } from '../types/Content.js';
import type { AnyExtension } from '../types/index.js';

const UNSAFE_HREFS: unknown[] = [
  'javascript:alert(1)',
  'JaVaScRiPt:alert(1)',
  ' javascript:alert(1)',
  '\u0001javascript:alert(1)',
  'java\tscr\nipt:alert(1)',
  'javascript://%0aalert(1)',
  'vbscript:msgbox(1)',
  'data:text/html,<script>alert(1)</script>',
  'data:image/png;base64,AAAA',
  'https://google.com@evil.example/',
  ['javascript:alert(1)'],
  [['javascript:alert(1)']],
  42,
  true,
  { href: 'javascript:alert(1)' },
];

const link = (href: unknown, text = 'link', extra: Record<string, unknown> = {}): JSONContent =>
  ({ type: 'text', text, marks: [{ type: 'link', attrs: { href, ...extra } }] }) as JSONContent;
const doc = (...paragraphs: JSONContent[][]): JSONContent =>
  ({ type: 'doc', content: paragraphs.map(content => ({ type: 'paragraph', content })) });
const extensions = (options: Partial<LinkOptions> = {}): AnyExtension[] =>
  [Document, Paragraph, Text, HardBreak, Heading, Blockquote, BulletList, ListItem, Bold, Link.configure(options)];

/** Selects a range, or places the cursor when `to` is omitted. */
function select(ed: Editor, from: number, to = from): void {
  ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, from, to)));
}

let editor: Editor | undefined;
afterEach(() => {
  editor?.destroy();
  editor = undefined;
  vi.restoreAllMocks();
});

function create(content: JSONContent | string, options: Partial<LinkOptions> = {}, editable = true): Editor {
  editor = new Editor({ extensions: extensions(options), content, editable });
  return editor;
}

/** Runs the click plugin as ProseMirror would for a left click on `target`. */
function click(view: Editor['view'], target: Element, init: MouseEventInit = {}): boolean {
  const plugin = view.state.plugins.find(candidate => candidate.spec.key === linkClickPluginKey);
  const event = new MouseEvent('click', { button: 0, bubbles: true, ...init });
  Object.defineProperty(event, 'target', { value: target });
  return (plugin?.props.handleClick as (view: unknown, pos: number, event: MouseEvent) => boolean)(view, 0, event);
}

const spyOpen = (): MockInstance<typeof window.open> => vi.spyOn(window, 'open').mockImplementation(() => null);

describe('Link rendering against the URL policy', () => {
  it.each(UNSAFE_HREFS.map(href => [JSON.stringify(href), href]))('renders %s as a span in the editor, getHTML and generateHTML (F1)', (_label, href) => {
    const content = doc([{ type: 'text', text: 'before ' }, link(href, 'CLICK')]);
    for (const editable of [true, false]) {
      const { view } = create(content, {}, editable);
      expect(view.dom.querySelector('a')).toBeNull();
      expect(view.dom.querySelector('span')?.textContent).toBe('CLICK');
      expect(editor?.getHTML()).toBe('<p>before <span>CLICK</span></p>');
      editor?.destroy();
    }
    expect(generateHTML(content, extensions())).toBe('<p>before <span>CLICK</span></p>');
    const { document } = parseHTML('<!DOCTYPE html><html><body></body></html>');
    expect(generateHTML(content, extensions(), { document })).toBe('<p>before <span>CLICK</span></p>');
  });

  it('renders a link without href as a span, dropping its link attributes and the HTMLAttributes option', () => {
    const content = doc([link(null, 'x', { target: '_blank', rel: 'nofollow', title: 't', class: 'c' })]);
    create(content, { HTMLAttributes: { class: 'app-link', 'data-app': '1' } });
    expect(editor?.getHTML()).toBe('<p><span>x</span></p>');
  });

  it('renders the cleaned spelling of an allowed href and keeps the stored one', () => {
    create(doc([link(' https://exa\nmple.com/a\t ')]));
    expect(editor?.view.dom.querySelector('a')?.getAttribute('href')).toBe('https://example.com/a');
    expect(editor?.getHTML()).toBe('<p><a href="https://example.com/a">link</a></p>');
    expect(editor?.getJSON().content?.[0]?.content?.[0]?.marks?.[0]?.attrs?.['href']).toBe(' https://exa\nmple.com/a\t ');
  });

  it('renders an allowed href with its other attributes', () => {
    create(doc([link('https://example.com/', 'x', { target: '_blank', title: 'T' })]));
    const anchor = editor!.view.dom.querySelector('a')!;
    expect(Object.fromEntries(Array.from(anchor.attributes, ({ name, value }) => [name, value]))).toEqual({
      href: 'https://example.com/', target: '_blank', rel: 'noopener noreferrer', title: 'T',
    });
  });

  it('never gives a copied refused link to the clipboard', () => {
    const { view } = create(doc([link('javascript:alert(1)', 'copy me')]));
    const slice = view.state.doc.slice(1, 8);
    const html = view.serializeForClipboard(slice).dom.innerHTML;
    expect(html).not.toContain('href');
    expect(html).not.toContain('<a');
    const reparsed = PMDOMParser.fromSchema(view.state.schema).parseSlice(view.serializeForClipboard(slice).dom);
    let marks = 0;
    reparsed.content.descendants(node => { marks += node.marks.length; });
    expect(marks).toBe(0);
  });
});

describe('Link click against the URL policy', () => {
  it.each(UNSAFE_HREFS.map(href => [JSON.stringify(href), href]))('opens nothing for %s at block start or after text (F2)', (_label, href) => {
    const open = spyOpen();
    for (const content of [doc([link(href)]), doc([{ type: 'text', text: 'a ' }, link(href)])]) {
      const { view } = create(content);
      const target = view.dom.querySelector('span') ?? view.dom.querySelector('p')!;
      expect(click(view, target)).toBe(false);
      editor?.destroy();
    }
    expect(open).not.toHaveBeenCalled();
  });

  it('opens an allowed link in a new tab without an opener or referrer (F6)', () => {
    const open = spyOpen();
    const { view } = create(doc([link('https://example.com/')]));
    expect(click(view, view.dom.querySelector('a')!)).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('https://example.com/', '_blank', 'noopener,noreferrer');
  });

  it('opens the cleaned spelling', () => {
    const open = spyOpen();
    const { view } = create(doc([link('\thttps://exa\nmple.com/ ')]));
    click(view, view.dom.querySelector('a')!);
    expect(open).toHaveBeenCalledWith('https://example.com/', '_blank', 'noopener,noreferrer');
  });

  it('opens the clicked link, not the link before it (F3)', () => {
    const open = spyOpen();
    const { view } = create(doc([link('javascript:alert(1)', 'bad'), link('https://safe.example/', 'safe')]));
    expect(click(view, view.dom.querySelector('a')!)).toBe(true);
    expect(open).toHaveBeenCalledWith('https://safe.example/', '_blank', 'noopener,noreferrer');
    open.mockClear();
    expect(click(view, view.dom.querySelector('span')!)).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it('refuses the clicked unsafe link when a safe link comes before it', () => {
    const open = spyOpen();
    const { view } = create(doc([link('https://safe.example/', 'safe'), link(['javascript:alert(1)'], 'bad')]));
    expect(click(view, view.dom.querySelector('span')!)).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it('opens each of two adjacent allowed links with its own href', () => {
    const open = spyOpen();
    const { view } = create(doc([link('https://one.example/', 'one'), link('https://two.example/', 'two')]));
    const anchors = view.dom.querySelectorAll('a');
    click(view, anchors[0]!);
    click(view, anchors[1]!);
    expect(open.mock.calls.map(call => call[0])).toEqual(['https://one.example/', 'https://two.example/']);
  });

  it('opens its own href for a click on bold text inside the link and after a hard break', () => {
    const open = spyOpen();
    const content: JSONContent = { type: 'doc', content: [{ type: 'paragraph', content: [
      link('javascript:alert(1)', 'bad'),
      { type: 'hardBreak' },
      { type: 'text', text: 'bold', marks: [{ type: 'link', attrs: { href: 'https://bold.example/' } }, { type: 'bold' }] },
      { type: 'text', text: ' plain', marks: [{ type: 'link', attrs: { href: 'https://bold.example/' } }] },
    ] }] };
    const { view } = create(content);
    const strong = view.dom.querySelector('strong')!;
    expect(click(view, strong)).toBe(true);
    expect(open).toHaveBeenLastCalledWith('https://bold.example/', '_blank', 'noopener,noreferrer');
  });

  it('opens its own href in a heading, a list item and a blockquote', () => {
    const open = spyOpen();
    const content: JSONContent = { type: 'doc', content: [
      { type: 'heading', attrs: { level: 1 }, content: [link('https://h.example/')] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [link('https://li.example/')] }] }] },
      { type: 'blockquote', content: [{ type: 'paragraph', content: [link('javascript:alert(1)'), link('https://bq.example/')] }] },
    ] };
    const { view } = create(content);
    for (const anchor of Array.from(view.dom.querySelectorAll('a'))) click(view, anchor);
    expect(open.mock.calls.map(call => call[0])).toEqual(['https://h.example/', 'https://li.example/', 'https://bq.example/']);
  });

  it('honors _self, _parent and _top in any case, and opens every other target in a new tab', () => {
    const open = spyOpen();
    const targets: [unknown, unknown[]][] = [
      ['_self', ['https://t.example/', '_self']],
      ['_PARENT', ['https://t.example/', '_parent']],
      ['_top', ['https://t.example/', '_top']],
      ['_BLANK', ['https://t.example/', '_blank', 'noopener,noreferrer']],
      ['preview', ['https://t.example/', '_blank', 'noopener,noreferrer']],
      [['_top'], ['https://t.example/', '_blank', 'noopener,noreferrer']],
    ];
    for (const [target, expected] of targets) {
      const { view } = create(doc([link('https://t.example/', 'x', { target })]));
      click(view, view.dom.querySelector('a')!);
      expect(open).toHaveBeenLastCalledWith(...expected);
      editor?.destroy();
    }
  });

  it('opens without a referrer only when rel asks for it once addRelNoopener is off', () => {
    const open = spyOpen();
    for (const [rel, features] of [[null, 'noopener'], ['nofollow', 'noopener'], ['NoReferrer', 'noopener,noreferrer']] as const) {
      const { view } = create(doc([link('https://r.example/', 'x', { rel })]), { addRelNoopener: false });
      click(view, view.dom.querySelector('a')!);
      expect(open).toHaveBeenLastCalledWith('https://r.example/', '_blank', features);
      editor?.destroy();
    }
  });

  it('opens a scheme only when the Link protocols allow it', () => {
    const open = spyOpen();
    let { view } = create(doc([link('ftp://files.example/f')]));
    expect(click(view, view.dom.querySelector('span')!)).toBe(false);
    editor?.destroy();
    ({ view } = create(doc([link('ftp://files.example/f')]), { protocols: ['ftp:'] }));
    expect(click(view, view.dom.querySelector('a')!)).toBe(true);
    expect(open).toHaveBeenCalledWith('ftp://files.example/f', '_blank', 'noopener,noreferrer');
  });

  it('ignores an anchor without a link mark, such as one a node view renders', () => {
    const open = spyOpen();
    const { view } = create(doc([{ type: 'text', text: 'plain' }]));
    const foreign = document.createElement('a');
    foreign.href = 'https://foreign.example/';
    view.dom.querySelector('p')!.appendChild(foreign);
    expect(click(view, foreign)).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it('ignores clicks outside the editor, other buttons and read-only editors', () => {
    const open = spyOpen();
    const { view } = create(doc([link('https://example.com/')]));
    const outside = document.createElement('a');
    document.body.appendChild(outside);
    expect(click(view, outside)).toBe(false);
    expect(click(view, view.dom.querySelector('a')!, { button: 1 })).toBe(false);
    view.setProps({ editable: () => false });
    expect(click(view, view.dom.querySelector('a')!)).toBe(false);
    outside.remove();
    expect(open).not.toHaveBeenCalled();
  });

  it('selects the clicked link\'s own range with enableClickSelection, next to another link', () => {
    const { view } = create(doc([link('https://one.example/', 'one'), link('https://two.example/', 'twotwo'), { type: 'text', text: ' tail' }]),
      { enableClickSelection: true });
    click(view, view.dom.querySelectorAll('a')[1]!);
    expect(view.state.doc.textBetween(view.state.selection.from, view.state.selection.to)).toBe('twotwo');
    click(view, view.dom.querySelectorAll('a')[0]!);
    expect(view.state.doc.textBetween(view.state.selection.from, view.state.selection.to)).toBe('one');
  });

  it('selects a link across its bold part with enableClickSelection', () => {
    const href = 'https://one.example/';
    const { view } = create({ type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: 'x ' },
      { type: 'text', text: 'ab', marks: [{ type: 'link', attrs: { href } }] },
      { type: 'text', text: 'cd', marks: [{ type: 'link', attrs: { href } }, { type: 'bold' }] },
      { type: 'text', text: 'ef', marks: [{ type: 'link', attrs: { href } }] },
    ] }] }, { enableClickSelection: true });
    click(view, view.dom.querySelector('strong')!);
    expect(view.state.doc.textBetween(view.state.selection.from, view.state.selection.to)).toBe('abcdef');
  });
});

describe('Link entries against the URL policy', () => {
  it('parses an href to its cleaned spelling and refuses what the policy refuses', () => {
    create('<p><a href=" https://exa&#10;mple.com/x ">a</a> <a href="java&#9;script:alert(1)">b</a> <a href="https://u:p@x.example/">c</a></p>');
    const nodes = editor!.getJSON().content?.[0]?.content ?? [];
    expect(nodes.flatMap(node => node.marks ?? []).map(mark => mark.attrs?.['href'])).toEqual(['https://example.com/x']);
    expect(editor!.getText()).toBe('a b c');
  });

  it('setLink and toggleLink refuse arrays, credentials and script addresses, and store the cleaned spelling', () => {
    create('<p>hello</p>');
    for (const href of [['https://example.com/'], 'https://google.com@evil.example/', ' javascript:alert(1)', 42]) {
      select(editor!, 1, 6);
      expect(editor!.commands.setLink({ href } as never)).toBe(false);
      expect(editor!.commands.toggleLink({ href } as never)).toBe(false);
    }
    select(editor!, 1, 6);
    expect(editor!.commands.setLink({ href: ' https://exa\nmple.com/ ' })).toBe(true);
    expect(editor!.getJSON().content?.[0]?.content?.[0]?.marks?.[0]?.attrs?.['href']).toBe('https://example.com/');
    editor!.commands.unsetLink();
    select(editor!, 1, 6);
    expect(editor!.commands.toggleLink({ href: '\thttps://t.example/' })).toBe(true);
    expect(editor!.getJSON().content?.[0]?.content?.[0]?.marks?.[0]?.attrs?.['href']).toBe('https://t.example/');
  });

  it('toggleLink stores the cleaned spelling on the cursor too', () => {
    create('<p>hello</p>');
    select(editor!, 3);
    expect(editor!.commands.toggleLink({ href: ' https://c.example/ ' })).toBe(true);
    editor!.view.dispatch(editor!.view.state.tr.insertText('X'));
    const marked = editor!.getJSON().content?.[0]?.content?.find(node => node.text === 'X');
    expect(marked?.marks?.[0]?.attrs?.['href']).toBe('https://c.example/');
  });
});
