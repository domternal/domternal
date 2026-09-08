/**
 * Links in pasted HTML against the destination (H1 to H9): each sanitized
 * link needs its scheme in the destination's Link, which a constant probe
 * confirms; a link the destination cannot hold keeps its text and reports
 * `link-removed` once. Titles too long to keep are reported.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { Bold, Document, Editor, History, Link, Mark, Paragraph, StarterKit, Text, isValidUrl, checkUrl } from '@domternal/core';
import type { EditorOptions } from '@domternal/core';
import { PasteCleanup, normalizePasteHTML } from './index.js';
import type { PasteCleanupOptions, PasteOperationResult } from './index.js';
import { safeLink } from './html/urls.js';
import { getUnsupportedDestinationFeatures } from './destinationCapabilities.js';
import { collectDestinationDemand } from './html/destinationDemand.js';
import { parseBoundedHTML } from './html/parse.js';

const editors: Editor[] = [];
const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const editor of editors) if (!editor.isDestroyed) editor.destroy();
  for (const host of hosts) host.remove();
  editors.length = 0; hosts.length = 0; vi.restoreAllMocks();
});

interface Fixture {
  editor: Editor;
  completed: Mock<(result: PasteOperationResult) => void>;
}

function mount(extensions: NonNullable<EditorOptions['extensions']>, options: PasteCleanupOptions = {}): Fixture {
  const completed = vi.fn<(result: PasteOperationResult) => void>();
  const host = document.createElement('div'); document.body.append(host); hosts.push(host);
  const editor = new Editor({ element: host, content: '<p></p>',
    extensions: [...extensions, PasteCleanup.configure({ ...options, onPasteResult: completed })] });
  editors.push(editor);
  editor.view.setProps({ handleScrollToSelection: () => true });
  return { editor, completed };
}

function paste(editor: Editor, html: string): void {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: {
    items: [{ kind: 'string', type: 'text/html', getAsFile: () => null }], files: [],
    getData: (type: string) => type === 'text/html' ? html : '',
  } });
  editor.view.dom.dispatchEvent(event);
}

async function pasted(fixture: Fixture, html: string): Promise<PasteOperationResult> {
  paste(fixture.editor, html);
  await vi.waitFor(() => { expect(fixture.completed).toHaveBeenCalledOnce(); }, { interval: 1 });
  const result = fixture.completed.mock.calls[0]?.[0];
  if (!result) throw new Error('Expected a terminal paste result');
  return result;
}

/** Every link in the editor, as [text, href]. */
function links(editor: Editor): [string, unknown][] {
  const found: [string, unknown][] = [];
  editor.state.doc.descendants(node => {
    const link = node.marks.find(mark => mark.attrs['href'] !== undefined);
    if (node.isText && link) found.push([node.text ?? '', link.attrs['href']]);
  });
  return found;
}

const codes = (result: PasteOperationResult): string[] => result.diagnostics.map(diagnostic => diagnostic.code);
const base = [Document, Paragraph, Text, History, Bold];
const FOUR = '<p><a href="http://a.example/">http</a> <a href="https://b.example/">https</a> '
  + '<a href="mailto:c@c.example">mail</a> <a href="tel:+385123">phone</a></p>';

