/**
 * Serializer tests over the core schema. Documents are built through a real
 * Editor (jsdom) from HTML, then serialized headlessly from the state doc.
 */
import { describe, expect, it } from 'vitest';
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
  Node,
  OrderedList,
  Paragraph,
  Strike,
  TaskItem,
  TaskList,
  Text,
  TextAlign,
  Underline,
} from '@domternal/core';
import type { Node as PMNode } from '@domternal/pm/model';
import { serializeMarkdown } from './serializer.js';
import type { SerializeMarkdownOptions } from './serializer.js';

const Widget = Node.create({
  name: 'widget',
  group: 'block',
  atom: true,
  parseHTML() {
    return [{ tag: 'div[data-type="widget"]' }];
  },
  renderHTML() {
    return ['div', { 'data-type': 'widget' }];
  },
});

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
  Underline,
  TextAlign,
  Widget,
];

function docFrom(content: string): PMNode {
  const editor = new Editor({ extensions, content });
  const doc = editor.state.doc;
  editor.destroy();
  return doc;
}

function md(content: string, options?: SerializeMarkdownOptions): string {
  return serializeMarkdown(docFrom(content), options).markdown;
}

describe('serializeMarkdown - blocks', () => {
  it('serializes paragraphs and headings', () => {
    expect(md('<h1>Title</h1><p>Body text.</p>')).toBe('# Title\n\nBody text.');
    expect(md('<h3>Sub</h3>')).toBe('### Sub');
  });

  it('serializes blockquotes with nested blocks', () => {
    expect(md('<blockquote><p>a</p><p>b</p></blockquote>')).toBe('> a\n>\n> b');
  });

  it('serializes code blocks with language and fence escalation', () => {
    expect(md('<pre><code class="language-ts">const a = 1;</code></pre>')).toBe(
      '```ts\nconst a = 1;\n```'
    );
    expect(md('<pre><code>a\n```\nb</code></pre>')).toBe('````\na\n```\nb\n````');
  });

  it('serializes horizontal rules between blocks', () => {
    expect(md('<p>a</p><hr><p>b</p>')).toBe('a\n\n---\n\nb');
  });

  it('serializes hard breaks as backslash newlines, skipping trailing ones', () => {
    expect(md('<p>a<br>b</p>')).toBe('a\\\nb');
    expect(md('<p>a<br></p>')).toBe('a');
  });
});

describe('serializeMarkdown - lists', () => {
  it('serializes tight bullet lists by default', () => {
    expect(md('<ul><li><p>a</p></li><li><p>b</p></li></ul>')).toBe('- a\n- b');
  });

  it('supports loose lists via tightLists: false', () => {
    expect(md('<ul><li><p>a</p></li><li><p>b</p></li></ul>', { tightLists: false })).toBe(
      '- a\n\n- b'
    );
  });

  it('serializes nested lists with indentation', () => {
    expect(md('<ul><li><p>a</p><ul><li><p>b</p></li></ul></li></ul>')).toBe('- a\n  - b');
  });

  it('serializes ordered lists honoring the start attribute', () => {
    expect(md('<ol><li><p>x</p></li><li><p>y</p></li></ol>')).toBe('1. x\n2. y');
    expect(md('<ol start="3"><li><p>x</p></li></ol>')).toBe('3. x');
  });

  it('serializes task lists with GFM checkboxes', () => {
    expect(
      md(
        '<ul data-type="taskList">' +
          '<li data-type="taskItem" data-checked="true"><p>done</p></li>' +
          '<li data-type="taskItem" data-checked="false"><p>open</p></li>' +
          '</ul>'
      )
    ).toBe('- [x] done\n- [ ] open');
  });

  it('keeps extra blocks of a list item indented under the marker', () => {
    expect(md('<ul><li><p>label</p><p>child</p></li></ul>')).toBe('- label\n\n  child');
  });
});

