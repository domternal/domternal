import { afterEach, describe, expect, it, vi } from 'vitest';
import { Plugin } from '@domternal/pm/state';
import { Editor } from '../Editor.js';
import { Extension } from '../Extension.js';
import { Document } from '../nodes/Document.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Text } from '../nodes/Text.js';
import { TextStyle } from '../marks/TextStyle.js';
import { Link } from '../marks/Link.js';
import { Highlight } from './Highlight.js';
import { History } from './History.js';
import { TextColor } from './TextColor.js';
import { generateHTML } from '../helpers/ssr.js';
import { measuredContrastColor, paintedTextColor, textContrastPaint, textContrastRatio } from '../helpers/textColorContrast.js';
import type { JSONContent } from '../types/index.js';

const editors: Editor[] = [];
const hosts: HTMLElement[] = [];
const Auto = TextColor.configure({ contrast: 'auto' });
const base = [Document, Paragraph, Text, TextStyle, Link, History];
const run = (text: string, attrs: Record<string, string>, link = false): JSONContent => ({ type: 'text', text,
  marks: [...(link ? [{ type: 'link', attrs: { href: 'https://example.com' } }] : []), { type: 'textStyle', attrs }] });
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content: [{ type: 'paragraph', content }] });
function mount(content: JSONContent, extensions = [Auto, Highlight], background = '#202020'): Editor {
  const host = document.createElement('div');
  host.className = 'dm-editor';
  host.style.backgroundColor = background;
  document.body.append(host);
  hosts.push(host);
  const editor = new Editor({ element: host, content, extensions: [...base, ...extensions] });
  editors.push(editor);
  return editor;
}
const span = (editor: Editor, text?: string): HTMLElement => Array.from(editor.view.dom.querySelectorAll<HTMLElement>('span'))
  .find(element => text === undefined || element.textContent === text)!;
const adjusted = (element: HTMLElement): string => element.style.getPropertyValue('--dm-readable-color');
const settle = (): Promise<void> => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => { resolve(); })));

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  for (const host of hosts.splice(0)) host.remove();
  vi.restoreAllMocks();
});

