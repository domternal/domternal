import { afterEach, describe, expect, it } from 'vitest';
import { Document, Editor, Extension, Paragraph, Text } from '@domternal/core';
import { Plugin } from '@domternal/pm/state';
import { SmartPaste } from '../../../extension-block-controls/dist/index.js';
import { Markdown } from '../../../extension-markdown/dist/index.js';
import { PasteCleanup } from '../PasteCleanup.js';
import { isFirstHTMLTransformer, mayContainImageMarkup } from './preparedHTMLPassthrough.js';

const editors: Editor[] = [];
afterEach(() => { editors.splice(0).forEach(editor => { editor.destroy(); }); });

function mount(extra: Extension[] = [], cleanup = true): Editor {
  const editor = new Editor({
    extensions: [Document, Paragraph, Text, ...(cleanup ? [PasteCleanup] : []), ...extra],
  });
  editors.push(editor);
  return editor;
}

describe('prepared HTML passthrough eligibility', () => {
  it('accepts the ordinary cleanup route and the default SmartPaste and Markdown combination', () => {
    expect(isFirstHTMLTransformer(mount().view)).toBe(true);
    expect(isFirstHTMLTransformer(mount([SmartPaste, Markdown]).view)).toBe(true);
    expect(isFirstHTMLTransformer(mount([], false).view)).toBe(false);
  });

  it.each([true, false])('follows the actual plugin order for an earlier transform: %s', earlier => {
    const transform = Extension.create({
      name: 'hostHTMLTransform', priority: earlier ? 2000 : 1,
      addProseMirrorPlugins: () => [new Plugin({ props: { transformPastedHTML: html => html } })],
    });
    expect(isFirstHTMLTransformer(mount([transform]).view)).toBe(!earlier);
  });

  it('refuses reuse with direct view or direct plugin transforms, including identity transforms', () => {
    const { view } = mount();
    view.setProps({ transformPastedHTML: html => html });
    expect(isFirstHTMLTransformer(view)).toBe(false);
    const { transformPastedHTML: _transform, ...remainingProps } = view.props;
    view.update({ ...remainingProps, plugins: [new Plugin({ props: { transformPastedHTML: html => html } })] });
    expect(isFirstHTMLTransformer(view)).toBe(false);
    view.setProps({ plugins: [new Plugin({ props: { transformPastedText: text => text } })] });
    expect(isFirstHTMLTransformer(view)).toBe(true);
  });

  it.each(['<img src="a">', '<IMG\nsrc="a">', '<image src="a">', '<!-- <img src="a"> -->', '<script>"<image"</script>'])(
    'keeps possible image markup on the existing path: %s', html => {
      expect(mayContainImageMarkup(html)).toBe(true);
    },
  );

  it.each(['<p>Plain text</p>', '<ol start="4"><li>Four</li></ol>', '<p>&lt;img src="a"&gt;</p>'])(
    'admits image-free markup for the fully validated passthrough: %s', html => {
      expect(mayContainImageMarkup(html)).toBe(false);
    },
  );
});
