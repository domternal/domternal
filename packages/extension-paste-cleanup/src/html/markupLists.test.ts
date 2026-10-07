// @vitest-environment node
/**
 * Office list reconstruction runs where the markup declares an Office list, `mso-list:` in a style attribute, a
 * stylesheet rule or a conditional comment, never because a page's text names the property. The pass rebuilds every
 * element it walks, which loses what the parser read of each image: a page whose text named `mso-list:` kept the style
 * of a box that only draws its image and reported it.
 */
import { describe, expect, it, vi } from 'vitest';
import { normalizePasteHTML } from './index.js';
import { normalizeClipboardHTML } from './normalize.js';
import type { NormalizePasteHTMLResult } from './types.js';

const BOX = '<p><span style="display:inline-block;overflow:hidden;width:100px;height:50px">'
  + '<img src="https://example.com/a.png" width="100" height="50" style="width:100px;height:50px"></span></p>';
// The box's span without its style, as cleanup quiets a box that only draws its image.
const QUIET = '<span><img style="width:100px;height:50px" src="https://example.com/a.png" width="100" height="50"></span>';
const clean = (html: string): NormalizePasteHTMLResult => normalizePasteHTML(html, { allowRemoteImages: true });
const MENTION = 'mso-list: l0 level1 lfo1';
const NEUTRAL = 'msx-list: l0 level1 lfo1';

/** Whether cleanup runs Office list reconstruction, which asks the destination's list capabilities first. */
function listPass(html: string): boolean {
  const capabilities = vi.fn(() => ({ orderedLists: true, bulletLists: true, nestedLists: true }));
  normalizeClipboardHTML(html, {}, capabilities);
  return capabilities.mock.calls.length > 0;
}

const PLACES: readonly (readonly [place: string, html: (mention: string) => string])[] = [
  ['a paragraph', mention => `<p>Word writes ${mention} on each item.</p>`],
  ['an attribute-free text run', mention => `Notes: ${mention}`],
  ['a table cell', mention => `<table><tr><td>${mention}</td></tr></table>`],
  ['a code block', mention => `<pre><code>&lt;p style="${mention}"&gt;</code></pre>`],
  ['a title attribute', mention => `<p title="${mention}">x</p>`],
  ['an image alt text', mention => `<p><img src="https://example.com/b.png" alt="${mention}"></p>`],
  ['a link', mention => `<p><a href="https://example.com/?q=${mention.replaceAll(' ', '-')}">x</a></p>`],
  ['a site\'s own class', mention => `<p class="${mention.replaceAll(' ', '-')}">x</p>`],
  ['a comment', mention => `<!--${mention}--><p>x</p>`],
  ['CDATA', mention => `<p>x</p><![CDATA[<p style="${mention}">]]>`],
  ['a script', mention => `<p>x</p><script>"<p style='${mention}'>"</script>`],
  ['a title element', mention => `<title>${mention}</title><p>x</p>`],
  ['a stylesheet comment', mention => `<style>/* ${mention} */ p { margin: 0 }</style><p>x</p>`],
];

describe('Office list reconstruction is read from markup, never from text', () => {
  for (const [place, html] of PLACES) {
    it(`runs no list pass for a page that names mso-list in ${place}, and cleans its image box as without the mention`, () => {
      expect(listPass(html(MENTION))).toBe(false);
      for (const source of ['', '<p class=MsoNormal>Word</p>', '<b id="docs-internal-guid-1"><p>Docs</p></b>']) {
        const mentioned = clean(source + BOX + html(MENTION));
        const neutral = clean(source + BOX + html(NEUTRAL));
        expect(mentioned.html, source).toContain(QUIET);
        expect(mentioned.html.replaceAll(MENTION, NEUTRAL).replaceAll(MENTION.replaceAll(' ', '-'), NEUTRAL.replaceAll(' ', '-')), source).toBe(neutral.html);
        expect(mentioned.diagnostics, source).toEqual(neutral.diagnostics);
      }
    });
  }

  it('runs no list pass for a character reference of the property in text', () => {
    expect(listPass('<p>mso&#45;list: l0 level1 lfo1</p>')).toBe(false);
  });

  it.each([
    ['a list paragraph, as Word writes it', '<p class=MsoListParagraphCxSpFirst style=\'text-indent:-18.0pt;mso-list:l0 level1 lfo1\'>Item</p>'],
    ['a list marker run', '<p><span style="mso-list:Ignore">1.</span>Item</p>'],
    ['a declaration on a later line, as Word wraps a long style', '<p style="margin-left:36.0pt;text-indent:-18.0pt;\r\nmso-list:l0 level1 lfo1">Item</p>'],
    ['a declaration in capitals with spaces, as Safari writes it', '<p style="text-indent: -18pt; MSO-LIST: l0 level1 lfo1;">Item</p>'],
    ['an unquoted declaration', '<p style=mso-list:l0>Item</p>'],
    ['a stylesheet rule, as Word writes its List Bullet style', '<style>p.MsoListBullet\n\t{mso-style-priority:99;\n\tmso-list:l0 level1 lfo1;}</style><p class=MsoListBullet>Item</p>'],
    ['a list paragraph in a conditional comment', '<!--[if gte mso 9]><p style="mso-list:l0 level1 lfo1">Item</p><![endif]--><p>x</p>'],
  ])('runs the list pass where the markup declares a list in %s', (_name, html) => {
    expect(listPass(html)).toBe(true);
  });

  it('still rebuilds a Word list whose text names the property', () => {
    const item = (label: string, text: string): string => `<p class=MsoListParagraph style='margin-left:36.0pt;text-indent:-18.0pt;mso-list:l0 level1 lfo1'>`
      + `<span style='mso-list:Ignore'>${label}<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp; </span></span>${text}<o:p></o:p></p>`;
    expect(clean(item('1.', 'One') + item('2.', `Two names ${MENTION}`)).html).toBe(`<ol style="list-style-type:decimal" start="1"><li><p>One</p></li><li><p>Two names ${MENTION}</p></li></ol>`);
  });
});