describe('TextColor contrast presentation', () => {
  it('requires the explicit option, preserving the default mark rendering', async () => {
    expect(TextColor.options.contrast).toBe('original');
    const editor = mount(doc(run('ink', { color: '#000000' })), [TextColor, Highlight]);
    await settle();
    expect(span(editor).style.color).toBe('rgb(0, 0, 0)');
    expect(editor.view.dom.querySelector('[data-dm-text-contrast]')).toBeNull();
  });

  it('adjusts only unreadable opaque literal colors and retains the original inline color', async () => {
    const editor = mount(doc(run('dark', { color: '#000000' }), run('bright', { color: '#ffff00' }),
      run('transparent', { color: 'rgba(0, 0, 0, .4)' }), run('token', { color: '#000000', colorToken: 'red' }),
      run('variable', { color: 'var(--custom)' }), run('current', { color: 'currentColor' })));
    await vi.waitFor(() => { expect(adjusted(span(editor, 'dark'))).not.toBe(''); });
    expect(span(editor, 'dark').style.color).toBe('rgb(0, 0, 0)');
    expect(textContrastRatio(measuredContrastColor(adjusted(span(editor, 'dark')))!, [32, 32, 32, 1])).toBeGreaterThanOrEqual(4.5);
    for (const name of ['bright', 'transparent', 'token', 'variable', 'current']) expect(adjusted(span(editor, name))).toBe('');
  });

  it.each([['TextColor before Highlight', [Auto, Highlight]], ['Highlight before TextColor', [Highlight, Auto]], ['TextColor alone', [Auto]]] as const)(
    'composes with Highlight: %s', async (_name, extensions) => {
    const chosen = [...extensions] as typeof Auto[];
    const editor = mount(doc(run('highlighted', { color: '#000000', backgroundColor: '#ffffff' }), run('plain', { color: '#010101' })), chosen);
    await vi.waitFor(() => { expect(adjusted(span(editor, 'plain'))).not.toBe(''); });
    if (chosen.includes(Highlight)) {
      expect(span(editor, 'highlighted').getAttribute('data-dm-tone')).toBe('light');
      expect(adjusted(span(editor, 'highlighted'))).toBe('');
    }
  });

  it('follows theme and nested surface changes without accumulating color drift', async () => {
    const editor = mount(doc(run('ink', { color: '#102040' })));
    const own = span(editor);
    await vi.waitFor(() => { expect(adjusted(own)).not.toBe(''); });
    const dark = adjusted(own);
    hosts[0]!.style.backgroundColor = '#ffffff';
    await vi.waitFor(() => { expect(adjusted(own)).toBe(''); });
    hosts[0]!.style.backgroundColor = '#202020';
    await vi.waitFor(() => { expect(adjusted(own)).toBe(dark); });
    const sheet = document.createElement('style');
    sheet.textContent = '.readability-nested p { background-color: rgba(255,255,255,.95); }';
    hosts[0]!.append(sheet);
    hosts[0]!.classList.add('readability-nested');
    await vi.waitFor(() => { expect(adjusted(own)).toBe(''); });
    expect(own.style.color).toBe('rgb(16, 32, 64)');
  });

  it.each(['background-image:linear-gradient(black, white)', 'filter:blur(1px)', 'mix-blend-mode:multiply',
    'box-shadow:inset 0 0 0 9999px white'])(
    'leaves uncertain paint unchanged: %s', async style => {
    const editor = mount(doc(run('ink', { color: '#000000' })));
    hosts[0]!.style.cssText += style;
    await settle();
    expect(adjusted(span(editor))).toBe('');
  });

  it('adjusts ink after paragraph opacity and remeasures opacity changes without rewriting content', async () => {
    const editor = mount(doc(run('ink', { color: '#1a1a1a' })));
    const own = span(editor); const paragraph = own.closest('p')!;
    const before = { json: editor.getJSON(), html: editor.getHTML() };
    const sheet = document.createElement('style');
    sheet.textContent = '.readability-opacity p { opacity: .6 } .readability-faint p { opacity: .1 } .readability-hidden p { opacity: 0 }';
    document.head.append(sheet);
    hosts.push(sheet);
    hosts[0]!.classList.add('readability-opacity');
    const paint = textContrastPaint([
      { background: [0, 0, 0, 0], opacity: .6 }, { background: [32, 32, 32, 1], opacity: 1 },
    ])!;
    await vi.waitFor(() => {
      const color = measuredContrastColor(adjusted(own));
      expect(color).not.toBeNull();
      expect(textContrastRatio(paintedTextColor(color!, paint), paint.background)).toBeGreaterThanOrEqual(4.5);
    });
    expect(getComputedStyle(paragraph).opacity).toBe('0.6');
    expect(own.style.color).toBe('rgb(26, 26, 26)');
    hosts[0]!.classList.add('readability-faint');
    await vi.waitFor(() => { expect(adjusted(own)).toBe(''); });
    hosts[0]!.classList.add('readability-hidden');
    await settle();
    expect(adjusted(own)).toBe('');
    hosts[0]!.classList.remove('readability-opacity', 'readability-faint', 'readability-hidden');
    await vi.waitFor(() => { expect(adjusted(own)).not.toBe(''); });
    expect({ json: editor.getJSON(), html: editor.getHTML() }).toEqual(before);
  });

  it('keeps a transparent outer canvas unknown when the editor itself has opacity', async () => {
    const editor = mount(doc(run('ink', { color: '#000000' })));
    hosts[0]!.style.opacity = '0.6';
    await settle();
    expect(adjusted(span(editor))).toBe('');
  });

  it('rechecks after a same-sized editor moves between different ancestor backgrounds', async () => {
    const editor = mount(doc(run('ink', { color: '#000000' })), [Auto, Highlight], 'transparent');
    const host = hosts[0]!;
    const dark = document.createElement('div');
    const light = document.createElement('div');
    dark.style.cssText = 'background-color:#202020;width:300px;height:100px;';
    light.style.cssText = 'background-color:#ffffff;width:300px;height:100px;';
    document.body.append(dark, light);
    hosts.push(dark, light);
    dark.append(host);
    const own = span(editor);
    await vi.waitFor(() => { expect(adjusted(own)).not.toBe(''); });
    light.append(host);
    await vi.waitFor(() => { expect(adjusted(own)).toBe(''); });
    dark.append(host);
    await vi.waitFor(() => { expect(adjusted(own)).not.toBe(''); });
  });

  it('remeasures when an ancestor transition finishes, even without another attribute mutation', async () => {
    const editor = mount(doc(run('ink', { color: '#000000' })), [Auto, Highlight], 'transparent');
    const host = hosts[0]!;
    host.classList.add('readability-transition');
    const sheet = document.createElement('style');
    sheet.textContent = '.readability-transition { background-color: #202020; }';
    document.head.append(sheet);
    hosts.push(sheet);
    host.style.removeProperty('background-color');
    const own = span(editor);
    await vi.waitFor(() => { expect(adjusted(own)).not.toBe(''); });
    sheet.sheet!.insertRule('.readability-transition { background-color: #ffffff; }', 1);
    host.dispatchEvent(new Event('transitionend', { bubbles: true }));
    await vi.waitFor(() => { expect(adjusted(own)).toBe(''); });
  });

  it('keeps JSON, HTML, styled HTML, SSR, clipboard and history independent of the view adjustment', async () => {
    const content = doc(run('linked', { color: '#102040' }, true), run('highlighted', { color: '#ffffff', backgroundColor: '#002060' }));
    const original = mount(content, [TextColor, Highlight]);
    const editor = mount(content);
    const before = { json: editor.getJSON(), html: editor.getHTML(), styled: editor.getHTML({ styled: true }) };
    const update = vi.fn();
    editor.on('update', update);
    await vi.waitFor(() => { expect(adjusted(span(editor, 'linked'))).not.toBe(''); });
    expect(editor.getJSON()).toEqual(before.json);
    expect(editor.getHTML()).toBe(before.html);
    expect(editor.getHTML({ styled: true })).toBe(before.styled);
    expect(editor.getHTML()).toBe(original.getHTML());
    expect(generateHTML(content, [...base, Auto, Highlight])).toBe(generateHTML(content, [...base, TextColor, Highlight]));
    editor.commands.selectAll();
    original.commands.selectAll();
    expect(editor.view.serializeForClipboard(editor.state.selection.content()).dom.innerHTML)
      .toBe(original.view.serializeForClipboard(original.state.selection.content()).dom.innerHTML);
    expect(update).not.toHaveBeenCalled();
    editor.commands.setTextColor('#abcdef');
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getJSON()).toEqual(before.json);
  });

  it('respects a higher-priority host mark view', async () => {
    const custom = Extension.create({ name: 'customTextView', priority: 1000, addProseMirrorPlugins() {
      return [new Plugin({ props: { markViews: { textStyle: () => {
        const dom = document.createElement('span'); dom.className = 'custom-color'; return { dom };
      } } } })];
    } });
    const editor = mount(doc(run('ink', { color: '#000000' })), [custom, Auto, Highlight] as never);
    await settle();
    expect(span(editor).className).toBe('custom-color');
    expect(editor.view.dom.querySelector('[data-dm-text-contrast]')).toBeNull();
  });

  it('stops pending measurements on destroy', async () => {
    const editor = mount(doc(run('ink', { color: '#000000' })));
    const own = span(editor);
    editor.destroy();
    editors.splice(editors.indexOf(editor), 1);
    await settle();
    expect(adjusted(own)).toBe('');
  });
});
