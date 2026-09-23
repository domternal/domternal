/**
 * Markdown pasted into a details summary, which holds text only. A heading's text joined the
 * summary as a paragraph's does; anything else, such as a list item, closed the details and
 * opened a new one, which split it and hid its content. Such a line now pastes as the text it
 * was. Several lines go into the details content, in the paste's own transaction, which starts
 * from the placement Details registers. A textblock whose parent takes blocks after it, as a
 * title that starts the document, still takes converted Markdown.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Blockquote, Bold, BulletList, CharacterCount, CodeBlock, Document, Editor, Heading, ListItem, Node, Paragraph, Text } from '@domternal/core';
import type { AnyExtension } from '@domternal/core';
import { TextSelection } from '@domternal/pm/state';
import { pasteClipboard } from '@domternal/tests-clipboard-slices';
import { Details, DetailsContent, DetailsSummary } from '../../extension-details/dist/index.js';
import { Markdown } from './Markdown.js';

const editors: Editor[] = [];
afterEach(() => { for (const editor of editors.splice(0)) editor.destroy(); });

function pasteIntoSummary(text: string, extra: AnyExtension[] = []): string {
  const editor = new Editor({
    element: document.body.appendChild(document.createElement('div')),
    content: '<details><summary>Title</summary><div data-details-content><p>body</p></div></details>',
    extensions: [Document, Paragraph, Text, Blockquote, Bold, CodeBlock, Heading, BulletList, ListItem, Details, DetailsSummary, DetailsContent, Markdown, ...extra],
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

  it('puts a code fence of several lines in the content as a code block', () => {
    for (const text of ['```\nconst a = 1;\n```', '```\nline one\nline two\n```']) {
      expect(pasteIntoSummary(text), text).toMatch(/^doc\(details\(detailsSummary\("Title"\), detailsContent\(codeBlock\(".+"\), paragraph\("body"\)\)\)\)$/);
    }
  });

  it('puts nothing in the content when a transaction filter refuses the paste', () => {
    expect(pasteIntoSummary('# Head\n\n- one', [CharacterCount.configure({ limit: 10 })])).toBe(summary('"Title"'));
  });
});

describe('Markdown pasted into a textblock whose parent takes blocks after it', () => {
  const Title = Node.create({ name: 'title', content: 'inline*', isolating: true, defining: true,
    parseHTML() { return [{ tag: 'h1.title' }]; }, renderHTML() { return ['h1', { class: 'title' }, 0]; } });
  const TitledDocument = Document.extend({ content: 'title block+' });

  it('converts it, and puts its blocks after the title', () => {
    for (const [text, blocks] of [
      ['# Head\n\n- one', 'heading("Head"), bulletList(listItem(paragraph("one")))'],
      ['- item', 'bulletList(listItem(paragraph("item")))'],
    ] as const) {
      const editor = new Editor({ content: '<h1 class="title">T</h1><p>body</p>', extensions: [TitledDocument, Title, Paragraph, Text, Heading, BulletList, ListItem, Markdown] });
      editors.push(editor);
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2)));
      pasteClipboard(editor.view, { text });
      expect(editor.state.doc.toString(), text).toBe(`doc(title("T"), ${blocks}, paragraph("body"))`);
    }
  });
});
