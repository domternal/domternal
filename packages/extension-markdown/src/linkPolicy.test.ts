/**
 * Markdown and the URL policy (J1 to J10): parsing opens a link only for an
 * href the schema's Link keeps, and an image only for a source the Image
 * loads; serializing writes a link the editor would not render as its text,
 * and escapes destinations and titles so every renderer reads one address.
 */
import { afterEach, describe, expect, it } from 'vitest';
import MarkdownIt from 'markdown-it';
import {
  Bold,
  Document,
  Editor,
  HardBreak,
  Link,
  Node,
  Paragraph,
  Text,
} from '@domternal/core';
import type { AnyExtension } from '@domternal/core';
import { Image } from '@domternal/extension-image';
import type { Node as PMNode, Schema } from '@domternal/pm/model';
import { parseMarkdown } from './parser/parser.js';
import { serializeMarkdown } from './serializer/serializer.js';
import { Markdown } from './Markdown.js';

const baseExtensions: AnyExtension[] = [Document, Text, Paragraph, Bold, HardBreak, Image.configure({ inline: true })];
const schemaOf = (link: AnyExtension = Link): Schema => {
  const editor = new Editor({ extensions: [...baseExtensions, link] });
  const { schema } = editor;
  editor.destroy();
  return schema;
};
const schema = schemaOf();

/** Every link in a parsed document, as [text, href]. */
function links(doc: PMNode): [string, unknown][] {
  const found: [string, unknown][] = [];
  doc.descendants((node) => {
    const link = node.marks.find(mark => mark.type.name === 'link');
    if (node.isText && link) found.push([node.text ?? '', link.attrs['href']]);
  });
  return found;
}

/** A document of one paragraph whose text carries a link mark, created without loading, as a collaborator stores it. */
function stored(href: unknown, text = 'x', title: string | null = null, target: Schema = schema): PMNode {
  const mark = target.marks['link']!.create({ href, title });
  return target.node('doc', null, [target.node('paragraph', null, [target.text(text, [mark])])]);
}

const md = new MarkdownIt('default', { html: true, linkify: false });
/** Every href markdown-it would render for the Markdown, with raw HTML enabled, as a permissive renderer. */
function renderedHrefs(markdown: string): string[] {
  const host = document.createElement('div');
  host.innerHTML = md.render(markdown);
  return Array.from(host.querySelectorAll('[href], [src]')).map(element => element.getAttribute('href') ?? element.getAttribute('src') ?? '');
}

describe('parsing links (J1 to J5)', () => {
  it.each([
    // markdown-it refuses the script scheme before the policy sees it, so the source stays literal.
    ['[a](javascript:alert(1))', '[a](javascript:alert(1))'],
    ['<javascript:alert(1)>', '<javascript:alert(1)>'],
    ['[a](ftp://files.example/f)', 'a'],
    ['[a](//evil.example/x)', 'a'],
    ['[a](data:image/png;base64,AA)', 'a'],
    ['[a](java%09script:alert(1))', 'a'],
    ['[a](https://user:pass@example.com/)', 'a'],
    ['[a](https://google.com@evil.example/)', 'a'],
    ['[a]()', 'a'],
    ['[a](<>)', 'a'],
    ['[a](%6Aavascript:alert(1))', 'a'],
  ])('keeps %j as the text %j without a link', (markdown, text) => {
    const doc = parseMarkdown(markdown, schema);
    expect(links(doc)).toEqual([]);
    expect(doc.textContent).toBe(text);
  });

  it.each([
    ['[a](#intro)', '#intro'],
    ['[a](/docs/page)', '/docs/page'],
    ['[a](./page)', './page'],
    ['[a](?q=1)', '?q=1'],
    ['[a](https://example.com/)', 'https://example.com/'],
    ['[a](mailto:a@b.example)', 'mailto:a@b.example'],
    ['[a](tel:+385123)', 'tel:+385123'],
    ['<https://example.com/>', 'https://example.com/'],
  ])('links %j to %j', (markdown, href) => {
    expect(links(parseMarkdown(markdown, schema)).map(([, value]) => value)).toEqual([href]);
  });

  it('follows the configured protocols and allowRelative', () => {
    const ftp = schemaOf(Link.configure({ protocols: ['https:', 'ftp:'] }));
    expect(links(parseMarkdown('[a](ftp://files.example/f)', ftp))).toEqual([['a', 'ftp://files.example/f']]);
    const absolute = schemaOf(Link.configure({ allowRelative: false }));
    expect(links(parseMarkdown('[a](#intro) [b](https://example.com/)', absolute))).toEqual([['b', 'https://example.com/']]);
  });

  it('keeps a refused link beside allowed ones, each with its own text and formatting', () => {
    const doc = parseMarkdown('[one](https://one.example/) [**two**](ftp://two.example/) [three](#three)', schema);
    expect(links(doc)).toEqual([['one', 'https://one.example/'], ['three', '#three']]);
    expect(doc.textContent).toBe('one two three');
    let bold = false;
    doc.descendants(node => { if (node.text === 'two') bold = node.marks.some(mark => mark.type.name === 'bold'); });
    expect(bold).toBe(true);
  });

  it('keeps linkified bare URLs of allowed schemes', () => {
    expect(links(parseMarkdown('see https://example.com/ and ftp://files.example/', schema))).toEqual([['https://example.com/', 'https://example.com/']]);
  });
});