describe('destination link schemes', () => {
  it('keeps every link with the default Link, without a report (H1)', async () => {
    const fixture = mount([...base, Link]);
    const result = await pasted(fixture, FOUR);
    expect(result.status).toBe('applied');
    expect(links(fixture.editor)).toEqual([
      ['http', 'http://a.example/'], ['https', 'https://b.example/'], ['mail', 'mailto:c@c.example'], ['phone', 'tel:+385123'],
    ]);
    expect(codes(result)).toEqual([]);
  });

  it.each([
    ['no Link extension', base],
    ['StarterKit with link: false', [StarterKit.configure({ link: false, linkPopover: false })]],
  ])('keeps the text and reports each link as link-removed with %s (H2)', async (_label, extensions) => {
    const fixture = mount(extensions);
    const result = await pasted(fixture, FOUR);
    expect(result.status).toBe('applied');
    expect(links(fixture.editor)).toEqual([]);
    expect(fixture.editor.getText()).toBe('http https mail phone');
    expect(codes(result)).toEqual(['link-removed', 'link-removed', 'link-removed', 'link-removed']);
    expect(result.diagnostics.every(diagnostic => typeof diagnostic.offset === 'number')).toBe(true);
  });

  it('keeps only the schemes the destination Link allows (H3)', async () => {
    const fixture = mount([...base, Link.configure({ protocols: ['https:'] })]);
    const result = await pasted(fixture, FOUR);
    expect(links(fixture.editor)).toEqual([['https', 'https://b.example/']]);
    expect(fixture.editor.getText()).toBe('http https mail phone');
    expect(codes(result)).toEqual(['link-removed', 'link-removed', 'link-removed']);
  });

  it('keeps the formatting inside a removed link', async () => {
    const fixture = mount(base);
    await pasted(fixture, '<p>a <a href="https://b.example/"><strong>bold</strong> text</a> c</p>');
    expect(fixture.editor.getHTML()).toBe('<p>a <strong>bold</strong> text c</p>');
  });

  it('confirms a renamed link mark by the href it stores (H4)', async () => {
    const Hyperlink = Mark.create({
      name: 'hyperlink',
      addAttributes: () => ({ href: { default: null } }),
      parseHTML: () => [{ tag: 'a[href]', getAttrs: element => ({ href: (element as HTMLElement).getAttribute('href') }) }],
      renderHTML: ({ HTMLAttributes }) => ['a', HTMLAttributes, 0],
    });
    const fixture = mount([...base, Hyperlink]);
    const result = await pasted(fixture, '<p><a href="https://b.example/">https</a></p>');
    expect(links(fixture.editor)).toEqual([['https', 'https://b.example/']]);
    expect(codes(result)).toEqual([]);
  });

  it('does not count a mark that stores another href as support', () => {
    const Rewriting = Mark.create({
      name: 'rewriting',
      addAttributes: () => ({ href: { default: null } }),
      parseHTML: () => [{ tag: 'a[href]', getAttrs: () => ({ href: 'https://proxy.example/' }) }],
      renderHTML: ({ HTMLAttributes }) => ['a', HTMLAttributes, 0],
    });
    const editor = new Editor({ extensions: [...base, Rewriting] });
    editors.push(editor);
    expect(getUnsupportedDestinationFeatures(editor.schema, document, ['link-https', 'link-tel'])).toEqual(['link-https', 'link-tel']);
  });

  it('probes with constant HTML in a detached container', () => {
    const editor = new Editor({ extensions: [...base, Link] });
    editors.push(editor);
    const created: HTMLElement[] = [];
    // A document that records every element the probe creates.
    const recording = { createElement: (tag: string): HTMLElement => {
      const element = document.createElement(tag);
      created.push(element);
      return element;
    } } as unknown as Document;
    expect(getUnsupportedDestinationFeatures(editor.schema, recording, ['link-http', 'link-https', 'link-mailto', 'link-tel'])).toEqual([]);
    expect(created.length).toBeGreaterThan(0);
    for (const element of created) expect(element.isConnected).toBe(false);
    expect(created.map(element => element.innerHTML)).toEqual(expect.arrayContaining([
      '<p><a href="http://probe.invalid/">Probe</a></p>',
      '<p><a href="https://probe.invalid/">Probe</a></p>',
      '<p><a href="mailto:probe@probe.invalid">Probe</a></p>',
      '<p><a href="tel:+10000000000">Probe</a></p>',
    ]));
  });

  it('asks only for schemes of links with text', () => {
    const limits = { maxInputLength: 10_000, maxNodes: 1000, maxDepth: 100, maxDiagnostics: 10, maxTableCells: 10, maxImages: 10, maxImagePixels: 100 };
    const tree = parseBoundedHTML('<p><a href="https://b.example/">x</a><a href="tel:+1"></a><a href="mailto:a@b.example"><img src="x.png"></a></p>', limits);
    expect(collectDestinationDemand(tree, { maxNodes: 1000, maxDepth: 100 })).toEqual(['link-https']);
  });

  it('keeps the standalone normalizer unchanged (H5)', () => {
    const html = '<p><a href="https://b.example/">https</a></p>';
    expect(normalizePasteHTML(html)).toMatchObject({ status: 'cleaned', html, diagnostics: [] });
  });

  it('does not report unconfirmed formatting for links alone', async () => {
    const fixture = mount(base);
    const result = await pasted(fixture, '<p><a href="https://b.example/">x</a> <strong>b</strong></p>');
    expect(codes(result)).toEqual(['link-removed']);
  });
});

describe('dropped link and image metadata (H6, H7)', () => {
  const title = (length: number): string => 't'.repeat(length);

  it.each([
    ['a link title of 512 characters', `<p><a href="https://b.example/" title="${title(512)}">x</a></p>`, []],
    ['a link title of 513 characters', `<p><a href="https://b.example/" title="${title(513)}">x</a></p>`, ['unsupported-formatting']],
    ['an image title of 513 characters', `<p><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC" title="${title(513)}"></p>`, ['unsupported-formatting']],
    ['a paragraph title of 513 characters', `<p title="${title(513)}">x</p>`, []],
    ['target, rel and name', '<p><a href="https://b.example/" target="_blank" rel="noopener" name="_Toc1">x</a></p>', []],
  ])('reports %s as expected', (_label, html, expected) => {
    const result = normalizePasteHTML(html);
    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual(expected);
    expect(result.html).not.toMatch(/target=|rel=|name=/);
    expect(result.html.includes(title(513))).toBe(false);
  });

  it('keeps a title of 512 characters', () => {
    expect(normalizePasteHTML(`<p><a href="https://b.example/" title="${title(512)}">x</a></p>`).html).toContain(title(512));
  });
});

