/**
 * Link hrefs in loaded content and commands: the JSON entry points remove a
 * link whose href the URL policy refuses and report it, validation rejects an
 * href that is not a string, commands refuse such values, and the
 * normalizeContentAttributes migration removes stored ones.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { AddMarkStep, Step } from '@domternal/pm/transform';
import { TextSelection } from '@domternal/pm/state';
import { Editor } from '../Editor.js';
import { Document } from '../nodes/Document.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Text } from '../nodes/Text.js';
import { Bold } from './Bold.js';
import { Link, type LinkOptions } from './Link.js';
import { History } from '../extensions/History.js';
import { Node } from '../Node.js';
import { createDocument } from '../helpers/createDocument.js';
import { normalizeContent } from '../helpers/normalizeContent.js';
import { generateHTML, generateText } from '../helpers/ssr.js';
import { isSupportedAttributeValue } from '../utils/normalizedAttributes.js';
import { ExtensionConfigurationError } from '../ExtensionConfigurationError.js';
import type { ContentDiagnostic, JSONContent } from '../types/Content.js';
import type { ContentDiagnosticProps } from '../types/EditorEvents.js';
import type { AnyExtension } from '../types/index.js';

type Json = JSONContent;
const linked = (text: string, href: unknown, attrs: Record<string, unknown> = {}): Json =>
  ({ type: 'text', text, marks: [{ type: 'link', attrs: { href, ...attrs } }] }) as Json;
const doc = (...content: Json[]): Json => ({ type: 'doc', content: [{ type: 'paragraph', content }] });
const extensions = (options: Partial<LinkOptions> = {}): AnyExtension[] => [Document, Paragraph, Text, Bold, History, Link.configure(options)];
/** An inline image, as the image extension's inline mode defines it, that a link can wrap. */
const InlineImage = Node.create({
  name: 'image',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes: () => ({ src: { default: null } }),
  parseHTML: () => [{ tag: 'img[src]' }],
  renderHTML: ({ HTMLAttributes }) => ['img', HTMLAttributes],
});

/** Selects a range, or places the cursor when `to` is omitted. */
function select(ed: Editor, from: number, to = from): void {
  ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, from, to)));
}

let editor: Editor | undefined;
afterEach(() => { editor?.destroy(); editor = undefined; vi.restoreAllMocks(); });

function mount(content: Json | string, options: Partial<LinkOptions> = {}, editable = true): { editor: Editor; reports: ContentDiagnosticProps[] } {
  const reports: ContentDiagnosticProps[] = [];
  editor = new Editor({ extensions: extensions(options), content, editable, onContentDiagnostic: props => reports.push(props) });
  return { editor, reports };
}

const hrefs = (ed: Editor): unknown[] => {
  const found: unknown[] = [];
  ed.state.doc.descendants(node => { for (const mark of node.marks) if (mark.type.name === 'link') found.push(mark.attrs['href']); });
  return found;
};

