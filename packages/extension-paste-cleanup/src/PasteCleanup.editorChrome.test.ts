/**
 * An own copy of a to-do list, or of an aligned image, pastes as it was and shows no notice: the
 * task checkbox and the image's alignment drawing are chrome the editor renders, and they reported
 * formatting that could not be preserved on every such copy.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { BulletList, Document, Editor, ListItem, Paragraph, TaskItem, TaskList, Text } from '@domternal/core';
import { AllSelection } from '@domternal/pm/state';
import { copySelection, pasteClipboard } from '@domternal/tests-clipboard-slices';
import { Image } from '../../extension-image/dist/index.js';
import { PasteCleanup } from './index.js';
import type { NormalizePasteHTMLResult } from './index.js';

const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

function mount(content: string, results: NormalizePasteHTMLResult[] = []): Editor {
  const editor = new Editor({
    element: document.body.appendChild(document.createElement('div')),
    content,
    extensions: [Document, Paragraph, Text, BulletList, ListItem, TaskList, TaskItem, Image,
      PasteCleanup.configure({ onResult: result => { results.push(result); } })],
  });
  editors.push(editor);
  return editor;
}

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC';

describe('PasteCleanup and an own copy of what the editor draws around its content', () => {
  it.each([
    ['a to-do list', '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>done</p></li><li data-type="taskItem" data-checked="false"><p>todo</p></li></ul>'],
    ['a centered image', `<p>x</p><img src="${PNG}" data-align="center"><p>y</p>`],
    ['a right-aligned image', `<p>x</p><img src="${PNG}" data-align="right"><p>y</p>`],
  ])('pastes %s as it was, with no finding and no notice', async (_name, content) => {
    const source = mount(content);
    source.view.dispatch(source.state.tr.setSelection(new AllSelection(source.state.doc)));
    const results: NormalizePasteHTMLResult[] = [];
    const target = mount('<p></p>', results);

    pasteClipboard(target.view, copySelection(source.view));
    await new Promise(resolve => { setTimeout(resolve, 0); });

    expect(target.getJSON()).toEqual(source.getJSON());
    expect(results.map(result => result.diagnostics)).toEqual([[]]);
    expect(document.querySelector('.dm-paste-feedback:not([hidden])')).toBeNull();
  });
});
