// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Element } from 'hast';
import { normalizePasteHTML } from './normalize.js';
import { quietImageBoxes } from './imageBoxes.js';
import type { NormalizePasteHTMLOptions, PasteDiagnostic } from './types.js';

// The image box below is authored in the shape Google Docs is expected to write around an image: a span
// with no border, inline-block, overflow hidden and the image's size, around an img with zero margins.
// It is not a native capture: the Google Docs captures confirm or correct it.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC';
const REMOTE = 'https://docs-images.example.invalid/synthetic/box';
const box = (inner: string, style = 'border:none;display:inline-block;overflow:hidden;width:320px;height:200px;'): string =>
  `<span style="${style}">${inner}</span>`;
const image = (src = PNG, style = 'margin-left:0px;margin-top:0px;', size = ' width="320" height="200"'): string =>
  `<img src="${src}"${size} alt="Alt" style="${style}" />`;
const google = (content: string): string => '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-00000000-7fff-4000-8000-000000000005">'
  + '<p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;'
  + 'background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;'
  + `white-space:pre-wrap;">${content}</span></p></b>`;
const both = ['preserve', 'adapt'] as const;
const warnings = (diagnostics: readonly PasteDiagnostic[]): string[] =>
  diagnostics.filter(diagnostic => diagnostic.severity !== 'info').map(diagnostic => diagnostic.code);
function clean(html: string, options: NormalizePasteHTMLOptions = {}): { html: string; warnings: string[]; offsets: (number | undefined)[] } {
  const result = normalizePasteHTML(html, options);
  expect(result.status).toBe('cleaned');
  return { html: result.html, warnings: warnings(result.diagnostics),
    offsets: result.diagnostics.filter(diagnostic => diagnostic.severity !== 'info').map(diagnostic => diagnostic.offset) };
}

describe('the box a span draws around exactly one image', () => {
  it.each(both)('drops the authored Google Docs image box around a removed remote image, which reports only its removal, in %s', formatting => {
    const result = clean(google(box(image(REMOTE))), { formatting });
    expect(result.warnings).toEqual(['image-removed']);
    expect(result.html).toBe('<span id="docs-internal-guid-00000000-7fff-4000-8000-000000000005">'
      // 1.38 is Docs' default 1.15 spacing, the document's own, and the paragraph that held only the image is a division.
      + '<div dir="ltr"><span style="white-space:pre-wrap"><span>Alt</span></span></div></span>');
  });

  it.each(both)('keeps a data image inside the authored Google Docs image box quietly in %s', formatting => {
    const result = clean(google(box(image())), { formatting });
    expect(result.warnings).toEqual([]);
    expect(result.html).toContain(`<span style="white-space:pre-wrap"><span><img src="${PNG}" alt="Alt" width="320" height="200"></span></span>`);
  });

  it.each(both)('keeps an allowed remote image inside the authored Google Docs image box quietly in %s', formatting => {
    const result = clean(google(box(image(REMOTE))), { formatting, allowRemoteImages: true });
    expect(result.warnings).toEqual([]);
    expect(result.html).toContain(`<span><img src="${REMOTE}" alt="Alt" width="320" height="200"></span>`);
  });

  it.each(both)('drops a box without a border declaration or an image style, and reports only the image transform, in %s', formatting => {
    expect(clean(box(image(), 'display:inline-block;overflow:hidden;width:320px;height:200px'), { formatting }))
      .toEqual({ html: `<span><img src="${PNG}" alt="Alt" width="320" height="200"></span>`, warnings: [], offsets: [] });
    // An image without a style of its own has no margin that could move it.
    expect(clean(box(`<img src="${PNG}" width="320" height="200" alt="Alt">`), { formatting }))
      .toEqual({ html: `<span><img src="${PNG}" alt="Alt" width="320" height="200"></span>`, warnings: [], offsets: [] });
    // An older rotation Google Docs is recalled to write; the image still reports it, the box no longer does.
    const html = box(image(PNG, 'margin-left:0px;margin-top:0px;transform:rotate(0.00rad) translateZ(0px);-webkit-transform:rotate(0.00rad) translateZ(0px);'));
    const rotated = clean(html, { formatting });
    expect(rotated.warnings).toEqual(['unsupported-formatting']);
    expect(rotated.offsets).toEqual([html.indexOf('<img')]);
  });

  it.each(both)('drops the box around an image with a zero border attribute, zero padding or a size written with a character reference in %s', formatting => {
    for (const html of [box(image(PNG, undefined, ' width="320" height="200" border="0"')), box(image(PNG, 'margin:0;padding:0')),
      box(image(PNG, undefined, ' width="3&#50;0" height="200"'))]) {
      expect(clean(html, { formatting })).toEqual({ html: `<span><img src="${PNG}" alt="Alt" width="320" height="200"></span>`, warnings: [], offsets: [] });
    }
  });

  it('keeps an image box quiet when the image is removed over the image limit', () => {
    const result = clean(box(image()) + box(image()), { limits: { maxImages: 1 } });
    expect(result.warnings).toEqual(['image-removed']);
    expect(result.html).toBe(`<span><img src="${PNG}" alt="Alt" width="320" height="200"></span><span>Alt</span>`);
  });
});

