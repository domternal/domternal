// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Element, Root, RootContent } from 'hast';
import { toHtml } from 'hast-util-to-html';
import { parseBoundedHTML, StructureLimitError } from './parse.js';
import { DEFAULT_PASTE_HTML_LIMITS, normalizePasteHTML } from './normalize.js';
import { reconstructOfficeLists } from './officeLists.js';
import type { OfficeListReconstructionOptions } from './officeLists.js';

// Synthetic fixtures encode the documented inline metadata shape, not native clipboard captures.
function item(marker: string, body = 'Body', level = 1, identity = 'l0', lfo = 'lfo1'): string {
  return `<p style="mso-list:${identity} level${String(level)} ${lfo}"><span style="mso-list:Ignore">${marker}<span>&nbsp; </span></span>${body}</p>`;
}

function parse(html: string): Root {
  return parseBoundedHTML(html, DEFAULT_PASTE_HTML_LIMITS);
}

function run(html: string, options: Partial<OfficeListReconstructionOptions> = {}): {
  tree: Root;
  result: ReturnType<typeof reconstructOfficeLists>;
  diagnostics: { code: string; offset: number | undefined }[];
  html: string;
} {
  const tree = parse(html);
  const diagnostics: { code: string; offset: number | undefined }[] = [];
  const result = reconstructOfficeLists(tree, { ...DEFAULT_PASTE_HTML_LIMITS, ...options }, (code, node) => {
    diagnostics.push({ code, offset: node.position?.start.offset });
  });
  return { tree, result, diagnostics, html: toHtml(tree) };
}

function elements(node: Root | Element, tagName: string): Element[] {
  const found: Element[] = [];
  for (const child of node.children) {
    if (child.type !== 'element') continue;
    if (child.tagName === tagName) found.push(child);
    found.push(...elements(child, tagName));
  }
  return found;
}

function visibleText(node: Root | RootContent): string {
  if (node.type === 'text') return node.value;
  return 'children' in node ? node.children.map(visibleText).join('') : '';
}

function shape(node: Root | RootContent): unknown {
  if (node.type === 'text') return node.value;
  if (node.type === 'comment') return { comment: node.value };
  if (node.type === 'doctype') return 'doctype';
  if (node.type === 'root') return node.children.map(shape);
  return [node.tagName, node.properties.start ?? null, node.children.map(shape)];
}

// Authored in the shape Word writes for its default bullets and numbering, not a native capture.
const wordStyle = '<style><!--\n/* List Definitions */\n@list l0\n\t{mso-list-id:1;mso-list-type:hybrid;}\n'
  + '@list l0:level1\n\t{mso-level-number-format:bullet;\n\tmso-level-text:\\F0B7;\n\tmso-level-tab-stop:none;\n\ttext-indent:-.25in;\n\tfont-family:Symbol;}\n'
  + '@list l0:level2\n\t{mso-level-number-format:bullet;\n\tmso-level-text:o;\n\tfont-family:"Courier New";\n\tmso-bidi-font-family:"Times New Roman";}\n'
  + '@list l0:level3\n\t{mso-level-number-format:bullet;\n\tmso-level-text:\\F0A7;\n\tfont-family:Wingdings;}\n'
  + '@list l1:level1\n\t{mso-level-tab-stop:none;\n\tmso-level-number-position:left;}\n'
  + '@list l1:level2\n\t{mso-level-number-format:alpha-lower;}\n'
  + '@list l1:level3\n\t{mso-level-number-format:roman-lower;\n\tmso-level-number-position:right;}\n'
  + '@list l2:level1\n\t{mso-level-number-format:alpha-upper;\n\tmso-level-text:"%1\\)";}\n'
  + '@list l2:level2\n\t{mso-level-number-format:roman-upper;}\n'
  + '@list l2:level1 lfo3\n\t{mso-level-number-format:roman-lower;}\n'
  + '@list l3:level1\n\t{mso-level-number-format:bullet;\n\tmso-level-text:o;\n\tfont-family:"Courier New";}\n'
  + '@list l4:level1\n\t{mso-level-number-format:bullet;\n\tmso-level-text:\\F0A7;\n\tfont-family:Wingdings;}\n'
  + '--></style>';