describe('link hrefs in JSON content', () => {
  const cases: [label: string, href: unknown, code: ContentDiagnostic['code'], value?: string | number][] = [
    ['a script address', 'javascript:alert(1)', 'unsafe-url', 'javascript:alert(1)'],
    ['a hidden script scheme', 'java\tscript:alert(1)', 'unsafe-url', 'java\tscript:alert(1)'],
    ['a data address', 'data:text/html,x', 'unsafe-url', 'data:text/html,x'],
    ['credentials', 'https://google.com@evil.example/', 'unsafe-url', 'https://google.com@evil.example/'],
    ['a hidden character in the host', 'https://x\u200b.example/', 'unsafe-url', 'https://x\u200b.example/'],
    ['a bidi override', 'https://x.example/\u202eexe.txt', 'unsafe-url', 'https://x.example/\u202eexe.txt'],
    ['an array', ['javascript:alert(1)'], 'unsafe-url'],
    ['a number', 42, 'unsafe-url', 42],
    ['an object', { a: 1 }, 'unsafe-url'],
    ['another scheme', 'ftp://files.example/f', 'unsupported-url', 'ftp://files.example/f'],
    ['a network path', '//evil.example/x', 'unsupported-url', '//evil.example/x'],
    ['a backslash', 'https:\\\\evil.example', 'unsupported-url', 'https:\\\\evil.example'],
    ['an empty string', '', 'unsupported-url', ''],
    ['null', null, 'unsupported-url'],
  ];

  it.each(cases)('removes a link with %s from initial content, keeps its text and reports it', (_label, href, code, value) => {
    const { editor: ed, reports } = mount(doc({ type: 'text', text: 'a ' }, linked('link', href)));
    expect(hrefs(ed)).toEqual([]);
    expect(ed.getText()).toBe('a link');
    expect(reports).toEqual([{
      editor: ed,
      source: 'content',
      total: 1,
      diagnostics: [{ code, nodeType: 'text', markType: 'link', attribute: 'href', path: [0, 1], ...(value !== undefined && { value }) }],
    }]);
    expect(Object.isFrozen(reports[0]?.diagnostics[0])).toBe(true);
  });

  it('removes a link mark without an href attribute', () => {
    const { editor: ed, reports } = mount({ type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: 'bare', marks: [{ type: 'link' }, { type: 'bold' }] },
    ] }] });
    expect(ed.getJSON().content?.[0]?.content?.[0]?.marks).toEqual([{ type: 'bold' }]);
    expect(reports[0]?.diagnostics).toEqual([{ code: 'unsupported-url', nodeType: 'text', markType: 'link', attribute: 'href', path: [0, 0] }]);
  });

  it('keeps an allowed href exactly as stored, and omits a value longer than 64 characters', () => {
    const long = `ftp://files.example/${'a'.repeat(60)}`;
    const { editor: ed, reports } = mount(doc(linked('a', ' https://example.com/ '), linked('b', long)));
    expect(hrefs(ed)).toEqual([' https://example.com/ ']);
    expect(reports[0]?.diagnostics).toEqual([{ code: 'unsupported-url', nodeType: 'text', markType: 'link', attribute: 'href', path: [0, 1] }]);
  });

  it('keeps links whose path, query or fragment holds the joiners of Persian, Indic and emoji text', () => {
    const persian = 'https://fa.wikipedia.org/wiki/\u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u0645';
    const hindi = '/wiki/\u0915\u094d\u200d\u0937';
    const emoji = 'https://example.com/search?q=\ud83d\udc68\u200d\ud83d\udc69\u200d\ud83d\udc67#\u200e';
    const { editor: ed, reports } = mount(doc(linked('fa', persian), { type: 'text', text: ' ' }, linked('hi', hindi), { type: 'text', text: ' ' }, linked('em', emoji)));
    expect(hrefs(ed)).toEqual([persian, hindi, emoji]);
    expect(reports).toEqual([]);
    const anchors = Array.from(ed.view.dom.querySelectorAll('a'), anchor => anchor.getAttribute('href'));
    expect(anchors).toEqual([persian, hindi, emoji]);
    expect(generateHTML(doc(linked('fa', persian)), extensions())).toBe(`<p><a href="${persian}">fa</a></p>`);
    ed.commands.setContent(`<p><a href="${persian}">parsed</a></p>`);
    expect(hrefs(ed)).toEqual([persian]);
    ed.commands.selectAll();
    expect(ed.commands.setLink({ href: emoji })).toBe(true);
    expect(hrefs(ed)).toEqual([emoji]);
    expect(isSupportedAttributeValue(ed.schema, 'link', 'href', hindi)).toBe(true);
  });

  it('removes a link whose host holds a joiner, where it would hide the real host', () => {
    const { editor: ed, reports } = mount(doc(linked('x', 'https://exa\u200dmple.com/')));
    expect(hrefs(ed)).toEqual([]);
    expect(reports[0]?.diagnostics.map(diagnostic => diagnostic.code)).toEqual(['unsafe-url']);
    expect(isSupportedAttributeValue(ed.schema, 'link', 'href', 'https://example.com\u200c/')).toBe(false);
  });

  it('keeps links with a user where it is the standard form of a listed scheme, such as ssh: or ftp:', () => {
    const values = ['ssh://git@github.com/org/repo.git', 'ftp://anonymous@ftp.example/pub/', 'smb://user@fileserver/share', 'myapp://my%20host/path'];
    const { editor: ed, reports } = mount(doc(...values.flatMap((href, index) => [linked(`L${String(index)}`, href), { type: 'text', text: ' ' }])),
      { protocols: ['https:', 'ssh:', 'ftp:', 'smb:', 'myapp:'] });
    expect(hrefs(ed)).toEqual(values);
    expect(reports).toEqual([]);
    expect(Array.from(ed.view.dom.querySelectorAll('a'), anchor => anchor.getAttribute('href'))).toEqual(values);
    ed.commands.selectAll();
    expect(ed.commands.setLink({ href: 'ssh://git@example.com/repo.git' })).toBe(true);
    expect(ed.commands.setLink({ href: 'https://google.com@evil.example/' })).toBe(false);
  });

  it('allows the schemes the Link protocols list', () => {
    const { editor: ed, reports } = mount(doc(linked('f', 'ftp://files.example/f')), { protocols: ['https:', 'ftp:'] });
    expect(hrefs(ed)).toEqual(['ftp://files.example/f']);
    expect(reports).toEqual([]);
  });

  it('removes the link from setContent, insertContent with an object and an array, and reports each source', () => {
    const { editor: ed, reports } = mount('<p>start</p>');
    ed.commands.setContent(doc(linked('s', 'javascript:alert(1)')));
    ed.commands.insertContent({ type: 'paragraph', content: [linked('o', ['x'])] });
    ed.commands.insertContent([{ type: 'text', text: 'k', marks: [{ type: 'link', attrs: { href: 'https://ok.example/' } }] }, linked('r', 'ftp://x.example/')]);
    expect(hrefs(ed)).toEqual(['https://ok.example/']);
    expect(reports.map(report => [report.source, report.diagnostics.map(diagnostic => diagnostic.code)])).toEqual([
      ['setContent', ['unsafe-url']],
      ['insertContent', ['unsafe-url']],
      ['insertContent', ['unsupported-url']],
    ]);
  });

  it('removes the link in createDocument, normalizeContent, generateHTML and generateText', () => {
    const content = doc({ type: 'text', text: 'x ' }, linked('bad', 'vbscript:msgbox(1)'));
    const schema = new Editor({ extensions: extensions() }).schema;
    const seen: ContentDiagnostic[] = [];
    const created = createDocument(content, schema, { onDiagnostic: diagnostic => seen.push(diagnostic) });
    expect(created.textContent).toBe('x bad');
    let marks = 0;
    created.descendants(node => { marks += node.marks.length; });
    expect(marks).toBe(0);
    const normalized = normalizeContent(content, schema, { onDiagnostic: diagnostic => seen.push(diagnostic) });
    expect(normalized).toEqual(doc({ type: 'text', text: 'x ' }, { type: 'text', text: 'bad' }));
    expect(content.content?.[0]?.content?.[1]?.marks).toHaveLength(1);
    expect(generateHTML(content, extensions(), { onDiagnostic: diagnostic => seen.push(diagnostic) })).toBe('<p>x bad</p>');
    expect(generateText(content, extensions())).toBe('x bad');
    expect(seen.map(diagnostic => diagnostic.code)).toEqual(['unsafe-url', 'unsafe-url', 'unsafe-url']);
  });

  it('returns JSON without refused links as is', () => {
    const schema = new Editor({ extensions: extensions() }).schema;
    const content = doc(linked('ok', 'https://example.com/'), { type: 'text', text: ' plain' });
    expect(normalizeContent(content, schema)).toBe(content);
  });

  it('removes only the refused link and keeps the other marks of the text', () => {
    const { editor: ed } = mount({ type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: 'both', marks: [{ type: 'bold' }, { type: 'link', attrs: { href: 'javascript:x' } }] },
    ] }] });
    expect(ed.getJSON().content?.[0]?.content?.[0]).toEqual({ type: 'text', text: 'both', marks: [{ type: 'bold' }] });
  });

  it('reports the node that carries the link, such as an inline image', () => {
    const reports: ContentDiagnosticProps[] = [];
    editor = new Editor({
      extensions: [...extensions(), InlineImage],
      content: { type: 'doc', content: [{ type: 'paragraph', content: [
        { type: 'image', attrs: { src: 'https://img.example/a.png' }, marks: [{ type: 'link', attrs: { href: ['javascript:x'] } }] },
      ] }] },
      onContentDiagnostic: props => reports.push(props),
    });
    expect(editor.state.doc.firstChild?.firstChild?.marks).toEqual([]);
    expect(reports[0]?.diagnostics).toEqual([{ code: 'unsafe-url', nodeType: 'image', markType: 'link', attribute: 'href', path: [0, 0] }]);
  });

  it('keeps the first 100 diagnostics of 150 refused links and counts all', () => {
    const { editor: ed, reports } = mount({ type: 'doc', content: Array.from({ length: 150 }, (_, index) =>
      ({ type: 'paragraph', content: [linked(`l${String(index)}`, 'javascript:x')] })) });
    expect(hrefs(ed)).toEqual([]);
    expect(reports[0]?.total).toBe(150);
    expect(reports[0]?.diagnostics).toHaveLength(100);
  });

  it('loads the content when the diagnostic callback throws', () => {
    editor = new Editor({
      extensions: extensions(),
      content: doc(linked('x', 'javascript:x')),
      onContentDiagnostic: () => { throw new Error('app bug'); },
    });
    expect(editor.getText()).toBe('x');
  });

  it('recognizes a renamed link mark by its href attribute and reports its name', () => {
    const Hyperlink = Link.extend({ name: 'hyperlink' });
    const reports: ContentDiagnosticProps[] = [];
    editor = new Editor({
      extensions: [Document, Paragraph, Text, Hyperlink],
      content: { type: 'doc', content: [{ type: 'paragraph', content: [
        { type: 'text', text: 'h', marks: [{ type: 'hyperlink', attrs: { href: 'javascript:x' } }] },
      ] }] },
      onContentDiagnostic: props => reports.push(props),
    });
    expect(editor.state.doc.firstChild?.firstChild?.marks).toEqual([]);
    expect(reports[0]?.diagnostics[0]).toMatchObject({ code: 'unsafe-url', markType: 'hyperlink' });
  });
});

