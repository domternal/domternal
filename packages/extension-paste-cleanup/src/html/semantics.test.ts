import { afterEach, describe, expect, it } from 'vitest';
import { Bold, Document, Editor, Paragraph, Text } from '@domternal/core';
import { normalizePasteHTML } from './index.js';
import type { NormalizePasteHTMLOptions } from './index.js';

let editor: Editor | undefined;
afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

function normalizedDOM(html: string, options: NormalizePasteHTMLOptions = {}): HTMLDivElement {
  const result = normalizePasteHTML(html, options);
  expect(result.status).toBe('cleaned');
  const root = document.createElement('div');
  root.innerHTML = result.html;
  return root;
}

describe('supported HTML semantics', () => {
  it.each([
    { formatting: 'preserve' as const, internal: false, retained: true },
    { formatting: 'adapt' as const, internal: false, retained: false },
    { formatting: 'adapt' as const, internal: true, retained: true },
  ])(
    'handles color metadata in $formatting mode with internal=$internal',
    ({ formatting, internal, retained }) => {
      const marker = internal ? ' data-pm-slice="0 0 []"' : '';
      const result = normalizePasteHTML(
        `<div${marker}><p><span data-text-color="red" data-bg-color="blue">Text</span></p><table><tr><td data-background="#123456">Cell</td></tr></table></div>`,
        { formatting }
      );
      const root = document.createElement('div');
      root.innerHTML = result.html;

      expect(root.querySelector('span')?.getAttribute('data-text-color')).toBe(
        retained ? 'red' : null
      );
      expect(root.querySelector('span')?.getAttribute('data-bg-color')).toBe(
        retained ? 'blue' : null
      );
      expect(root.querySelector('td')?.getAttribute('data-background')).toBe(
        retained ? '#123456' : null
      );
      if (!retained)
        expect(result.diagnostics).toContainEqual(
          expect.objectContaining({ code: 'formatting-adapted', severity: 'info' })
        );
    }
  );

  it.each(['normal', '400'])(
    'keeps explicit font-weight %s unbold in the receiving editor',
    (weight) => {
      const result = normalizePasteHTML(
        `<p><b style="font-weight:${weight}">Plain</b> <b>Bold</b></p>`
      );
      editor = new Editor({ extensions: [Document, Paragraph, Text, Bold], content: result.html });

      expect(editor.getHTML()).toBe('<p>Plain <strong>Bold</strong></p>');
      expect(editor.state.doc.firstChild?.firstChild?.marks).toEqual([]);
    }
  );

  it.each([
    '<details open><summary>Title</summary><div data-details-content><p>Body</p></div></details>',
    '<div data-type="details" open><summary>Title</summary><div data-details-content><p>Body</p></div></div>',
  ])('retains persisted details open state: %s', (html) => {
    const root = normalizedDOM(html);
    expect(root.firstElementChild?.hasAttribute('open')).toBe(true);
    expect(root.querySelector('[data-details-content]')?.textContent).toBe('Body');
  });

  it('does not create open state on closed details or unrelated elements', () => {
    const root = normalizedDOM(
      '<details><summary>Closed</summary><div data-details-content><p>Body</p></div></details><p open>Text</p><div open>Other</div>'
    );
    expect(root.querySelectorAll('[open]')).toHaveLength(0);
  });

  it.each(['left', 'center', 'right'])(
    'retains image %s alignment without introducing float placement',
    (align) => {
      const margins =
        align === 'left'
          ? 'margin-right:auto'
          : align === 'right'
            ? 'margin-left:auto'
            : 'margin-left:auto;margin-right:auto';
      const root = normalizedDOM(
        `<img src="https://example.test/image.png" data-align="${align}" style="display:block;width:fit-content;${margins}">`,
        { allowRemoteImages: true }
      );
      const image = root.querySelector('img');

      expect(image?.getAttribute('data-align')).toBe(align);
      expect(image?.style.float).toBe('');
      expect(image?.style.marginLeft).toBe(align === 'right' ? 'auto' : '');
      expect(image?.style.marginRight).toBe(align === 'left' ? 'auto' : '');
    }
  );

  it('retains explicit float placement when alignment metadata is also present', () => {
    const root = normalizedDOM(
      '<img src="https://example.test/image.png" data-align="center" style="float:right;margin-left:auto;margin-right:auto">',
      { allowRemoteImages: true }
    );
    const image = root.querySelector('img');

    expect(image?.getAttribute('data-align')).toBe('center');
    expect(image?.style.float).toBe('right');
    expect(image?.style.marginLeft).toBe('');
    expect(image?.style.marginRight).toBe('');
  });

  it.each(['left', 'right'])('retains bounded image float %s', (float) => {
    const root = normalizedDOM(
      `<img src="https://example.test/image.png" style="float:${float};margin:0 1em 1em 0">`,
      { allowRemoteImages: true }
    );
    const image = root.querySelector('img');

    expect(image?.style.float).toBe(float);
    expect(image?.hasAttribute('data-align')).toBe(false);
  });

  it('retains centered float semantics through paired auto margins', () => {
    const root = normalizedDOM(
      '<img src="https://example.test/image.png" style="display:block;margin-left:auto;margin-right:auto">',
      { allowRemoteImages: true }
    );
    const image = root.querySelector('img');

    expect(image?.style.marginLeft).toBe('auto');
    expect(image?.style.marginRight).toBe('auto');
    expect(image?.hasAttribute('data-align')).toBe(false);
  });

  it('does not widen placement styles to other tags or arbitrary CSS values', () => {
    const root = normalizedDOM(
      '<p style="float:left;margin-left:auto">Text</p><img src="https://example.test/image.png" data-align="url(https://unsafe.test)" style="float:expression(alert(1));margin-left:-9999px;margin-right:url(https://unsafe.test)">',
      { allowRemoteImages: true }
    );

    expect(root.querySelector('p')?.getAttribute('style')).toBeNull();
    expect(root.querySelector('img')?.getAttribute('style')).toBeNull();
    expect(root.querySelector('img')?.hasAttribute('data-align')).toBe(false);
    expect(root.innerHTML).not.toContain('unsafe.test');
  });

  it.each(['td', 'th'])(
    'maps explicit %s CSS alignment and background to receiving table attributes',
    (tag) => {
      const root = normalizedDOM(
        `<table><tr><${tag} style="text-align:right;vertical-align:bottom;background-color:#123456"><p>Cell</p></${tag}></tr></table>`
      );
      const cell = root.querySelector(tag);

      expect(cell?.getAttribute('data-text-align')).toBe('right');
      expect(cell?.getAttribute('data-vertical-align')).toBe('bottom');
      expect(cell?.getAttribute('data-background')).toBe('#123456');
    }
  );

  it('preserves validated table metadata when redundant CSS disagrees', () => {
    const root = normalizedDOM(
      '<table><tr><td data-text-align="center" data-vertical-align="top" data-background="#abcdef" style="text-align:right;vertical-align:bottom;background-color:#123456">Cell</td></tr></table>'
    );
    const cell = root.querySelector('td');

    expect(cell?.getAttribute('data-text-align')).toBe('center');
    expect(cell?.getAttribute('data-vertical-align')).toBe('top');
    expect(cell?.getAttribute('data-background')).toBe('#abcdef');
  });

  it('adapts external table colors while preserving alignment', () => {
    const root = normalizedDOM(
      '<table><tr><td style="text-align:center;vertical-align:middle;background-color:red">Cell</td></tr></table>',
      { formatting: 'adapt' }
    );
    const cell = root.querySelector('td');

    expect(cell?.getAttribute('data-text-align')).toBe('center');
    expect(cell?.getAttribute('data-vertical-align')).toBe('middle');
    expect(cell?.getAttribute('data-background')).toBeNull();
    expect(cell?.style.backgroundColor).toBe('');
  });

  it('does not map unsupported table CSS or unsafe background data', () => {
    const root = normalizedDOM(
      '<table><tr><td data-background="url(https://unsafe.test)" style="text-align:expression(alert(1));vertical-align:baseline;background-color:url(https://unsafe.test)">Cell</td></tr></table>'
    );
    const cell = root.querySelector('td');

    expect(cell?.hasAttribute('data-text-align')).toBe(false);
    expect(cell?.hasAttribute('data-vertical-align')).toBe(false);
    expect(cell?.hasAttribute('data-background')).toBe(false);
    expect(root.innerHTML).not.toContain('unsafe.test');
  });
});
