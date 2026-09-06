/**
 * Math in Markdown: stored LaTeX is written raw, so the serializer picks a
 * form that no LaTeX can end early and that a renderer without math cannot
 * read as a link or raw HTML. Ordinary formulas keep `$...$` and `$$`
 * blocks; anything else becomes the `` $`...`$ `` code span form or a `math`
 * code fence, which GitHub and GitLab read as math and every other renderer
 * shows as code. The parser reads both forms back.
 */
import { describe, expect, it } from 'vitest';
import MarkdownIt from 'markdown-it';
import { Blockquote, BulletList, CodeBlock, Document, Editor, ListItem, Paragraph, Text } from '@domternal/core';
import type { AnyExtension } from '@domternal/core';
import { MathBlock, MathInline } from '@domternal/extension-math';
import type { Node as PMNode, Schema } from '@domternal/pm/model';
import { parseMarkdown } from './parser/parser.js';
import { serializeMarkdown } from './serializer/serializer.js';

function schemaOf(extensions: AnyExtension[]): Schema {
  const editor = new Editor({ extensions });
  const { schema } = editor;
  editor.destroy();
  return schema;
}
const schema = schemaOf([Document, Text, Paragraph, Blockquote, BulletList, ListItem, MathInline, MathBlock]);

const inline = (latex: string, before = 'a ', after = ' b'): PMNode => schema.node('doc', null, [
  schema.node('paragraph', null, [
    ...(before === '' ? [] : [schema.text(before)]),
    schema.nodes['mathInline']!.create({ latex }),
    ...(after === '' ? [] : [schema.text(after)]),
  ]),
]);
const block = (latex: string): PMNode => schema.node('doc', null, [schema.nodes['mathBlock']!.create({ latex })]);

/** Every math node of a parsed document, as [type, latex]. */
function maths(doc: PMNode): [string, unknown][] {
  const found: [string, unknown][] = [];
  doc.descendants((node) => {
    if (node.type.name === 'mathInline' || node.type.name === 'mathBlock') found.push([node.type.name, node.attrs['latex']]);
  });
  return found;
}

/** The text of a parsed document's text nodes, without the math. */
function plainText(doc: PMNode): string {
  let text = '';
  doc.descendants((node) => {
    if (node.isText) text += node.text ?? '';
  });
  return text;
}

/**
 * The elements a CommonMark renderer without math, with raw HTML enabled,
 * makes of the Markdown, beyond paragraphs, code and lists: it reads the
 * LaTeX of `$...$` and `$$` blocks as Markdown.
 */
const renderer = new MarkdownIt('default', { html: true, linkify: true });
function unexpectedElements(markdown: string): string[] {
  const host = document.createElement('div');
  host.innerHTML = renderer.render(markdown);
  return Array.from(host.querySelectorAll('*'))
    .filter(element => !['P', 'CODE', 'PRE', 'BLOCKQUOTE', 'UL', 'LI', 'EM', 'STRONG'].includes(element.tagName)
      || Array.from(element.attributes).some(attribute => attribute.name !== 'class'))
    .map(element => element.outerHTML);
}

describe('serializing ordinary math', () => {
  it.each([
    'a^2+b^2', 'e^{i\\pi}+1=0', '0 < x < 1', 'a<1', 'a > b', '\\left[0,1\\right]', '[0,1]', 'x_1 + y_2',
    '\\frac{a}{b}', 'f(x) = \\sqrt{x}', '\\text{if } x \\ge 0', 'a & b', '\\{x \\mid x > 0\\}', '\\mathbb{1}_{[0,1]}(x)',
  ])('keeps the dollar form for %j and parses it back', (latex) => {
    const { markdown, warnings } = serializeMarkdown(inline(latex));
    expect(markdown).toBe(`a $${latex}$ b`);
    expect(warnings).toEqual([]);
    expect(maths(parseMarkdown(markdown, schema))).toEqual([['mathInline', latex]]);
  });

  it.each([
    'x = 1', 'a^2 + b^2 = c^2\n\\sum_{i=1}^n i', '\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}', '\\left[0,1\\right]\n0 < x',
  ])('keeps the $$ form for the block %j and parses it back', (latex) => {
    const { markdown, warnings } = serializeMarkdown(block(latex));
    expect(markdown).toBe(`$$\n${latex}\n$$`);
    expect(warnings).toEqual([]);
    expect(maths(parseMarkdown(markdown, schema))).toEqual([['mathBlock', latex]]);
  });
});