describe('link href validation', () => {
  it('rejects an href that is not a string or null in nodeFromJSON, Mark.fromJSON and Node.check', () => {
    const { schema } = new Editor({ extensions: extensions() });
    const node = (href: unknown): Record<string, unknown> => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href } }] }] }] });
    for (const href of [['javascript:x'], 42, true, {}]) {
      expect(() => schema.nodeFromJSON(node(href)), JSON.stringify(href)).toThrow(RangeError);
      expect(() => schema.markFromJSON({ type: 'link', attrs: { href } })).toThrow(RangeError);
      const unchecked = schema.text('x', [schema.marks['link']!.create({ href })]);
      expect(() => { schema.node('paragraph', null, [unchecked]).check(); }).toThrow(RangeError);
    }
    // Validation accepts every string, so a collaborator's wider configuration still loads.
    expect(() => schema.nodeFromJSON(node('javascript:alert(1)'))).not.toThrow();
    expect(() => schema.nodeFromJSON(node('ftp://x.example/'))).not.toThrow();
    expect(() => schema.nodeFromJSON(node(null))).not.toThrow();
  });

  it('rejects an AddMarkStep with an array href and applies one with a string that then renders as text', () => {
    const { editor: ed } = mount('<p>hello</p>');
    const step = (href: unknown): Record<string, unknown> => ({ stepType: 'addMark', from: 1, to: 6, mark: { type: 'link', attrs: { href } } });
    expect(() => Step.fromJSON(ed.schema, step(['javascript:x']))).toThrow(RangeError);
    const applied = Step.fromJSON(ed.schema, step('javascript:alert(1)'));
    expect(applied).toBeInstanceOf(AddMarkStep);
    ed.view.dispatch(ed.state.tr.step(applied));
    expect(hrefs(ed)).toEqual(['javascript:alert(1)']);
    expect(ed.getHTML()).toBe('<p><span>hello</span></p>');
  });
});

