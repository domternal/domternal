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
    expect(markdown).toBe('[x](https://ok.example/a%20b%3Cc%3E%26colon;)');
    expect(renderedHrefs(markdown)).toEqual(['https://ok.example/a%20b%3Cc%3E%26colon;']);
  });

  it.each([
    ['javascript&colon;alert(1)', '[x](javascript%26colon;alert\\(1\\))'],
    ['&#106;avascript:alert(1)', '[x](%26#106;avascript:alert\\(1\\))'],
    ['javascript&#58alert(1)', '[x](javascript%26#58alert\\(1\\))'],
  ])('keeps the entity-like relative path %j from decoding into a scheme in any renderer', (href, expected) => {
    const { markdown } = serializeMarkdown(stored(href, 'x'));
    expect(markdown).toBe(expected);
    const rendered = renderedHrefs(markdown);
    expect(rendered).toHaveLength(1);
    // Resolved as a browser would read the attribute: a path on the page, never a script scheme.
    for (const value of rendered) expect(new URL(value, 'https://base.example/').protocol).toBe('https:');
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
  ])('parses back to the same link for %j', (href, title) => {
    const { markdown } = serializeMarkdown(stored(href, 'x', title));
    const parsed = parseMarkdown(markdown, schema);
    const link = parsed.firstChild?.firstChild?.marks.find(mark => mark.type.name === 'link');
    expect(parsed.textContent).toBe('x');
    expect(new URL(link?.attrs['href'] as string, 'https://base.example/').href).toBe(new URL(href, 'https://base.example/').href);
    expect(link?.attrs['title']).toBe(title?.replace(/\n/g, ' ') ?? null);
  });
});