describe('parsing images', () => {
  const images = (doc: PMNode): unknown[] => {
    const found: unknown[] = [];
    doc.descendants(node => { if (node.type.name === 'image') found.push(node.attrs['src']); });
    return found;
  };

  it.each([
    ['![alt](https://example.com/a.png)', 'https://example.com/a.png'],
    ['![alt](/a.png)', '/a.png'],
    ['![alt](//cdn.example/a.png)', '//cdn.example/a.png'],
    ['![alt](data:image/png;base64,AA)', 'data:image/png;base64,AA'],
  ])('keeps the image %j', (markdown, src) => {
    expect(images(parseMarkdown(markdown, schema))).toEqual([src]);
  });

  it.each([
    ['![alt](https://user:pass@example.com/a.png)'],
    ['![alt](java%09script:x)'],
    ['![alt]()'],
  ])('keeps the alternative text of %j instead of an image', (markdown) => {
    const doc = parseMarkdown(markdown, schema);
    expect(images(doc)).toEqual([]);
    expect(doc.textContent).toBe('alt');
  });
});

describe('images and the Image configuration', () => {
  const withoutData = (() => {
    const editor = new Editor({ extensions: [Document, Text, Paragraph, Image.configure({ inline: true, allowBase64: false }), Link] });
    const { schema: target } = editor;
    editor.destroy();
    return target;
  })();
  const sources = (doc: PMNode): unknown[] => {
    const found: unknown[] = [];
    doc.descendants(node => { if (node.type.name === 'image') found.push(node.attrs['src']); });
    return found;
  };
  const DATA = 'data:image/png;base64,iVBORw0KGgo=';

  it('keeps the alternative text of a data image the Image refuses with allowBase64 false', () => {
    const doc = parseMarkdown(`![pic](${DATA}) and ![web](https://example.com/a.png)`, withoutData);
    expect(sources(doc)).toEqual(['https://example.com/a.png']);
    // The kept image contributes its alternative text as leaf text.
    expect(doc.textContent).toBe('pic and web');
  });

  it('omits a stored data image the Image refuses with allowBase64 false, with a warning', () => {
    const image = withoutData.nodes['image']!;
    const doc = withoutData.node('doc', null, [withoutData.node('paragraph', null, [image.create({ src: DATA, alt: 'pic' }), withoutData.text(' x')])]);
    const { markdown, warnings } = serializeMarkdown(doc);
    expect(markdown).toBe(' x');
    expect(warnings).toContainEqual(expect.objectContaining({ code: 'unsupported-node', nodeType: 'image' }));
    expect(serializeMarkdown(schema.node('doc', null, [schema.node('paragraph', null, [schema.nodes['image']!.create({ src: DATA, alt: 'pic' })])])).markdown)
      .toBe(`![pic](${DATA})`);
  });

  it('reads a source from an image node that wraps its img, and keeps judging it by the URL policy', () => {
    const Figure = Node.create({
      name: 'image',
      group: 'inline',
      inline: true,
      atom: true,
      addAttributes: () => ({ src: { default: null }, alt: { default: null }, title: { default: null } }),
      parseHTML: () => [{ tag: 'img[src]' }],
      renderHTML: ({ HTMLAttributes }) => ['span', { class: 'figure' }, ['img', HTMLAttributes]],
    });
    const editor = new Editor({ extensions: [Document, Text, Paragraph, Figure] });
    const { schema: target } = editor;
    editor.destroy();
    expect(sources(parseMarkdown('![a](https://example.com/a.png) ![b](javascript:x) ![c](file:///x.png)', target))).toEqual(['https://example.com/a.png']);
  });
});