describe('parity with the core URL policy (H8)', () => {
  const LINK = { protocols: ['http:', 'https:', 'mailto:', 'tel:'], allowRelative: true };
  const SCRIPT = [
    'javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', '\u0001javascript:alert(1)', 'java\tscript:alert(1)',
    'java\nscript:alert(1)', 'java\rscript:alert(1)', 'java\u0000script:alert(1)', 'javascript://%0aalert(1)',
    'vbscript:msgbox(1)', 'data:text/html,x', 'data:image/png;base64,AA', ' data:text/html,x',
  ];

  it.each(SCRIPT)('refuses %j in both', (value) => {
    expect(safeLink(value)).toBeUndefined();
    expect(isValidUrl(value, LINK)).toBe(false);
  });

  it('refuses a host that holds &, which reads as another host once a browser decodes a character reference', () => {
    for (const value of ['https://a.example&#64;evil.example/', 'https://a.example&commat;evil.example/', 'https:&#47;&#47;evil.example/']) {
      expect(safeLink(value), value).toBeUndefined();
      expect(isValidUrl(value, LINK), value).toBe(false);
    }
    expect(safeLink('https://example.com/a?b=1&c=2')).toBe('https://example.com/a?b=1&c=2');
  });

  it('refuses a mail or phone address whose decoded form hides a character, which a mail client or dialer decodes', () => {
    for (const value of ['mailto:%E2%80%AEmoc.elgoog@evil.example', 'mailto:\u202emoc.elgoog@evil.example', 'mailto:a/b@ev\u200dil.example',
      'tel:%E2%80%8B1234', 'tel:+1%00', 'mailto:a@b.example?cc=%E2%80%AEx@y.example', 'mailto:a@b.example?subject=x&bcc=\u200bx@y.example',
      'mailto://ex\u200bample.com/']) {
      expect(safeLink(value), value).toBeUndefined();
      expect(isValidUrl(value, LINK), value).toBe(false);
    }
    for (const value of ['mailto:a@b.example?subject=%E2%80%AE', 'tel:+1%20555', 'mailto:J%C3%B6rg@example.com']) {
      expect(safeLink(value), value).toBe(value);
      expect(isValidUrl(value, LINK), value).toBe(true);
    }
  });

  it('keeps only addresses core allows, for a corpus and a seeded fuzz', () => {
    const corpus = [
      'https://example.com/', 'HTTPS://EXAMPLE.COM/A', 'http://example.com/a b', 'https://ｅxample.com/', 'https://example.com/‮',
      'mailto:a@b.example', 'mailto:‮@b.example', 'tel:+385 1', 'https://user:pass@example.com/', 'https://exa mple.com/',
      'ftp://example.com/', 'https:example.com', 'https:\\\\example.com', '//example.com/', '/relative', '#fragment',
      'https://example.com/%00', 'https://[::1]/', 'https://example.com/?q=<script>', 'mailto:?subject=x', 'tel:',
      'mailto:%E2%80%AEa@b.example', 'mailto:a@b.example?cc=%E2%80%8Bx@y', 'tel:+1%E2%80%8B2', 'mailto://ex%E2%80%8Bample.com/',
    ];
    let seed = 7;
    const random = (): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const pieces = ['https:', 'http:', 'mailto:', 'tel:', 'javascript:', 'data:', '//', '/', '\\', '#', '?', '%', '&', ';', ':', '@',
      'a', 'b.example', ' ', '\t', '\n', '\u0000', ' ', '​', '‮', 'ｊ', 'а', '%0a', '&#58;', '..', 'x',
      '%E2%80%AE', '%E2%80%8B', '%E2%80%8E', '%C2%AD', '\u00ad', '\u200e', '\u202a', '\u202c', '?cc=', '&bcc=', '?subject='];
    for (let run = 0; run < 3000; run++) {
      const length = 1 + Math.floor(random() * 6);
      corpus.push(Array.from({ length }, () => pieces[Math.floor(random() * pieces.length)] ?? '').join(''));
    }
    for (const value of corpus) {
      for (const source of [undefined, 'https://source.example/dir/page']) {
        const href = safeLink(value, source);
        if (href === undefined) continue;
        // Every address PasteCleanup keeps is one the destination Link stores as it is.
        expect(isValidUrl(href, LINK), JSON.stringify([value, href])).toBe(true);
        const check = checkUrl(href, LINK);
        expect(check.status === 'allowed' && check.url, JSON.stringify(value)).toBe(href);
        expect(/^(?:javascript|vbscript|data):/i.test(href)).toBe(false);
      }
    }
  });
});
