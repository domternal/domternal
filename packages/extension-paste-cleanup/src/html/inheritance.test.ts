import { afterEach, describe, expect, it } from 'vitest';
import type { Element, Root } from 'hast';
import { toHtml } from 'hast-util-to-html';
import {
  Bold, Code, Document, Editor, FontFamily, FontSize, Highlight, Italic, Link,
  Paragraph, Strike, Subscript, Superscript, Text, TextColor, TextStyle, Underline,
} from '@domternal/core';
import type { Node as ProseMirrorNode } from '@domternal/pm/model';
import { parseBoundedHTML } from './parse.js';
import { InheritanceLimitError, resolveInlineInheritance } from './inheritance.js';
import type { InlineInheritanceOptions } from './inheritance.js';

const limits = {
  maxInputLength: 2_000_000, maxNodes: 30_000, maxDepth: 128, maxDiagnostics: 100,
  maxTableCells: 20_000, maxImages: 200, maxImagePixels: 50_000_000,
};
let editor: Editor | undefined;
afterEach(() => { editor?.destroy(); editor = undefined; });

function resolve(html: string, options: Partial<InlineInheritanceOptions> = {}): { html: string; tree: Root; unsupported: Element[] } {
  const tree = parseBoundedHTML(html, limits);
  const unsupported: Element[] = [];
  resolveInlineInheritance(tree, { ...limits, ...options }, node => { unsupported.push(node); });
  return { html: toHtml(tree), tree, unsupported };
}

function documentFrom(html: string): ProseMirrorNode {
  editor?.destroy();
  editor = new Editor({
    extensions: [Document, Paragraph, Text, Bold, Italic, Underline, Strike, Code, Subscript, Superscript,
      TextStyle, FontFamily, FontSize, TextColor, Highlight, Link.configure({ autolink: false, linkOnPaste: false })],
    content: html,
  });
  return editor.state.doc;
}

function characters(html: string): Map<string, Record<string, unknown>> {
  const result = new Map<string, Record<string, unknown>>();
  documentFrom(html).descendants(node => {
    if (node.isText) {
      const marks: Record<string, unknown> = {};
      for (const mark of node.marks) marks[mark.type.name] = { ...mark.attrs };
      for (const character of node.text ?? '') result.set(character, marks);
    }
  });
  return result;
}

