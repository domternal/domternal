/**
 * Relative and fragment links: stored, rendered and opened by default, a
 * fragment scrolling in place, and all refused with allowRelative false.
 */
import { describe, it, expect, vi, afterEach, type MockInstance } from 'vitest';
import { TextSelection } from '@domternal/pm/state';
import { Editor } from '../Editor.js';
import { Document } from '../nodes/Document.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Text } from '../nodes/Text.js';
import { Heading } from '../nodes/Heading.js';
import { Link, type LinkOptions } from './Link.js';
import { linkClickPluginKey } from './helpers/linkClickPlugin.js';
import { generateHTML } from '../helpers/ssr.js';
import type { JSONContent } from '../types/Content.js';
import type { ContentDiagnosticProps } from '../types/EditorEvents.js';
import type { AnyExtension } from '../types/index.js';

const RELATIVE = ['/path/page', './page', '../page', 'page.html', '?q=1', '#section', '/path#id'];
const extensions = (options: Partial<LinkOptions> = {}): AnyExtension[] => [Document, Paragraph, Text, Heading, Link.configure(options)];
const doc = (href: string): JSONContent => ({ type: 'doc', content: [{ type: 'paragraph', content: [
  { type: 'text', text: 'go', marks: [{ type: 'link', attrs: { href } }] },
] }] });

// jsdom does not scroll; tests that need it record the element instead.
const nativeScrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');

let editor: Editor | undefined;
afterEach(() => {
  editor?.destroy();
  editor = undefined;
  vi.restoreAllMocks();
  document.getElementById('outside-target')?.remove();
  if (nativeScrollIntoView) Object.defineProperty(Element.prototype, 'scrollIntoView', nativeScrollIntoView);
  else Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
});

const hrefs = (ed: Editor): unknown[] => {
  const found: unknown[] = [];
  ed.state.doc.descendants(node => { for (const mark of node.marks) found.push(mark.attrs['href']); });
  return found;
};

function click(ed: Editor, target: Element): boolean {
  const plugin = ed.state.plugins.find(candidate => candidate.spec.key === linkClickPluginKey);
  const event = new MouseEvent('click', { button: 0, bubbles: true });
  Object.defineProperty(event, 'target', { value: target });
  return (plugin?.props.handleClick as (view: unknown, pos: number, event: MouseEvent) => boolean)(ed.view, 0, event);
}

const spyOpen = (): MockInstance<typeof window.open> => vi.spyOn(window, 'open').mockImplementation(() => null);

describe('relative links by default', () => {
  it.each(RELATIVE)('parses, loads, renders and generates %s', (href) => {
    const reports: ContentDiagnosticProps[] = [];
    editor = new Editor({ extensions: extensions(), content: doc(href), onContentDiagnostic: props => reports.push(props) });
    expect(hrefs(editor)).toEqual([href]);
    expect(reports).toEqual([]);
    expect(editor.view.dom.querySelector('a')?.getAttribute('href')).toBe(href);
    expect(generateHTML(doc(href), extensions())).toContain(`href="${href.replace('&', '&amp;')}"`);
    editor.destroy();
    editor = new Editor({ extensions: extensions(), content: `<p><a href="${href}">go</a></p>` });
    expect(hrefs(editor)).toEqual([href]);
  });

  it.each(RELATIVE)('setLink and toggleLink store %s', (href) => {
    editor = new Editor({ extensions: extensions(), content: '<p>hello</p>' });
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 6)));
    expect(editor.commands.setLink({ href })).toBe(true);
    expect(hrefs(editor)).toEqual([href]);
  });

  it('still refuses network paths, backslashes and a colon in the first segment', () => {
    const reports: ContentDiagnosticProps[] = [];
    editor = new Editor({
      extensions: extensions(),
      content: { type: 'doc', content: [{ type: 'paragraph', content: ['//evil.example/x', '/\\evil.example', '1abc:x', 'ｊavascript:x'].map((href, index) => (
        { type: 'text', text: `l${String(index)} `, marks: [{ type: 'link', attrs: { href } }] })) }] },
      onContentDiagnostic: props => reports.push(props),
    });
    expect(hrefs(editor)).toEqual([]);
    expect(reports[0]?.diagnostics.map(diagnostic => diagnostic.code)).toEqual(['unsupported-url', 'unsupported-url', 'unsupported-url', 'unsupported-url']);
  });

  it('opens a relative path in a new tab without an opener, resolved by the browser (C10)', () => {
    const open = spyOpen();
    editor = new Editor({ extensions: extensions(), content: doc('/docs/page?x=1') });
    expect(click(editor, editor.view.dom.querySelector('a')!)).toBe(true);
    expect(open).toHaveBeenCalledWith('/docs/page?x=1', '_blank', 'noopener,noreferrer');
  });

  it('allows only relative links with an empty protocols list (A27)', () => {
    editor = new Editor({ extensions: extensions({ protocols: [] }), content: '<p><a href="https://x.example/">a</a> <a href="#b">b</a></p>' });
    expect(hrefs(editor)).toEqual(['#b']);
  });
});

