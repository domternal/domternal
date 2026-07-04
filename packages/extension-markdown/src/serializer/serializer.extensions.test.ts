/**
 * Serializer tests over the extension packages: tables, images, details,
 * emoji, mentions, and math.
 */
import { describe, expect, it } from 'vitest';
import {
  Bold,
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
    expect(warnings.some((w) => w.code === 'lossy-attribute')).toBe(true);
  });

  it('warns when merged cells lose their spans', () => {
    const { warnings } = serialize(
      '<table><tr><th colspan="2">wide</th></tr><tr><td>a</td><td>b</td></tr></table>'
    );
    expect(
      warnings.some((w) => w.code === 'lossy-attribute' && w.message.includes('Merged'))
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

  it('warns when resize dimensions are lost', () => {
    const { warnings } = serialize('<img src="https://e.com/i.png" width="200">');
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
    expect(warnings.some((w) => w.code === 'lossy-attribute' && w.nodeType === 'details')).toBe(
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