describe('link commands', () => {
  it('setMark and toggleMark refuse an href the policy or validation refuses', () => {
    const { editor: ed } = mount('<p>hello</p>');
    select(ed, 1, 6);
    for (const href of ['javascript:alert(1)', ['https://x.example/'], 'ftp://x.example/', 42]) {
      expect(ed.commands.setMark('link', { href }), JSON.stringify(href)).toBe(false);
      expect(ed.commands.toggleMark('link', { href })).toBe(false);
      expect(ed.can().setMark('link', { href })).toBe(false);
    }
    select(ed, 3);
    expect(ed.commands.setMark('link', { href: 'javascript:x' })).toBe(false);
    expect(ed.commands.toggleMark('link', { href: 'javascript:x' })).toBe(false);
    expect(hrefs(ed)).toEqual([]);
    select(ed, 1, 6);
    expect(ed.commands.setMark('link', { href: 'https://ok.example/' })).toBe(true);
    expect(hrefs(ed)).toEqual(['https://ok.example/']);
  });

  it('updateAttributes refuses an unsupported href but changes other attributes of a stored unsafe link', () => {
    const { editor: ed } = mount('<p>hello</p>');
    ed.view.dispatch(ed.state.tr.addMark(1, 6, ed.schema.marks['link']!.create({ href: 'javascript:x' })));
    select(ed, 1, 6);
    expect(ed.commands.updateAttributes('link', { href: 'vbscript:y' })).toBe(false);
    expect(ed.commands.updateAttributes('link', { href: ['https://x.example/'] })).toBe(false);
    expect(ed.commands.updateAttributes('link', { title: 'kept for migration' })).toBe(true);
    expect(ed.state.doc.firstChild?.firstChild?.marks[0]?.attrs).toMatchObject({ href: 'javascript:x', title: 'kept for migration' });
    expect(ed.commands.updateAttributes('link', { href: 'https://fixed.example/' })).toBe(true);
    expect(hrefs(ed)).toEqual(['https://fixed.example/']);
  });

  it('setMark on other marks is unchanged', () => {
    const { editor: ed } = mount('<p>hello</p>');
    select(ed, 1, 6);
    expect(ed.commands.setMark('bold')).toBe(true);
    expect(ed.commands.toggleMark('bold')).toBe(true);
  });
});

