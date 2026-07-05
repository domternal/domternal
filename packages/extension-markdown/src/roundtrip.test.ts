/**
 * Round-trip suite: serialize(parse(md)) must reproduce the Markdown exactly
 * for the supported subset, and parse(serialize(doc)) must rebuild an equal
 * document for editor-built content.
 */
import { afterAll, describe, expect, it } from 'vitest';
import {
  Blockquote,
  Bold,
  BulletList,
  Code,
  CodeBlock,
  Document,
  Editor,
  HardBreak,
  Heading,
  HorizontalRule,
  Italic,
  Link,
  ListItem,
  OrderedList,
  Paragraph,
  Strike,
  TaskItem,
  TaskList,
  Text,
} from '@domternal/core';
import { Image } from '@domternal/extension-image';
import { MathBlock, MathInline } from '@domternal/extension-math';
import { Table, TableCell, TableHeader, TableRow } from '@domternal/extension-table';
import { DOMParser as PMDOMParser } from '@domternal/pm/model';
import type { Node as PMNode, Schema } from '@domternal/pm/model';
import { parseMarkdown } from './parser/parser.js';
import { serializeMarkdown } from './serializer/serializer.js';

const extensions = [
  Document,
  Text,
  Paragraph,
  Heading,
  Blockquote,
  CodeBlock,
  BulletList,
  OrderedList,
  ListItem,
  TaskList,
  TaskItem,
  HorizontalRule,
  HardBreak,
  Bold,
  Italic,
  Strike,
  Code,
  Link,
  Table,
  TableRow,
  TableCell,
  TableHeader,
  Image,
  MathInline,
  MathBlock,
];

const editor = new Editor({ extensions });
const schema: Schema = editor.state.schema;
afterAll(() => {
  editor.destroy();
});

// Reference docs must be built in the SAME schema instance the parser uses:
// doc.eq compares node types by identity, not by name.
function docFrom(html: string): PMNode {
  const container = document.createElement('div');
  container.innerHTML = html;
  return PMDOMParser.fromSchema(schema).parse(container);
}

const FIXTURE = [
  '# Title',
  '',
  'Intro with **bold**, *italic*, ~~strike~~, `code`, and [link](https://x.com/ "T").',
  '',
  'Or <https://x.com/> plain, one\\',
  'two.',
  '',
  '- one',
  '- two',
  '  - nested',
  '',
  '1. first',
  '2. second',
  '',
  '- [x] done',
  '- [ ] open',
  '',
  '> quoted',
  '',
  '```ts',
  'const a = 1;',
  '```',
  '',
  '| A | B |',
  '| --- | :---: |',
  '| 1 | **2** |',
  '',
  '![pic](https://e.com/i.png "T")',
  '',
  '---',
  '',
  '$$',
  'x = 1',
  '$$',
  '',
  'Inline $a^2$ math.',
].join('\n');

describe('markdown round trip', () => {
  it('serialize(parse(md)) reproduces the fixture exactly', () => {
    const doc = parseMarkdown(FIXTURE, schema);
    const { markdown, warnings } = serializeMarkdown(doc);
    expect(markdown).toBe(FIXTURE);
    expect(warnings).toEqual([]);
  });

  it('parse(serialize(doc)) rebuilds an equal document', () => {
    const original = docFrom(
      '<h2>Round</h2>' +
        '<p><strong>bold</strong> and <em>italic</em> with <a href="https://x.com/">link</a></p>' +
        '<ul><li><p>a</p></li><li><p>b</p><ul><li><p>c</p></li></ul></li></ul>' +
        '<ol start="2"><li><p>two</p></li></ol>' +
        '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>t</p></li></ul>' +
        '<blockquote><p>q</p></blockquote>' +
        '<pre><code class="language-js">x()</code></pre>' +
        '<table><tr><th>H</th></tr><tr><td>c</td></tr></table>' +
        '<img src="https://e.com/i.png" alt="a">' +
        '<hr>' +
        '<p>end</p>'
    );
    const { markdown, warnings } = serializeMarkdown(original);
    expect(warnings).toEqual([]);
    const rebuilt = parseMarkdown(markdown, schema);
    expect(
      rebuilt.eq(original),
      `md:\n${markdown}\n\nrebuilt: ${JSON.stringify(rebuilt.toJSON())}\n\noriginal: ${JSON.stringify(original.toJSON())}`
    ).toBe(true);
  });

  it('escaped literals survive a full round trip', () => {
    const original = docFrom('<p># not heading, *not bold*, a|b, 1. not list</p>');
    const { markdown } = serializeMarkdown(original);
    expect(parseMarkdown(markdown, schema).eq(original)).toBe(true);
  });
});
