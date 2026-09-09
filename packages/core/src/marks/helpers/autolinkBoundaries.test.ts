import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '../../Editor.js';
import { Document } from '../../nodes/Document.js';
import { Paragraph } from '../../nodes/Paragraph.js';
import { Text } from '../../nodes/Text.js';
import { Bold } from '../Bold.js';
import { Link } from '../Link.js';
import { History } from '../../extensions/History.js';
import { TextSelection } from '@domternal/pm/state';

let editor: Editor;
afterEach(() => { editor.destroy(); });

function mount(content: string): void {
  editor = new Editor({ extensions: [Document, Paragraph, Text, Bold, Link, History], content });
  const end = editor.state.doc.firstChild!.content.size + 1;
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, end)));
}

function type(text: string): void {
  const { from, to } = editor.state.selection;
  const defaultInsert = (): ReturnType<typeof editor.state.tr.insertText> => editor.state.tr.insertText(text, from, to);
  const handled = editor.view.someProp('handleTextInput', handler => handler(editor.view, from, to, text, defaultInsert));
  if (!handled) editor.view.dispatch(defaultInsert());
}

function runs(): { text: string | undefined; marks: string[] }[] {
  const result: { text: string | undefined; marks: string[] }[] = [];
  editor.state.doc.firstChild!.forEach(node => {
    result.push({ text: node.text, marks: node.marks.map(mark => mark.type.name).sort() });
  });
  return result;
}

describe('autolink delimiter boundaries', () => {
  it.each([
    'https://example.com',
    'https://example.co.uk/path?query=value',
    'https://example.com/path?query=value#section',
    'www.example.com',
    'example.com',
  ])('links the whole %s token when typed one character at a time', url => {
    mount('<p></p>');
    for (const character of url) type(character);
    type(' ');
    type('following');
    expect(runs()).toEqual([
      { text: url, marks: ['link'] },
      { text: ' following', marks: [] },
    ]);
    expect(editor.state.doc.firstChild!.firstChild!.marks[0]?.attrs['href'])
      .toBe(url.startsWith('https:') ? url : `https://${url}`);
  });

  it.each([' ', '.', ',', '!', '?', ';', ':'])('leaves %j and following text outside a newly recognized URL', delimiter => {
    mount('<p>https://example.com</p>');
    type(delimiter);
    type('following');
    expect(runs()).toEqual([
      { text: 'https://example.com', marks: ['link'] },
      { text: delimiter + 'following', marks: [] },
    ]);
  });

  it('preserves bold on the delimiter, later text and the URL', () => {
    mount('<p><strong>https://example.com</strong></p>');
    type(' ');
    type('following');
    expect(runs()).toEqual([
      { text: 'https://example.com', marks: ['bold', 'link'] },
      { text: ' following', marks: ['bold'] },
    ]);
  });

  it('keeps an existing URL destination and attributes while leaving it with a space', () => {
    mount('<p><a href="https://destination.test" target="_self">https://example.com</a></p>');
    const mark = editor.state.doc.firstChild!.firstChild!.marks[0];
    type(' ');
    type('following');
    expect(editor.state.doc.firstChild!.firstChild!.marks[0]).toEqual(mark);
    expect(runs()).toEqual([
      { text: 'https://example.com', marks: ['link'] },
      { text: ' following', marks: [] },
    ]);
  });

  it('does not extend a partially linked URL with a manually assigned destination', () => {
    mount('<p><a href="https://destination.test">https://example</a>.com</p>');
    type(' ');
    type('following');
    expect(runs()).toEqual([
      { text: 'https://example', marks: ['link'] },
      { text: '.com following', marks: [] },
    ]);
    expect(editor.state.doc.firstChild!.firstChild!.marks[0]?.attrs['href'])
      .toBe('https://destination.test');
  });

  it('keeps named-link boundary typing and explicit ArrowRight exit unchanged', () => {
    mount('<p><a href="https://example.com">Named link</a></p>');
    type('x');
    expect(runs()).toEqual([{ text: 'Named linkx', marks: ['link'] }]);
    const event = new KeyboardEvent('keydown', { key: 'ArrowRight' });
    editor.view.someProp('handleKeyDown', handler => handler(editor.view, event));
    expect(editor.state.storedMarks).toEqual([]);
    type('after');
    expect(runs()).toEqual([
      { text: 'Named linkx', marks: ['link'] },
      { text: 'after', marks: [] },
    ]);
  });

  it('keeps explicit editing inside an existing link inclusive', () => {
    mount('<p><a href="https://example.com/path">https://example.com/path</a></p>');
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 'https://example.com'.length + 1)));
    type(' ');
    expect(runs()).toEqual([{ text: 'https://example.com /path', marks: ['link'] }]);
  });

  it('replaces selected text after the URL with an unlinked delimiter', () => {
    mount('<p>https://example.com remove</p>');
    const from = 'https://example.com'.length + 1;
    const to = editor.state.doc.firstChild!.content.size + 1;
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)));
    type(' ');
    expect(runs()).toEqual([
      { text: 'https://example.com', marks: ['link'] },
      { text: ' ', marks: [] },
    ]);
    editor.commands.undo();
    expect(editor.state.doc.textContent).toBe('https://example.com remove');
    editor.commands.redo();
    expect(runs()).toEqual([
      { text: 'https://example.com', marks: ['link'] },
      { text: ' ', marks: [] },
    ]);
  });

  it('does not auto-link literal URLs when autolink is disabled', () => {
    editor = new Editor({
      extensions: [Document, Paragraph, Text, Bold, Link.configure({ autolink: false })],
      content: '<p></p>',
    });
    for (const character of 'https://example.com following') type(character);
    expect(runs()).toEqual([{ text: 'https://example.com following', marks: [] }]);
  });
});
