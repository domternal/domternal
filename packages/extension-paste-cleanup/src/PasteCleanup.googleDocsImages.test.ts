/**
 * Google Docs images in the editor: Docs places an in line image in a paragraph of its own and aligns it by that
 * paragraph. These English text variants retain the recorded Chrome shapes
 * (e2e/native-office-capture/fixtures/gdocs-*-chrome); they are not new native captures.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Document, Editor, Paragraph, Text, TextAlign } from '@domternal/core';
import type { JSONContent } from '@domternal/core';
import { pasteClipboard } from '@domternal/tests-clipboard-slices';
import { Image } from '../../extension-image/dist/index.js';
import { Table, TableCell, TableHeader, TableRow } from '../../extension-table/dist/index.js';
import { PasteCleanup } from './index.js';
import type { PasteCleanupOptions } from './index.js';

const editors: Editor[] = [];
afterEach(() => { for (const editor of editors.splice(0)) editor.destroy(); });

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC';
const RUN = 'font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;'
  + 'font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;';
const paragraph = (text: string): string => `<p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;"><span style="${RUN}">${text}</span></p>`;
const imageParagraph = (alt: string, align: string, spacing = '1.38'): string =>
  `<p dir="ltr" style="line-height:${spacing};text-align: ${align};margin-top:0pt;margin-bottom:0pt;"><span style="${RUN}">`
  + `<img alt="${alt}" src="${PNG}" width="320" height="200" style="border:none;" /></span></p>`;
const docs = (content: string): string =>
  `<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-a5c727ca-7fff-16a5-f500-346b1a0df84d">${content}</b><br class="Apple-interchange-newline">`;
const cell = (content: string): string => `<td style="vertical-align:top;padding:5pt 5pt 5pt 5pt;">${content}</td>`;

function pasted(html: string, options: Partial<PasteCleanupOptions> = {}, image = Image): JSONContent {
  const editor = new Editor({ content: '<p></p>', extensions: [Document, Paragraph, Text, TextAlign, Table, TableRow, TableCell, TableHeader, image,
    PasteCleanup.configure(options)] });
  editors.push(editor);
  pasteClipboard(editor.view, { html, text: 'fallback' });
  return editor.getJSON();
}

/** An attribute that the outline names: its string, or none. */
const named = (value: unknown): string => (typeof value === 'string' ? value : 'none');

/** Each block as its type, its alignment and its text, an image as its alt text and alignment, through tables. */
function outline(node: JSONContent): string[] {
  if (node.type === 'image') return [`image ${named(node.attrs?.['alt'])} ${named(node.attrs?.['align'])}`];
  if (node.type === 'paragraph') {
    const images = (node.content ?? []).filter(child => child.type === 'image').flatMap(outline);
    const text = (node.content ?? []).map(child => child.text ?? '').join('');
    // TextAlign's default is the start, which it stores as left.
    const align = node.attrs?.['textAlign'] === 'left' ? 'none' : named(node.attrs?.['textAlign']);
    return [`paragraph ${align} ${JSON.stringify(text)}${images.length > 0 ? ` [${images.join(', ')}]` : ''}`];
  }
  return (node.content ?? []).flatMap(outline);
}

describe('Google Docs aligned images in the editor', () => {
  const html = (align: string): string => docs(paragraph('GI02 Text before the picture.') + imageParagraph('GI03 Blue rectangle', align)
    + paragraph('GI04 Text after the picture.') + `<div dir="ltr"><table><tbody><tr>${cell(imageParagraph('GI12 Red picture in a cell', align, '1.2'))}</tr></tbody></table></div>`);

  it.each(['center', 'right'])('pastes an image Docs aligns to the %s as an image aligned there, with no empty paragraph above it', align => {
    // A block image closed the aligned paragraph empty above it, and the image lost its alignment.
    expect(outline(pasted(html(align)))).toEqual(['paragraph none "GI02 Text before the picture."', `image GI03 Blue rectangle ${align}`,
      'paragraph none "GI04 Text after the picture."', `image GI12 Red picture in a cell ${align}`]);
    // An editor whose images are in line places the image in a paragraph of its own, aligned by the image.
    expect(outline(pasted(html(align), {}, Image.configure({ inline: true })))).toEqual(['paragraph none "GI02 Text before the picture."',
      `paragraph none "" [image GI03 Blue rectangle ${align}]`, 'paragraph none "GI04 Text after the picture."', `paragraph none "" [image GI12 Red picture in a cell ${align}]`]);
  });

  it('pastes the alt text of an aligned image the destination refuses in an aligned paragraph, and no alignment in adapt', () => {
    expect(outline(pasted(html('center'), {}, Image.configure({ allowBase64: false })))).toEqual(['paragraph none "GI02 Text before the picture."',
      'paragraph center "GI03 Blue rectangle"', 'paragraph none "GI04 Text after the picture."', 'paragraph center "GI12 Red picture in a cell"']);
    expect(outline(pasted(html('center'), { formatting: 'adapt' }))).toEqual(['paragraph none "GI02 Text before the picture."', 'image GI03 Blue rectangle none',
      'paragraph none "GI04 Text after the picture."', 'image GI12 Red picture in a cell none']);
  });
});