describe('markdown paste (J5)', () => {
  let editor: Editor | undefined;
  afterEach(() => { editor?.destroy(); editor = undefined; });

  it('pastes refused links as text and allowed ones as links', () => {
    editor = new Editor({ extensions: [...baseExtensions, Link, Markdown], content: '<p></p>' });
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: { getData: (type: string) => (type === 'text/plain' ? '**bold** [a](ftp://x.example/) [b](#b) [c](javascript:alert(1))' : '') },
    });
    editor.view.dom.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(links(editor.state.doc)).toEqual([['b', '#b']]);
    expect(editor.getText()).toBe('bold a b [c](javascript:alert(1))');
  });
});

describe('serializing links the editor would not render (J6)', () => {
  it.each([
    ['javascript:alert(1)'],
    [' javascript:alert(1)'],
    ['java\tscript:alert(1)'],
    ['data:text/html,x'],
    ['https://google.com@evil.example/'],
    ['ftp://files.example/'],
    ['//evil.example/x'],
    // The colon in the first segment already refuses a reference that would decode into a scheme.
    ['java&Tab;script:alert(1)'],
    [['javascript:alert(1)']],
    [42],
    [null],
  ])('writes the text of a link to %j with a lossy-attribute warning', (href) => {
    const { markdown, warnings } = serializeMarkdown(stored(href, 'click here'));
    expect(markdown).toBe('click here');
    expect(warnings).toContainEqual(expect.objectContaining({ code: 'lossy-attribute', nodeType: 'link' }));
    expect(renderedHrefs(markdown)).toEqual([]);
  });

  it('writes a link the configured Link allows', () => {
    const ftp = schemaOf(Link.configure({ protocols: ['https:', 'ftp:'] }));
    expect(serializeMarkdown(stored('ftp://files.example/', 'f', null, ftp)).markdown).toBe('[f](ftp://files.example/)');
  });

  it('writes a stored href in its cleaned spelling', () => {
    expect(serializeMarkdown(stored(' https://exa\nmple.com/ ', 'x')).markdown).toBe('[x](https://example.com/)');
  });
});