describe('fragment links (C8, C9)', () => {
  function withTarget(id: string): { editor: Editor; scrolled: string[] } {
    editor = new Editor({
      extensions: extensions(),
      content: { type: 'doc', content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'go', marks: [{ type: 'link', attrs: { href: `#${encodeURIComponent(id)}` } }] }] },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Target' }] },
      ] },
    });
    const heading = editor.view.dom.querySelector('h2')!;
    heading.id = id;
    const scrolled: string[] = [];
    Element.prototype.scrollIntoView = function (this: Element) { scrolled.push(this.id); };
    return { editor, scrolled };
  }

  it('scrolls to the matching element in the editor without opening a tab or changing the location', () => {
    const open = spyOpen();
    const before = window.location.href;
    const { editor: ed, scrolled } = withTarget('section');
    expect(click(ed, ed.view.dom.querySelector('a')!)).toBe(true);
    expect(scrolled).toEqual(['section']);
    expect(open).not.toHaveBeenCalled();
    expect(window.location.href).toBe(before);
  });

  it('decodes an escaped id', () => {
    const { editor: ed, scrolled } = withTarget('✓ done');
    expect(click(ed, ed.view.dom.querySelector('a')!)).toBe(true);
    expect(scrolled).toEqual(['✓ done']);
  });

  it('uses the raw id when an escape is malformed', () => {
    editor = new Editor({ extensions: extensions(), content: doc('#%ZZ') });
    const target = document.createElement('div');
    target.id = '%ZZ';
    const outside = document.createElement('section');
    outside.id = 'outside-target';
    outside.appendChild(target);
    document.body.appendChild(outside);
    const scrolled: string[] = [];
    Element.prototype.scrollIntoView = function (this: Element) { scrolled.push(this.id); };
    expect(click(editor, editor.view.dom.querySelector('a')!)).toBe(true);
    expect(scrolled).toEqual(['%ZZ']);
  });

  it('scrolls to a match elsewhere in the page, and returns false when nothing matches', () => {
    const open = spyOpen();
    editor = new Editor({ extensions: extensions(), content: doc('#outside-target') });
    expect(click(editor, editor.view.dom.querySelector('a')!)).toBe(false);
    const outside = document.createElement('section');
    outside.id = 'outside-target';
    document.body.appendChild(outside);
    const scrolled: string[] = [];
    Element.prototype.scrollIntoView = function (this: Element) { scrolled.push(this.id); };
    expect(click(editor, editor.view.dom.querySelector('a')!)).toBe(true);
    expect(scrolled).toEqual(['outside-target']);
    expect(open).not.toHaveBeenCalled();
  });

  it('never builds a selector from the id', () => {
    const { editor: ed, scrolled } = withTarget('a"]) , *[id="b');
    expect(click(ed, ed.view.dom.querySelector('a')!)).toBe(true);
    expect(scrolled).toEqual(['a"]) , *[id="b']);
  });

  it('returns false for an empty fragment', () => {
    editor = new Editor({ extensions: extensions(), content: doc('#') });
    expect(click(editor, editor.view.dom.querySelector('a')!)).toBe(false);
  });
});

describe('allowRelative: false', () => {
  it.each(RELATIVE)('refuses %s everywhere, as 1.2 did', (href) => {
    const open = spyOpen();
    const reports: ContentDiagnosticProps[] = [];
    editor = new Editor({ extensions: extensions({ allowRelative: false }), content: doc(href), onContentDiagnostic: props => reports.push(props) });
    expect(hrefs(editor)).toEqual([]);
    expect(reports[0]?.diagnostics[0]).toMatchObject({ code: 'unsupported-url', value: href });
    editor.destroy();
    editor = new Editor({ extensions: extensions({ allowRelative: false }), content: `<p><a href="${href}">go</a></p>` });
    expect(hrefs(editor)).toEqual([]);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 3)));
    expect(editor.commands.setLink({ href })).toBe(false);
    editor.view.dispatch(editor.state.tr.addMark(1, 3, editor.schema.marks['link']!.create({ href })));
    expect(editor.view.dom.querySelector('a')).toBeNull();
    expect(click(editor, editor.view.dom.querySelector('span')!)).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });
});
