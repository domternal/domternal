/**
 * The tone a highlight's own background gives its run in the editor view
 * (data-dm-tone), and that nothing outside the view changes: stored JSON,
 * getHTML, the styled export, generateHTML and clipboard HTML stay byte
 * identical.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Plugin } from '@domternal/pm/state';
import { Highlight } from './Highlight.js';
import { TextColor } from './TextColor.js';
import { TextStyle } from '../marks/TextStyle.js';
import { Bold } from '../marks/Bold.js';
import { Link } from '../marks/Link.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Editor } from '../Editor.js';
import { Extension } from '../Extension.js';
import { History } from './History.js';
import { generateHTML } from '../helpers/ssr.js';
import type { JSONContent } from '../types/index.js';

const base = [Document, Paragraph, Text, Bold, Link, TextStyle, TextColor];
const run = (text: string, attrs: Record<string, string>, marks: NonNullable<JSONContent['marks']> = []): JSONContent => ({
  type: 'text',
  text,
  marks: [...marks, { type: 'textStyle', attrs }],
});
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content: [{ type: 'paragraph', content }] });

let editors: Editor[] = [];
function mount(content: JSONContent, extensions: unknown[] = [...base, Highlight]): Editor {
  const element = document.createElement('div');
  document.body.appendChild(element);
  const editor = new Editor({ element, extensions: extensions as never, content });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  for (const editor of editors) {
    editor.view.dom.parentElement?.remove();
    editor.destroy();
  }
  editors = [];
});

const tones = (editor: Editor): string[] =>
  Array.from(editor.view.dom.querySelectorAll('[data-dm-tone]')).map((element) => `${element.getAttribute('data-dm-tone') ?? ''}:${element.textContent}`);

describe('Highlight surface tone', () => {
  it('marks a highlighted run light, dark or mid by its own background, in the view only', () => {
    const editor = mount(doc(
      run('yellow', { backgroundColor: '#fef08a' }),
      run('navy', { backgroundColor: '#002060' }),
      run('gray', { backgroundColor: '#808080' }),
      run('teal', { backgroundColor: 'teal' }),
      run('word', { backgroundColor: 'yellow' }),
    ));
    expect(tones(editor)).toEqual(['light:yellow', 'dark:navy', 'light mid:gray', 'dark mid:teal', 'light:word']);
    const span = editor.view.dom.querySelector('[data-dm-tone="dark"]');
    expect(span?.tagName).toBe('SPAN');
    expect(span?.getAttribute('style')).toBe('background-color: rgb(0, 32, 96);');
  });

  it('gives no tone where the background is not drawn or the surface behind it decides', () => {
    const editor = mount(doc(
      run('token', { backgroundColorToken: 'yellow' }),
      run('token wins', { backgroundColor: '#002060', backgroundColorToken: 'yellow' }),
      run('unsafe', { backgroundColor: 'url(x)' }),
      run('half', { backgroundColor: 'rgba(0, 0, 255, 0.5)' }),
      run('clear', { backgroundColor: 'transparent' }),
      run('legacy mix', { backgroundColor: 'rgb(0, 0, 50%)' }),
      run('no-break space', { backgroundColor: '#002060\u00a0' }),
      run('text only', { color: '#ff0000' }),
    ));
    expect(tones(editor)).toEqual([]);
  });

  it('marks a painted background it cannot read unknown, with its value as --dm-tone-surface for the theme, in the view only', () => {
    const editor = mount(doc(
      run('variable', { backgroundColor: 'var(--brand, #fef08a)' }),
      run('oklch', { backgroundColor: 'oklch(0.25 0.1 265)', color: '#ffcc00' }),
    ));
    expect(tones(editor)).toEqual(['unknown:variable', 'unknown:oklch']);
    const [variable, oklch] = Array.from(editor.view.dom.querySelectorAll('[data-dm-tone="unknown"]'));
    expect(variable?.getAttribute('style')).toBe('background-color: var(--brand, #fef08a); --dm-tone-surface: var(--brand, #fef08a)');
    expect(oklch?.getAttribute('style')).toContain('color: rgb(255, 204, 0)');
    expect(oklch?.getAttribute('style')).toContain('--dm-tone-surface: oklch(0.25 0.1 265)');
    expect(editor.getHTML()).not.toContain('--dm-tone');
    expect(editor.getHTML()).toContain('background-color: var(--brand, #fef08a)');
  });

  it('gives no tone to a value the engine does not paint, though it reads one', () => {
    vi.stubGlobal('CSS', { supports: (_property: string, value: string) => value !== '#00205f' && value !== 'var(--unpainted)' });
    try {
      const editor = mount(doc(run('unpainted', { backgroundColor: '#00205f' }), run('unread', { backgroundColor: 'var(--unpainted)' }), run('painted', { backgroundColor: '#00205e' })));
      expect(tones(editor)).toEqual(['dark:painted']);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps an explicit color on the run as authored', () => {
    const editor = mount(doc(run('both', { backgroundColor: '#002060', color: '#ffcc00' })));
    const span = editor.view.dom.querySelector('[data-dm-tone]');
    expect(span?.getAttribute('data-dm-tone')).toBe('dark');
    expect(span?.getAttribute('style')).toContain('color: rgb(255, 204, 0)');
  });

  it('marks a highlight inside a link and a link inside a highlight', () => {
    const link = { type: 'link', attrs: { href: 'https://example.com' } };
    const editor = mount(doc(run('linked', { backgroundColor: '#000080' }, [link])));
    const anchor = editor.view.dom.querySelector('a');
    expect(anchor?.querySelector('[data-dm-tone="dark"]')?.textContent).toBe('linked');
  });

  it('changes the tone with the mark, and undo brings the old one back', () => {
    const editor = mount(doc(run('word', { backgroundColor: '#fef08a' })), [...base, Highlight, History]);
    expect(tones(editor)).toEqual(['light:word']);
    editor.commands.selectAll();
    editor.commands.setHighlight({ color: '#000080' });
    expect(tones(editor)).toEqual(['dark:word']);
    editor.commands.setHighlight({ color: 'var(--x)' });
    expect(tones(editor)).toEqual(['unknown:word']);
    editor.commands.setHighlight({ color: 'transparent' });
    expect(tones(editor)).toEqual([]);
    editor.commands.undo();
    expect(tones(editor)).toEqual(['unknown:word']);
    editor.commands.undo();
    expect(tones(editor)).toEqual(['dark:word']);
    editor.commands.undo();
    expect(tones(editor)).toEqual(['light:word']);
    editor.commands.unsetHighlight();
    expect(tones(editor)).toEqual([]);
  });

  it('changes nothing outside the view: JSON, getHTML, the styled export, generateHTML and clipboard HTML', () => {
    const content = doc(
      run('yellow', { backgroundColor: '#fef08a' }),
      run('navy', { backgroundColor: '#002060', color: '#ffffff' }),
      run('token', { backgroundColorToken: 'red' }),
      run('variable', { backgroundColor: 'var(--brand)' }),
      { type: 'text', text: ' bold', marks: [{ type: 'bold' }] },
    );
    const withTone = mount(content);
    const NoTone = Highlight.extend({ addProseMirrorPlugins: () => [] });
    const without = mount(content, [...base, NoTone]);
    expect(tones(withTone)).toHaveLength(3);
    expect(tones(without)).toEqual([]);
    expect(withTone.getJSON()).toEqual(without.getJSON());
    expect(withTone.getHTML()).toBe(without.getHTML());
    expect(withTone.getHTML({ styled: true })).toBe(without.getHTML({ styled: true }));
    expect(withTone.getHTML()).not.toContain('data-dm-tone');
    expect(withTone.getHTML({ styled: true })).not.toContain('data-dm-tone');
    expect(withTone.getHTML({ styled: true })).not.toContain('--dm-tone');
    expect(generateHTML(content, [...base, Highlight] as never)).toBe(generateHTML(content, [...base, NoTone] as never));
    expect(generateHTML(content, [...base, Highlight] as never)).not.toContain('data-dm-tone');
    withTone.commands.selectAll();
    without.commands.selectAll();
    const copied = withTone.view.serializeForClipboard(withTone.state.selection.content());
    const plain = without.view.serializeForClipboard(without.state.selection.content());
    expect(copied.dom.innerHTML).toBe(plain.dom.innerHTML);
    expect(copied.dom.innerHTML).not.toContain('data-dm-tone');
    expect(copied.dom.innerHTML).not.toContain('--dm-tone');
  });

  it('renders every other run exactly as ProseMirror does by default', () => {
    const content = doc(
      run('red', { color: '#ff0000' }),
      run('token', { backgroundColorToken: 'yellow' }),
      { type: 'text', text: 'plain' },
      { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
    );
    const NoTone = Highlight.extend({ addProseMirrorPlugins: () => [] });
    expect(mount(content).view.dom.innerHTML).toBe(mount(content, [...base, NoTone]).view.dom.innerHTML);
  });

  it("leaves a host's own textStyle mark view in charge, without an error", () => {
    const HostView = Extension.create({
      name: 'hostTextStyleView',
      priority: 1000,
      addProseMirrorPlugins() {
        return [new Plugin({ props: { markViews: { textStyle: () => {
          const dom = document.createElement('span');
          dom.setAttribute('data-host', 'yes');
          return { dom };
        } } } })];
      },
    });
    const editor = mount(doc(run('hosted', { backgroundColor: '#002060' })), [...base, Highlight, HostView]);
    expect(editor.view.dom.querySelector('[data-host="yes"]')?.textContent).toBe('hosted');
    expect(tones(editor)).toEqual([]);
  });

  it('marks runs in a read-only editor too', () => {
    const element = document.createElement('div');
    document.body.appendChild(element);
    const editor = new Editor({ element, editable: false, extensions: [...base, Highlight] as never, content: doc(run('ro', { backgroundColor: '#000080' })) });
    editors.push(editor);
    expect(tones(editor)).toEqual(['dark:ro']);
  });
});
