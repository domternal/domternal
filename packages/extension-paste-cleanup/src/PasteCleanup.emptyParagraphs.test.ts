import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BulletList, Document, Editor, HardBreak, Heading, History, ListItem, OrderedList, Paragraph, Text } from '@domternal/core';
import { undoDepth } from '@domternal/pm/history';
import { TextSelection } from '@domternal/pm/state';
import { pasteClipboard } from '@domternal/tests-clipboard-slices';
import { Table, TableCell, TableHeader, TableRow } from '../../extension-table/dist/index.js';
import { PasteCleanup } from './PasteCleanup.js';

const editors: Editor[] = [];
afterEach(() => { for (const editor of editors.splice(0)) editor.destroy(); vi.unstubAllGlobals(); });

/** These committed English variants preserve archived clipboard shapes; they are not new native captures. */
function capture(name: string): { html: string; text: string } {
  const bundle = JSON.parse(readFileSync(resolve('../../e2e/native-office-capture/fixtures', name, 'capture.json'), 'utf8')) as {
    payload: { text: Record<string, string> };
  };
  return { html: bundle.payload.text['text/html'] ?? '', text: bundle.payload.text['text/plain'] ?? '' };
}

function mount(formatting: 'preserve' | 'adapt', content = '<p>Replace me</p>'): Editor {
  vi.stubGlobal('ClipboardEvent', Event);
  const editor = new Editor({ content, extensions: [Document, Paragraph, Text, HardBreak, Heading, BulletList, OrderedList, ListItem,
    Table, TableRow, TableHeader, TableCell, History, PasteCleanup.configure({ formatting })] });
  editors.push(editor);
  editor.view.setProps({ handleScrollToSelection: () => true });
  editor.commands.selectAll();
  return editor;
}

function outline(editor: Editor): { type: string; text: string; empty: boolean }[] {
  const blocks: { type: string; text: string; empty: boolean }[] = [];
  editor.state.doc.forEach(node => blocks.push({ type: node.type.name, text: node.textContent, empty: node.content.size === 0 }));
  return blocks;
}

function reversible(editor: Editor, before: ReturnType<Editor['getJSON']>): void {
  editor.state.doc.check();
  const after = editor.getJSON();
  expect(undoDepth(editor.state)).toBe(1);
  expect(editor.commands.undo()).toBe(true);
  expect(editor.getJSON()).toEqual(before);
  expect(editor.commands.redo()).toBe(true);
  expect(editor.getJSON()).toEqual(after);
}

describe('source evidence for empty paragraphs at the end of an external paste', () => {
  for (const formatting of ['preserve', 'adapt'] as const) {
    it(`retains the recorded Docs paragraph after its last table in ${formatting}`, () => {
      const editor = mount(formatting);
      const before = editor.getJSON();
      pasteClipboard(editor.view, capture('gdocs-table-text-chrome'));
      const blocks = outline(editor);
      expect(blocks.map(block => block.type)).toEqual(['heading', 'paragraph', 'table', 'paragraph', 'paragraph', 'table',
        'paragraph', 'paragraph', 'table', 'paragraph', 'paragraph', 'table', 'paragraph']);
      expect(blocks.flatMap((block, index) => block.empty ? [index] : [])).toEqual([1, 4, 7, 10, 12]);
      expect(blocks.at(-2)?.text).toContain('GT20 Second bullet in a cell');
      expect(blocks.at(-1)).toEqual({ type: 'paragraph', text: '', empty: true });
      reversible(editor, before);
    });

    it(`does not turn Word's final plain-text CRLF into an extra paragraph in ${formatting}`, () => {
      const source = capture('word-empty-paragraphs-safari');
      expect(source.text.endsWith('\r\n')).toBe(true);
      const editor = mount(formatting);
      const before = editor.getJSON();
      pasteClipboard(editor.view, source);
      expect(outline(editor)).toEqual([
        { type: 'paragraph', text: 'B14 Paragraph with a first-line indent.', empty: false },
        { type: 'paragraph', text: 'B15 Visible part end.', empty: false },
        { type: 'paragraph', text: '', empty: true },
        { type: 'paragraph', text: '', empty: true },
        { type: 'paragraph', text: 'B16 After two empty paragraphs.', empty: false },
      ]);
      reversible(editor, before);
    });

    for (const source of ['word', 'google-docs'] as const) for (const route of ['native', 'programmatic'] as const) {
      it(`${formatting}: retains explicit final empty paragraphs from ${source} through ${route}`, () => {
        // Authored boundary variants of the retained Word o:p and Docs wrapper shapes, not new captures.
        const html = source === 'word'
          ? '<p class="MsoNormal">Source<o:p></o:p></p><p class="MsoNormal"><o:p>&nbsp;</o:p></p><p class="MsoNormal"><o:p>&nbsp;</o:p></p>'
          : '<b id="docs-internal-guid-58cfb271-6c81-4b63-a5aa-aa7b42e92127" style="font-weight:normal"><p>Source</p><br><br></b><br class="Apple-interchange-newline">';
        const editor = mount(formatting, '<p>BeforeAfter</p>');
        editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 7)));
        const before = editor.getJSON();
        if (route === 'native') pasteClipboard(editor.view, { html, text: 'Source\n\n\n' });
        else editor.view.pasteHTML(html);
        // The first empty paragraph stays empty; the final paragraph receives the existing destination suffix.
        expect(outline(editor)).toEqual([
          { type: 'paragraph', text: 'BeforeSource', empty: false },
          { type: 'paragraph', text: '', empty: true },
          { type: 'paragraph', text: 'After', empty: false },
        ]);
        reversible(editor, before);
      });
    }

    it(`does not guess that an ambiguous foreign terminal break is content in ${formatting}`, () => {
      const editor = mount(formatting);
      pasteClipboard(editor.view, { html: '<p>Source<br></p>', text: 'Source\n' });
      expect(editor.getHTML()).toBe('<p>Source</p>');
      expect(editor.state.doc.firstChild?.childCount).toBe(1);
    });
  }
});
