/**
 * A mention's type says which trigger made it, and so which character it shows: with an `@` and a
 * `#` trigger, a `#feature` tag mention copied in the editor pasted back as `@feature`, because
 * cleanup dropped `data-mention-type` while it kept the mention's id and label.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Document, Editor, Paragraph, Text } from '@domternal/core';
import { TextSelection } from '@domternal/pm/state';
import { copySelection, pasteClipboard } from '@domternal/tests-clipboard-slices';
import { Mention } from '../../extension-mention/dist/index.js';
import { normalizePasteHTML, PasteCleanup } from './index.js';

const editors: Editor[] = [];
afterEach(() => { for (const editor of editors.splice(0)) editor.destroy(); });

const triggers = [{ char: '@', name: 'user', items: () => [] }, { char: '#', name: 'tag', items: () => [] }];
const tag = '<span data-type="mention" data-id="f1" data-label="feature" data-mention-type="tag">#feature</span>';

function mount(content: string, cleanup = true): Editor {
  const editor = new Editor({ content, extensions: [Document, Paragraph, Text, Mention.configure({ triggers }), ...(cleanup ? [PasteCleanup] : [])] });
  editors.push(editor);
  return editor;
}

function mentions(editor: Editor): string[] {
  const found: string[] = [];
  editor.state.doc.descendants(node => {
    if (node.type.name === 'mention') found.push(`${String(node.attrs['type'])} ${String(node.attrs['id'])} ${String(node.attrs['label'])}`);
  });
  return found;
}

describe('PasteCleanup and a mention type', () => {
  it('keeps the type of a mention the editor copied, so a tag mention stays a tag', () => {
    const source = mount(`<p>See ${tag} and <span data-type="mention" data-id="u1" data-label="Ana" data-mention-type="user">@Ana</span></p>`);
    source.view.dispatch(source.state.tr.setSelection(TextSelection.create(source.state.doc, 1, source.state.doc.content.size - 1)));
    const copied = copySelection(source.view);
    expect(copied.text).toBe('See #feature and @Ana');

    const target = mount('<p></p>');
    pasteClipboard(target.view, copied);

    expect(mentions(target)).toEqual(['tag f1 feature', 'user u1 Ana']);
    expect(target.state.doc.textContent).toBe('See #feature and @Ana');
  });

  it('keeps the type of a mention from other HTML, as it keeps its id and label', () => {
    expect(normalizePasteHTML(`<p>${tag}</p>`).html).toBe(`<p>${tag}</p>`);
    const target = mount('<p></p>');
    pasteClipboard(target.view, { html: `<p>${tag}</p>`, text: '#feature' });
    expect(mentions(target)).toEqual(['tag f1 feature']);
  });

  it('pastes the type it pastes without PasteCleanup', () => {
    const cleaned = mount('<p></p>');
    const plain = mount('<p></p>', false);
    for (const editor of [cleaned, plain]) pasteClipboard(editor.view, { html: `<p>${tag}</p>`, text: '#feature' });
    expect(cleaned.getJSON()).toEqual(plain.getJSON());
  });

  it('drops a type longer than the other mention metadata it keeps', () => {
    expect(normalizePasteHTML(`<span data-mention-type="${'t'.repeat(4_097)}">x</span>`).html).toBe('<span>x</span>');
  });
});
