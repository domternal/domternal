// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { defaultTreeAdapter, parseFragment } from 'parse5';
import { assertTagWork, TagWorkLimitError } from './tagWork.js';

function attributes(count: number): string {
  return Array.from({ length: count }, (_, index) => `a${String(index)}=x`).join(' ');
}

/** Observe public parser adapter calls to independently check fixture premises. */
function maximumParsedAttributes(html: string): number {
  let maximum = 0;
  parseFragment(html, {
    treeAdapter: {
      ...defaultTreeAdapter,
      createElement(tagName, namespaceURI, attrs) {
        maximum = Math.max(maximum, attrs.length);
        return defaultTreeAdapter.createElement(tagName, namespaceURI, attrs);
      },
    },
  });
  return maximum;
}

describe('assertTagWork', () => {
  it('allows ordinary markup and the exact attribute limit', () => {
    expect(() => { assertTagWork('<p title="A > B">Text &lt; not a tag</p>'); }).not.toThrow();
    const html = `<p ${attributes(256)}>Text</p>`;
    expect(maximumParsedAttributes(html)).toBe(256);
    expect(() => { assertTagWork(html); }).not.toThrow();
  });

  it('rejects excess attributes before parser allocation', () => {
    const html = `<p ${attributes(300)}>Text</p>`;
    expect(maximumParsedAttributes(html)).toBe(300);
    expect(() => { assertTagWork(html); }).toThrow(TagWorkLimitError);
  });

  it('counts duplicate attributes as lexical work even though the parser discards them', () => {
    const html = '<p ' + 'same=x '.repeat(257) + '>Text</p>';
    expect(maximumParsedAttributes(html)).toBe(1);
    expect(() => { assertTagWork(html); }).toThrow(TagWorkLimitError);
  });

  it('bounds attribute names without bounding quoted data URL values', () => {
    expect(() => { assertTagWork(`<p ${'a'.repeat(256)}=x>Text</p>`); }).not.toThrow();
    expect(() => { assertTagWork(`<p ${'a'.repeat(257)}=x>Text</p>`); }).toThrow(TagWorkLimitError);
    const html = `<img src="data:image/png;base64,${'A'.repeat(1_500_000)}" alt="A > B">`;
    expect(() => { assertTagWork(html); }).not.toThrow();
  });

  it.each([
    '<p odd"name=x ',
    "<p odd'name=x ",
    '<p first=unquoted" ',
    "<p first=unquoted' ",
    '<p first=&quot; ',
    '<p first=unquoted< ',
    '<p first=unquoted/ ',
    '<p first="greater > than" ',
    "<p first='greater > than' ",
    '<p first="value"',
    '<p first = "value" / ',
    '<p/// ',
    '<p =leading-equals ',
  ])('does not let malformed quoting or slashes hide attributes: %s', prefix => {
    const html = `${prefix}${attributes(300)}>Text</p>`;
    expect(maximumParsedAttributes(html)).toBeGreaterThan(256);
    expect(() => { assertTagWork(html); }).toThrow(TagWorkLimitError);
  });

  it('ignores quotes in names and unquoted values until an actual value delimiter', () => {
    const html = '<p odd"name=plain\'text other=plain"text third = "quoted > text" fourth=last>Text</p>';
    expect(maximumParsedAttributes(html)).toBe(4);
    expect(() => { assertTagWork(html); }).not.toThrow();
  });

  it('also checks end tag attributes, even though tree construction does not use them', () => {
    expect(() => { assertTagWork(`</p ${attributes(300)}>`); }).toThrow(TagWorkLimitError);
  });

  it.each([
    '<script><p pretend="</script>',
    '<style><p pretend="</style>',
    '<textarea><p pretend="</textarea>',
    '<script><!--</script>',
    '<!-->',
    '<!--->',
    '<!-- ordinary --!>',
  ])('finds a real tag after raw text or abrupt comment endings: %s', prefix => {
    const html = `${prefix}<p ${attributes(300)}>Text</p>`;
    expect(maximumParsedAttributes(html)).toBeGreaterThan(256);
    expect(() => { assertTagWork(html); }).toThrow(TagWorkLimitError);
  });

  it('documents conservative rejection of excessive markup inside comments and raw text', () => {
    for (const html of [
      `<!-- <p ${attributes(300)}> -->`,
      `<script>const example = '<p ${attributes(300)}>';</script>`,
    ]) {
      expect(maximumParsedAttributes(html)).toBeLessThanOrEqual(256);
      expect(() => { assertTagWork(html); }).toThrow(TagWorkLimitError);
    }
  });

  it('bounds overlapping candidate scans instead of rescanning input quadratically', () => {
    const html = '<p value="'.repeat(200) + 'x'.repeat(10_000);
    expect(() => { assertTagWork(html); }).toThrow(TagWorkLimitError);
  });

  it('checks generated quote, whitespace and slash fixtures against parse5', () => {
    let seed = 0x12345678;
    const next = (): number => {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
      return seed;
    };
    const spaces = [' ', '\t', '\n', '\r', '\f', '/ '] as const;
    for (let fixture = 0; fixture < 80; fixture++) {
      const count = 257 + next() % 44;
      let html = '<p ';
      for (let index = 0; index < count; index++) {
        const name = `a${String(index)}`;
        const forms = [name, `${name}=x"`, `${name}=x'`, `${name}"=x`, `${name}'=x`,
          `${name}="x > y"`, `${name}='x > y'`, `${name}=x<y`, `${name} = x`] as const;
        html += forms[next() % forms.length] ?? name;
        html += spaces[next() % spaces.length] ?? ' ';
      }
      html += '>Text</p>';
      expect(maximumParsedAttributes(html), `generated fixture ${String(fixture)}`).toBeGreaterThan(256);
      expect(() => { assertTagWork(html); }).toThrow(TagWorkLimitError);
    }
  });
});