const spacer = '<span style=\'font:7.0pt "Times New Roman"\'>&nbsp;&nbsp;&nbsp; </span>';
/** One Word list paragraph. The marker run font sits on the wrapper around the Ignore span, as Word writes it. */
function wordItem(marker: string, body: string, level = 1, list = 'l0', font?: string, lfo = 'lfo1'): string {
  const run = font === undefined ? 'mso-bidi-font-family:Calibri' : `font-family:${font};mso-fareast-font-family:${font}`;
  const label = level === 3 && list === 'l1' ? spacer + marker + spacer : marker + spacer;
  return `<p class=MsoListParagraphCxSpMiddle style="margin-left:${String(level / 2)}in;text-indent:-.25in;mso-list:${list} level${String(level)} ${lfo}">`
    + `<![if !supportLists]><span style='${run}'><span style="mso-list:Ignore">${label}</span></span><![endif]>${body}<o:p></o:p></p>`;
}
const symbol = 'Symbol';
const courier = '"Courier New"';
const wingdings = 'Wingdings';

/** A compact outline: lists with their marker class and start, items as their paragraph text and nested lists. */
function outline(node: Root | Element): string[] {
  const lines: string[] = [];
  for (const child of node.children) {
    if (child.type !== 'element' || child.tagName === 'style') continue;
    if (child.tagName === 'ol' || child.tagName === 'ul') {
      const marker = typeof child.properties.style === 'string' ? child.properties.style.replace('list-style-type:', '') : '';
      const start = child.properties.start === undefined ? '' : `@${String(child.properties.start)}`;
      const items = child.children.map(item => item.type === 'element' ? outline(item).join(' ') : '');
      lines.push(`${child.tagName}(${marker}${start})[${items.join(' | ')}]`);
    } else if (child.tagName === 'p') lines.push(visibleText(child).replace(/[\s\u00a0]+/gu, ' ').trim());
    else lines.push(...outline(child));
  }
  return lines;
}