describe('serializing inline math that could end early or read as Markdown', () => {
  it.each([
    ['a dollar that closes the math', 'x$ [click](javascript:alert(1)) $y'],
    ['a dollar before raw HTML', 'x$ <img src=x onerror=alert(1)> $y'],
    ['a link a renderer without math reads', '[click](javascript:alert(1))'],
    ['an image', '![a](https://probe.test/x.png)'],
    ['a reference link', '[click][ref]'],
    ['raw HTML', '<img src=x onerror=alert(1)>'],
    ['an unclosed tag that later text could close', 'x<img src=x onerror="alert(1)'],
    ['a closing tag', '</p>'],
    ['a comment', '<!-- x -->'],
    ['a processing instruction', '<?php x ?>'],
    ['an autolink', '<javascript:alert(1)>'],
    ['a backtick', 'a`b'],
    ['backticks at both ends', '`a`'],
    ['a run of backticks', 'a ``` b'],
    ['a line break before a blank line and HTML', 'a\n\n<img src=x onerror=alert(1)>'],
    ['a carriage return', 'a\r\r<img src=x onerror=alert(1)>'],
    ['a trailing backslash, which would escape the closing dollar', 'a\\'],
    ['spaces at both ends, which parsers take for currency', ' x '],
    ['a space at the start', ' x'],
    ['a space at the end', 'x '],
    ['only spaces', '   '],
    ['a bracket pair followed by a parenthesis', '[0,1](x)'],
  ])('writes %s in the code span form, inert without math, and parses it back', (_label, latex) => {
    const { markdown, warnings } = serializeMarkdown(inline(latex));
    expect(markdown).toMatch(/^a \$`+ ?[\s\S]* ?`+\$ b$/);
    expect(warnings).toEqual([]);
    expect(unexpectedElements(markdown)).toEqual([]);
    expect(maths(parseMarkdown(markdown, schema))).toEqual([['mathInline', latex.replace(/\r\n?|\n/g, ' ')]]);
    expect(plainText(parseMarkdown(markdown, schema))).toBe('a  b');
  });

  it('writes a backtick fence longer than any run inside', () => {
    expect(serializeMarkdown(inline('a ``` b')).markdown).toBe('a $````a ``` b````$ b');
    expect(serializeMarkdown(inline('`a`')).markdown).toBe('a $`` `a` ``$ b');
    expect(serializeMarkdown(inline(' x ')).markdown).toBe('a $`  x  `$ b');
  });

  it('writes math followed by a digit in the code span form, which currency guards do not refuse', () => {
    const { markdown } = serializeMarkdown(inline('x', 'a ', '5 b'));
    expect(markdown).toBe('a $`x`$5 b');
    const parsed = parseMarkdown(markdown, schema);
    expect(maths(parsed)).toEqual([['mathInline', 'x']]);
    expect(plainText(parsed)).toBe('a 5 b');
  });

  it('keeps two formulas from forming a link between them', () => {
    const doc = schema.node('doc', null, [schema.node('paragraph', null, [
      schema.nodes['mathInline']!.create({ latex: '[a' }),
      schema.text(' x '),
      schema.nodes['mathInline']!.create({ latex: '](javascript:alert(1))' }),
    ])]);
    const { markdown } = serializeMarkdown(doc);
    expect(unexpectedElements(markdown)).toEqual([]);
    expect(maths(parseMarkdown(markdown, schema))).toEqual([['mathInline', '[a'], ['mathInline', '](javascript:alert(1))']]);
  });

  it('keeps an unclosed tag in the math from taking the following text as its attributes', () => {
    const { markdown } = serializeMarkdown(inline('x<img src=x onerror="alert(1)', 'a ', '"> b'));
    expect(unexpectedElements(markdown)).toEqual([]);
  });

  it('omits empty math with a warning, since a lone $$ would open a math block', () => {
    const { markdown, warnings } = serializeMarkdown(inline('', 'a', ''));
    expect(markdown).toBe('a');
    expect(warnings).toEqual([expect.objectContaining({ code: 'lossy-structure', nodeType: 'mathInline' })]);
    const alone = schema.node('doc', null, [
      schema.node('paragraph', null, [schema.nodes['mathInline']!.create({ latex: '' })]),
      schema.node('paragraph', null, [schema.text('next')]),
    ]);
    expect(plainText(parseMarkdown(serializeMarkdown(alone).markdown, schema))).toBe('next');
  });
});

