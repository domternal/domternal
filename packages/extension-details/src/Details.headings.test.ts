/**
 * Heading tags in a details summary: the summary holds inline content only, so every heading
 * tag there, a configured level too, parses as the summary's text instead of emptying the
 * summary and moving a heading into the body. A heading in the body stays a heading.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Document, Editor, Heading, Paragraph, Text } from '@domternal/core';
import { TextSelection } from '@domternal/pm/state';
import { Details } from './Details.js';
import { DetailsSummary } from './DetailsSummary.js';
import { DetailsContent } from './DetailsContent.js';

const extensions = [Document, Paragraph, Text, Heading, Details, DetailsSummary, DetailsContent];
const editors: Editor[] = [];
afterEach(() => { editors.splice(0).forEach(editor => { editor.destroy(); }); });

function mount(content: string): Editor {
  const editor = new Editor({ extensions, content });
  editors.push(editor);
  return editor;
}

const summaryAndBody = (editor: Editor): { summary: string; body: unknown[] } => {
  const details = editor.state.doc.firstChild;
  if (details?.type.name !== 'details') throw new Error('No details');
  const body: unknown[] = [];
  details.child(1).forEach(node => { body.push(node.type.name === 'heading' ? `h${String(node.attrs['level'])}:${node.textContent}` : node.textContent); });
  return { summary: details.child(0).textContent, body };
};

describe('heading tags in a details summary', () => {
  it.each([
    ['a configured heading', '<details><summary><h2>Sum</h2></summary><p>body</p></details>', 'Sum'],
    ['a heading the levels lack', '<details><summary><h6>Sum</h6></summary><p>body</p></details>', 'Sum'],
  ])('parses %s as the summary text', (_name, html, summary) => {
    const editor = mount(html);
    expect(summaryAndBody(editor)).toEqual({ summary, body: ['body'] });
    expect(editor.getHTML()).not.toContain('<h');

    const pasted = mount('<p></p>');
    pasted.view.dispatch(pasted.state.tr.setSelection(TextSelection.create(pasted.state.doc, 1)));
    pasted.view.pasteHTML(html, new Event('paste', { cancelable: true }) as ClipboardEvent);
    expect(summaryAndBody(pasted)).toEqual({ summary, body: ['body'] });
  });

  it('ends the summary at a heading after summary text, as any block element there does, since 1.2', () => {
    const heading = mount('<details><summary>Pre <h3>Sum</h3></summary><p>body</p></details>');
    const block = mount('<details><summary>Pre <div>Sum</div></summary><p>body</p></details>');
    expect(heading.getJSON()).toEqual(block.getJSON());
    expect(summaryAndBody(heading).summary).toBe('Pre');
  });

  it('keeps a heading in the details body', () => {
    const editor = mount('<details><summary>Sum</summary><h2>Body</h2></details>');
    expect(summaryAndBody(editor)).toEqual({ summary: 'Sum', body: ['h2:Body'] });
  });
});
