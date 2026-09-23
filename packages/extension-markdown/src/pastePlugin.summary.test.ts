/**
 * One line of Markdown pasted into a details summary, which holds text only. A heading's text
 * joined the summary as a paragraph's does; anything else, such as a list item, closed the details
 * and opened a new one, which split it and hid its content. Such a line now pastes as the text it
 * was. Several lines go into the details content, where Details puts the caret first.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Blockquote, Bold, BulletList, Document, Editor, Heading, ListItem, Paragraph, Text } from '@domternal/core';
import { TextSelection } from '@domternal/pm/state';
import { pasteClipboard } from '@domternal/tests-clipboard-slices';
import { Details, DetailsContent, DetailsSummary } from '../../extension-details/dist/index.js';
import { Markdown } from './Markdown.js';

const editors: Editor[] = [];
afterEach(() => { for (const editor of editors.splice(0)) editor.destroy(); });

function pasteIntoSummary(text: string): string {
  const editor = new Editor({
    content: '<details><summary>Title</summary><div data-details-content><p>body</p></div></details>',
    extensions: [Document, Paragraph, Text, Blockquote, Bold, Heading, BulletList, ListItem, Details, DetailsSummary, DetailsContent, Markdown],
  });
  editors.push(editor);
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 7)));
  pasteClipboard(editor.view, { text });
  return editor.state.doc.toString();
}

const summary = (text: string): string => `doc(details(detailsSummary(${text}), detailsContent(paragraph("body"))))`;

describe('Markdown pasted into a details summary', () => {
  it('joins the text of one heading to the summary, as the text of one paragraph', () => {
    expect(pasteIntoSummary('# Head')).toBe(summary('"TitleHead"'));
    expect(pasteIntoSummary('has **bold**')).toBe(summary('"Titlehas ", bold("bold")'));
  });

  it('pastes one line that is not a textblock, such as a list item, as the text it was', () => {
    expect(pasteIntoSummary('- item')).toBe(summary('"Title- item"'));
    expect(pasteIntoSummary('> quoted')).toBe(summary('"Title> quoted"'));
  });

  it('puts several lines in the content, as the blocks Markdown parses', () => {
    expect(pasteIntoSummary('# Head\n\n- one')).toBe(
      'doc(details(detailsSummary("Title"), detailsContent(heading("Head"), bulletList(listItem(paragraph("one"))), paragraph("body"))))');
  });
});
