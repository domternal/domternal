/**
 * Loading JSON content remembers the URL check of each href under the same Link policy: a
 * controlled editor sets the same content again after every change, and generateHTML loads it
 * on every call.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '../Editor.js';
import { Document } from '../nodes/Document.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Text } from '../nodes/Text.js';
import { generateHTML } from '../helpers/ssr.js';
import type { ContentDiagnostic, JSONContent } from '../types/index.js';
import { Link } from './Link.js';
import * as urlPolicy from '../helpers/checkUrl.js';

vi.mock('../helpers/checkUrl.js', async (importOriginal) => {
  const actual = await importOriginal<typeof urlPolicy>();
  return { ...actual, checkUrl: vi.fn(actual.checkUrl) };
});

const editors: Editor[] = [];
afterEach(() => { editors.splice(0).forEach(editor => { editor.destroy(); }); });

function mount(link: Parameters<typeof Link.configure>[0], content: JSONContent, diagnostics: ContentDiagnostic[] = []): Editor {
  const editor = new Editor({
    extensions: [Document, Paragraph, Text, Link.configure(link)], content,
    onContentDiagnostic: ({ diagnostics: found }) => { diagnostics.push(...found); },
  });
  editors.push(editor);
  return editor;
}

const linked = (hrefs: string[]): JSONContent => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: hrefs.map((href, i) => ({ type: 'text', text: `l${String(i)} `, marks: [{ type: 'link', attrs: { href } }] })) }],
});
const hrefs = Array.from({ length: 50 }, (_, i) => `https://example.com/${String(i)}`);

describe('Link hrefs in loaded JSON content', () => {
  it('checks each href once however often the same content loads', () => {
    const content = linked(hrefs);
    const editor = mount({}, content);
    const html = editor.getHTML();
    vi.mocked(urlPolicy.checkUrl).mockClear();

    editor.commands.setContent(content);
    editor.commands.setContent(content);

    expect(editor.getHTML()).toBe(html);
    expect(vi.mocked(urlPolicy.checkUrl)).not.toHaveBeenCalled();
  });

  it('checks each href once however often generateHTML loads the same content', () => {
    const content = linked(hrefs);
    const extensions = [Document, Paragraph, Text, Link];
    const html = generateHTML(content, extensions);
    vi.mocked(urlPolicy.checkUrl).mockClear();

    expect(generateHTML(content, extensions)).toBe(html);
    expect(vi.mocked(urlPolicy.checkUrl)).not.toHaveBeenCalled();
  });

  it('removes a refused link and reports it on every load', () => {
    const diagnostics: ContentDiagnostic[] = [];
    const content = linked(['javascript:alert(1)', 'ftp://example.com/file']);
    const editor = mount({}, content, diagnostics);
    editor.commands.setContent(content);

    expect(editor.getHTML()).toBe('<p>l0 l1 </p>');
    expect(diagnostics.map(diagnostic => diagnostic.code)).toEqual(['unsafe-url', 'unsupported-url', 'unsafe-url', 'unsupported-url']);
  });

  it('checks an href over 2,048 characters again on every load and render instead of keeping it', () => {
    // A long-lived page or server would otherwise keep thousands of such hrefs from untrusted content.
    const long = `https://example.com/${'x'.repeat(2048)}`;
    const content = linked([long, ...hrefs.slice(0, 2)]);
    const editor = mount({}, content);
    const html = editor.getHTML();
    vi.mocked(urlPolicy.checkUrl).mockClear();

    editor.commands.setContent(content);
    expect(editor.getHTML()).toBe(html);
    expect(generateHTML(content, [Document, Paragraph, Text, Link])).toBe(html);

    const checked = vi.mocked(urlPolicy.checkUrl).mock.calls.map(([href]) => href);
    expect(checked.length).toBeGreaterThanOrEqual(3);
    expect(new Set(checked)).toEqual(new Set([long]));
  });

  it('keeps the checks of different policies apart', () => {
    const content = linked(['mailto:a@b.example', '#top']);
    const wide = mount({}, content);
    const narrow = mount({ protocols: ['https:'], allowRelative: false }, content);
    for (let round = 0; round < 2; round++) {
      wide.commands.setContent(content);
      narrow.commands.setContent(content);
      expect(wide.getHTML()).toBe('<p><a href="mailto:a@b.example">l0 </a><a href="#top">l1 </a></p>');
      expect(narrow.getHTML()).toBe('<p>l0 l1 </p>');
    }
  });
});
