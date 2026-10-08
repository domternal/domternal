# @domternal/core

[![Version](https://img.shields.io/npm/v/@domternal/core.svg)](https://www.npmjs.com/package/@domternal/core)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/domternal/domternal/blob/main/LICENSE)

The headless editor engine for [Domternal](https://domternal.dev), built on
ProseMirror. Use it directly in JavaScript or TypeScript, or through the Angular,
React, Vue and Vanilla wrappers. It provides the `Editor` class, composable
extensions, chainable commands, document serialization and server-side helpers.

[Documentation](https://domternal.dev/v1/guides/editor-api/) · [Getting started](https://domternal.dev/v1/getting-started/) · [Examples](https://domternal.dev/examples)

## Install

The package declares Node.js 22 or later for tooling.

```bash
pnpm add @domternal/core
```

Core has no framework dependency and includes `@domternal/pm`. Use version 1.3.1
for all installed Domternal packages. Their 1.3.x peer compatibility range remains
`>=1.3.0 <2.0.0`; Core 1.3.1 requires PM `>=1.3.1 <2.0.0` at runtime so its
dependency fixes are included.
Import ProseMirror primitives from `@domternal/pm/*` to keep
[one shared copy](https://domternal.dev/v1/guides/single-prosemirror-copy/).

For ready-made editor styling, also install `@domternal/theme` and import it from
your application entry point, with `class="dm-editor"` on the mount or an ancestor.
Core itself ships no CSS, toolbar or framework UI.

## Quick start

Add a mount element to your page:

```html
<div id="editor"></div>
```

Then create the editor in your browser entry point:

```ts
import { Editor, StarterKit } from '@domternal/core';

const editor = new Editor({
  element: document.getElementById('editor')!,
  extensions: [StarterKit],
  content: '<p>Hello <strong>world</strong>!</p>',
});

editor.on('update', () => {
  console.log(editor.getJSON());
});
```

`StarterKit` includes paragraphs, headings, lists, tasks, links, common text marks,
history and editing keymaps. It does not include tables, images, Office paste
cleanup or other optional extension packages.

Read or change the document through the same instance:

```ts
editor.chain().focus().toggleBold().run();
editor.commands.insertContent('<p>Another paragraph</p>');

const json = editor.getJSON();
const html = editor.getHTML();
const text = editor.getText();
```

Call `editor.destroy()` when removing the editor from your application. Framework
wrappers manage the lifetime of the instances they create.

## Choose your extensions

Configure or disable individual StarterKit features:

```ts
StarterKit.configure({
  heading: { levels: [1, 2, 3] },
  link: { openOnClick: false },
  codeBlock: false,
});
```

Pass the configured StarterKit in place of `StarterKit` in `extensions`. Headings
support levels 1 to 4 by default. `listIndent` is off by default because enabling
it also captures Tab in a paragraph immediately after a list.

For a smaller schema, replace StarterKit with the individual exports you need,
such as `Document`, `Paragraph`, `Text`, `Bold`, `BaseKeymap` and `History`.
Register optional packages in that same extension array:

- [Tables](https://domternal.dev/v1/nodes/table/) and [images](https://domternal.dev/v1/nodes/image/).
- [Block controls](https://domternal.dev/v1/extensions/block-controls/) for slash commands, drag handles and SmartPaste.
- [PasteCleanup](https://github.com/domternal/domternal/tree/main/packages/extension-paste-cleanup) for opt-in Word and Google Docs HTML cleanup.
- [Markdown](https://domternal.dev/v1/extensions/markdown/) for Markdown parsing and serialization.

Only imported extensions enter your JavaScript bundle. `preset: 'notion'` selects
the Notion presentation and behavior; it does not install optional extensions.
See the [configuration guide](https://domternal.dev/v1/guides/configuration/).

## Content and validation

Use JSON for structured storage and HTML or plain text when your application needs
those formats. Loading JSON normalizes unsupported attributes and refused links;
`onContentDiagnostic` reports those repairs. Rendering an existing shared document
can show a normalized value without rewriting its stored data.

Before migrating persisted or collaborative content, read the
[content normalization guide](https://github.com/domternal/domternal/blob/main/packages/core/docs/content.md)
and [release notes](https://github.com/domternal/domternal/blob/main/CHANGELOG.md).
URL and style checks apply to built-in content paths. Custom renderers, exporters
and uploads still need application validation; custom `IconSet` SVG must be trusted
application code. See the [security guide](https://domternal.dev/v1/guides/security/).

`onUpdate` runs for accepted document changes, including changes appended by
plugins. A transaction vetoed by a plugin does not run update callbacks. See the
[transaction contract](https://domternal.dev/v1/guides/editor-api/#transaction-flow)
when connecting autosave or external state.

## Server-side rendering

`generateHTML`, `generateJSON` and `generateText` work without an editor instance.
HTML serialization and parsing need a DOM. For a Node.js ES module, install the
optional `linkedom` peer and pass its document explicitly:

```bash
pnpm add linkedom
```

```ts
import { generateHTML, generateText, StarterKit } from '@domternal/core';
import { parseHTML } from 'linkedom';

const content = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }],
};
const { document } = parseHTML('<!doctype html><html><body></body></html>');

const html = generateHTML(content, [StarterKit], { document });
const text = generateText(content, [StarterKit]);
```

`generateJSON(html, extensions, { document })` parses HTML into JSON.
`generateText` does not need a DOM. CommonJS can load installed `linkedom`
automatically; browser calls use the browser document. See
[server-side utilities](https://domternal.dev/v1/guides/editor-api/#server-side-utilities).

## Guides

- [Editor API](https://domternal.dev/v1/guides/editor-api/): commands, events, lifecycle and DOM adoption.
- [Localization](https://domternal.dev/v1/guides/i18n/): per-editor language, English fallback and optional `/locales/de` catalogs.
- [Theming](https://domternal.dev/v1/guides/theming/) and [printing](https://domternal.dev/v1/extensions/print/).
- [Content normalization and migrations](https://github.com/domternal/domternal/blob/main/packages/core/docs/content.md).
- [URL and style policy](https://github.com/domternal/domternal/blob/main/packages/core/docs/url-and-style-policy.md): custom link controls and exporters.
- [Clipboard coordination](https://github.com/domternal/domternal/blob/main/packages/core/docs/clipboard.md): experimental APIs for extension authors.

## License

[MIT](https://github.com/domternal/domternal/blob/main/LICENSE).
