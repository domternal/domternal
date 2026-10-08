import { afterEach, describe, expect, it, vi } from 'vitest';
import { Fragment, Schema, Slice } from '@domternal/pm/model';
import { guardSliceContextHTML, isUnwritableSliceContext, repairSliceContext } from './sliceContext.js';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    heading: { group: 'block', content: 'inline*', attrs: { level: { default: 1 } } },
    blockquote: { group: 'block', content: 'block+' },
    bulletList: { group: 'block', content: 'listItem+' },
    listItem: { content: 'paragraph block*' },
    pair: { group: 'block', content: 'blockquote blockquote' },
    rule: { group: 'block' },
    required: { group: 'block', content: 'block+', attrs: { id: {} } },
    footnote: { group: 'inline', inline: true, content: 'paragraph' },
    text: { group: 'inline' },
    image: { group: 'inline', inline: true },
  },
});
const { nodes } = schema;

function marked(context: string, open = '0 0', element = 'p'): string {
  return `<${element} data-pm-slice="${open} ${context.replace(/"/g, '&quot;')}">Pasted</${element}>`;
}

afterEach(() => { vi.restoreAllMocks(); });

describe('isUnwritableSliceContext', () => {
  it.each([
    ['[]', false], ['["blockquote",null]', false], ['["bulletList",null,"listItem",null]', false],
    ['["pair",null]', false], ['["blockquote",{"x":1},"blockquote",null]', false],
  ])('keeps %s, a context of wrappers ProseMirror can write', (context, expected) => {
    expect(isUnwritableSliceContext(context, schema)).toBe(expected);
  });

  it.each([
    '["paragraph",null]', '["heading",{"level":2}]', '["text",null]', '["image",null]', '["rule",null]',
    '["footnote",null]', '["doc",null]', '["blockquote",null,"paragraph",null]', '["paragraph",null,"blockquote",null]',
    '[["heading"],null]',
  ])('refuses %s, which names a textblock, an inline or leaf node, text or the top node', context => {
    expect(isUnwritableSliceContext(context, schema)).toBe(true);
  });

  it.each(['null', '5', '"heading"', '{}', 'true'])('refuses %s, JSON that is not a list', context => {
    expect(isUnwritableSliceContext(context, schema)).toBe(true);
  });

  it('refuses a context of more wrappers than any document nests, which could overflow the stack while pasting', () => {
    const wrappers = (count: number): string => JSON.stringify(Array.from({ length: count }, () => ['blockquote', null]).flat());
    expect(isUnwritableSliceContext(wrappers(512), schema)).toBe(false);
    expect(isUnwritableSliceContext(wrappers(513), schema)).toBe(true);
    expect(isUnwritableSliceContext(`${wrappers(512).slice(0, -1)},"blockquote"]`, schema)).toBe(false);
    expect(isUnwritableSliceContext(JSON.stringify(Array.from({ length: 5000 }, () => ['unknown', null]).flat()), schema)).toBe(true);
  });

  it.each(['', '[', '["heading"', 'undefined', "['heading']"])('leaves %s, which ProseMirror cannot parse and ignores', context => {
    expect(isUnwritableSliceContext(context, schema)).toBe(false);
  });

  it('judges only the entries ProseMirror applies: from the innermost to an unknown or required type', () => {
    expect(isUnwritableSliceContext('["heading",null,"unknown",null]', schema)).toBe(false);
    expect(isUnwritableSliceContext('["heading",null,"required",null]', schema)).toBe(false);
    expect(isUnwritableSliceContext('["heading",null,"constructor",null]', schema)).toBe(false);
    expect(isUnwritableSliceContext('["heading",null,"__proto__",null]', schema)).toBe(false);
    expect(isUnwritableSliceContext('["unknown",null,"heading",null]', schema)).toBe(true);
    expect(isUnwritableSliceContext('[5,null,"heading",null]', schema)).toBe(true);
    // An odd trailing entry is never applied, as in addContext.
    expect(isUnwritableSliceContext('["blockquote",null,"heading"]', schema)).toBe(false);
    expect(isUnwritableSliceContext('["heading"]', schema)).toBe(false);
  });
});

