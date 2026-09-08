/**
 * Every context a Domternal copy writes survives PasteCleanup's context check unchanged,
 * and pastes as it does without PasteCleanup. Tables and details are covered in
 * e2e/paste-slice-context.browser.ts, where their extensions are available.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { TextSelection } from '@domternal/pm/state';
import {
  Blockquote, BulletList, Document, Editor, ListItem, OrderedList, Paragraph, TaskItem, TaskList, Text,
} from '@domternal/core';
import type { EditorOptions } from '@domternal/core';
import { PasteCleanup } from './index.js';
import type { NormalizePasteHTMLResult } from './index.js';

const editors: Editor[] = [];
afterEach(() => { for (const editor of editors) editor.destroy(); editors.length = 0; });

function mount(content: string, results?: NormalizePasteHTMLResult[]): Editor {
  const extensions: NonNullable<EditorOptions['extensions']> = [
    Document, Text, Paragraph, Blockquote, BulletList, OrderedList, ListItem, TaskList, TaskItem,
  ];
  if (results !== undefined) extensions.push(PasteCleanup.configure({ onResult: result => { results.push(result); } }));
  const editor = new Editor({ extensions, content });
  editors.push(editor);
  return editor;
}

function paste(editor: Editor, html: string): void {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { items: [], files: [], getData: (type: string) => type === 'text/html' ? html : type === 'text/plain' ? 'Fallback' : '' },
  });
  editor.view.dom.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
}

const marker = (html: string): string | undefined =>
  /data-pm-slice="([^"]*)"/.exec(html)?.[1]?.replaceAll('&quot;', '"').replaceAll('&#x22;', '"');

/** Selects from inside the first text to inside the last text of the named blocks. */
function selectBetween(editor: Editor, first: string, last: string): void {
  let from = -1;
  let to = -1;
  editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.text === first && from < 0) from = pos + 1;
    if (node.isText && node.text === last) to = pos + node.nodeSize - 1;
  });
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)));
}

const STRUCTURES: [string, string, string, string, string][] = [
  // The copied blockquote holds both paragraphs, so it is the slice and records no context.
  ['a blockquote', '<blockquote><p>One</p><p>Two</p></blockquote>', 'One', 'Two', '[]'],
  ['nested blockquotes', '<blockquote><blockquote><p>One</p><p>Two</p></blockquote></blockquote>', 'One', 'Two', '["blockquote",null]'],
  ['three nested blockquotes', '<blockquote><blockquote><blockquote><p>One</p><p>Two</p></blockquote></blockquote></blockquote>', 'One', 'Two', '["blockquote",null,"blockquote",null]'],
  ['a list item', '<ul><li><p>One</p><p>Two</p></li></ul>', 'One', 'Two', '["bulletList",'],
  ['a nested list item', '<ul><li><p>Top</p><ul><li><p>One</p><p>Two</p></li></ul></li></ul>', 'One', 'Two', '["bulletList",'],
  ['an ordered list item', '<ol start="3"><li><p>One</p><p>Two</p></li></ol>', 'One', 'Two', '["orderedList",'],
  ['a task item', '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>One</p><p>Two</p></li></ul>', 'One', 'Two', '["taskList",'],
  ['a list in a blockquote', '<blockquote><ul><li><p>One</p><p>Two</p></li></ul></blockquote>', 'One', 'Two', '["blockquote",null,"bulletList",'],
  ['two list items', '<ul><li><p>One</p></li><li><p>Two</p></li></ul>', 'One', 'Two', '[]'],
];

describe('PasteCleanup keeps every context a Domternal copy writes', () => {
  it.each(STRUCTURES)('keeps the context of %s and pastes as ProseMirror does', (_name, content, first, last, prefix) => {
    const source = mount(content);
    selectBetween(source, first, last);
    const copied = source.view.serializeForClipboard(source.state.selection.content()).dom.innerHTML;
    const context = marker(copied);
    expect(context).toContain(prefix);

    const results: NormalizePasteHTMLResult[] = [];
    const cleaned = mount('<p></p>', results);
    paste(cleaned, copied);
    expect(results).toHaveLength(1);
    expect(marker(results[0]?.html ?? '')).toBe(context);

    const plain = mount('<p></p>');
    paste(plain, copied);
    const withoutIds = (editor: Editor): unknown => JSON.parse(JSON.stringify(editor.getJSON(), (key, value: unknown) => key === 'id' ? undefined : value));
    expect(withoutIds(cleaned)).toEqual(withoutIds(plain));
  });
});