describe('Link protocols configuration', () => {
  it.each([[['javascript:']], [['DATA']], [['vbscript']], [['https', 'data:']], [['']], [['1abc:']], [['https:', 42]], ['https:']])(
    'refuses %j with an ExtensionConfigurationError', (protocols) => {
      expect(() => new Editor({ extensions: extensions({ protocols: protocols as string[] }) })).toThrow(ExtensionConfigurationError);
      expect(() => generateHTML(doc({ type: 'text', text: 'x' }), extensions({ protocols: protocols as string[] }))).toThrow(ExtensionConfigurationError);
    });

  it('reads entries in any case, with or without the colon', () => {
    for (const protocols of [['HTTPS'], ['https'], ['Https:']]) {
      const { editor: ed, reports } = mount(doc(linked('s', 'https://x.example/'), linked('h', 'http://x.example/')), { protocols });
      expect(hrefs(ed)).toEqual(['https://x.example/']);
      expect(reports[0]?.diagnostics.map(diagnostic => diagnostic.value)).toEqual(['http://x.example/']);
      ed.destroy();
    }
  });
});

describe('autolink and link paste', () => {
  function typeText(ed: Editor, text: string): void {
    for (const char of text) {
      const { from, to } = ed.state.selection;
      const handled = ed.view.someProp('handleTextInput', handler => handler(ed.view, from, to, char, () => ed.state.tr));
      if (!handled) ed.view.dispatch(ed.state.tr.insertText(char, from, to));
    }
  }

  it('autolinks an allowed address but not credentials or a script address (B13)', () => {
    const { editor: ed } = mount('<p></p>');
    typeText(ed, 'https://google.com@evil.example ');
    typeText(ed, 'javascript:alert(1) ');
    typeText(ed, 'www.example.com ');
    expect(hrefs(ed)).toEqual(['https://www.example.com']);
  });

  it('applies the policy before shouldAutoLink, and removes a prefix it linked once the whole address is refused (B14)', () => {
    const shouldAutoLink = vi.fn((_url: string) => true);
    const { editor: ed } = mount('<p></p>', { shouldAutoLink });
    typeText(ed, 'https://user:pw@x.example ');
    expect(hrefs(ed)).toEqual([]);
    expect(shouldAutoLink.mock.calls.flat().filter(url => url.includes('@'))).toEqual([]);
    expect(ed.getText()).toBe('https://user:pw@x.example ');
  });

  it('removes a prefix it linked when shouldAutoLink refuses the whole address', () => {
    const { editor: ed } = mount('<p></p>', { shouldAutoLink: url => !url.endsWith('.com') });
    typeText(ed, 'https://example.com ');
    expect(hrefs(ed)).toEqual([]);
  });

  it('keeps extending a prefix link to the whole allowed address', () => {
    const { editor: ed } = mount('<p></p>');
    typeText(ed, 'https://docs.example.com/a ');
    expect(hrefs(ed)).toEqual(['https://docs.example.com/a']);
    expect(ed.getJSON().content?.[0]?.content?.[0]?.text).toBe('https://docs.example.com/a');
  });

  function paste(ed: Editor, text: string): boolean {
    const event = new Event('paste') as ClipboardEvent;
    Object.defineProperty(event, 'clipboardData', { value: { getData: (type: string) => (type === 'text/plain' ? text : '') } });
    return ed.view.someProp('handlePaste', handler => handler(ed.view, event, ed.state.doc.slice(0, 0))) ?? false;
  }

  it('pastes a single-line allowed address as a link with its cleaned spelling (B15)', () => {
    const { editor: ed } = mount('<p></p>');
    expect(paste(ed, '  https://example.com/  ')).toBe(true);
    expect(hrefs(ed)).toEqual(['https://example.com/']);
    expect(ed.getText()).toBe('https://example.com/');
  });

  it('leaves text with a line break, a relative path, credentials or a script address to the default paste (B15, B16)', () => {
    const { editor: ed } = mount('<p></p>');
    for (const text of ['https://exa\nmple.com/', 'https://x.example/\tb', '/path', '#x', 'javascript:alert(1)', 'https://google.com@evil.example/']) {
      expect(paste(ed, text), JSON.stringify(text)).toBe(false);
    }
    expect(hrefs(ed)).toEqual([]);
  });
});

