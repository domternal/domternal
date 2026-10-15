import { afterEach, describe, expect, it, vi } from 'vitest';
import { TextSelection } from '@domternal/pm/state';
import { parseHTML } from 'linkedom';
import { Editor } from '../Editor.js';
import { Document } from '../nodes/Document.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Heading } from '../nodes/Heading.js';
import { Text } from '../nodes/Text.js';
import { BulletList } from '../nodes/BulletList.js';
import { ListItem } from '../nodes/ListItem.js';
import { TextStyle } from '../marks/TextStyle.js';
import { Highlight } from './Highlight.js';
import { TextColor } from './TextColor.js';
import { History } from './History.js';
import { BlockColor } from './BlockColor.js';
import { generateHTML, generateJSON } from '../helpers/ssr.js';
import { htmlBlockBackground, literalBlockBackground } from '../utils/blockColorBackground.js';
import * as tones from '../helpers/surfaceTone.js';

const extensions = [Document, Paragraph, Heading, Text, BulletList, ListItem, History, TextStyle, TextColor, Highlight, BlockColor];
const editors: Editor[] = [];
afterEach(() => { for (const editor of editors.splice(0)) editor.destroy(); vi.restoreAllMocks(); });
function mount(content = '<p>Text</p>'): Editor {
  const editor = new Editor({ extensions, content });
  editors.push(editor);
  return editor;
}

describe('explicit block background values', () => {
  it.each([
    ['#123456', '#123456'], [' #ABC ', '#ABC'], ['#1234', '#1234'], ['#11223344', '#11223344'],
    ['rgb(18, 52, 86)', '#123456'], ['rgba(18, 52, 86, 1)', '#123456'],
    ['rgba(18, 52, 86, 0.5)', 'rgba(18, 52, 86, 0.5)'], ['rgb(18 52 86 / 0)', 'rgb(18 52 86 / 0)'],
  ])('keeps literal %s without changing alpha', (input, expected) => {
    expect(literalBlockBackground(input)).toBe(expected);
  });

  it.each([
    'red', 'gray', 'tomato', 'brand-background', 'transparent', 'currentColor', 'inherit', 'var(--brand)',
    '#12345', '#12x456', 'rgb(1,2)', 'rgb(1,2,3);color:red', 'rgb(var(--channels))', 'rgb(1,2,3)/**/',
    'url(https://example.test/picture)', 'rgb(1,2,3) !important', 'rgb(1,2,3)\n', '#000" onclick="alert(1)',
    null, 42, { toString: () => '#123456' },
  ])('does not reinterpret a palette token or unsafe/nonliteral value %j', input => {
    expect(literalBlockBackground(input)).toBeNull();
  });
});

