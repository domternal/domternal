/**
 * Serializer tests over the extension packages: tables, images, details,
 * emoji, mentions, and math.
 */
import { describe, expect, it } from 'vitest';
import {
  Bold,
  Code,
  CodeBlock,
  Document,
  Editor,
  Italic,
  Paragraph,
  Text,
} from '@domternal/core';
import { Details, DetailsContent, DetailsSummary } from '@domternal/extension-details';
import { Emoji, emojis } from '@domternal/extension-emoji';
import { Image } from '@domternal/extension-image';
import { MathBlock, MathInline } from '@domternal/extension-math';
import { Mention } from '@domternal/extension-mention';
import { Table, TableCell, TableHeader, TableRow } from '@domternal/extension-table';
import type { Node as PMNode } from '@domternal/pm/model';
import { serializeMarkdown } from './serializer.js';
import type { SerializeMarkdownResult } from '../types.js';

const extensions = [
  Document,
  Text,
  Paragraph,
  Bold,
  Italic,
  Code,
  CodeBlock,
  Table,
  TableRow,
  TableCell,
  TableHeader,
  Image,
  Details,
  DetailsSummary,
  DetailsContent,
  Emoji,
  Mention,
  MathInline,
  MathBlock,
];

function docFrom(content: string): PMNode {
  const editor = new Editor({ extensions, content });
  const doc = editor.state.doc;
  editor.destroy();
  return doc;
}

function serialize(content: string): SerializeMarkdownResult {
  return serializeMarkdown(docFrom(content));
}

describe('serializeMarkdown - tables', () => {
  it('serializes a GFM pipe table with the first row as header', () => {
    const { markdown, warnings } = serialize(
      '<table>' +
        '<tr><th>Name</th><th>Age</th></tr>' +
        '<tr><td>Ana</td><td>30</td></tr>' +
        '<tr><td>Ivo</td><td>41</td></tr>' +
        '</table>'
    );
    expect(markdown).toBe(
      '| Name | Age |\n| --- | --- |\n| Ana | 30 |\n| Ivo | 41 |'
    );
    expect(warnings).toEqual([]);
  });

  it('maps header cell alignment to separator syntax', () => {
    const { markdown } = serialize(
      '<table>' +
        '<tr><th data-text-align="center">A</th><th data-text-align="right">B</th></tr>' +
        '<tr><td>1</td><td>2</td></tr>' +
        '</table>'
    );
    expect(markdown).toBe('| A | B |\n| :---: | ---: |\n| 1 | 2 |');
  });

  it('escapes pipes inside cells', () => {
    const { markdown } = serialize(
      '<table><tr><th>a|b</th></tr><tr><td>c</td></tr></table>'
    );
    expect(markdown).toBe('| a\\|b |\n| --- |\n| c |');
  });

  it('keeps inline marks inside cells', () => {
    const { markdown } = serialize(
      '<table><tr><th>H</th></tr><tr><td><strong>bold</strong></td></tr></table>'
    );
    expect(markdown).toBe('| H |\n| --- |\n| **bold** |');
  });

  it('flattens multi-block cells to one line with a warning', () => {
    const { markdown, warnings } = serialize(
      '<table><tr><th>H</th></tr><tr><td><p>x</p><p>y</p></td></tr></table>'
    );
    expect(markdown).toBe('| H |\n| --- |\n| x y |');
    expect(warnings.some((w) => w.code === 'lossy-structure')).toBe(true);
  });

  it('escapes pipes inside code spans in cells', () => {
    const { markdown } = serialize(
      '<table><tr><th>H</th></tr><tr><td><code>a|b</code></td></tr></table>'
    );
    expect(markdown).toBe('| H |\n| --- |\n| `a\\|b` |');
  });

  it('flattens hard breaks in cells without a stray backslash', () => {
    const { markdown } = serialize(
      '<table><tr><th>H</th></tr><tr><td><p>a<br>b</p></td></tr></table>'
    );
    expect(markdown).toBe('| H |\n| --- |\n| a b |');
  });

  it('warns when a cell holds a single non-textblock child', () => {
    const { warnings } = serialize(
      '<table><tr><th>H</th></tr><tr><td><pre><code>x</code></pre></td></tr></table>'
    );
    expect(
      warnings.some((w) => w.code === 'lossy-structure' && w.message.includes('flattened'))
    ).toBe(true);
  });

  it('warns for cell backgrounds and body alignment differing from the column', () => {
    const { warnings } = serialize(
      '<table>' +
        '<tr><th>H</th></tr>' +
        '<tr><td data-background="#fee" data-text-align="right">x</td></tr>' +
        '</table>'
    );
    expect(warnings.some((w) => w.message.includes('background'))).toBe(true);
    expect(warnings.some((w) => w.message.includes('differing from its column'))).toBe(true);
  });

  it('warns when merged cells lose their spans', () => {
    const { warnings } = serialize(
      '<table><tr><th colspan="2">wide</th></tr><tr><td>a</td><td>b</td></tr></table>'
    );
    expect(
      warnings.some((w) => w.code === 'lossy-structure' && w.message.includes('Merged'))
    ).toBe(true);
  });
});