describe('Word list profiles from level definitions and marker run fonts', () => {
  it('reconstructs Word default bullets from Symbol, Courier New and Wingdings definitions and run fonts', () => {
    const output = run(wordStyle + wordItem('·', 'One', 1, 'l0', symbol) + wordItem('o', 'Two', 2, 'l0', courier)
      + wordItem('§', 'Three', 3, 'l0', wingdings) + wordItem('·', 'Four', 1, 'l0', symbol));
    expect(outline(output.tree)).toEqual(['ul(disc)[One ul(circle)[Two ul(square)[Three]] | Four]']);
    expect(output.diagnostics).toEqual([]);
    // The stylesheet stays for normalization to remove; the reconstructed content keeps no marker or list metadata.
    expect(output.html.slice(output.html.indexOf('</style>'))).not.toMatch(/mso-list|>o<|§|·/u);
  });

  it('reconstructs Word default numbering with alphabetic and right aligned Roman levels', () => {
    const output = run(wordStyle + wordItem('1.', 'One', 1, 'l1') + wordItem('a.', 'Two', 2, 'l1') + wordItem('b.', 'Three', 2, 'l1')
      + wordItem('i.', 'Deep', 3, 'l1') + wordItem('ii.', 'Deeper', 3, 'l1') + wordItem('2.', 'Four', 1, 'l1'));
    expect(outline(output.tree)).toEqual([
      'ol(decimal@1)[One ol(lower-alpha@1)[Two | Three ol(lower-roman@1)[Deep | Deeper]] | Four]',
    ]);
    expect(output.diagnostics).toEqual([]);
  });

  it('reads an alphabetic i as the ninth letter and keeps observed starts and continuations', () => {
    const output = run(wordStyle + wordItem('9.', 'Parent', 1, 'l1') + wordItem('i.', 'Ninth', 2, 'l1') + wordItem('j.', 'Tenth', 2, 'l1')
      + wordItem('m.', 'Gap', 2, 'l1'));
    expect(outline(output.tree)).toEqual(['ol(decimal@9)[Parent ol(lower-alpha@9)[Ninth | Tenth] ol(lower-alpha@13)[Gap]]']);
  });

  it('reads upper case profiles, parenthesized level text and instance overrides', () => {
    const output = run(wordStyle + wordItem('C)', 'Third', 1, 'l2') + wordItem('IV.', 'Fourth', 2, 'l2')
      + '<p>Between</p>' + wordItem('iii)', 'Override', 1, 'l2', undefined, 'lfo3'));
    expect(outline(output.tree)).toEqual(['ol(upper-alpha@3)[Third ol(upper-roman@4)[Fourth]]', 'Between', 'ol(lower-roman@3)[Override]']);
  });

  it.each([
    ['a Courier New definition with an Arial run', wordItem('o', 'Body', 1, 'l3', 'Arial')],
    ['a Symbol definition without a run font', wordItem('·', 'Body', 1, 'l0')],
    ['a Wingdings definition with a Symbol run', wordItem('§', 'Body', 1, 'l4', symbol)],
    ['a bullet glyph that differs from its definition', wordItem('o', 'Body', 1, 'l0', symbol)],
    ['a decimal marker under an alphabetic definition', wordItem('1)', 'Body', 1, 'l2')],
    ['punctuation that differs from its definition', wordItem('A.', 'Body', 1, 'l2')],
    ['a repeated letter past Z', wordItem('AA)', 'Body', 1, 'l2')],
    ['a noncanonical Roman numeral', wordItem('iiii)', 'Body', 1, 'l2', undefined, 'lfo3')],
    ['a lower case marker under an upper case definition', wordItem('c)', 'Body', 1, 'l2')],
    ['a marker font hidden behind a shorthand', wordItem('·', 'Body', 1, 'l0', symbol).replace('mso-list:Ignore', 'font:10pt Arial;mso-list:Ignore')],
  ])('keeps a literal marker for %s', (_name, paragraph) => {
    const input = wordStyle + paragraph;
    const output = run(input);
    expect(output.html).toBe(toHtml(parse(input)));
    expect(output.diagnostics).toHaveLength(1);
  });

  it.each([
    ['legal numbering', '{mso-level-legal-format:yes}', '1.'],
    ['multilevel level text', '{mso-level-text:"%1\\.%2\\."}', '1.1.'],
    ['a parenthesized level text', '{mso-level-text:"\\(%1\\)"}', '(1)'],
    ['a leading zero format', '{mso-level-number-format:arabic-leading-zero}', '01.'],
    ['an unusable definition for an otherwise supported decimal', '{mso-level-number-format:bullet;mso-level-number-format:decimal}', '1.'],
    ['a dash bullet', '{mso-level-number-format:bullet;mso-level-text:-;font-family:Calibri}', '-'],
    ['an arrow bullet', '{mso-level-number-format:bullet;mso-level-text:\\F0D8;font-family:Wingdings}', ''],
    ['a bullet without level text', '{mso-level-number-format:bullet;font-family:Symbol}', '·'],
  ])('keeps a literal marker for %s', (_name, body, marker) => {
    const input = `<style>@list l5:level1 ${body}</style>` + wordItem(marker, 'Body', 1, 'l5', wingdings);
    const output = run(input);
    expect(output.html).toBe(toHtml(parse(input)));
    expect(output.diagnostics).toHaveLength(1);
  });

  it('reads the nearest marker run font, including one on the Ignore span itself', () => {
    const inner = wordItem('o', 'Inner', 1, 'l3').replace('style="mso-list:Ignore"', 'style=\'font-family:"Courier New";mso-list:Ignore\'');
    expect(outline(run(wordStyle + inner).tree)).toEqual(['ul(circle)[Inner]']);
    const paragraphFont = wordItem('o', 'Paragraph', 1, 'l3').replace('style="margin-left', 'style="font-family:\'Courier New\';margin-left');
    expect(outline(run(wordStyle + paragraphFont).tree)).toEqual(['ul(circle)[Paragraph]']);
    const overridden = wordItem('o', 'Overridden', 1, 'l3', 'Arial').replace('style="margin-left', 'style="font-family:\'Courier New\';margin-left');
    expect(run(wordStyle + overridden).result.reconstructedItems).toBe(0);
  });

  it('keeps the glyph-only path for levels without a definition and never infers Word profiles from glyphs', () => {
    const output = run(wordStyle + wordItem('3.', 'Legacy decimal', 1, 'l7') + wordItem('•', 'Legacy bullet', 1, 'l8'));
    expect(outline(output.tree)).toEqual(['ol(decimal@3)[Legacy decimal]', 'ul(disc)[Legacy bullet]']);
    for (const [marker, font] of [['o', courier], ['§', wingdings], ['a.', undefined], ['i.', undefined]] as const) {
      const input = wordItem(marker, 'Body', 1, 'l9', font);
      expect(run(input).html).toBe(toHtml(parse(input)));
      expect(run(wordStyle + input).html).toBe(toHtml(parse(wordStyle + input)));
    }
  });

  it('reads definitions only from root level style elements', () => {
    const item = wordItem('o', 'Body', 1, 'l3', courier);
    expect(run(`<div>${wordStyle}</div>` + item).result.reconstructedItems).toBe(0);
    expect(outline(run(wordStyle + item).tree)).toEqual(['ul(circle)[Body]']);
  });

  it('requires the destination to preserve each reconstructed marker class', () => {
    const input = wordStyle + wordItem('·', 'One', 1, 'l0', symbol) + wordItem('o', 'Two', 2, 'l0', courier);
    const output = run(input, { markers: new Set(['disc', 'square']) });
    expect(output.result.reconstructedItems).toBe(0);
    expect(output.diagnostics).toHaveLength(1);
    expect(outline(run(input, { markers: new Set(['disc', 'circle']) }).tree)).toEqual(['ul(disc)[One ul(circle)[Two]]']);
  });

  it.each(['preserve', 'adapt'] as const)('normalizes a Word default list paste in %s without a warning', formatting => {
    const html = '<html xmlns:o="urn:schemas-microsoft-com:office:office"><head><meta charset="utf-8"><meta name=ProgId content=Word.Document>'
      + `${wordStyle}</head><body lang=EN-US style='tab-interval:.5in'><!--StartFragment-->`
      + wordItem('·', 'One', 1, 'l0', symbol) + wordItem('o', 'Two', 2, 'l0', courier) + wordItem('§', 'Three', 3, 'l0', wingdings)
      + wordItem('1.', 'Four', 1, 'l1') + wordItem('a.', 'Five', 2, 'l1') + wordItem('i.', 'Six', 3, 'l1')
      + '<!--EndFragment--></body></html>';
    const output = normalizePasteHTML(html, { formatting });
    expect(output.status).toBe('cleaned');
    expect(output.diagnostics.filter(entry => entry.severity !== 'info')).toEqual([]);
    expect(outline(parse(output.html))).toEqual([
      'ul(disc)[One ul(circle)[Two ul(square)[Three]]]',
      'ol(decimal@1)[Four ol(lower-alpha@1)[Five ol(lower-roman@1)[Six]]]',
    ]);
    expect(output.html).not.toMatch(/mso-|<style|§/u);
  });
});