describe('resolveInlineInheritance', () => {
  it('materializes inherited typography and restores sibling state', () => {
    const result = resolve('<div style="font-family:Calibri;font-size:12pt;color:red"><p>A<span style="color:blue">B</span>C</p></div>');
    const chars = characters(result.html);
    expect(chars.get('A')?.['textStyle']).toMatchObject({ fontFamily: 'Calibri', fontSize: '12pt', color: 'red' });
    expect(chars.get('B')?.['textStyle']).toMatchObject({ fontFamily: 'Calibri', fontSize: '12pt', color: 'blue' });
    expect(chars.get('C')?.['textStyle']).toEqual(chars.get('A')?.['textStyle']);
    expect(result.unsupported).toEqual([]);
  });

  it.each(['normal', '400', '100', '500'])('resets inherited bold for %s in the actual editor schema', weight => {
    const source = `<p><strong>A<span style="font-weight:${weight}">B<strong>C</strong>D</span>E</strong></p>`;
    expect(characters(source).get('B')).toHaveProperty('bold');
    const chars = characters(resolve(source).html);
    for (const text of ['A', 'C', 'E']) expect(chars.get(text)).toHaveProperty('bold');
    for (const text of ['B', 'D']) expect(chars.get(text)).not.toHaveProperty('bold');
  });

  it('honors resets on semantic wrappers and across italic descendants', () => {
    const chars = characters(resolve('<p><strong style="font-weight:normal">A</strong><em>B<span style="font-style:normal">C<i>D</i></span>E</em><i style="font-style:normal">F</i></p>').html);
    for (const text of ['A', 'C', 'F']) expect(Object.keys(chars.get(text) ?? {})).toEqual([]);
    for (const text of ['B', 'D', 'E']) expect(chars.get(text)).toHaveProperty('italic');
  });

  it('retains ancestor decorations while allowing a reset on the decorating element', () => {
    const chars = characters(resolve('<p><u>A<span style="text-decoration:none">B<span style="text-decoration:line-through">C</span></span></u><u style="text-decoration:none">D</u><s style="text-decoration:none">E</s></p>').html);
    for (const text of ['A', 'B', 'C']) expect(chars.get(text)).toHaveProperty('underline');
    expect(chars.get('C')).toHaveProperty('strike');
    expect(chars.get('D')).not.toHaveProperty('underline');
    expect(chars.get('E')).not.toHaveProperty('strike');
  });

  it('respects supported shorthand and longhand decoration source order', () => {
    const chars = characters(resolve('<p><span style="text-decoration-line:underline;text-decoration:none">A</span><span style="text-decoration:none;text-decoration-line:underline">B</span><span style="text-decoration:none;text-decoration-line:underline;text-decoration:line-through">C</span></p>').html);
    expect(chars.get('A')).not.toHaveProperty('underline');
    expect(chars.get('B')).toHaveProperty('underline');
    expect(chars.get('C')).not.toHaveProperty('underline');
    expect(chars.get('C')).toHaveProperty('strike');
  });

  it('combines inherited style attributes with inline highlight and named color tokens', () => {
    const result = resolve('<div style="font-family:Calibri;color:red"><p><span style="background-color:yellow">A<span style="font-size:12pt">B</span></span><span data-bg-color="blue" data-text-color="green">C</span><mark>D</mark></p></div>');
    const chars = characters(result.html);
    for (const text of ['A', 'B']) expect(chars.get(text)?.['textStyle']).toMatchObject({ fontFamily: 'Calibri', color: 'red', backgroundColor: 'yellow' });
    expect(chars.get('B')?.['textStyle']).toMatchObject({ fontSize: '12pt' });
    expect(chars.get('C')?.['textStyle']).toMatchObject({ colorToken: 'green', backgroundColorToken: 'blue' });
    expect(chars.get('D')?.['textStyle']).toMatchObject({ color: 'red', backgroundColor: '#fef08a' });
  });

  it('preserves background painting through transparent inline descendants', () => {
    const result = resolve('<p><span style="background-color:yellow">A<span style="background-color:transparent;color:red">B</span></span></p>');
    expect(characters(result.html).get('B')?.['textStyle']).toMatchObject({ backgroundColor: 'yellow', color: 'red' });
  });

  it('respects default mark backgrounds and transparent resets on the same element', () => {
    const chars = characters(resolve('<p><mark style="background-color:transparent">A</mark><span style="background-color:blue"><mark>B</mark><mark style="background-color:transparent">C</mark></span></p>').html);
    expect(chars.get('A')).not.toHaveProperty('textStyle');
    expect(chars.get('B')?.['textStyle']).toMatchObject({ backgroundColor: '#fef08a' });
    expect(chars.get('C')?.['textStyle']).toMatchObject({ backgroundColor: 'blue' });
  });

  it.each(['rgba(0,0,0,0)', 'rgba(100%,0%,0%,0%)', 'hsla(120,50%,25%,0)', '#0000', '#11223300'])('treats fully transparent %s as painting the inherited background', background => {
    const chars = characters(resolve(`<p><mark style="background-color:${background}">A</mark><span style="background-color:yellow"><mark style="background-color:${background}">B</mark></span></p>`).html);
    expect(chars.get('A')).not.toHaveProperty('textStyle');
    expect(chars.get('B')?.['textStyle']).toMatchObject({ backgroundColor: 'yellow' });
  });

  it('lets tokens replace inherited literal colors and lets descendant literals replace tokens', () => {
    const chars = characters(resolve('<p><span style="color:red;background-color:yellow"><span data-text-color="blue" data-bg-color="green">A<span style="color:#123456;background-color:#abcdef">B</span>C</span>D</span></p>').html);
    for (const character of ['A', 'C']) expect(chars.get(character)?.['textStyle']).toMatchObject({
      color: null, colorToken: 'blue', backgroundColor: null, backgroundColorToken: 'green',
    });
    expect(chars.get('B')?.['textStyle']).toMatchObject({ color: '#123456', colorToken: null, backgroundColor: '#abcdef', backgroundColorToken: null });
    expect(chars.get('D')?.['textStyle']).toMatchObject({ color: 'red', colorToken: null, backgroundColor: 'yellow', backgroundColorToken: null });
  });

  it('restores an inherited token behind a transparent mark without inventing a default highlight', () => {
    const chars = characters(resolve('<p><span data-bg-color="blue"><mark style="background-color:transparent">A</mark></span></p>').html);
    expect(chars.get('A')?.['textStyle']).toMatchObject({ backgroundColor: null, backgroundColorToken: 'blue' });
  });

  it('reports invalid consumed tokens without erasing a valid inherited token', () => {
    const result = resolve('<p><span data-text-color="red"><span data-text-color="bad;token" data-bg-color="">A</span></span></p>');
    expect(characters(result.html).get('A')?.['textStyle']).toMatchObject({ colorToken: 'red', backgroundColorToken: null });
    expect(result.unsupported).toHaveLength(1);
    expect(result.unsupported[0]?.position?.start.offset).toBe(31);
  });

  it('overrides script semantics on the same element while retaining a parent script box', () => {
    const chars = characters(resolve('<p><sub style="vertical-align:baseline">A</sub><sup style="vertical-align:baseline">B</sup><sup>C<span style="vertical-align:baseline">D</span><span style="vertical-align:sub">E</span></sup></p>').html);
    for (const character of ['A', 'B']) {
      expect(chars.get(character)).not.toHaveProperty('subscript');
      expect(chars.get(character)).not.toHaveProperty('superscript');
    }
    for (const character of ['C', 'D', 'E']) expect(chars.get(character)).toHaveProperty('superscript');
    expect(chars.get('E')).toHaveProperty('subscript');
  });

  it('does not turn vertical alignment on a block into a script mark or change cell alignment', () => {
    const result = resolve('<div style="vertical-align:super"><p>A</p></div><table><tr><td style="vertical-align:middle">B</td></tr></table>');
    expect(result.html).not.toContain('vertical-align:super');
    expect(result.html).toContain('<td style="vertical-align:middle">B</td>');
    expect(characters(result.html).get('A')).not.toHaveProperty('superscript');
    expect(result.unsupported).toHaveLength(1);
  });

  it('reports unsupported inline vertical alignment while retaining its safe declaration', () => {
    const result = resolve('<p><sup style="vertical-align:middle">A</sup></p>');
    expect(result.html).toContain('vertical-align:middle');
    expect(characters(result.html).get('A')).not.toHaveProperty('superscript');
    expect(result.unsupported).toHaveLength(1);
  });

  it('retains safe nonconsumed styles and metadata on their original boundary', () => {
    const result = resolve('<p id="paragraph" lang="hr" dir="rtl" style="text-align:right;line-height:1.7"><span title="Tooltip" data-thread-ids="thread" style="white-space:pre-wrap;color:red">A</span></p>');
    expect(result.html).toContain('<p id="paragraph" lang="hr" dir="rtl" style="text-align:right;line-height:1.7">');
    expect(result.html).toContain('<span title="Tooltip" data-thread-ids="thread" style="white-space:pre-wrap">');
    expect(characters(result.html).get('A')?.['textStyle']).toMatchObject({ color: 'red' });
    expect(result.unsupported).toEqual([]);
  });

  it('keeps block and cell fills out of text marks and never wraps table structure', () => {
    const result = resolve('<div style="background-color:yellow;color:red"><table style="font-weight:bold">\n<tbody>\n<tr>\n<td colspan="2" rowspan="3" style="background-color:blue;vertical-align:middle"><p>A</p></td></tr></tbody></table></div>');
    expect(result.html).toContain('<div style="background-color:yellow"><table>\n<tbody>\n<tr>\n<td colspan="2" rowspan="3" style="background-color:blue;vertical-align:middle"><p><span style="color:red"><strong>A</strong></span></p>');
    expect(result.html).not.toMatch(/<(?:strong|span|em|u|s)>\s*<(?:table|tbody|tr|td)/);
    expect(result.html.match(/background-color:/g)).toHaveLength(2);
  });

  it('leaves whitespace between list items outside formatting wrappers', () => {
    const result = resolve('<ul style="font-weight:bold">\n<li>A</li>\n<li>B</li>\n</ul>');
    expect(result.html).toBe('<ul>\n<li><strong>A</strong></li>\n<li><strong>B</strong></li>\n</ul>');
  });

  it('resolves relative font sizes from the nearest known source base only once', () => {
    const chars = characters(resolve('<div style="font-size:12pt"><p>A<span style="font-size:2em">B<span style="font-size:50%">C</span></span>D</p></div>').html);
    for (const text of ['A', 'C', 'D']) expect(chars.get(text)?.['textStyle']).toMatchObject({ fontSize: '12pt' });
    expect(chars.get('B')?.['textStyle']).toMatchObject({ fontSize: '24pt' });
    expect(resolve('<p style="font-size:0">A<span style="font-size:2em">B</span></p>').html).toContain('font-size:0px');
  });

  it.each(['2em', '150%', '1rem'])('reports an unknown source base without guessing for %s', size => {
    const result = resolve(`<p style="font-size:${size}">A<span style="font-size:2em">B</span></p>`);
    expect(result.html).not.toContain('font-size');
    expect(result.unsupported).toHaveLength(2);
    expect(result.unsupported[0]?.position?.start.offset).toBe(0);
  });

  it.each(['1rem', '9999em', '0.001%'])('invalidates a base that cannot be safely computed: %s', size => {
    const result = resolve(`<div style="font-size:12px"><p style="font-size:${size}">A<span style="font-size:2em">B</span></p><p>C</p></div>`);
    const chars = characters(result.html);
    expect(chars.get('A')).not.toHaveProperty('textStyle');
    expect(chars.get('B')).not.toHaveProperty('textStyle');
    expect(chars.get('C')?.['textStyle']).toMatchObject({ fontSize: '12px' });
    expect(result.unsupported).toHaveLength(2);
  });

  it.each(['notacolor', 'inherit', 'initial', 'unset', 'revert', 'currentColor', '#12345', 'rgb(1,2)', 'rgb(1%,2,3)', 'hsl(10,20,30)'])('does not erase inherited color for unsupported %s', color => {
    const result = resolve(`<p style="color:red">A<span style="color:${color}">B</span></p>`);
    expect(characters(result.html).get('B')?.['textStyle']).toMatchObject({ color: 'red' });
    expect(result.unsupported).toHaveLength(1);
  });

  it.each(['rebeccapurple', '#1234', '#12345678', 'rgb(1, 2, 3)', 'rgb(10%, 20%, 30%)', 'rgba(1,2,3,0.5)', 'hsl(120,50%,25%)', 'hsla(120,50%,25%,50%)'])('accepts a supported color form: %s', color => {
    const result = resolve(`<p style="color:${color}">A</p>`);
    expect(result.html).toContain(`color:${color}`);
    expect(result.unsupported).toEqual([]);
  });

  it('keeps an earlier valid declaration when a later value is invalid', () => {
    const result = resolve('<p style="color:red;color:notacolor;font-family:Calibri;font-family:initial">A</p>');
    expect(characters(result.html).get('A')?.['textStyle']).toMatchObject({ color: 'red', fontFamily: 'Calibri' });
    expect(result.unsupported).toHaveLength(1);
  });

  it('supports bounded quoted family names containing commas and opposite quotes', () => {
    const result = resolve('<p style="font-family:&quot;Font, Name&quot;, \'Other Font\', sans-serif">A</p>');
    expect(result.html).toContain('font-family:&#x22;Font, Name&#x22;, &#x27;Other Font&#x27;, sans-serif');
    expect(result.unsupported).toEqual([]);
    expect(resolve('<p style="font-family:&quot;Tom\'s Font&quot;">B</p>').unsupported).toEqual([]);
  });

  it.each(['inherit', 'initial', 'unset', 'revert', "'Broken", '12font'])('keeps a supported parent family when the child family is unsupported: %s', family => {
    const result = resolve(`<div style="font-family:Calibri"><p style="font-family:${family}">A</p></div>`);
    expect(characters(result.html).get('A')?.['textStyle']).toMatchObject({ fontFamily: 'Calibri' });
    expect(result.unsupported).toHaveLength(1);
  });

  it('preserves source boundaries, metadata, links and subscript nodes', () => {
    const result = resolve('<p id="block" data-pm-slice="1 1 []" style="font-family:Calibri"><strong id="emphasis" data-thread-ids="thread"><a href="https://example.test">A<sub>B</sub></a><code>C</code></strong></p>');
    expect(result.html).toContain('<p id="block" data-pm-slice="1 1 []">');
    expect(result.html).toContain('<span id="emphasis" data-thread-ids="thread"><a href="https://example.test">');
    const chars = characters(result.html);
    expect(chars.get('A')).toHaveProperty('link');
    expect(chars.get('B')).toHaveProperty('subscript');
    expect(chars.get('C')).toHaveProperty('code');
  });

  it('preserves every text code point, hard break, empty paragraph and preformatted newline', () => {
    const source = '<div style="font-weight:bold"><p>A<span> </span>B&nbsp;C<br>D</p><p></p><pre> E\n  F </pre></div>';
    const result = resolve(source);
    const text = (root: Root): string => {
      let value = '';
      const visit = (node: Root | Root['children'][number]): void => {
        if (node.type === 'text') value += node.value;
        if ('children' in node) for (const child of node.children) visit(child);
      };
      visit(root);
      return value;
    };
    expect(text(result.tree)).toBe(text(parseBoundedHTML(source, limits)));
    expect(result.html).toContain('<br>');
    expect(result.html).toContain('<p></p>');
    expect(result.html).toContain('<pre><strong> E\n  F </strong></pre>');
  });

  it('keeps the original void break and its metadata when materializing inherited formatting', () => {
    const tree = parseBoundedHTML('<p style="font-weight:bold;color:red;line-height:1.5"><br id="break" title="Keep" data-thread-ids="thread" style="line-height:1.7"></p>', limits);
    const paragraph = tree.children[0] as Element;
    const br = paragraph.children[0] as Element; const position = br.position;
    resolveInlineInheritance(tree, limits);
    const found: Element[] = [];
    const visit = (node: Root | Root['children'][number]): void => {
      if (node.type === 'element' && node.tagName === 'br') found.push(node);
      if ('children' in node) for (const child of node.children) visit(child);
    };
    visit(tree);
    expect(found).toEqual([br]); expect(found[0]).toBe(br); expect(br.position).toBe(position);
    expect(br.children).toEqual([]);
    expect(br.properties).toEqual({ id: 'break', title: 'Keep', dataThreadIds: 'thread', style: 'line-height:1.7' });
    expect(paragraph.properties).toEqual({ style: 'line-height:1.5' });
    expect(toHtml(tree)).toBe('<p style="line-height:1.5"><span style="color:red"><strong><br id="break" title="Keep" data-thread-ids="thread" style="line-height:1.7"></strong></span></p>');
    expect(toHtml(tree).match(/id="break"/g)).toHaveLength(1);
  });

  it('does not extend leaf formatting materialization to images or horizontal rules', () => {
    const result = resolve('<div style="font-weight:bold;color:red"><p><img src="https://example.test/image"><br></p><hr></div>');
    expect(result.html).toBe('<div><p><img src="https://example.test/image"><span style="color:red"><strong><br></strong></span></p><hr></div>');
  });

  it.each(['<br>', '<br><br>', 'A<br>B'])('materializes direct or inherited effective break formatting in %s', content => {
    const inherited = resolve(`<p style="font-weight:bold;font-style:italic;color:red">${content}</p>`);
    expect(inherited.unsupported).toEqual([]);
    expect(inherited.html.match(/<strong><em><br><\/em><\/strong>/g)).toHaveLength(content.match(/<br>/g)?.length ?? 0);
    expect(inherited.html.match(/<br>/g)).toHaveLength(content.match(/<br>/g)?.length ?? 0);
  });

  it('enforces exact generated break node and depth budgets before wrapper allocation', () => {
    const html = '<p style="font-weight:bold;font-style:italic;color:red"><br></p>';
    expect(() => resolve(html, { maxNodes: 5, maxDepth: 5 })).not.toThrow();
    expect(() => resolve(html, { maxNodes: 4 })).toThrow(InheritanceLimitError);
    expect(() => resolve(html, { maxDepth: 4 })).toThrow(InheritanceLimitError);
    const full = '<p><span style="font-family:Georgia;font-size:14pt;color:red"><b><i><u><s><sub><br></sub></s></u></i></b></span></p>';
    expect(() => resolve(full, { maxNodes: 14, maxDepth: 14 })).not.toThrow();
    expect(() => resolve(full, { maxNodes: 13 })).toThrow(InheritanceLimitError);
    expect(() => resolve(full, { maxDepth: 13 })).toThrow(InheritanceLimitError);
  });

  it('enforces exact adapt semantic wrapper node and depth budgets before wrapper allocation', () => {
    const adapt = { formatting: 'adapt' } as const;
    // Adapt omits the typography carrier, so each budget is exactly one below preserve.
    const html = '<p style="font-weight:bold;font-style:italic;color:red"><br></p>';
    expect(() => resolve(html, { ...adapt, maxNodes: 4, maxDepth: 4 })).not.toThrow();
    expect(() => resolve(html, { ...adapt, maxNodes: 3 })).toThrow(InheritanceLimitError);
    expect(() => resolve(html, { ...adapt, maxDepth: 3 })).toThrow(InheritanceLimitError);
    const full = '<p><span style="font-family:Georgia;font-size:14pt;color:red"><b><i><u><s><sub><br></sub></s></u></i></b></span></p>';
    expect(resolve(full, { ...adapt, maxNodes: 13, maxDepth: 13 }).html)
      .toBe('<p><span><span><span><span><span><span><strong><em><u><s><sub><br></sub></s></u></em></strong></span></span></span></span></span></span></p>');
    expect(() => resolve(full, { ...adapt, maxNodes: 12 })).toThrow(InheritanceLimitError);
    expect(() => resolve(full, { ...adapt, maxDepth: 12 })).toThrow(InheritanceLimitError);
    const tree = parseBoundedHTML(html, limits);
    const paragraph = tree.children[0] as Element; const [only] = paragraph.children;
    expect(() => { resolveInlineInheritance(tree, { ...limits, ...adapt, maxNodes: 3 }); }).toThrow(InheritanceLimitError);
    expect(paragraph.children).toEqual([only]);
    expect((only as Element).tagName).toBe('br');
  });

  it('charges every repeated break style even when no source text exists', () => {
    const html = '<p style="font-family:Georgia"><br><br></p>';
    // Each generated family declaration uses 11 name units, 7 value units and 2 separators.
    expect(() => resolve(html, { maxInputLength: 40 })).not.toThrow();
    expect(() => resolve(html, { maxInputLength: 39 })).toThrow(InheritanceLimitError);
    const tree = parseBoundedHTML(html, limits);
    const paragraph = tree.children[0] as Element; const [first, second] = paragraph.children;
    expect(() => { resolveInlineInheritance(tree, { ...limits, maxNodes: 4 }); }).toThrow(InheritanceLimitError);
    expect(paragraph.children).toEqual([first, second]);
    expect((first as Element).tagName).toBe('br'); expect((second as Element).tagName).toBe('br');
  });

  it('adapts typography while retaining semantic marks and real resets', () => {
    const result = resolve('<div style="color:red;font-size:12pt;font-family:Calibri"><p><strong>A<span style="font-weight:normal;background-color:yellow">B</span></strong><mark>C</mark></p></div>', { formatting: 'adapt' });
    expect(result.html).not.toMatch(/font-|color:|<mark/);
    const chars = characters(result.html);
    expect(chars.get('A')).toHaveProperty('bold');
    expect(chars.get('B')).not.toHaveProperty('bold');
    for (const value of chars.values()) expect(value).not.toHaveProperty('textStyle');
  });

  it('reports unsupported declarations once per located element and does not retain them', () => {
    const result = resolve('<p>A<span style="background-image:url(https://example.test/a);font:12pt Arial;position:fixed">B</span></p>');
    expect(result.unsupported).toHaveLength(1);
    expect(result.unsupported[0]?.position?.start.offset).toBe(4);
    expect(result.html).not.toContain('style=');
  });

  it('checks generated nodes against the shared budget before allocation', () => {
    expect(() => resolve('<p style="font-weight:bold;font-style:italic;color:red">A</p>', { maxNodes: 4 })).toThrow(InheritanceLimitError);
    expect(() => resolve('<p style="font-weight:bold;font-style:italic;color:red">A</p>', { maxNodes: 5 })).not.toThrow();
  });

  it('bounds duplicated style bodies even when source nodes and depth are small', () => {
    const color = `rgb(${'0'.repeat(200_000)}1,2,3)`;
    const source = `<div style="color:${color}">${'<p>X</p>'.repeat(15)}</div>`;
    expect(() => resolve(source)).toThrow(InheritanceLimitError);
  });

  it('uses a smaller input budget for generated attributes and validates that budget', () => {
    expect(() => resolve('<p style="font-family:Calibri">A</p>', { maxInputLength: 10 })).toThrow(InheritanceLimitError);
    for (const maxInputLength of [0, -1, 1.5, NaN, Infinity, 2_000_001]) {
      expect(() => resolve('<p>A</p>', { maxInputLength })).toThrow(RangeError);
    }
  });

  it('includes generated script marks in node and depth budgets', () => {
    expect(() => resolve('<p><span style="vertical-align:sub">A</span></p>', { maxNodes: 3 })).toThrow(InheritanceLimitError);
    expect(() => resolve('<p><span style="vertical-align:sub">A</span></p>', { maxDepth: 3 })).toThrow(InheritanceLimitError);
  });

  it('checks generated depth and rejects already oversized input trees', () => {
    expect(() => resolve('<p style="font-weight:bold;font-style:italic;color:red">A</p>', { maxDepth: 4 })).toThrow(InheritanceLimitError);
    expect(() => resolve('<p style="font-weight:bold;font-style:italic;color:red">A</p>', { maxDepth: 5 })).not.toThrow();
    expect(() => resolve('<div><div><p>A</p></div></div>', { maxDepth: 3 })).toThrow(InheritanceLimitError);
    expect(() => resolve('<p>A</p><p>B</p>', { maxNodes: 3 })).toThrow(InheritanceLimitError);
  });

  it.each([0, -1, 1.5, Infinity, NaN, 30_001])('rejects invalid node budgets: %s', maxNodes => {
    expect(() => resolve('<p>A</p>', { maxNodes })).toThrow(RangeError);
  });

  it('rejects an unsafe recursion budget and bounds repeated alternating formatting', () => {
    expect(() => resolve('<p>A</p>', { maxDepth: 129 })).toThrow(RangeError);
    const result = resolve('<p>' + '<b>A<span style="font-weight:normal">B</span>C</b>'.repeat(500) + '</p>');
    expect(result.html.length).toBeLessThan(50_000);
    expect(result.unsupported).toEqual([]);
  });
});