describe('isSupportedAttributeValue', () => {
  it('answers what loading JSON content keeps', () => {
    const { schema } = new Editor({ extensions: extensions({ protocols: ['https:', 'mailto:'] }) });
    expect(isSupportedAttributeValue(schema, 'link', 'href', 'https://x.example/')).toBe(true);
    expect(isSupportedAttributeValue(schema, 'link', 'href', ' mailto:a@b.example')).toBe(true);
    expect(isSupportedAttributeValue(schema, 'link', 'href', 'http://x.example/')).toBe(false);
    expect(isSupportedAttributeValue(schema, 'link', 'href', 'javascript:x')).toBe(false);
    expect(isSupportedAttributeValue(schema, 'link', 'href', ['https://x.example/'])).toBe(false);
    expect(isSupportedAttributeValue(schema, 'link', 'href', null)).toBe(false);
    expect(isSupportedAttributeValue(schema, 'link', 'href', undefined)).toBe(false);
    expect(isSupportedAttributeValue(schema, 'link', 'title', 'anything')).toBe(true);
    expect(isSupportedAttributeValue(schema, 'bold', 'href', 'javascript:x')).toBe(true);
    expect(isSupportedAttributeValue(schema, 'missing', 'href', 'javascript:x')).toBe(true);
  });
});

describe('normalizeContentAttributes with links', () => {
  function inject(ed: Editor, marks: [from: number, to: number, href: unknown][]): void {
    const tr = ed.state.tr.setMeta('addToHistory', false);
    for (const [from, to, href] of marks) tr.addMark(from, to, ed.schema.marks['link']!.create({ href }));
    ed.view.dispatch(tr);
  }

  it('removes stored unsafe and unsupported links in one step outside the history, reports each, and is idempotent (I1, I2)', () => {
    const { editor: ed, reports } = mount('<p>aaa bbb ccc</p>');
    inject(ed, [[1, 4, 'javascript:x'], [5, 8, 'ftp://x.example/'], [9, 12, 'https://ok.example/']]);
    let transactions = 0;
    ed.on('transaction', () => { transactions++; });
    expect(ed.can().normalizeContentAttributes()).toBe(true);
    expect(ed.commands.normalizeContentAttributes()).toBe(true);
    expect(transactions).toBe(1);
    expect(hrefs(ed)).toEqual(['https://ok.example/']);
    expect(ed.getText()).toBe('aaa bbb ccc');
    expect(reports.at(-1)).toMatchObject({
      source: 'normalizeContentAttributes',
      total: 2,
      diagnostics: [
        { code: 'unsafe-url', nodeType: 'text', markType: 'link', attribute: 'href', path: [0, 0], value: 'javascript:x' },
        { code: 'unsupported-url', nodeType: 'text', markType: 'link', attribute: 'href', path: [0, 2], value: 'ftp://x.example/' },
      ],
    });
    expect(ed.can().normalizeContentAttributes()).toBe(false);
    expect(ed.commands.normalizeContentAttributes()).toBe(false);
    expect(ed.commands.undo()).toBe(false);
    expect(hrefs(ed)).toEqual(['https://ok.example/']);
  });

  it('leaves the document alone in a dry run and in a read-only editor', () => {
    const { editor: ed } = mount('<p>aaa</p>');
    inject(ed, [[1, 4, ['javascript:x']]]);
    expect(ed.can().normalizeContentAttributes()).toBe(true);
    expect(hrefs(ed)).toEqual([['javascript:x']]);
    ed.setEditable(false);
    expect(ed.commands.normalizeContentAttributes()).toBe(false);
    expect(hrefs(ed)).toEqual([['javascript:x']]);
  });
});
