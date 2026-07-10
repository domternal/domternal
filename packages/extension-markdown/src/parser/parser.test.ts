/**
 * Parser tests: Markdown strings against reference documents built through a
 * real Editor from HTML, compared with `doc.eq`.
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
import { parseMarkdown } from './parser.js';

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

function expectParsed(markdown: string, html: string): void {
  const parsed = parseMarkdown(markdown, schema);
  const expected = docFrom(html);
  expect(parsed.eq(expected), `${markdown}\n\nparsed: ${JSON.stringify(parsed.toJSON())}\n\nexpected: ${JSON.stringify(expected.toJSON())}`).toBe(true);
}

describe('parseMarkdown - blocks', () => {
  it('parses headings and paragraphs', () => {
    expectParsed('# Title\n\nBody.', '<h1>Title</h1><p>Body.</p>');
  });

  it('parses blockquotes', () => {
    expectParsed('> a\n>\n> b', '<blockquote><p>a</p><p>b</p></blockquote>');
  });

  it('parses fenced code with language and indented code', () => {
    expectParsed('```ts\nconst a = 1;\n```', '<pre><code class="language-ts">const a = 1;</code></pre>');
    expectParsed('    indented', '<pre><code>indented</code></pre>');
  });

  it('parses horizontal rules and hard breaks', () => {
    expectParsed('a\n\n---\n\nb', '<p>a</p><hr><p>b</p>');
    expectParsed('one\\\ntwo', '<p>one<br>two</p>');
  });

  it('joins soft-wrapped lines with a space', () => {
    expectParsed('one\ntwo', '<p>one two</p>');
  });

  it('parses an empty string to an empty document', () => {
    const parsed = parseMarkdown('', schema);
    expect(parsed.childCount).toBe(1);
    expect(parsed.firstChild?.type.name).toBe('paragraph');
    expect(parsed.firstChild?.content.size).toBe(0);
  });
});

describe('parseMarkdown - lists', () => {
  it('parses bullet and nested lists', () => {
    expectParsed('- a\n- b', '<ul><li><p>a</p></li><li><p>b</p></li></ul>');
    expectParsed('- a\n  - b', '<ul><li><p>a</p><ul><li><p>b</p></li></ul></li></ul>');
  });

  it('parses ordered lists with a start attribute', () => {
    expectParsed('3. x\n4. y', '<ol start="3"><li><p>x</p></li><li><p>y</p></li></ol>');
  });

  it('converts checkbox-only bullet lists to task lists', () => {
    expectParsed(
      '- [x] done\n- [ ] open',
      '<ul data-type="taskList">' +
        '<li data-type="taskItem" data-checked="true"><p>done</p></li>' +
        '<li data-type="taskItem" data-checked="false"><p>open</p></li>' +
        '</ul>'
    );
  });

  it('keeps mixed lists as bullet lists with literal markers', () => {
    const parsed = parseMarkdown('- [x] done\n- plain', schema);
    expect(parsed.firstChild?.type.name).toBe('bulletList');
    expect(parsed.textContent).toContain('[x] done');
  });

  it('converts a bare checkbox marker without trailing text', () => {
    const parsed = parseMarkdown('- [x]\n- [ ] open', schema);
    expect(parsed.firstChild?.type.name).toBe('taskList');
    expect(parsed.firstChild?.firstChild?.attrs['checked']).toBe(true);
    expect(parsed.firstChild?.firstChild?.textContent).toBe('');
  });

  it('does not convert markers wrapped in marks', () => {
    const parsed = parseMarkdown('- **[x] done**', schema);
    expect(parsed.firstChild?.type.name).toBe('bulletList');
    expect(parsed.textContent).toBe('[x] done');
  });

  it('converts nested task lists', () => {
    const parsed = parseMarkdown('- [ ] outer\n  - [x] inner', schema);
    const outer = parsed.firstChild;
    expect(outer?.type.name).toBe('taskList');
    expect(outer?.firstChild?.type.name).toBe('taskItem');
    expect(outer?.firstChild?.lastChild?.type.name).toBe('taskList');
  });
});

describe('parseMarkdown - inline', () => {
  it('parses emphasis, strike, and inline code', () => {
    expectParsed(
      '**b** *i* ~~s~~ `c`',
      '<p><strong>b</strong> <em>i</em> <s>s</s> <code>c</code></p>'
    );
    expectParsed('***x***', '<p><strong><em>x</em></strong></p>');
  });

  it('parses links, autolinks, and bare URLs', () => {
    expectParsed('[t](https://x.com/ "T")', '<p><a href="https://x.com/" title="T">t</a></p>');
    expectParsed('<https://x.com/>', '<p><a href="https://x.com/">https://x.com/</a></p>');
    expectParsed(
      'Visit https://x.com/ now',
      '<p>Visit <a href="https://x.com/">https://x.com/</a> now</p>'
    );
  });

  it('unescapes backslash escapes', () => {
    expectParsed('\\*not bold\\*', '<p>*not bold*</p>');
  });
});

describe('parseMarkdown - tables', () => {
  it('parses pipe tables with header and alignment', () => {
    expectParsed(
      '| A | B |\n| --- | :---: |\n| 1 | 2 |',
      '<table>' +
        '<tr><th>A</th><th data-text-align="center">B</th></tr>' +
        '<tr><td>1</td><td data-text-align="center">2</td></tr>' +
        '</table>'
    );
  });

  it('keeps inline marks and escaped pipes inside cells', () => {
    expectParsed(
      '| H |\n| --- |\n| **a\\|b** |',
      '<table><tr><th>H</th></tr><tr><td><strong>a|b</strong></td></tr></table>'
    );
  });
});

describe('parseMarkdown - images', () => {
  it('parses a lone image paragraph as a block image without empty paragraphs', () => {
    const parsed = parseMarkdown('![pic](https://e.com/i.png "T")', schema);
    expect(parsed.childCount).toBe(1);
    expect(parsed.firstChild?.type.name).toBe('image');
    expect(parsed.firstChild?.attrs['alt']).toBe('pic');
    expect(parsed.firstChild?.attrs['title']).toBe('T');
  });

  it('splits a paragraph around an inline-positioned image', () => {
    const parsed = parseMarkdown('before ![x](https://e.com/i.png) after', schema);
    const names: string[] = [];
    parsed.forEach((child) => names.push(child.type.name));
    expect(names).toEqual(['paragraph', 'image', 'paragraph']);
    expect(parsed.child(0).textContent).toBe('before ');
    expect(parsed.child(2).textContent).toBe(' after');
  });
});

describe('parseMarkdown - math', () => {
  function inlineLatex(parsed: PMNode): string | null {
    let latex: string | null = null;
    parsed.descendants((node) => {
      if (node.type.name === 'mathInline') latex = String(node.attrs['latex']);
      return true;
    });
    return latex;
  }

  it('parses inline math', () => {
    expect(inlineLatex(parseMarkdown('Euler: $e^{i\\pi}+1=0$ wow', schema))).toBe('e^{i\\pi}+1=0');
  });

  it('does not treat currency as math', () => {
    const parsed = parseMarkdown('costs $5 and $10 total', schema);
    expect(parsed.textContent).toBe('costs $5 and $10 total');
  });

  it('does not let a currency dollar swallow later math', () => {
    const parsed = parseMarkdown('price $5 and math $x$ here', schema);
    expect(inlineLatex(parsed)).toBe('x');
    expect(parsed.textContent.startsWith('price $5 and math ')).toBe(true);
  });

  it('rejects whitespace-delimited dollars', () => {
    const parsed = parseMarkdown('a $ b $ c', schema);
    expect(inlineLatex(parsed)).toBeNull();
    expect(parsed.textContent).toBe('a $ b $ c');
  });

  it('keeps escaped dollars inside a formula', () => {
    expect(inlineLatex(parseMarkdown('$a\\$b$ tail', schema))).toBe('a\\$b');
  });

  it('parses block math in both forms', () => {
    for (const md of ['$$\nx = 1\n$$', '$$x = 1$$']) {
      const parsed = parseMarkdown(md, schema);
      expect(parsed.firstChild?.type.name).toBe('mathBlock');
      expect(parsed.firstChild?.attrs['latex']).toBe('x = 1');
    }
  });

  it('lets block math interrupt a paragraph', () => {
    const parsed = parseMarkdown('text\n$$\nx = 1\n$$', schema);
    expect(parsed.childCount).toBe(2);
    expect(parsed.child(0).textContent).toBe('text');
    expect(parsed.child(1).type.name).toBe('mathBlock');
  });
});

describe('parseMarkdown - graceful degradation', () => {
  const minimal = [Document, Text, Paragraph, Bold, Italic];

  function schemaFor(list: typeof minimal): Schema {
    const scoped = new Editor({ extensions: list });
    const result = scoped.state.schema;
    scoped.destroy();
    return result;
  }

  function minimalSchema(): Schema {
    return schemaFor(minimal);
  }

  it('does not crash with only one of the two math nodes', () => {
    const inlineOnly = schemaFor([...minimal, MathInline]);
    const blockMd = '$$\nx = 1\n$$';
    expect(parseMarkdown(blockMd, inlineOnly).textContent).toContain('x = 1');

    const blockOnly = schemaFor([...minimal, MathBlock]);
    const parsed = parseMarkdown('inline $x$ here', blockOnly);
    expect(parsed.textContent).toBe('inline $x$ here');
  });

  it('degrades tables to text when the cell types are incomplete', () => {
    const partial = schemaFor([...minimal, Table, TableRow, TableCell]);
    const parsed = parseMarkdown('| A |\n| --- |\n| 1 |', partial);
    expect(parsed.textContent).toContain('A');
    expect(parsed.textContent).toContain('1');
  });

  it('keeps unsupported syntax as readable text', () => {
    const scopedSchema = minimalSchema();
    const parsed = parseMarkdown('~~strike~~ and `code`', scopedSchema);
    expect(parsed.textContent).toBe('~~strike~~ and code');
  });

  it('degrades headings to paragraphs when the schema lacks them', () => {
    const scopedSchema = minimalSchema();
    const parsed = parseMarkdown('# Title', scopedSchema);
    expect(parsed.firstChild?.type.name).toBe('paragraph');
    expect(parsed.textContent).toBe('Title');
  });
});