describe('image boxes that still report a crop, an offset or other layout', () => {
  it.each([
    ['a box narrower than its image', box(image(), 'border:none;display:inline-block;overflow:hidden;width:300px;height:200px')],
    ['a box wider than its image', box(image(), 'border:none;display:inline-block;overflow:hidden;width:340px;height:200px')],
    ['a box in other units', box(image(), 'border:none;display:inline-block;overflow:hidden;width:240pt;height:150pt')],
    ['an image moved up inside its box', box(image(PNG, 'margin-left:0px;margin-top:-10px'))],
    ['an image moved by a margin shorthand', box(image(PNG, 'margin:-5px 0 0 0'))],
    ['an image whose CSS size differs from its attributes', box(image(PNG, 'margin-left:0px;margin-top:0px;width:300px'))],
    ['an image without size attributes', box(image(PNG, 'margin-left:0px;margin-top:0px', ''))],
    ['a box with a transform', box(image(), 'border:none;display:inline-block;overflow:hidden;width:320px;height:200px;transform:rotate(0)')],
    ['a box with padding', box(image(), 'border:none;display:inline-block;overflow:hidden;width:320px;height:200px;padding:0')],
    ['a box with a margin', box(image(), 'border:none;display:inline-block;overflow:hidden;width:320px;height:200px;margin:0')],
    ['a positioned box', box(image(), 'border:none;display:inline-block;overflow:hidden;width:320px;height:200px;position:relative')],
    ['a box with a visible border', box(image(), 'border:1px solid black;display:inline-block;overflow:hidden;width:320px;height:200px')],
    ['an inline box', box(image(), 'border:none;display:inline;overflow:hidden;width:320px;height:200px')],
    ['a box that does not clip', box(image(), 'border:none;display:inline-block;overflow:visible;width:320px;height:200px')],
    ['a box without a height', box(image(), 'border:none;display:inline-block;overflow:hidden;width:320px')],
    ['a box around two images', box(image() + image())],
    ['a box with text beside its image', box(`${image()}Caption`)],
    ['a box with white space beside its image', box(` ${image()}`)],
    ['a box with a declaration without a value', box(image(), 'border:none;display:inline-block;overflow:hidden;width:320px;height:200px;clip')],
    // CSS reads each of these styles otherwise than a split on semicolons: an important declaration outranks a later one,
    // a no-break space is part of the name, and a comment hides the semicolons it holds.
    ['an image moved up by an earlier important margin', box(image(PNG, 'margin-top:-40px !important;margin-top:0px'))],
    ['a box whose earlier width is important', box(image(), 'border:none;display:inline-block;overflow:hidden;width:100px !important;width:320px;height:200px')],
    ['a box whose last width follows a no-break space', box(image(), 'border:none;display:inline-block;overflow:hidden;width:100px;height:200px;\u00a0width:320px')],
    ['an image whose margin reset is inside a comment', box(image(PNG, 'margin-top:-40px;mso-a:x/*;margin-top:0px;mso-b:*/'))],
    // Padding and the hspace, vspace and border attributes move the image inside the clip as a margin does.
    ['an image pushed down by its top padding', box(image(PNG, 'margin-left:0px;margin-top:0px;padding-top:40px'))],
    ['an image pushed down by a padding shorthand', box(image(PNG, 'padding:40px 0'))],
    ['an image pushed down by its block padding', box(image(PNG, 'padding-block-start:40px'))],
    ...[' hspace="40"', ' vspace="40"', ' border="10"'].map((attribute): [string, string] =>
      [`an image with${attribute}`, box(image(PNG, undefined, ` width="320" height="200"${attribute}`))]),
    // Browsers read a size attribute up to its first character that is not a digit, where HAST reads these as numbers.
    ['an image width that browsers read as 1', box(image(PNG, undefined, ' width="1e3" height="200"'),
      'border:none;display:inline-block;overflow:hidden;width:1000px;height:200px')],
    ['an image width in hexadecimal', box(image(PNG, undefined, ' width="0x140" height="200"'))],
    ['an image width with a plus sign, which browsers ignore', box(image(PNG, undefined, ' width="+320" height="200"'))],
  ])('reports %s', (_name, html) => {
    for (const formatting of both) {
      const result = clean(html, { formatting });
      expect(result.warnings).toEqual(['unsupported-formatting']);
      expect(result.offsets).toEqual([0]);
    }
  });

  it('keeps the box around an image whose attributes the HTML parser did not read', () => {
    const style = 'border:none;display:inline-block;overflow:hidden;width:320px;height:200px';
    const span: Element = { type: 'element', tagName: 'span', properties: { style },
      children: [{ type: 'element', tagName: 'img', properties: { src: PNG, width: 320, height: 200 }, children: [] }] };
    quietImageBoxes({ type: 'root', children: [span] });
    expect(span.properties.style).toBe(style);
  });

  it('reports both the box and the image when the image moves sideways', () => {
    const html = box(image(PNG, 'margin-left:-10px;margin-top:0px'));
    expect(clean(html)).toMatchObject({ warnings: ['unsupported-formatting', 'unsupported-formatting'], offsets: [0, html.indexOf('<img')] });
  });
});
