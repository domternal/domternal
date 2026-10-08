import { afterEach, describe, expect, it } from 'vitest';
import { Editor, StarterKit, FontFamily, FontSize, TextStyle } from '@domternal/core';
import type { JSONContent } from '@domternal/core';
import { normalizePasteHTML } from './index.js';

/*
 * Google Docs writes `white-space: pre-wrap` on every run (e2e/native-office-capture/fixtures/gdocs-*-chrome). A span
 * left with that style only is a text style the editor stores without a value. These English text variants keep
 * the recorded shapes and are not new native captures.
 */
const RUN = 'font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;'
  + 'font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;';
const run = (text: string, style = RUN): string => `<span style="${style}">${text}</span>`;
const docs = (content: string): string =>
  `<meta charset='utf-8'><meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-aad3651c-7fff-d733-0af8-e9d7b9904961">${content}</b>`;
const block = (tag: string, runs: string): string => `<${tag} dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;">${runs}</${tag}>`;

const editors: Editor[] = [];
afterEach(() => { for (const editor of editors) editor.destroy(); editors.length = 0; });

/** The document the editor parses from cleaned HTML, as its paste does for an external copy. */
function parsed(html: string): JSONContent {
  const editor = new Editor({ extensions: [StarterKit, TextStyle, FontFamily, FontSize], content: html });
  editors.push(editor);
  return editor.getJSON();
}

/** Each text block's text, and the text style marks that store no value. */
function read(doc: JSONContent): { texts: string[]; emptyStyles: number } {
  const texts: string[] = [];
  let emptyStyles = 0;
  const visit = (node: JSONContent): void => {
    if (node.type === 'paragraph' || node.type === 'heading') texts.push((node.content ?? []).map(child => child.text ?? '').join(''));
    for (const mark of node.marks ?? []) {
      if (mark.type === 'textStyle' && Object.values(mark.attrs ?? {}).every(value => value === null)) emptyStyles++;
    }
    for (const child of node.content ?? []) visit(child);
  };
  visit(doc);
  return { texts, emptyStyles };
}

const spanStyles = (html: string): string[] => [...html.matchAll(/<span style="([^"]*)"/gu)].map(match => match[1] ?? '');