describe('serializeMarkdown - inline marks', () => {
  it('serializes bold, italic, and strike', () => {
    expect(md('<p><strong>b</strong> <em>i</em> <s>s</s></p>')).toBe('**b** *i* ~~s~~');
  });

  it('nests marks with shared delimiters', () => {
    expect(md('<p><strong><em>x</em></strong></p>')).toBe('***x***');
  });

  it('expels enclosing whitespace out of mark delimiters', () => {
    expect(md('<p>a<strong> b </strong>c</p>')).toBe('a **b** c');
  });

  it('serializes inline code, escalating backticks', () => {
    expect(md('<p><code>plain</code></p>')).toBe('`plain`');
    expect(md('<p><code>a`b</code></p>')).toBe('``a`b``');
  });

  it('serializes links with optional title and autolinks bare URLs', () => {
    expect(md('<p><a href="https://x.com/">t</a></p>')).toBe('[t](https://x.com/)');
    expect(md('<p><a href="https://x.com/" title="T">t</a></p>')).toBe('[t](https://x.com/ "T")');
    expect(md('<p><a href="https://x.com/">https://x.com/</a></p>')).toBe('<https://x.com/>');
  });

  it('escapes double quotes in link titles', () => {
    expect(md('<p><a href="https://x.com/" title=\'a"b\'>t</a></p>')).toBe(
      '[t](https://x.com/ "a\\"b")'
    );
  });

  it('escapes backslashes in link titles and destinations', () => {
    // `\` before `"` must double-escape so re-parse cannot un-escape the quote.
    expect(md('<p><a href="https://x.com/" title=\'a\\"b\'>t</a></p>')).toBe(
      '[t](https://x.com/ "a\\\\\\"b")'
    );
    expect(md('<p><a href="https://x.com/a\\b">t</a></p>')).toBe('[t](https://x.com/a\\\\b)');
  });

  it('closes marks before a trailing hard break', () => {
    expect(md('<p><strong>a<br></strong>b</p>')).toBe('**a**\\\nb');
  });

  it('keeps marks open across whitespace-only nodes', () => {
    expect(md('<p><strong>a<em> </em>b</strong></p>')).toBe('**a b**');
  });
});

describe('serializeMarkdown - escaping', () => {
  it('escapes markdown syntax in plain text', () => {
    expect(md('<p>*not bold*</p>')).toBe('\\*not bold\\*');
    expect(md('<p>a[b]c</p>')).toBe('a\\[b\\]c');
  });

  it('start-of-line escapes the first line of list items', () => {
    expect(md('<ul><li><p>2. fake</p></li></ul>')).toBe('- 2\\. fake');
    expect(md('<ol><li><p># fake</p></li></ol>')).toBe('1. \\# fake');
  });

  it('escapes an exclamation mark directly before a link', () => {
    expect(md('<p>Wow!<a href="https://x.com/">link</a></p>')).toBe(
      'Wow\\![link](https://x.com/)'
    );
  });

  it('escapes dollars, angle brackets, and entity-like ampersands', () => {
    expect(md('<p>5 &lt; 6 and $7</p>')).toBe('5 \\< 6 and \\$7');
    expect(md('<p>AT&amp;T</p>')).toBe('AT\\&T');
  });

  it('escapes block markers at line start only', () => {
    expect(md('<p># not a heading</p>')).toBe('\\# not a heading');
    expect(md('<p>1. not a list</p>')).toBe('1\\. not a list');
    expect(md('<p>5 + 3</p>')).toBe('5 + 3');
  });

  it('keeps intra-word underscores unescaped', () => {
    expect(md('<p>snake_case_name</p>')).toBe('snake_case_name');
  });
});

describe('serializeMarkdown - fidelity warnings', () => {
  it('drops marks without a mapping and warns once', () => {
    const result = serializeMarkdown(docFrom('<p><u>a</u> and <u>b</u></p>'));
    expect(result.markdown).toBe('a and b');
    const dropped = result.warnings.filter((w) => w.code === 'unsupported-mark');
    expect(dropped).toHaveLength(1);
    expect(dropped[0]?.nodeType).toBe('underline');
  });

  it('flattens nodes without a mapping and warns', () => {
    const result = serializeMarkdown(docFrom('<p>a</p><div data-type="widget"></div><p>b</p>'));
    expect(result.markdown).toBe('a\n\nb');
    expect(result.warnings.some((w) => w.code === 'unsupported-node' && w.nodeType === 'widget')).toBe(
      true
    );
  });

  it('warns about non-default text alignment', () => {
    const result = serializeMarkdown(docFrom('<p style="text-align: center">c</p>'));
    expect(result.markdown).toBe('c');
    expect(result.warnings.some((w) => w.code === 'lossy-attribute')).toBe(true);
  });

  it('reports no warnings for fully representable content', () => {
    const result = serializeMarkdown(docFrom('<h2>Hi</h2><p><strong>bold</strong></p>'));
    expect(result.warnings).toEqual([]);
  });
});

describe('serializeMarkdown - hardening', () => {
  it('sanitizes hostile code block language attrs', () => {
    const editor = new Editor({
      extensions,
      content: {
        type: 'doc',
        content: [
          {
            type: 'codeBlock',
            attrs: { language: 'js `evil' },
            content: [{ type: 'text', text: 'x' }],
          },
        ],
      },
    });
    const doc = editor.state.doc;
    editor.destroy();
    expect(serializeMarkdown(doc).markdown).toBe('```js\nx\n```');
  });

  it('serializes a lone textblock node as its inline content', () => {
    const paragraph = docFrom('<p><strong>x</strong> y</p>').firstChild;
    if (paragraph === null) throw new Error('paragraph missing');
    expect(serializeMarkdown(paragraph).markdown).toBe('**x** y');
  });
});