describe('guardSliceContextHTML', () => {
  it('returns HTML without a marker attribute as given', () => {
    const html = '<p>Plain</p>';
    expect(guardSliceContextHTML(html, schema)).toBe(html);
  });

  it('returns text without any tag that names data-pm-slice as given', () => {
    const text = 'data-pm-slice="0 0 [&quot;heading&quot;,null]"';
    expect(guardSliceContextHTML(text, schema)).toBe(text);
  });

  it('keeps only the line ProseMirror reads when a marker spans lines', () => {
    const html = '<p data-pm-slice="0 0 null\n[]">Pasted</p>';
    expect(guardSliceContextHTML(html, schema)).toBe('<p data-pm-slice="0 0 []">Pasted</p>');
  });

  it('returns HTML that names data-pm-slice only in text as given', () => {
    const html = '<pre><code>&lt;p data-pm-slice="0 0 [&quot;heading&quot;,null]"&gt;</code></pre>';
    expect(guardSliceContextHTML(html, schema)).toBe(html);
  });

  it.each(['[]', '["blockquote",null]', '["bulletList",null,"listItem",null]', '["heading",null,"unknown",null]'])(
    'returns HTML with the context %s, one ProseMirror can write or ignores, unchanged', context => {
      const html = `<meta charset="utf-8">${marked(context, '1 1')}<p>Second</p>`;
      expect(guardSliceContextHTML(html, schema)).toBe(html);
    });

  it.each(['0 0 [heading', '0 0', 'x 0 ["heading",null]', '["heading",null]', '0 0 -x ["heading",null]', ''])(
    'returns a marker ProseMirror does not read, %s, unchanged', value => {
      const html = `<p data-pm-slice="${value.replace(/"/g, '&quot;')}">Pasted</p>`;
      expect(guardSliceContextHTML(html, schema)).toBe(html);
    });

  it.each(['["heading",{"level":2}]', '["text",null]', 'null', '5', '{}', '["doc",null,"paragraph",null]'])(
    'empties the context %s and keeps the open depths', context => {
      expect(guardSliceContextHTML(marked(context, '1 2'), schema)).toBe('<p data-pm-slice="1 2 []">Pasted</p>');
    });

  it('keeps the table wrapper count while emptying the context', () => {
    const html = `<table><tbody><tr><td data-pm-slice="1 1 -2 ${'["heading",null]'.replace(/"/g, '&quot;')}"><p>Cell</p></td></tr></tbody></table>`;
    expect(guardSliceContextHTML(html, schema))
      .toBe('<table><tbody><tr><td data-pm-slice="1 1 -2 []"><p>Cell</p></td></tr></tbody></table>');
  });

  it('keeps a zero wrapper count as written', () => {
    expect(guardSliceContextHTML(marked('["heading",null]', '0 0 -0'), schema)).toBe('<p data-pm-slice="0 0 -0 []">Pasted</p>');
  });

  it('reads a leading table part inside the wrappers ProseMirror adds', () => {
    const html = `${marked('["heading",null]', '1 1', 'td')}<td>Next</td>`;
    expect(guardSliceContextHTML(html, schema)).toBe('<td data-pm-slice="1 1 []">Pasted</td><td>Next</td>');
    const row = `<tr>${marked('["text",null]', '1 1', 'td')}</tr>`;
    expect(guardSliceContextHTML(row, schema)).toBe('<tr><td data-pm-slice="1 1 []">Pasted</td></tr>');
  });

  it('strips leading meta tags as ProseMirror does before looking for the first tag', () => {
    const html = `<meta charset="utf-8"> <meta name="x" content="y">${marked('["heading",null]', '1 1', 'td')}`;
    expect(guardSliceContextHTML(html, schema)).toBe('<meta charset="utf-8"> <meta name="x" content="y"><td data-pm-slice="1 1 []">Pasted</td>');
    // A marker on a leading meta tag is stripped with it, so the next one is the marker ProseMirror reads.
    const meta = `<meta data-pm-slice="0 0 []">${marked('["heading",null]', '1 1')}`;
    expect(guardSliceContextHTML(meta, schema)).toBe('<meta data-pm-slice="0 0 []"><p data-pm-slice="1 1 []">Pasted</p>');
  });

  it('never resolves a wrapper through the object prototype', () => {
    const html = `<constructor>${marked('["heading",null]')}</constructor>`;
    expect(guardSliceContextHTML(html, schema)).toBe('<constructor><p data-pm-slice="0 0 []">Pasted</p></constructor>');
  });

  it('judges the first marker in document order', () => {
    const html = marked('["blockquote",null]') + marked('["heading",null]');
    expect(guardSliceContextHTML(html, schema)).toBe(html);
    expect(guardSliceContextHTML(marked('["heading",null]') + marked('["blockquote",null]'), schema))
      .toBe(`<p data-pm-slice="0 0 []">Pasted</p>${marked('["blockquote",null]')}`);
  });

  it('matches the attribute in any letter case, as HTML attributes are', () => {
    const html = `<p DATA-PM-SLICE="0 0 ${'["heading",null]'.replace(/"/g, '&quot;')}">Pasted</p>`;
    expect(guardSliceContextHTML(html, schema)).toBe('<p data-pm-slice="0 0 []">Pasted</p>');
  });

  it.each([
    ['a pre', '<pre>\n\nx</pre>'],
    ['a textarea', '<textarea>\n\nx</textarea>'],
    ['a listing', '<listing>\n\nx</listing>'],
    // The parser nests these forms, which serializing would write as HTML that reads back to another tree.
    ['nested forms', '<form><div></form><form>'],
  ])('rewrites only the marker in HTML whose serialization would read back differently, such as %s', (_name, before) => {
    for (const context of ['["text",null]', 'null', '["heading",null]']) {
      const html = `${before}${marked(context, '1 1')}`;
      expect(guardSliceContextHTML(html, schema)).toBe(`${before}<p data-pm-slice="1 1 []">Pasted</p>`);
    }
  });

  it('rewrites a marker whose element holds a > in an earlier attribute value', () => {
    expect(guardSliceContextHTML('<pre>\n\nx</pre><a title="a>b" data-pm-slice="0 0 null">Pasted</a>', schema))
      .toBe('<pre>\n\nx</pre><a title="a>b" data-pm-slice="0 0 []">Pasted</a>');
  });

  it('rewrites the marker as written, whatever quotes or spacing it uses', () => {
    const context = '["text",null]'.replace(/"/g, '&quot;');
    expect(guardSliceContextHTML(`<pre>\n\nx</pre><p data-pm-slice = '0 0 ${context}' class=a>Pasted</p>`, schema))
      .toBe('<pre>\n\nx</pre><p data-pm-slice="0 0 []" class=a>Pasted</p>');
    expect(guardSliceContextHTML('<pre>\n\nx</pre><p class="a"data-pm-slice=0>Pasted</p>'.replace('=0', '="0 0 null"'), schema))
      .toBe('<pre>\n\nx</pre><p class="a"data-pm-slice="0 0 []">Pasted</p>');
    expect(guardSliceContextHTML('<p data-pm-slice=5>x</p>'.replace('=5', '="0 0 5"'), schema)).toBe('<p data-pm-slice="0 0 []">x</p>');
  });

  it('skips a mention of the marker in text or a comment and rewrites the attribute itself', () => {
    const context = '["text",null]'.replace(/"/g, '&quot;');
    const html = `<pre>\n\ndata-pm-slice="0 0 []"</pre><!-- <p data-pm-slice="0 0 []"> --><p data-pm-slice="1 1 ${context}">Pasted</p>`;
    expect(guardSliceContextHTML(html, schema))
      .toBe('<pre>\n\ndata-pm-slice="0 0 []"</pre><!-- <p data-pm-slice="0 0 []"> --><p data-pm-slice="1 1 []">Pasted</p>');
  });

  it('rewrites a marker the parser copies onto a reopened formatting element', () => {
    // The adoption agency reopens the <b> inside the <p>, with the same attributes.
    const html = `<b data-pm-slice="0 0 null">One<p>Two</b>Three</p>`;
    expect(guardSliceContextHTML(html, schema)).toBe('<b data-pm-slice="0 0 []">One<p>Two</b>Three</p>');
  });

  it('rewrites the first of repeated marker attributes, the one the parser keeps', () => {
    const html = '<pre>\n\nx</pre><p data-pm-slice="0 0 null" data-pm-slice="0 0 []">Pasted</p>';
    expect(guardSliceContextHTML(html, schema)).toBe('<pre>\n\nx</pre><p data-pm-slice="0 0 []" data-pm-slice="0 0 []">Pasted</p>');
  });

  it('returns the HTML as given when more mentions precede the marker than the guard reads', () => {
    const crowded = `${'<!-- <p data-pm-slice="0 0 []"> -->'.repeat(4)}${'<pre>data-pm-slice=x</pre>'.repeat(4)}<p data-pm-slice="0 0 null">Pasted</p>`;
    expect(guardSliceContextHTML(crowded, schema)).toBe(crowded);
    const within = `${'<!-- <p data-pm-slice="0 0 []"> -->'.repeat(4)}${'<pre>data-pm-slice=x</pre>'.repeat(3)}<p data-pm-slice="0 0 null">Pasted</p>`;
    expect(guardSliceContextHTML(within, schema)).toBe(within.replace('"0 0 null"', '"0 0 []"'));
  });

  it('returns the HTML as given when it cannot be read, as under a Trusted Types policy', () => {
    vi.spyOn(document.implementation, 'createHTMLDocument').mockImplementation(() => {
      throw new TypeError('This document requires TrustedHTML assignment');
    });
    const html = marked('["heading",null]');
    expect(guardSliceContextHTML(html, schema)).toBe(html);
  });
});

describe('repairSliceContext', () => {
  const paragraph = (value: string): ReturnType<typeof nodes.paragraph.create> => nodes.paragraph.create(null, schema.text(value));

  it('returns a closed or flat slice as given', () => {
    const closed = new Slice(Fragment.from(nodes.heading.create(null, paragraph('x'))), 0, 0);
    expect(repairSliceContext(closed)).toBe(closed);
    const flat = new Slice(Fragment.from(paragraph('x')), 1, 1);
    expect(repairSliceContext(flat)).toBe(flat);
    expect(repairSliceContext(Slice.empty)).toBe(Slice.empty);
  });

  it('returns a slice whose wrappers can hold their content as given', () => {
    const quote = new Slice(Fragment.from(nodes.blockquote.create(null, paragraph('x'))), 2, 2);
    expect(repairSliceContext(quote)).toBe(quote);
    // A list item without its first paragraph is fillable: ProseMirror fills it when replacing.
    const item = new Slice(Fragment.from(nodes.bulletList.create(null, nodes.listItem.create(null, [paragraph('x')]))), 3, 3);
    expect(repairSliceContext(item)).toBe(item);
  });

  it('removes a textblock wrapper around a block and lowers both open depths', () => {
    const slice = new Slice(Fragment.from(nodes.heading.create(null, paragraph('x'))), 2, 2);
    const repaired = repairSliceContext(slice);
    expect(repaired.content.firstChild?.type.name).toBe('paragraph');
    expect([repaired.openStart, repaired.openEnd]).toEqual([1, 1]);
  });

  it('removes every wrapper down to the deepest one that cannot hold its content', () => {
    const inner = nodes.pair.create(null, [paragraph('a'), paragraph('b')]);
    const slice = new Slice(Fragment.from(nodes.blockquote.create(null, inner)), 3, 2);
    const repaired = repairSliceContext(slice);
    expect(repaired.content.childCount).toBe(2);
    expect(repaired.content.firstChild?.type.name).toBe('paragraph');
    expect([repaired.openStart, repaired.openEnd]).toEqual([1, 0]);
  });

  it('looks only within the depth open on both sides', () => {
    const slice = new Slice(Fragment.from(nodes.heading.create(null, paragraph('x'))), 2, 0);
    expect(repairSliceContext(slice)).toBe(slice);
  });

  it('stops at a node with more than one child after judging it', () => {
    const list = nodes.bulletList.create(null, [nodes.heading.create(null, paragraph('a')), nodes.listItem.create(null, paragraph('b'))]);
    const slice = new Slice(Fragment.from(list), 3, 3);
    const repaired = repairSliceContext(slice);
    expect(repaired.content.childCount).toBe(2);
    expect([repaired.openStart, repaired.openEnd]).toEqual([2, 2]);
  });
});