describe('BlockColor full paragraph backgrounds', () => {
  it.each([
    ['red', '#ff0000'], ['black', '#000000'], ['ReBeccAPurple', '#663399'],
    ['gray', '#808080'], ['transparent', 'rgba(0, 0, 0, 0)'],
  ])('reads the HTML CSS color %s as literal paint, independently of palette tokens', (color, expected) => {
    const html = `<p style="background-color:${color}">Literal</p>`;
    const editor = mount(html);
    expect(editor.state.doc.firstChild?.attrs['bgColor']).toBe(expected);
    expect(editor.getHTML()).not.toContain('data-bg-color');
    expect(mount(editor.getHTML()).getJSON()).toEqual(editor.getJSON());
    const serverDocument = parseHTML('<!DOCTYPE html><html><body></body></html>').document;
    expect(generateJSON(html, extensions, { document: serverDocument })).toEqual(editor.getJSON());
    expect(htmlBlockBackground(color)).toBe(expected);
  });

  it('leaves existing JSON palette tokens unchanged even when they are also CSS color names', () => {
    const editor = new Editor({ extensions, content: { type: 'doc', content: [
      { type: 'paragraph', attrs: { bgColor: 'red' }, content: [{ type: 'text', text: 'Palette' }] },
    ] } });
    editors.push(editor);
    expect(editor.state.doc.firstChild?.attrs['bgColor']).toBe('red');
    expect(editor.view.dom.querySelector('p')?.style.backgroundColor).toBe('');
    expect(editor.getHTML()).toContain('data-bg-color="red"');
  });

  it.each(['currentColor', 'inherit', 'Canvas', 'var(--surface)', 'red;position:fixed', 'a'.repeat(1_000)])(
    'does not resolve context-dependent, invalid or oversized HTML color %s', color => {
      expect(htmlBlockBackground(color)).toBeNull();
    },
  );

  it.each(['p', 'h2'])('roundtrips a full %s fill with the existing bgColor JSON attribute', tag => {
    const editor = mount(`<${tag} style="background-color:#123456">Full width</${tag}>`);
    const node = editor.state.doc.firstChild;
    expect(node?.attrs['bgColor']).toBe('#123456');
    expect(node?.firstChild?.marks).toEqual([]);
    const json = editor.getJSON();
    const html = editor.getHTML();
    expect(html).toContain('background-color:');
    expect(html).not.toContain('data-dm-tone');
    expect(html).not.toContain('data-bg-color');
    const generated = generateHTML(json, extensions);
    expect(generateJSON(generated, extensions)).toEqual(json);
    expect(generated).not.toContain('data-dm-tone');
    expect(mount(html).getJSON()).toEqual(json);
    expect(editor.view.dom.firstElementChild?.getAttribute('data-dm-tone')).toBe('dark');
    expect(editor.getJSON()).toEqual(json);
  });

  it('keeps palette and unknown tokens exactly as stored, with token precedence over a literal style', () => {
    for (const token of ['red', 'gray', 'custom-brand']) {
      const editor = mount(`<p data-bg-color="${token}" style="background-color:#123456">Token</p>`);
      expect(editor.state.doc.firstChild?.attrs['bgColor']).toBe(token);
      expect(editor.getHTML()).toContain(`data-bg-color="${token}"`);
      expect(editor.getHTML()).not.toContain('background-color:');
      expect(editor.view.dom.querySelector('p')?.hasAttribute('data-dm-tone')).toBe(false);
    }
  });

  it('preserves empty paragraphs and nested list paragraph fills without recoloring the list', () => {
    const editor = mount('<p style="background-color:#fff2cc"></p><ul><li><p style="background-color:#002060">Item</p></li></ul>');
    expect(editor.state.doc.child(0).attrs['bgColor']).toBe('#fff2cc');
    expect(editor.state.doc.child(1).attrs['bgColor']).toBeNull();
    expect(editor.state.doc.child(1).firstChild?.firstChild?.attrs['bgColor']).toBe('#002060');
    const paragraphs = editor.view.dom.querySelectorAll('p');
    expect(paragraphs[0]?.getAttribute('data-dm-tone')).toBe('light');
    expect(paragraphs[1]?.getAttribute('data-dm-tone')).toBe('dark');
  });

  it('keeps independent authored text colors and nested highlights inside a shaded paragraph', () => {
    const editor = mount('<p style="background-color:#002060"><span style="color:#ffffff">White</span> <span style="background-color:#fff2cc;color:#123456">Highlight</span></p>');
    expect(editor.state.doc.firstChild?.attrs['bgColor']).toBe('#002060');
    expect(editor.state.doc.firstChild?.firstChild?.marks[0]?.attrs['color']).toBe('#ffffff');
    expect(editor.state.doc.firstChild?.lastChild?.marks[0]?.attrs).toMatchObject({ color: '#123456', backgroundColor: '#fff2cc' });
    expect(editor.view.dom.querySelector('p')?.getAttribute('data-dm-tone')).toBe('dark');
    expect(editor.view.dom.querySelector('span[style*="background-color"]')?.getAttribute('data-dm-tone')).toBe('light');
  });

  it('updates literal tone after attribute steps, token selection and Undo without changing stored color values', () => {
    const editor = mount('<p style="background-color:#002060">Text</p>');
    const before = editor.getJSON();
    editor.view.dispatch(editor.state.tr.setNodeAttribute(0, 'bgColor', '#fff2cc'));
    expect(editor.view.dom.querySelector('p')?.getAttribute('data-dm-tone')).toBe('light');
    expect(editor.state.doc.firstChild?.attrs['bgColor']).toBe('#fff2cc');
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getJSON()).toEqual(before);
    expect(editor.view.dom.querySelector('p')?.getAttribute('data-dm-tone')).toBe('dark');
    expect(editor.commands.setBlockBgColor('red')).toBe(true);
    expect(editor.view.dom.querySelector('p')?.getAttribute('data-bg-color')).toBe('red');
    expect(editor.view.dom.querySelector('p')?.hasAttribute('data-dm-tone')).toBe(false);
    expect(editor.commands.setBlockBgColor('#123456')).toBe(false);
    expect(editor.commands.setBlockBgColor(null)).toBe(true);
    expect(editor.view.dom.querySelector('p')?.style.backgroundColor).toBe('');
  });

  it('preserves alpha and does not guess a tone when a translucent fill depends on its backdrop', () => {
    const editor = mount('<p style="background-color:rgba(0,0,0,0.3)">Translucent</p>');
    expect(editor.state.doc.firstChild?.attrs['bgColor']).toBe('rgba(0, 0, 0, 0.3)');
    expect(editor.view.dom.querySelector('p')?.hasAttribute('data-dm-tone')).toBe(false);
    expect(editor.getHTML()).toContain('rgba(0, 0, 0, 0.3)');
  });

  it('never turns unsafe stored strings into a style or tone', () => {
    const editor = mount();
    editor.view.dispatch(editor.state.tr.setNodeAttribute(0, 'bgColor', '#123456;position:fixed'));
    expect(editor.view.dom.querySelector('p')?.style.backgroundColor).toBe('');
    expect(editor.view.dom.querySelector('p')?.style.position).toBe('');
    expect(editor.view.dom.querySelector('p')?.hasAttribute('data-dm-tone')).toBe(false);
    expect(editor.getHTML()).not.toContain('style=');
  });

  it('updates only affected block tones when typing and never scans them for a selection change', () => {
    const read = vi.spyOn(tones, 'surfaceToneAttributes');
    const editor = mount(Array.from({ length: 300 }, (_, index) => `<p style="background-color:${index % 2 ? '#fff2cc' : '#002060'}">Block</p>`).join(''));
    expect(read.mock.calls.length).toBe(300);
    read.mockClear();
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, editor.state.doc.content.size - 1)));
    expect(read).not.toHaveBeenCalled();
    editor.view.dispatch(editor.state.tr.insertText('!'));
    expect(read.mock.calls.length).toBeLessThanOrEqual(2);
    expect(editor.view.dom.querySelectorAll('[data-dm-tone]')).toHaveLength(300);
    expect(editor.view.dom.lastElementChild?.getAttribute('data-dm-tone')).toBe('light');
  });

  it('keeps tone annotations correct after replacing and joining shaded paragraphs', () => {
    const editor = mount('<p style="background-color:#002060">Dark</p><p style="background-color:#fff2cc">Light</p>');
    editor.view.dispatch(editor.state.tr.delete(5, 7));
    expect(editor.state.doc.childCount).toBe(1);
    expect(editor.state.doc.textContent).toBe('DarkLight');
    expect(editor.view.dom.querySelectorAll('[data-dm-tone]')).toHaveLength(1);
    expect(editor.view.dom.querySelector('p')?.getAttribute('data-dm-tone')).toBe('dark');
    expect(editor.commands.undo()).toBe(true);
    expect(Array.from(editor.view.dom.querySelectorAll('p'), node => node.getAttribute('data-dm-tone'))).toEqual(['dark', 'light']);
  });

  it('removes a tone when a changed node no longer belongs to the configured block types', () => {
    const editor = new Editor({
      extensions: [Document, Paragraph, Heading, Text, BlockColor.configure({ types: ['paragraph'] })],
      content: '<p style="background-color:#002060">Text</p>',
    });
    editors.push(editor);
    expect(editor.view.dom.querySelector('p')?.getAttribute('data-dm-tone')).toBe('dark');
    editor.view.dispatch(editor.state.tr.setNodeMarkup(0, editor.schema.nodes['heading'], { level: 2 }));
    expect(editor.view.dom.querySelector('h2')?.hasAttribute('data-dm-tone')).toBe(false);
    expect(editor.view.dom.querySelectorAll('[data-dm-tone]')).toHaveLength(0);
  });

  it('maps earlier attribute changes through later insertions in the same transaction', () => {
    const editor = mount('<p style="background-color:#002060">First</p><p style="background-color:#002060">Second</p>');
    const transaction = editor.state.tr.setNodeAttribute(7, 'bgColor', '#fff2cc');
    transaction.insert(0, editor.schema.nodes['paragraph']!.create(null, editor.schema.text('Prefix')));
    editor.view.dispatch(transaction);
    expect(Array.from(editor.view.dom.querySelectorAll('p'), node => node.getAttribute('data-dm-tone'))).toEqual([null, 'dark', 'light']);
  });
});