describe('strict Office list reconstruction', () => {
  it('reconstructs a decimal run and keeps the observed non-one start', () => {
    const output = run(item('7.', 'Seven') + item('8)', 'Eight'));
    expect(shape(output.tree)).toEqual([
      ['ol', 7, [
        ['li', null, [['p', null, ['Seven']]]],
        ['li', null, [['p', null, ['Eight']]]],
      ]],
    ]);
    expect(output.result).toEqual({ reconstructedRuns: 1, reconstructedLists: 1, reconstructedItems: 2, skippedRuns: 0 });
    expect(output.diagnostics).toEqual([]);
  });

  it.each(['•', '·', '◦', '▪', '●'])('reconstructs the explicit Unicode bullet %s', (marker) => {
    const output = run(item(marker, 'First') + item(marker, 'Second'));
    expect(elements(output.tree, 'ul')).toHaveLength(1);
    expect(elements(output.tree, 'li')).toHaveLength(2);
    expect(visibleText(output.tree)).toBe('FirstSecond');
  });

  it.each([
    { marker: '•', style: 'disc' }, { marker: '·', style: 'disc' }, { marker: '●', style: 'disc' },
    { marker: '◦', style: 'circle' }, { marker: '▪', style: 'square' },
  ])('retains the admitted bullet class $marker as explicit $style', ({ marker, style }) => {
    const output = run(item(marker, 'Body'));
    expect(elements(output.tree, 'ul')[0]?.properties.style).toBe(`list-style-type:${style}`);
    expect(visibleText(output.tree)).toBe('Body');
  });

  it('keeps decimal markers explicit at every reconstructed depth', () => {
    const output = run(item('7.', 'Outer') + item('2.', 'Inner', 2) + item('1.', 'Deep', 3));
    expect(elements(output.tree, 'ol').map(node => ({ start: node.properties.start, style: node.properties.style }))).toEqual([
      { start: 7, style: 'list-style-type:decimal' }, { start: 2, style: 'list-style-type:decimal' },
      { start: 1, style: 'list-style-type:decimal' },
    ]);
  });

  it('splits a shared Office identity whenever its admitted bullet class changes', () => {
    const output = run(item('•', 'A') + item('·', 'B') + item('●', 'C') + item('◦', 'D') + item('▪', 'E') + item('•', 'F'));
    expect(elements(output.tree, 'ul').map(node => ({ style: node.properties.style, text: visibleText(node) }))).toEqual([
      { style: 'list-style-type:disc', text: 'ABC' }, { style: 'list-style-type:circle', text: 'D' },
      { style: 'list-style-type:square', text: 'E' }, { style: 'list-style-type:disc', text: 'F' },
    ]);
    expect(output.result).toEqual({ reconstructedRuns: 1, reconstructedLists: 4, reconstructedItems: 6, skippedRuns: 0 });
  });

  it('keeps changed nested bullet classes under their actual current parent', () => {
    const output = run(item('1.', 'ParentA') + item('•', 'A', 2) + item('◦', 'B', 2) + item('2.', 'ParentB') + item('▪', 'C', 2));
    const outer = elements(output.tree, 'ol')[0]!;
    const first = outer.children[0];
    const second = outer.children[1];
    expect(first?.type).toBe('element');
    expect(second?.type).toBe('element');
    if (first?.type !== 'element' || second?.type !== 'element') throw new Error('Missing authored parents');
    expect(elements(first, 'ul').map(node => [node.properties.style, visibleText(node)])).toEqual([
      ['list-style-type:disc', 'A'], ['list-style-type:circle', 'B'],
    ]);
    expect(elements(second, 'ul').map(node => [node.properties.style, visibleText(node)])).toEqual([
      ['list-style-type:square', 'C'],
    ]);
  });

  it.each(['preserve', 'adapt'] as const)('preserves explicit reconstructed list markers through %s normalization and a second pass', formatting => {
    const output = normalizePasteHTML(item('7.', 'A') + item('2.', 'B', 2) + item('▪', 'C', 3), { formatting });
    expect(output.status).toBe('cleaned');
    const parsed = parse(output.html);
    expect(elements(parsed, 'ol').map(node => node.properties.style)).toEqual(['list-style-type:decimal', 'list-style-type:decimal']);
    expect(elements(parsed, 'ul')[0]?.properties.style).toBe('list-style-type:square');
    expect(normalizePasteHTML(output.html, { formatting }).html).toBe(output.html);
  });

  it('rebuilds mixed nesting and resets nested parents after a new root item', () => {
    const output = run(item('1.', 'A') + item('•', 'B', 2) + item('2.', 'C') + item('7.', 'D', 2));
    expect(shape(output.tree)).toEqual([
      ['ol', 1, [
        ['li', null, [
          ['p', null, ['A']],
          ['ul', null, [['li', null, [['p', null, ['B']]]]]],
        ]],
        ['li', null, [
          ['p', null, ['C']],
          ['ol', 7, [['li', null, [['p', null, ['D']]]]]],
        ]],
      ]],
    ]);
  });

  it('emits separate lists for restarts, gaps, new instances, and list kinds', () => {
    const output = run(
      item('7.', 'A') + item('8.', 'B') + item('2.', 'C') + item('4.', 'D')
      + item('5.', 'E', 1, 'l0', 'lfo2') + item('•', 'F')
      + item('6.', 'G', 1, 'l1', 'lfo2'),
    );
    expect(output.tree.children.map(node => node.type === 'element' ? [node.tagName, node.properties.start] : null))
      .toEqual([['ol', 7], ['ol', 2], ['ol', 4], ['ol', 5], ['ul', undefined], ['ol', 6]]);
    expect(output.result.reconstructedItems).toBe(7);
    expect(output.result.reconstructedLists).toBe(6);
  });

  it('preserves source boundaries while consuming only the verified marker and list metadata', () => {
    const input = '<p id="p1" style="mso-list:l0 level1 lfo1">\n<span id="anchor"><span style="mso-list:Ignore">1.<span>&nbsp; </span></span>'
      + '<strong> Á😀&nbsp;</strong><a href="https://example.test" data-thread-ids="thread1">Link</a><br><img src="https://example.test/x" alt="Alt"> Tail </span></p>';
    const expected = parse(input);
    const expectedParagraph = elements(expected, 'p')[0]!;
    const expectedWrapper = elements(expectedParagraph, 'span')[0]!;
    expectedWrapper.children.splice(0, 1);
    delete expectedParagraph.properties.style;
    const output = run(input);
    expect(elements(output.tree, 'p')).toEqual([expectedParagraph]);
    expect(elements(output.tree, 'li')[0]?.properties).toEqual({});
    expect(output.html.match(/id="p1"/g)).toHaveLength(1);
    expect(output.html.match(/id="anchor"/g)).toHaveLength(1);
  });

  it('removes handled list metadata without losing other source declarations or mutating original nodes', () => {
    const tree = parse(item('7.', 'Seven').replace('mso-list:l0 level1 lfo1', 'font-family:Calibri;mso-list:l0 level1 lfo1;color:red'));
    const original = tree.children[0];
    const before = structuredClone(original);
    reconstructOfficeLists(tree, DEFAULT_PASTE_HTML_LIMITS, () => undefined);
    expect(original).toEqual(before);
    expect(elements(tree, 'p')[0]?.properties.style).toBe('font-family:Calibri;color:red');
    expect(toHtml(tree)).not.toContain('mso-list');
  });

  it('retains empty source wrappers and explicit empty list items', () => {
    const output = run('<p style="mso-list:l0 level1 lfo1"><span id="anchor"><span style="mso-list:Ignore">1.</span></span></p>');
    expect(elements(output.tree, 'li')).toHaveLength(1);
    expect(elements(output.tree, 'span')[0]?.properties.id).toBe('anchor');
    expect(elements(output.tree, 'span')[0]?.children).toEqual([]);
  });

  it('preserves inter-paragraph whitespace and comments in document order through nesting', () => {
    const output = run(item('1.', 'A') + '\n<!--between-->\t' + item('1.', 'B', 2) + '\r\n' + item('2.', 'C'));
    expect(visibleText(output.tree)).toBe('A\n\tB\nC');
    expect(output.html).toContain('<!--between-->');
  });

  it('keeps authored empty paragraphs and containers as run boundaries', () => {
    const output = run(item('1.', 'A') + '<p></p>' + item('2.', 'B')
      + '<blockquote>' + item('3.', 'C') + '</blockquote>' + item('4.', 'D'));
    expect(output.tree.children.map(node => node.type === 'element' ? node.tagName : node.type))
      .toEqual(['ol', 'p', 'ol', 'blockquote', 'ol']);
    expect(elements(output.tree, 'ol').map(node => node.properties.start)).toEqual([1, 2, 3, 4]);
    expect(elements(output.tree, 'p').some(node => node.children.length === 0)).toBe(true);
  });

  it('reconstructs independently in table cells and does not rewrite existing semantic lists', () => {
    const existing = '<ol start="9"><li>' + item('9.', 'Existing') + '</li></ol>';
    const output = run('<table><tr><td>' + item('1.', 'A') + '</td><td>' + item('2.', 'B') + '</td></tr></table>' + existing);
    const cells = elements(output.tree, 'td');
    expect(elements(cells[0]!, 'ol')[0]?.properties.start).toBe(1);
    expect(elements(cells[1]!, 'ol')[0]?.properties.start).toBe(2);
    expect(output.html.endsWith(toHtml(parse(existing)))).toBe(true);
  });

  it('accepts revealed conditional markers but never activates markup inside comments', () => {
    const revealed = '<p style="mso-list:l0 level1 lfo1"><![if !supportLists]><span><span style="mso-list:Ignore">1.<span>&nbsp;</span></span></span><![endif]>Body</p>';
    expect(elements(run(revealed).tree, 'ol')).toHaveLength(1);
    const hidden = '<p style="mso-list:l0 level1 lfo1"><!--[if !supportLists]><span style="mso-list:Ignore">1.</span><![endif]-->Body</p>';
    const output = run(hidden);
    expect(output.html).toBe(toHtml(parse(hidden)));
    expect(output.diagnostics).toEqual([{ code: 'office-list-unsupported', offset: 0 }]);
  });

  it.each(['01.', '0.', '10001.', '1.2.', '1.a', '1.\u200b', 'I.', 'a)', 'o', '➢', '▫', '•◦', '▪ note', '1. Actual note'])(
    'retains unsupported visible marker %s with a located warning', (marker) => {
      const input = '<p>Before</p>' + item(marker, 'Body');
      const output = run(input);
      expect(output.html).toBe(toHtml(parse(input)));
      expect(output.diagnostics).toEqual([{ code: 'office-list-unsupported', offset: 13 }]);
    });

  it('accepts the largest supported ordinal', () => {
    expect(elements(run(item('10000.', 'Last')).tree, 'ol')[0]?.properties.start).toBe(10000);
  });

  it.each(['Text', '\u200b', '&nbsp;', '<br>', '<img alt="Leading" src="x">', '<a href="https://example.test">Leading</a>'])(
    'does not consume a marker after meaningful prefix %s', (prefix) => {
      const input = item('1.', 'Body').replace('<span style=', prefix + '<span style=');
      const output = run(input);
      expect(output.html).toBe(toHtml(parse(input)));
      expect(output.result.skippedRuns).toBe(1);
    });

  it.each(['id="anchor"', 'data-thread-ids="thread1"', 'data-type="mention"', 'data-id="mention1"', 'title="Note"'])(
    'retains marker subtree metadata: %s', (attribute) => {
      for (const input of [
        item('1.', 'Body').replace('style="mso-list:Ignore"', `${attribute} style="mso-list:Ignore"`),
        item('1.', 'Body').replace('<span>&nbsp;', `<span ${attribute}>&nbsp;`),
      ]) expect(run(input).html).toBe(toHtml(parse(input)));
    });

  it('atomically retains the entire run if the middle item or nesting is unsupported', () => {
    for (const middle of [item('2. Actual note', 'B'), item('2.', 'B', 3)]) {
      const input = item('1.', 'A') + middle + item('3.', 'C');
      const output = run(input);
      expect(output.html).toBe(toHtml(parse(input)));
      expect(output.result).toEqual({ reconstructedRuns: 0, reconstructedLists: 0, reconstructedItems: 0, skippedRuns: 1 });
      expect(output.diagnostics).toHaveLength(1);
    }
  });

  it('retains orphan nested runs and ambiguous additional Ignore elements', () => {
    for (const input of [
      item('1.', 'Nested', 2) + item('2.', 'Nested', 2),
      item('1.', '<span style="mso-list:Ignore">Important</span>Body'),
      item('1.', 'Body').replace('<span>&nbsp;', '<span style="mso-list:Ignore">&nbsp;'),
    ]) expect(run(input).html).toBe(toHtml(parse(input)));
  });

  it.each([
    '<p>1. Ordinary text</p>',
    '<p class="MsoListParagraph">1. Class only</p>',
    '<p><span style="mso-list:Ignore">1.</span>Standalone marker</p>',
    '<p style="mso-list:none"><span style="mso-list:Ignore">1.</span>Not a list</p>',
    '<p style=\'font-family:"x;mso-list:l0 level1 lfo1"\'><span style="mso-list:Ignore">1.</span>Quoted value</p>',
    '<p style="/* mso-list:l0 level1 lfo1 */color:red"><span style="mso-list:Ignore">1.</span>Comment</p>',
    '<p style="--custom:[;mso-list:l0 level1 lfo1;]"><span style="mso-list:Ignore">1.</span>Square block</p>',
    '<p style="--custom:{;mso-list:l0 level1 lfo1;}"><span style="mso-list:Ignore">1.</span>Curly block</p>',
    '<pre>' + item('1.', 'Literal') + '</pre>',
  ])('does not infer lists from unrelated text or literal content: %s', (input) => {
    const output = run(input);
    expect(output.html).toBe(toHtml(parse(input)));
    expect(output.result.reconstructedItems).toBe(0);
  });

  it.each([
    'mso-list:l0 level1 lfo1;mso-list:none',
    'mso-list:none;mso-list:l0 level1 lfo1',
    'mso-list:l0 level1 lfo1;mso-list:l1 level1 lfo1',
    'mso-list:l0 level1 lfo1!important',
    'mso-list:l0 level1 lfo1;/* unterminated',
    'mso-list:l0 level1 lfo1;font-family:&quot;unterminated',
    'mso-list:l0 level10 lfo1',
    'mso-list:l0&nbsp;level1 lfo1',
    'mso-list:l0 level1 lfo1;--custom:([)]',
  ])('does not partially accept malformed or ambiguous metadata: %s', (style) => {
    const input = item('1.', 'Body').replace('mso-list:l0 level1 lfo1', style);
    expect(run(input).html).toBe(toHtml(parse(input)));
  });

  it('parses declarations without treating semicolons in quoted, escaped, or parenthesized values as separators', () => {
    const style = 'font-family:&quot;x\\&quot;;mso-list:none&quot;;color:rgb(1;2;3);mso-list: l0/* gap */ level1 lfo1';
    const output = run(item('1.', 'Body').replace('mso-list:l0 level1 lfo1', style));
    expect(elements(output.tree, 'ol')).toHaveLength(1);
    expect(output.diagnostics).toEqual([]);
  });

  it.each([
    { options: { orderedLists: false }, html: item('1.', 'A') },
    { options: { bulletLists: false }, html: item('•', 'A') },
    { options: { nestedLists: false }, html: item('1.', 'A') + item('•', 'B', 2) },
    { options: { bulletLists: false }, html: item('1.', 'A') + item('•', 'B', 2) },
  ])('retains original markers when destination capabilities are insufficient: $options', ({ options, html }) => {
    const output = run(html, options);
    expect(output.html).toBe(toHtml(parse(html)));
    expect(output.result.skippedRuns).toBe(1);
  });

  it('still reconstructs supported separate runs when another run is unsupported', () => {
    const output = run(item('I.', 'Unsupported') + '<p>Boundary</p>' + item('4.', 'Supported'));
    expect(elements(output.tree, 'ol')[0]?.properties.start).toBe(4);
    expect(visibleText(output.tree)).toBe('I.\u00a0 UnsupportedBoundarySupported');
    expect(output.result.reconstructedRuns).toBe(1);
    expect(output.result.skippedRuns).toBe(1);
  });

  it('enforces generated node and descendant depth limits before mutating the tree', () => {
    for (const options of [{ maxNodes: 3 }, { maxDepth: 4 }]) {
      const tree = parse(item('1.', '<strong><em>Body</em></strong>'));
      const before = structuredClone(tree);
      expect(() => reconstructOfficeLists(tree, { ...DEFAULT_PASTE_HTML_LIMITS, ...options }, () => undefined))
        .toThrow(StructureLimitError);
      expect(tree).toEqual(before);
    }
  });

  it('validates all planned runs before committing any tree changes', () => {
    const tree = parse(item('1.', 'First') + '<div>' + item('1.', '<span><span><span>Deep</span></span></span>') + '</div>');
    const before = structuredClone(tree);
    expect(() => reconstructOfficeLists(tree, { ...DEFAULT_PASTE_HTML_LIMITS, maxDepth: 7 }, () => undefined))
      .toThrow(StructureLimitError);
    expect(tree).toEqual(before);
  });

  it('handles a large bounded run without changing body order', () => {
    const html = Array.from({ length: 1500 }, (_, index) => item(`${String(index + 1)}.`, `Body${String(index)};`)).join('');
    const output = run(html);
    expect(output.result.reconstructedItems).toBe(1500);
    expect(elements(output.tree, 'ol')).toHaveLength(1);
    expect(visibleText(output.tree)).toBe(Array.from({ length: 1500 }, (_, index) => `Body${String(index)};`).join(''));
  });
});
