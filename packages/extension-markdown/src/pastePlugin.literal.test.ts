/**
 * Markdown that parses to nothing visible, such as `---` in an editor without a horizontal rule,
 * a fence opener or an empty heading. The paste dispatched an empty slice and took the event, so
 * the pasted text was lost. It now pastes as the text it was.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Bold, CodeBlock, Document, Editor, Heading, HorizontalRule, Paragraph, Text } from '@domternal/core';
import type { AnyExtension } from '@domternal/core';
import { TextSelection } from '@domternal/pm/state';
import { pasteClipboard } from '@domternal/tests-clipboard-slices';
import { Markdown } from './Markdown.js';

const editors: Editor[] = [];
afterEach(() => { for (const editor of editors.splice(0)) editor.destroy(); });

function paste(text: string, extra: AnyExtension[] = []): { doc: string; prevented: boolean } {
  const editor = new Editor({ content: '<p>Title</p>', extensions: [Document, Paragraph, Text, Bold, Markdown, ...extra] });
  editors.push(editor);
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.atEnd(editor.state.doc)));
  const event = pasteClipboard(editor.view, { text });
  return { doc: editor.state.doc.toString(), prevented: event.defaultPrevented };
}

describe('Markdown that parses to nothing visible', () => {
  it('pastes a rule in an editor without a horizontal rule as the text it was', () => {
    for (const text of ['---', '***']) expect(paste(text), text).toEqual({ doc: `doc(paragraph("Title${text}"))`, prevented: true });
  });

  it('pastes a fence opener and an empty heading as the text they were', () => {
    for (const text of ['```js', '# ']) expect(paste(text, [CodeBlock, Heading]).doc, text).toBe(`doc(paragraph("Title${text}"))`);
  });

  it('still converts a rule the editor has a node for', () => {
    expect(paste('---', [HorizontalRule]).doc).toBe('doc(paragraph("Title"), horizontalRule)');
  });
});
