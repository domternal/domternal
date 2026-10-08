import { afterEach, describe, expect, it } from 'vitest';
import { Bold, Document, Editor, FontFamily, FontSize, Heading, Paragraph, Text, TextColor, TextStyle } from '@domternal/core';
import type { JSONContent } from '@domternal/core';
import { TextSelection } from '@domternal/pm/state';
import { PasteCleanup } from './index.js';
import type { PasteCleanupOptions } from './index.js';

const editors: Editor[] = [];
afterEach(() => { for (const editor of editors) editor.destroy(); editors.length = 0; });

function mount(options: PasteCleanupOptions): Editor {
  const editor = new Editor({
    extensions: [Document, Paragraph, Text, Heading, Bold, TextStyle, FontFamily, FontSize, TextColor, PasteCleanup.configure(options)],
    content: '<p></p>',
  });
  editors.push(editor);
  return editor;
}

function paste(editor: Editor, html: string): void {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { items: [], files: [], getData: (type: string) => type === 'text/html' ? html : type === 'text/plain' ? 'Fallback text' : '' },
  });
  editor.view.dom.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
}

/** The text style marks a document stores, as their attributes. */
function textStyles(doc: JSONContent): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  const visit = (node: JSONContent): void => {
    for (const mark of node.marks ?? []) if (mark.type === 'textStyle') found.push(mark.attrs ?? {});
    for (const child of node.content ?? []) visit(child);
  };
  visit(doc);
  return found;
}

// English text variants of the recorded Google Docs run shape
// (e2e/native-office-capture/fixtures/gdocs-bold-italic-underline-chrome), not new native captures.
const RUN = 'font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;'
  + 'font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;';
const html = '<meta charset=\'utf-8\'><meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-aad3651c-7fff-d733-0af8-e9d7b9904961">'
  + `<h2 dir="ltr" style="line-height:1.38;margin-top:18pt;margin-bottom:6pt;"><span style="${RUN.replace('11pt', '16pt')}">GB08 Heading</span></h2>`
  + `<p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;"><span style="${RUN}">GB09 </span>`
  + `<span style="${RUN.replace('font-weight:400', 'font-weight:700')}">bold</span><span style="${RUN}">  two spaces</span></p></b>`
  + '<br class="Apple-interchange-newline">';

describe('white space a source writes on every run, in the editor', () => {
  it.each(['preserve', 'adapt'] as const)('pastes Google Docs runs without an empty text style, every space kept, in %s mode', formatting => {
    const editor = mount({ formatting });
    paste(editor, html);
    const doc = editor.getJSON();
    // Each run was a text style that stored no value: one per run in adapt, and under each styled run in preserve.
    expect(textStyles(doc).filter(attrs => Object.values(attrs).every(value => value === null || value === undefined))).toEqual([]);
    expect(doc.content?.map(block => (block.content ?? []).map(child => child.text ?? '').join(''))).toEqual(['GB08 Heading', 'GB09 bold  two spaces']);
    // Preserve keeps the typography of every run.
    expect(textStyles(doc).length).toBe(formatting === 'preserve' ? 4 : 0);
  });

  it.each(['preserve', 'adapt'] as const)('pastes a selection inside one Google Docs paragraph, its runs outside any block, without an empty text style, in %s mode', formatting => {
    // Docs writes a selection inside one paragraph as its runs alone in the wrapper, as it writes an image copied alone.
    const runs = '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-534ccdc5-7fff-60e7-0535-d5029c756a08">'
      + `<span style="${RUN}">GB09 </span><span style="${RUN.replace('font-weight:400', 'font-weight:700')}">bold</span><span style="${RUN}"> </span>`
      + `<span style="${RUN.replace('font-weight:400', 'font-weight:700')}">also bold</span></b>`;
    const editor = mount({ formatting });
    editor.commands.setContent('<p>Before , and after</p>');
    // Into the middle of a paragraph, after "Before ", as an inline paste lands.
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1 + 'Before '.length)));
    paste(editor, runs);
    const doc = editor.getJSON();
    expect(textStyles(doc).filter(attrs => Object.values(attrs).every(value => value === null || value === undefined))).toEqual([]);
    expect(doc.content?.map(block => (block.content ?? []).map(child => child.text ?? '').join(''))).toEqual(['Before GB09 bold also bold, and after']);
    expect(textStyles(doc).length).toBe(formatting === 'preserve' ? 4 : 0);
  });
});
