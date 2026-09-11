# @domternal/extension-markdown

[![Version](https://img.shields.io/npm/v/@domternal/extension-markdown.svg)](https://www.npmjs.com/package/@domternal/extension-markdown)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/domternal/domternal/blob/main/LICENSE)

Bidirectional Markdown for the [Domternal](https://domternal.dev) editor: parse GitHub-flavored Markdown into the document and serialize the document back to Markdown, covering the full Notion-style schema.

- **Import**: `insertMarkdown` / `setMarkdownContent` commands, plus automatic conversion of Markdown-looking plain-text pastes (opt-out).
- **Export**: `getMarkdown(editor)` and a `downloadMarkdown` helper, with a warning channel for anything Markdown cannot express (alignment, colors, explicit list markers, merged table cells).
- **Headless**: `parseMarkdown` / `serializeMarkdown` work against any schema without an editor instance.
- Coverage: headings, lists (bullet, ordered with start, GFM task lists), blockquotes, fenced code with language, tables with column alignment, images, links and autolinks, bold/italic/strike/inline code, hard breaks, LaTeX math (`$...$`, `$$` blocks, and GitHub's `` $`...`$ `` and `math` fences), emoji glyphs.

## Links

<u>[Website](https://domternal.dev)</u> &nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp; <u>[Documentation](https://domternal.dev/v1/extensions/markdown)</u> &nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp; <u>[Live examples](https://domternal.dev/examples)</u>

## Install

```bash
pnpm add @domternal/extension-markdown
```

`@domternal/core` and `@domternal/pm` are peer dependencies.

Version 1.2.0 requires both `@domternal/core` and `@domternal/pm` in the range
`>=1.2.0 <2.0.0`. Upgrade these packages together with this extension.

## Usage

```ts
import { Editor } from '@domternal/core';
import { Markdown, getMarkdown, downloadMarkdown } from '@domternal/extension-markdown';

const editor = new Editor({
  extensions: [/* your extensions */, Markdown],
});

// Import
editor.commands.insertMarkdown('## Hello\n\n- [x] done\n- [ ] open');
editor.commands.setMarkdownContent('# Fresh document');
// A second argument takes SetContentOptions, e.g. to replace without firing `update`
editor.commands.setMarkdownContent('# Silent replace', { emitUpdate: false });

// Export
const { markdown, warnings } = getMarkdown(editor);
// downloadMarkdown saves the file and returns the same result, warnings included
const saved = downloadMarkdown(editor, 'notes.md');
```

Markdown-looking plain-text pastes convert automatically. Syntax-highlighted source copies, such as Markdown copied from VS Code, convert too when their HTML contains only source wrappers (`pre`, `div`, `span`, `br`), preserves whitespace, and matches the clipboard's plain text. HTML display formatting may expand tabs, but the original Markdown and its indentation are used for parsing. HTML with rich-text elements or editor metadata, copied editor code blocks, plain prose, and pastes into code blocks keep their usual handling. Disable with `Markdown.configure({ paste: false })`. The test the plugin applies is exported as `looksLikeMarkdown(text)`, so a handler that takes over the paste path can reuse the same heuristic.

Headings follow the editor's `Heading` `levels`, as HTML and JSON content do. Import places a
level the configuration lacks at the nearest configured level, so with levels 1 to 4 a
`#####` heading becomes a level 4 heading, and export writes each heading at the level it
renders at, so the Markdown matches `getHTML()` even for a level stored by a collaborator
configured with more levels. A heading node that does not use `Heading`'s level rules keeps
the level as written. A heading where one cannot stand, such as `- # Title` at the start of a
list item, whose first block is a paragraph, imports as that item's text, as HTML does, so the
item holds no empty paragraph before a heading.

## Options

| Option | Default | Description |
| --- | --- | --- |
| `paste` | `true` | Convert Markdown-looking plain-text pastes into rich content. |
| `tightLists` | `true` | Serialize lists without blank lines between items. |
| `specs` | `null` | Extra or replacement Markdown mappings for custom nodes and marks. |

## Headless usage

```ts
import {
  parseMarkdown,
  serializeMarkdown,
  createMarkdownParser,
  createMarkdownSerializer,
} from '@domternal/extension-markdown';

const doc = parseMarkdown('# Title', schema);
const { markdown, warnings } = serializeMarkdown(doc);

// Both one-shot helpers rebuild their machinery on every call. Build the
// instances once when converting repeatedly.
const parser = createMarkdownParser(schema);
const serializer = createMarkdownSerializer();
const result = serializer.serialize(parser.parse('# Title'));
```

With the extension loaded the editor already holds one of each at
`editor.storage.markdown.parser` and `editor.storage.markdown.serializer`, so a
companion package can reuse them instead of building its own.

Custom nodes without a mapping degrade gracefully: content is preserved as plain text and a warning is reported instead of failing. Custom mappings plug in via `Markdown.configure({ specs })` or the `specs` option of `serializeMarkdown`.

## Links and images

Markdown follows the same URL policy as the editor (`checkUrl` and `isSupportedAttributeValue` from
`@domternal/core`), so an import or export never carries an address the editor itself would not
store or render.

- Parsing opens a link only for an href the schema's `Link` keeps with its `protocols` and
  `allowRelative`: `[a](#intro)` and `[a](/docs/page)` become links by default, while
  `[a](ftp://x)`, `[a](//host/x)`, `[a](data:image/png;base64,...)` and a link with credentials
  keep their text without a link. An image whose source the `Image` would not load, such as a
  `data:` image with `allowBase64: false`, keeps its alternative text. markdown-it's own check still refuses `javascript:`, `vbscript:` and `file:`
  first. Markdown pastes behave the same.
- Serializing writes a link the editor would not render, such as a stored `javascript:` href or one
  a collaborator wrote, as its text with a `lossy-attribute` warning, and omits such an image with
  an `unsupported-node` warning. An allowed href is written in its cleaned spelling.
- Destinations write an `&` that starts a character reference, such as `&colon;` or `&#106;`, as
  `&amp;`: renderers decode it once into the stored `&`, so the reference stays text and a query
  such as `?q=x&copy;y` keeps its meaning. They also percent-encode `<`, `>` and every space, a
  Unicode one such as U+00A0 or U+3000 too, which some renderers read as the end of the
  destination (`%3C`, `%3E`, `%20`, `%E3%80%80`), and escape `\`, `(`, `)` and `"` with a backslash.
  Titles are written on one line, with `\`, `"`, `<` and `>` escaped with a backslash and an `&`
  that starts a character reference written as `&amp;`, as in destinations, so every renderer,
  marked included, shows the stored title.
- The `<url>` autolink form is used only for `http:`, `https:` and `mailto:` links whose text is
  their href; any other link, such as `tel:`, is written as `[text](href)`.

## Math

Inline math is written as `$latex$` and block math between `$$` lines. LaTeX is written as it is
stored, so when it holds something that could end the math early or read as Markdown in a renderer
without math, the serializer uses the forms GitHub and GitLab read as math instead, which no LaTeX
can close and every other renderer shows as code:

- inline math as `` $`latex`$ `` (with a longer backtick run when the LaTeX holds backticks) when it
  holds a `$`, a backtick, a `<` that opens a tag, comment or autolink (an email autolink such as
  `<1@example.com>` too, whose first character need not be a letter), a `](` or `][`, a space at
  either end or a `\` at the end, or when a digit follows it, which parsers take for currency.
  Line breaks are written as spaces, as TeX reads them in math;
- block math as a `math` code fence when it holds a `$$`, a backtick, a `<` that opens a tag or
  autolink, a `](` or `][`, a `]:`, which ends the label of every link reference definition, also
  one in a quote or a list item, that any `[label]` of the export would link to, or a line that
  starts with `~~~`.

Empty inline math is omitted with a `lossy-structure` warning. The parser reads both forms back into
the math nodes; a `math` fence becomes block math only when the schema has it.

## Fidelity notes

Markdown cannot express everything the editor can. The serializer keeps the content and reports a warning for: text alignment and line height, an explicit list marker (`listStyleType`, such as `upper-roman` or `square`, written as `1.` or `-`), text and background colors, underline, merged table cells, multi-block table cells, table cell background and vertical alignment, image resize dimensions, toggle (details) structure, and mentions. Two cases drop the content instead of keeping it, each with its own warning: an image without a `src`, and a table of contents block (generated content). Round trips of the supported subset, which leaves out everything these warnings report, are exact and covered by tests.

## License

MIT