describe('serializeMarkdown - images', () => {
  it('serializes src, alt, and title', () => {
    expect(serialize('<img src="https://e.com/i.png" alt="pic" title="T">').markdown).toBe(
      '![pic](https://e.com/i.png "T")'
    );
    expect(serialize('<img src="https://e.com/i.png">').markdown).toBe(
      '![](https://e.com/i.png)'
    );
  });

  it('escapes double quotes in image titles', () => {
    expect(serialize('<img src="https://e.com/i.png" title=\'a"b\'>').markdown).toBe(
      '![](https://e.com/i.png "a\\"b")'
    );
  });

  it('warns when resize dimensions are lost', () => {
    const { warnings } = serialize('<img src="https://e.com/i.png" width="200">');
    expect(warnings.some((w) => w.code === 'lossy-attribute' && w.nodeType === 'image')).toBe(true);
  });

  it('warns for NUMERIC resize dimensions too', () => {
    const editor = new Editor({ extensions });
    const image = editor.state.schema.nodes['image'];
    if (image === undefined) throw new Error('image type missing');
    const doc = editor.state.schema.topNodeType.create(null, [
      image.create({ src: 'https://e.com/i.png', width: 200 }),
    ]);
    editor.destroy();
    const { warnings } = serializeMarkdown(doc);
    expect(warnings.some((w) => w.code === 'lossy-attribute' && w.nodeType === 'image')).toBe(true);
  });

  it('escapes parentheses in the destination', () => {
    expect(serialize('<img src="https://e.com/a(1).png">').markdown).toBe(
      '![](https://e.com/a\\(1\\).png)'
    );
  });
});

describe('serializeMarkdown - details', () => {
  it('flattens toggles to a bold summary plus content with a warning', () => {
    const { markdown, warnings } = serialize(
      '<details><summary>More</summary><div data-details-content><p>Hidden</p></div></details>'
    );
    expect(markdown).toBe('**More**\n\nHidden');
    expect(warnings.some((w) => w.code === 'lossy-structure' && w.nodeType === 'details')).toBe(
      true
    );
  });
});

describe('serializeMarkdown - inline atoms', () => {
  it('serializes known emoji as their glyph', () => {
    const first = emojis[0];
    if (first === undefined) throw new Error('emoji dataset empty');
    const { markdown } = serialize(
      `<p><span data-type="emoji" data-name="${first.name}"></span></p>`
    );
    expect(markdown).toBe(first.emoji);
  });

  it('falls back to shortcode syntax for unknown emoji names', () => {
    const { markdown } = serialize(
      '<p><span data-type="emoji" data-name="definitely-unknown"></span></p>'
    );
    expect(markdown).toBe(':definitely-unknown:');
  });

  it('serializes mentions as plain text with a warning', () => {
    const { markdown, warnings } = serialize(
      '<p>Hi <span data-type="mention" data-id="1" data-label="ana"></span></p>'
    );
    expect(markdown).toBe('Hi @ana');
    expect(warnings.some((w) => w.nodeType === 'mention')).toBe(true);
  });

  it('serializes math as dollar-delimited LaTeX', () => {
    expect(
      serialize('<p><span data-type="math-inline" data-latex="a^2+b^2"></span></p>').markdown
    ).toBe('$a^2+b^2$');
    expect(serialize('<div data-type="math-block" data-latex="x = 1"></div>').markdown).toBe(
      '$$\nx = 1\n$$'
    );
  });
});
