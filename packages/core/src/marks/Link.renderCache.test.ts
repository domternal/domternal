/**
 * Rendering remembers the URL check of each href under the same Link policy: the wrappers call
 * getHTML on every update, which renders every link of the document again.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '../Editor.js';
import { Document } from '../nodes/Document.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Text } from '../nodes/Text.js';
import { Link } from './Link.js';
import * as urlPolicy from '../helpers/checkUrl.js';

vi.mock('../helpers/checkUrl.js', async (importOriginal) => {
  const actual = await importOriginal<typeof urlPolicy>();
  return { ...actual, checkUrl: vi.fn(actual.checkUrl) };
});

const editors: Editor[] = [];
afterEach(() => { editors.splice(0).forEach(editor => { editor.destroy(); }); });

function mount(link: Parameters<typeof Link.configure>[0], content: string): Editor {
  const editor = new Editor({ extensions: [Document, Paragraph, Text, Link.configure(link)], content });
  editors.push(editor);
  return editor;
}

const links = Array.from({ length: 50 }, (_, i) => `<a href="https://example.com/${String(i)}">l${String(i)}</a>`).join(' ');

describe('Link rendering', () => {
  it('checks each href once however often the document renders', () => {
    const editor = mount({}, `<p>${links}</p>`);
    const first = editor.getHTML();
    vi.mocked(urlPolicy.checkUrl).mockClear();

    expect(editor.getHTML()).toBe(first);
    expect(editor.getHTML()).toBe(first);

    expect(vi.mocked(urlPolicy.checkUrl)).not.toHaveBeenCalled();
  });

  it('keeps the checks of different policies apart', () => {
    const wide = mount({}, '<p>mail top</p>');
    const narrow = mount({ protocols: ['https:'], allowRelative: false }, '<p>mail top</p>');
    // Stored as a collaborator with a wider configuration would store them, past loading.
    for (const editor of [wide, narrow]) {
      const type = editor.schema.marks['link']!;
      editor.view.dispatch(editor.state.tr
        .addMark(1, 5, type.create({ href: 'mailto:a@b.example' }))
        .addMark(6, 9, type.create({ href: '#top' })));
    }
    for (let round = 0; round < 2; round++) {
      expect(wide.getHTML()).toBe('<p><a href="mailto:a@b.example">mail</a> <a href="#top">top</a></p>');
      expect(narrow.getHTML()).toBe('<p><span>mail</span> <span>top</span></p>');
    }
  });
});
