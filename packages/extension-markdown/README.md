# @domternal/extension-markdown

[![Version](https://img.shields.io/npm/v/@domternal/extension-markdown.svg)](https://www.npmjs.com/package/@domternal/extension-markdown)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/domternal/domternal/blob/main/LICENSE)

Import and export GitHub-flavored Markdown in [Domternal](https://domternal.dev). Convert Markdown pastes into rich content, insert or replace documents through commands, and export `.md` files with warnings for content Markdown cannot represent.

Part of **Domternal Free**, MIT licensed. Supports headings, lists and task lists, blockquotes, code, tables, images, links, common marks and math when their corresponding extensions are installed. Parsing and serialization are also available without an editor instance.

[Documentation](https://domternal.dev/v1/extensions/markdown/) · [Live examples](https://domternal.dev/examples) · [Source](https://github.com/domternal/domternal/tree/main/packages/extension-markdown/src)

## Install

The package declares Node.js 22 or later for tooling.

For a new editor:

```bash
pnpm add @domternal/core @domternal/pm @domternal/theme @domternal/extension-markdown
```

For an existing editor, add `@domternal/extension-markdown`. It requires `@domternal/core` and `@domternal/pm` peers in `>=1.3.0 <2.0.0`. Use version 1.3.1 for all installed Domternal Free packages.

## Quick start

Add the editor and export button to your page:

```html
<div id="editor" class="dm-editor"></div>
<button id="export-markdown" type="button">Export Markdown</button>
```

Initialize the editor in your application's browser entry point:

```ts
import { Editor, StarterKit } from '@domternal/core';
import {
  Markdown,
  getMarkdown,
  downloadMarkdown,
} from '@domternal/extension-markdown';
import '@domternal/theme';

const editor = new Editor({
  element: document.getElementById('editor')!,
  extensions: [StarterKit, Markdown],
});

// Replace the document, then insert at the selection.
editor.commands.setMarkdownContent('# Notes\n\nStart writing here.');
editor.commands.insertMarkdown('**Hello** from Markdown.');

// Serialize without downloading.
const { markdown, warnings } = getMarkdown(editor);
console.log(markdown, warnings);

const exportButton = document.getElementById('export-markdown')!;

function exportMarkdown(): void {
  const result = downloadMarkdown(editor, 'notes.md');
  console.log(result.warnings);
}

exportButton.addEventListener('click', exportMarkdown);

// Call this when your application removes the editor.
function destroyEditor(): void {
  exportButton.removeEventListener('click', exportMarkdown);
  editor.destroy();
}
```

`insertMarkdown` merges a single paragraph at the cursor and inserts larger content as blocks. `setMarkdownContent` replaces the entire document and accepts `SetContentOptions`, for example `{ emitUpdate: false }` as its second argument. `downloadMarkdown` starts a browser download and returns the same `{ markdown, warnings }` result as `getMarkdown`.

StarterKit covers basic text, headings, lists and marks. Add extensions for tables, images, math or other content you need. The parser adapts to the schema: unavailable features fall back to readable content where possible. Typing shortcuts come from individual extensions and do not require this package.

## Markdown paste

Markdown-looking plain text converts automatically. Matching syntax-highlighted source copies, such as a `.md` file copied from VS Code, convert too. Rich HTML, ordinary prose, bare URLs and pastes into code blocks keep their usual handling. Markdown that produces no visible content falls back to its literal text.

Use `Markdown.configure({ paste: false })` to disable conversion. Custom paste handlers can reuse `looksLikeMarkdown(text)`. With [PasteCleanup](https://github.com/domternal/domternal/blob/main/packages/extension-paste-cleanup/README.md), input and markup-token limits run before Markdown expands the text; rejected pastes insert nothing. Neither package imports DOCX files. The [paste guide](https://domternal.dev/v1/extensions/markdown/#markdown-paste) explains source HTML matching, constrained destinations and handler ordering.

## Options

| Option | Default | Purpose |
| --- | --- | --- |
| `paste` | `true` | Convert Markdown-looking plain text and matching source copies on paste. |
| `tightLists` | `true` | Export lists without blank lines between items. |
| `specs` | `null` | Add or replace serializer mappings for custom nodes and marks. |

## Export warnings and fidelity

Always inspect `warnings` when export fidelity matters. Each warning has `code`, `message` and an optional `nodeType`; distinct losses are deduplicated per export.

| Code | Meaning |
| --- | --- |
| `unsupported-node` | An unmapped node is flattened to its content; a leaf without serializable content is omitted. |
| `unsupported-mark` | Unsupported formatting is dropped while text remains. |
| `lossy-attribute` | An attribute cannot be represented, such as alignment, explicit list markers or image dimensions. |
| `lossy-structure` | Structure is simplified, such as merged cells, details blocks or mentions. |

Markdown cannot retain every editor feature. Colors, underline, line height, cell styling and complex tables can lose information. Generated table-of-contents blocks and images without an allowed source are omitted with warnings. Supported content round-trips through the document model; serialization may normalize the original Markdown spelling.

Headings follow the destination's configured levels. Links and images follow its URL policy on import and export. Math needs the math nodes and uses guarded GitHub/GitLab forms when ordinary dollar delimiters would be ambiguous. See the [detailed guide](https://domternal.dev/v1/extensions/markdown/) for mappings, escaping, math, heading rules and [custom serializers](https://domternal.dev/v1/extensions/markdown/#custom-nodes-and-marks).

## Parse and serialize without an editor

Supply a ProseMirror schema. This complete example uses a minimal text-only schema:

```ts
import { Schema } from '@domternal/pm/model';
import {
  parseMarkdown,
  serializeMarkdown,
  createMarkdownParser,
  createMarkdownSerializer,
} from '@domternal/extension-markdown';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    text: { group: 'inline' },
  },
});

const doc = parseMarkdown('Hello Markdown.', schema);
const { markdown, warnings } = serializeMarkdown(doc);

// Reuse these instances when converting repeatedly.
const parser = createMarkdownParser(schema);
const serializer = createMarkdownSerializer();
const result = serializer.serialize(parser.parse('Another paragraph.'));
```

Use your application's schema to retain richer features. One-shot helpers rebuild their parser or serializer on each call. With the extension installed, `editor.storage.markdown.parser` and `.serializer` hold the configured instances after initialization. Custom export mappings work through `Markdown.configure({ specs })` or the `specs` option of `serializeMarkdown`.

## License

[MIT](https://github.com/domternal/domternal/blob/main/LICENSE)
