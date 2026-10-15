import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '../Editor.js';
import { Document } from '../nodes/Document.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Text } from '../nodes/Text.js';
import { TextStyle } from '../marks/TextStyle.js';
import { Highlight } from './Highlight.js';
import { TextColor } from './TextColor.js';
import { History } from './History.js';
import { generateHTML, generateJSON } from '../helpers/ssr.js';

const extensions = [Document, Paragraph, Text, TextStyle, TextColor, Highlight, History];
const editors: Editor[] = [];
afterEach(() => { editors.splice(0).forEach(editor => { editor.destroy(); }); });

describe('translucent text and highlights', () => {
  it.each(['0', '0.25', '0.5', '0.999'])('retains alpha %s through HTML load, save, reload and clipboard serialization', alpha => {
    const color = `rgba(12, 34, 56, ${alpha})`;
    const background = `rgba(210, 180, 150, ${alpha})`;
    const html = `<p><span style="color:${color};background-color:${background}">Painted</span></p>`;
    const editor = new Editor({ extensions, content: html });
    editors.push(editor);
    const mark = editor.state.doc.firstChild?.firstChild?.marks.find(mark => mark.type.name === 'textStyle');
    expect(mark?.attrs['color']).toBe(color);
    expect(mark?.attrs['backgroundColor']).toBe(background);
    const json = editor.getJSON();
    expect(generateJSON(editor.getHTML(), extensions)).toEqual(json);
    expect(generateJSON(generateHTML(json, extensions), extensions)).toEqual(json);
    editor.commands.selectAll();
    const clipboard = editor.view.serializeForClipboard(editor.state.selection.content()).dom;
    expect(generateJSON(clipboard.innerHTML, extensions)).toEqual(json);
    expect(editor.commands.setTextColor('#123456')).toBe(true);
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getJSON()).toEqual(json);
  });
});