describe('serializing destinations and titles (J7, J8, J9)', () => {
  it('escapes a destination so it stays one address (J7)', () => {
    const { markdown } = serializeMarkdown(stored('https://ok.example/a b<c>&colon;', 'x'));
    expect(markdown).toBe('[x](https://ok.example/a%20b%3Cc%3E&amp;colon;)');
    // The renderer decodes `&amp;` once, so the attribute holds the stored `&colon;` as text.
    expect(renderedHrefs(markdown)).toEqual(['https://ok.example/a%20b%3Cc%3E&colon;']);
  });

  it.each(['javascript&colon;alert(1)', '&#106;avascript:alert(1)', 'javascript&#58alert(1)'])(
    'writes a link to the entity-like path %j, which the Link refuses, as its text',
    (href) => {
      const { markdown, warnings } = serializeMarkdown(stored(href, 'x'));
      expect(markdown).toBe('x');
      expect(renderedHrefs(markdown)).toEqual([]);
      expect(warnings.map(warning => warning.code)).toEqual(['lossy-attribute']);
    },
  );

  it.each([
    'https://example.com/?q=x&copy;y',
    'https://example.com/?a=1&amp;b=2',
    'https://example.com/?a=b&#top',
    '/search?a=1&lt=2',
    'mailto:a@b.example?subject=Q&amp;A',
  ])('writes an & that starts a reference as &amp;, so %j reads back and renders as stored', (href) => {
    const { markdown } = serializeMarkdown(stored(href, 'x'));
    expect(markdown).not.toContain('%26');
    const parsed = parseMarkdown(markdown, schema);
    expect(links(parsed)).toEqual([['x', href]]);
    expect(renderedHrefs(markdown)).toEqual([href]);
  });

  it('writes an image source with an & that starts a reference the same way', () => {
    const image = schema.node('doc', null, [schema.node('paragraph', null, [schema.nodes['image']!.create({ src: 'https://ok.example/a.png?x=1&copy;y', alt: 'a' })])]);
    const { markdown } = serializeMarkdown(image);
    expect(markdown).toBe('![a](https://ok.example/a.png?x=1&amp;copy;y)');
    expect(renderedHrefs(markdown)).toEqual(['https://ok.example/a.png?x=1&copy;y']);
  });

  // Every character JavaScript's \s matches, which marked reads as the end of a destination, that an
  // allowed href can hold: the policy removes tabs and line breaks and refuses the other controls.
  const UNICODE_SPACES = ['\u00a0', '\u1680', '\u2000', '\u2005', '\u200a', '\u2028', '\u2029', '\u202f', '\u205f', '\u3000', '\ufeff'];

  const codePoint = (char: string): string => `U+${(char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`;

  it.each(UNICODE_SPACES.map(space => [codePoint(space), space]))('percent-encodes %s in a destination, so no renderer ends the address there', (_label, space) => {
    const href = `https://x.example/a${space}*b*${space}https://evil.example/`;
    const { markdown } = serializeMarkdown(stored(href, 'x'));
    const encoded = encodeURIComponent(space);
    expect(markdown).toBe(`[x](https://x.example/a${encoded}*b*${encoded}https://evil.example/)`);
    expect(/\s/.test(markdown)).toBe(false);
    const parsed = links(parseMarkdown(markdown, schema));
    expect(parsed).toHaveLength(1);
    expect(new URL(parsed[0]![1] as string).href).toBe(new URL(href).href);
    expect(renderedHrefs(markdown)).toHaveLength(1);
  });

  it('percent-encodes a Unicode space at the end of a destination, which a renderer would drop', () => {
    const { markdown } = serializeMarkdown(stored('https://x.example/a\u00a0', 'x'));
    expect(markdown).toBe('[x](https://x.example/a%C2%A0)');
    expect(links(parseMarkdown(markdown, schema))).toEqual([['x', 'https://x.example/a%C2%A0']]);
  });

  it('percent-encodes a Unicode space in an image source and a relative destination', () => {
    const image = schema.node('doc', null, [schema.node('paragraph', null, [schema.nodes['image']!.create({ src: 'images/a\u3000b.png', alt: 'a' })])]);
    expect(serializeMarkdown(image).markdown).toBe('![a](images/a%E3%80%80b.png)');
    expect(serializeMarkdown(stored('/docs/a\u2028b#c\u00a0d', 'x')).markdown).toBe('[x](/docs/a%E2%80%A8b#c%C2%A0d)');
  });

  it('keeps an ampersand that starts no reference, so a query keeps its parameters', () => {
    expect(serializeMarkdown(stored('https://ok.example/?a=1&b=2&c', 'x')).markdown).toBe('[x](https://ok.example/?a=1&b=2&c)');
  });

  it('writes a title on one line with its markup escaped (J8)', () => {
    const { markdown } = serializeMarkdown(stored('https://ok.example/', 'x', 'a\n\n<script>"'));
    expect(markdown).toBe('[x](https://ok.example/ "a  \\<script\\>\\"")');
    const host = document.createElement('div');
    host.innerHTML = md.render(markdown);
    expect(host.querySelector('script')).toBeNull();
    expect(host.querySelector('a')?.getAttribute('title')).toBe('a  <script>"');
  });

  it.each([
    ['Tom &amp; Jerry &copy;', 'Tom &amp;amp; Jerry &amp;copy;'],
    ['x &#106; y &#x6A;', 'x &amp;#106; y &amp;#x6A;'],
    ['R&D', 'R&D'],
    ['a & b', 'a & b'],
    ['&copy2024 &amp', '&copy2024 &amp'],
    ['a\\&b', 'a\\\\&b'],
  ])('writes an & that starts a reference in the title %j as &amp;, which every renderer decodes once', (title, written) => {
    const { markdown } = serializeMarkdown(stored('https://ok.example/', 'x', title));
    expect(markdown).toBe(`[x](https://ok.example/ "${written}")`);
    const host = document.createElement('div');
    host.innerHTML = md.render(markdown);
    expect(host.querySelector('a')?.getAttribute('title')).toBe(title);
    const link = parseMarkdown(markdown, schema).firstChild?.firstChild?.marks.find(mark => mark.type.name === 'link');
    expect(link?.attrs['title']).toBe(title);
  });

  it('writes an image title with an & that starts a reference the same way', () => {
    const image = schema.node('doc', null, [schema.node('paragraph', null, [schema.nodes['image']!.create({ src: 'https://ok.example/a.png', alt: 'a', title: 'Q&amp;A' })])]);
    expect(serializeMarkdown(image).markdown).toBe('![a](https://ok.example/a.png "Q&amp;amp;A")');
  });

  it.each([
    ['https://example.com/', '<https://example.com/>'],
    ['http://example.com/', '<http://example.com/>'],
    ['mailto:a@b.example', '<mailto:a@b.example>'],
    ['tel:+385123', '[tel:+385123](tel:+385123)'],
    ['https://example.com/?a=1&b=2', '[https://example.com/?a=1\\&b=2](https://example.com/?a=1&b=2)'],
  ])('writes a link whose text is its href %j as %j (J9)', (href, expected) => {
    expect(serializeMarkdown(stored(href, href)).markdown).toBe(expected);
  });
});

