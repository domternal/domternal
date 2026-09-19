/**
 * Elements a browser lays out as blocks that cleanup does not keep, such as definition lists,
 * sections and figures. Unwrapped, their texts ran into each other ("termdefinition"); as plain
 * divisions each stays a block of its own, as it does without PasteCleanup.
 */
import { describe, expect, it } from 'vitest';
import { normalizePasteHTML } from './index.js';

describe('block elements cleanup does not keep', () => {
  it('turns a definition list into divisions, so the term and the definition stay apart', () => {
    const result = normalizePasteHTML('<dl><dt>term</dt><dd>definition</dd></dl>');
    expect(result.html).toBe('<div><div>term</div><div>definition</div></div>');
    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual(['unsupported-formatting', 'unsupported-formatting', 'unsupported-formatting']);
  });

  it('turns sectioning, figure and form elements into divisions', () => {
    for (const tag of ['address', 'article', 'aside', 'center', 'dd', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form',
      'header', 'hgroup', 'legend', 'main', 'nav', 'search', 'section']) {
      expect(normalizePasteHTML(`<${tag}>one</${tag}><${tag}>two</${tag}>`).html, tag).toBe('<div>one</div><div>two</div>');
    }
  });

  it('keeps no attribute of the element, so a division cannot take a meaning the source did not have', () => {
    expect(normalizePasteHTML('<section data-type="details" id="s" style="text-align:center" dir="rtl">x</section>').html).toBe('<div>x</div>');
  });

  it('still unwraps an inline element cleanup does not keep', () => {
    expect(normalizePasteHTML('<p>a <abbr title="b">b</abbr> <kbd>c</kbd></p>').html).toBe('<p>a b c</p>');
  });

  it('counts the divisions toward maxNodes and maxDepth like divisions the HTML wrote', () => {
    const output = (html: string, limits: Record<string, number>): { status: string; html: string } => {
      const result = normalizePasteHTML(html, { limits });
      return { status: result.status, html: result.html };
    };
    for (let limit = 1; limit <= 8; limit++) {
      for (const key of ['maxDepth', 'maxNodes']) {
        expect(output('<section><section>x</section></section>', { [key]: limit }), `${key} ${String(limit)}`)
          .toEqual(output('<div><div>x</div></div>', { [key]: limit }));
      }
    }
  });
});
