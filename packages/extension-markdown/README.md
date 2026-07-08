# @domternal/extension-markdown

[![Version](https://img.shields.io/npm/v/@domternal/extension-markdown.svg)](https://www.npmjs.com/package/@domternal/extension-markdown)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/domternal/domternal/blob/main/LICENSE)

Bidirectional Markdown for the [Domternal](https://domternal.dev) editor: parse GitHub-flavored Markdown into the document and serialize the document back to Markdown, covering the full Notion-style schema.

- **Import**: `insertMarkdown` / `setMarkdownContent` commands, plus automatic conversion of Markdown-looking plain-text pastes (opt-out).
- **Export**: `getMarkdown(editor)` and a `downloadMarkdown` helper, with a warning channel for anything Markdown cannot express (alignment, colors, merged table cells).
- **Headless**: `parseMarkdown` / `serializeMarkdown` work against any schema without an editor instance.
- Coverage: headings, lists (bullet, ordered with start, GFM task lists), blockquotes, fenced code with language, tables with column alignment, images, links and autolinks, bold/italic/strike/inline code, hard breaks, LaTeX math (`$...$`, `$$` blocks), emoji glyphs.

## Links

<u>[Website](https://domternal.dev)</u> &nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp; <u>[Documentation](https://domternal.dev/v1/extensions/markdown)</u> &nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp; <u>[Live examples](https://domternal.dev/examples)</u>

## Install

```bash
pnpm add @domternal/extension-markdown
```

`@domternal/core` and `@domternal/pm` are peer dependencies.

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

// Export
const { markdown, warnings } = getMarkdown(editor);
downloadMarkdown(editor, 'notes.md');
```

Markdown-looking plain-text pastes convert automatically. Pastes that carry an HTML flavor, plain prose, and pastes into code blocks are never touched. Disable with `Markdown.configure({ paste: false })`.

## Options

| Option | Default | Description |
| --- | --- | --- |
| `paste` | `true` | Convert Markdown-looking plain-text pastes into rich content. |
| `tightLists` | `true` | Serialize lists without blank lines between items. |
| `specs` | `null` | Extra or replacement Markdown mappings for custom nodes and marks. |

## Headless usage

```ts
import { parseMarkdown, serializeMarkdown } from '@domternal/extension-markdown';

const doc = parseMarkdown('# Title', schema);
const { markdown, warnings } = serializeMarkdown(doc);
```

Custom nodes without a mapping degrade gracefully: content is preserved as plain text and a warning is reported instead of failing. Custom mappings plug in via `Markdown.configure({ specs })` or the `specs` option of `serializeMarkdown`.

## Fidelity notes

Markdown cannot express everything the editor can. The serializer keeps the content and reports a warning for: text alignment and line height, text and background colors, underline, merged table cells, multi-block table cells, image resize dimensions, toggle (details) structure, and mentions. Round trips of the supported subset are exact and covered by tests.

## License

MIT