describe('serializing images', () => {
  const image = (src: unknown, title: string | null = null): PMNode =>
    schema.node('doc', null, [schema.node('paragraph', null, [schema.nodes['image']!.create({ src, alt: 'alt', title })])]);

  it('escapes the source and title', () => {
    expect(serializeMarkdown(image('https://ok.example/a b.png', 'a\n"b"')).markdown).toBe('![alt](https://ok.example/a%20b.png "a \\"b\\"")');
  });

  it.each([['javascript:alert(1)'], [' file:///etc/passwd'], [['https://ok.example/a.png']]])('omits an image with the source %j', (src) => {
    const { markdown, warnings } = serializeMarkdown(image(src));
    expect(markdown).toBe('');
    expect(warnings).toContainEqual(expect.objectContaining({ code: 'unsupported-node', nodeType: 'image' }));
  });
});

describe('round trips (J10)', () => {
  it.each([
    ['https://ok.example/a b<c>?x=1&y=2', 'title "q" <b>'],
    ['/docs/page?x=1&y=2#frag', 'multi\nline'],
    ['#section', null],
    ['https://ok.example/(paren)', null],
    // The joiners of Persian, Indic and emoji text are ordinary characters of a path or query.
    ['https://fa.wikipedia.org/wiki/\u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u0645', null],
    ['/wiki/\u0915\u094d\u200d\u0937?q=\ud83d\udc68\u200d\ud83d\udc69', null],
  ])('parses back to the same link for %j', (href, title) => {
    const { markdown } = serializeMarkdown(stored(href, 'x', title));
    const parsed = parseMarkdown(markdown, schema);
    const link = parsed.firstChild?.firstChild?.marks.find(mark => mark.type.name === 'link');
    expect(parsed.textContent).toBe('x');
    expect(new URL(link?.attrs['href'] as string, 'https://base.example/').href).toBe(new URL(href, 'https://base.example/').href);
    expect(link?.attrs['title']).toBe(title?.replace(/\n/g, ' ') ?? null);
  });
});