describe('serializing block math that could end early or read as Markdown', () => {
  it.each([
    ['a $$ line that closes the block', 'x\n$$\n\n<img src=x onerror=alert(1)>\n\n[click](javascript:alert(2))\n\n$$\ny'],
    ['a $$ inside a line', 'a $$ b'],
    ['a carriage return before a $$ line', 'x\r$$\r<img src=x onerror=alert(1)>'],
    ['a script element', '<script>alert(1)</script>'],
    ['a block tag without a closing bracket, which would turn the rest into HTML', '<div\nx'],
    ['a comment', '<!--\nx'],
    ['a link', 'a](javascript:alert(1))'],
    ['a link reference definition', 'x\n[ref]: javascript:alert(1)'],
    ['a code fence that would close a later fence', 'x\n````\ny'],
    ['a tilde fence', 'x\n~~~\ny'],
    ['backticks', 'a`b'],
  ])('writes %s as a math fence, inert without math, and parses it back', (_label, latex) => {
    const { markdown, warnings } = serializeMarkdown(block(latex));
    expect(markdown).toMatch(/^(`{3,})math\n[\s\S]*\n\1$/);
    expect(warnings).toEqual([]);
    expect(unexpectedElements(markdown)).toEqual([]);
    expect(maths(parseMarkdown(markdown, schema))).toEqual([['mathBlock', latex.replace(/\r\n?/g, '\n')]]);
  });

  it('writes a fence longer than any backtick run inside', () => {
    expect(serializeMarkdown(block('a\n`````\nb')).markdown).toBe('``````math\na\n`````\nb\n``````');
  });

  it('keeps a fenced block inside a quote and a list', () => {
    const latex = 'x\n$$\n<img src=x onerror=alert(1)>';
    const doc = schema.node('doc', null, [
      schema.node('blockquote', null, [schema.nodes['mathBlock']!.create({ latex })]),
      schema.node('bulletList', null, [schema.node('listItem', null, [
        schema.node('paragraph', null, [schema.text('item')]),
        schema.nodes['mathBlock']!.create({ latex }),
      ])]),
    ]);
    const { markdown } = serializeMarkdown(doc);
    expect(unexpectedElements(markdown)).toEqual([]);
    expect(maths(parseMarkdown(markdown, schema))).toEqual([['mathBlock', latex], ['mathBlock', latex]]);
  });

  it('keeps a fence in the math from closing a later code block, which would turn its text into HTML', () => {
    const withCode = schemaOf([Document, Text, Paragraph, CodeBlock, MathBlock]);
    const code = '<img src=x onerror=alert(1)>\n```';
    const doc = withCode.node('doc', null, [
      withCode.nodes['mathBlock']!.create({ latex: 'x\n```' }),
      withCode.nodes['codeBlock']!.create(null, withCode.text(code)),
    ]);
    const { markdown } = serializeMarkdown(doc);
    expect(unexpectedElements(markdown)).toEqual([]);
    const parsed = parseMarkdown(markdown, withCode);
    expect(maths(parsed)).toEqual([['mathBlock', 'x\n```']]);
    expect(parsed.lastChild?.textContent).toBe(code);
  });
});

describe('parsing the code span and fence forms', () => {
  it('reads $`...`$ as inline math, dropping one space at each end as a code span does', () => {
    expect(maths(parseMarkdown('a $`x^2`$ b', schema))).toEqual([['mathInline', 'x^2']]);
    expect(maths(parseMarkdown('$``a`b``$', schema))).toEqual([['mathInline', 'a`b']]);
    expect(maths(parseMarkdown('$` a `$', schema))).toEqual([['mathInline', 'a']]);
    expect(maths(parseMarkdown('$` a`$', schema))).toEqual([['mathInline', ' a']]);
    expect(maths(parseMarkdown('$`a\nb`$', schema))).toEqual([['mathInline', 'a b']]);
  });

  it('leaves an unclosed or mismatched code span form to the other rules', () => {
    expect(maths(parseMarkdown('a $`x b', schema))).toEqual([]);
    expect(maths(parseMarkdown('a $`x`` b', schema))).toEqual([]);
    // The dollar form still reads what the code span form does not close.
    expect(maths(parseMarkdown('a $``x`$ b', schema))).toEqual([['mathInline', '``x`']]);
  });

  it('reads a math fence as block math only when the schema has it', () => {
    expect(maths(parseMarkdown('```math\na\n\nb\n```', schema))).toEqual([['mathBlock', 'a\n\nb']]);
    const withCode = schemaOf([Document, Text, Paragraph]);
    expect(parseMarkdown('```math\nx\n```', withCode).textContent).toBe('x');
    expect(maths(parseMarkdown('```js\nx\n```', schema))).toEqual([]);
  });
});