describe('white space a source writes on every run', () => {
  it('moves the white space Google Docs writes on every run to its block, so the editor stores no empty text style', () => {
    const html = docs(block('h2', run('GB08 Level two heading'))
      + block('p', run('GB09 ') + run('bold', RUN.replace('font-weight:400', 'font-weight:700')) + run(' ') + run('two  spaces') + run(' at the end '))
      + '<ul style="margin-top:0;margin-bottom:0;padding-inline-start:48px;"><li dir="ltr" style="list-style-type:disc;font-size:11pt;'
      + `font-family:Arial,sans-serif;color:#000000;vertical-align:baseline;white-space:pre;" aria-level="1">${block('p', run('GL02 First level'))}</li></ul>`);
    for (const formatting of ['preserve', 'adapt'] as const) {
      const result = normalizePasteHTML(html, { formatting });
      expect(result.diagnostics.filter(diagnostic => diagnostic.severity !== 'info')).toEqual([]);
      // No run keeps the white space: a block whose spaces need it holds it, and the heading's one run needs none.
      expect(spanStyles(result.html).filter(style => style.includes('white-space'))).toEqual([]);
      expect(result.html).toMatch(/<h2 dir="ltr">/u);
      expect(result.html.match(/<p dir="ltr" style="white-space:pre-wrap">/gu)).toHaveLength(2);
      // Every space ProseMirror's parse kept stays: the run of two, and the one ending the paragraph goes as it went before.
      const { texts, emptyStyles } = read(parsed(result.html));
      expect(texts).toEqual(['GB08 Level two heading', 'GB09 bold two  spaces at the end', 'GL02 First level']);
      expect(emptyStyles).toBe(0);
    }
    // In preserve each run keeps its typography, now the only style of its span.
    expect(spanStyles(normalizePasteHTML(html).html)).toEqual(Array.from({ length: 7 }, () => 'font-family:Arial,sans-serif;font-size:11pt'));
  });

  it('drops it from a run whose texts read alike without it, and keeps it on one whose spaces need it', () => {
    const cleaned = (html: string): string => normalizePasteHTML(html, { formatting: 'adapt' }).html;
    // Beside text without it, the paragraph cannot take it: a run of one word drops it and is unwrapped.
    expect(cleaned('<p>Ordinary <span style="white-space:pre-wrap">one</span></p>')).toBe('<p>Ordinary one</p>');
    expect(cleaned('<p>Ordinary <span style="white-space:pre-line">one word</span></p>')).toBe('<p>Ordinary one word</p>');
    // A run of spaces, a space at its edge, a tab or a line break needs it, and so does `pre`, which keeps a line from wrapping.
    for (const text of ['two  spaces', ' start', 'end ', 'tab\tinside', 'new\nline']) {
      expect(cleaned(`<p>Ordinary <span style="white-space:pre-wrap">${text}</span></p>`)).toBe(`<p>Ordinary <span style="white-space:pre-wrap">${text}</span></p>`);
    }
    expect(cleaned('<p>Ordinary <span style="white-space:pre">one</span></p>')).toBe('<p>Ordinary <span style="white-space:pre">one</span></p>');
    // A run at the top of the copy, outside any block, drops it the same way.
    expect(cleaned('<span style="white-space:pre-wrap">GB09 bold</span>')).toBe('GB09 bold');
  });

  it('drops it from the runs Docs writes outside any block, as for a selection inside one paragraph, where their text reads alike without it', () => {
    // Docs writes a selection inside one paragraph as its runs alone in the wrapper, as it writes an image copied alone:
    // with no block to hold the white space, each run whose own text has a space at its edge kept it, an empty text style.
    const runs = run('GB09 ') + run('bold', RUN.replace('font-weight:400', 'font-weight:700')) + run(' ') + run('italic', RUN.replace('font-style:normal', 'font-style:italic'))
      + run(' ') + run('all three');
    for (const formatting of ['preserve', 'adapt'] as const) {
      const result = normalizePasteHTML(docs(runs), { formatting });
      expect(result.diagnostics.filter(diagnostic => diagnostic.severity !== 'info')).toEqual([]);
      expect(result.html).not.toContain('white-space');
      // The editor's paste gathers the runs into one paragraph.
      const { texts, emptyStyles } = read(parsed(`<p>${result.html}</p>`));
      expect(texts).toEqual(['GB09 bold italic all three']);
      expect(emptyStyles).toBe(0);
    }
    expect(normalizePasteHTML(docs(runs), { formatting: 'adapt' }).html).toBe('GB09 <strong>bold</strong> <em>italic</em> all three');
    // A run of spaces, or a space at the edge of the copy, reads otherwise without it, so the run that holds it keeps it.
    const kept = (html: string): string[] => spanStyles(normalizePasteHTML(docs(html), { formatting: 'adapt' }).html);
    expect(kept(run('GB09 ') + run(' two'))).toEqual(['white-space:pre-wrap', 'white-space:pre-wrap']);
    expect(kept(run('GB09 ') + run('end '))).toEqual(['white-space:pre-wrap']);
    // A space beside an image, which a destination can place as a block that ends the paragraph, keeps it too.
    expect(kept(run('GB09 ') + run('<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC" alt="">')
      + run('end'))).toEqual(['white-space:pre-wrap']);
    // Runs at the top of the copy after a block, which the editor gathers into a paragraph of their own, the same way.
    expect(normalizePasteHTML(docs(block('h2', run('GB08 Heading')) + run('GB09 ') + run('bold')), { formatting: 'adapt' }).html)
      .toBe('<h2 dir="ltr">GB08 Heading</h2>GB09 bold');
  });

  it('leaves a block whose texts stand under different values, and keeps a span that holds another attribute', () => {
    const cleaned = (html: string): string => normalizePasteHTML(html, { formatting: 'adapt' }).html;
    const mixed = '<p><span style="white-space:pre-wrap">a  b</span><span style="white-space:pre">c  d</span></p>';
    expect(cleaned(mixed)).toBe(mixed);
    expect(cleaned('<p style="white-space:pre">a  b</p>')).toBe('<p style="white-space:pre">a  b</p>');
    expect(cleaned('<p>x <span id="marker" style="white-space:pre-wrap">one</span></p>')).toBe('<p>x <span id="marker">one</span></p>');
    // A run already under the same value keeps no declaration of its own.
    expect(cleaned('<p style="white-space:pre-wrap">a <span style="white-space:pre-wrap">b  c</span></p>')).toBe('<p style="white-space:pre-wrap">a b  c</p>');
  });
});
