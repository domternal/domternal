# @domternal/core

[![Version](https://img.shields.io/npm/v/@domternal/core.svg)](https://www.npmjs.com/package/@domternal/core)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/domternal/domternal/blob/main/LICENSE)

The framework-agnostic editor engine of [Domternal](https://domternal.dev), built on
[ProseMirror](https://prosemirror.net/). It provides the headless `Editor` class, the
extension system (`Extension`, `Node`, `Mark`), a chainable command API, and the
built-in nodes, marks, and behaviors (paragraph, heading, lists, tasks, links,
inline formatting, history, keymaps) bundled as `StarterKit`. Use it directly with
vanilla JS/TS, or as the runtime under the Angular, React, Vue, and Vanilla wrappers.
Every export is tree-shakeable, so unused extensions are stripped from your bundle.

## Links

<u>[Website](https://domternal.dev)</u> &nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp; <u>[Documentation](https://domternal.dev/v1/getting-started)</u> &nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp; <u>[Live examples](https://domternal.dev/examples)</u>

## Install

```bash
pnpm add @domternal/core
```

`linkedom` is an optional peer dependency: install it only if you call the SSR
helpers (`generateHTML`, `generateJSON`, `generateText`) outside a browser.

```bash
pnpm add linkedom
```

## Usage

```ts
import { Editor, StarterKit } from '@domternal/core';

const editor = new Editor({
  element: document.getElementById('editor')!,
  extensions: [StarterKit],
  content: '<p>Hello <strong>world</strong></p>',
  onUpdate: ({ editor }) => {
    console.log(editor.getJSON());
  },
});

// Chainable command API
editor.chain().focus().toggleBold().run();

// Read content
const html = editor.getHTML();
const json = editor.getJSON();

// Tear down
editor.destroy();
```

The engine ships no styles. Import [`@domternal/theme`](https://www.npmjs.com/package/@domternal/theme) for ready-made light/dark editor styling, or supply your own CSS.

`StarterKit` bundles the common nodes, marks, and behaviors; each entry can be
configured or disabled individually.

```ts
StarterKit.configure({
  codeBlock: false,                  // disable an extension
  heading: { levels: [1, 2, 3] },    // configure an extension
  link: { openOnClick: false },
});
```

To trim the bundle further, skip `StarterKit` and compose only the extensions you
need:

```ts
import { Editor, Document, Paragraph, Text, Bold, History } from '@domternal/core';

const editor = new Editor({
  element: document.getElementById('editor')!,
  extensions: [Document, Paragraph, Text, Bold, History],
});
```

## Presets

`preset: 'notion'` switches the editor to the Notion-style experience in one option. It paints
the `dm-notion-mode` class on the `.dm-editor` host for you, and preset-aware code follows it:
the bubble menu serves the Notion text context, and images offer align controls instead of
float. `'classic'` is the default.

```ts
const editor = new Editor({
  element: document.getElementById('editor')!,
  extensions: [StarterKit],
  preset: 'notion',
});
```

`editor.preset` reports the resolved value, and still reports `'notion'` for a host that carries
the theme class alone, so setups that predate the option are unaffected.

## Printing

`Print` is not part of `StarterKit`, so add it explicitly. `printDocument()` isolates the
document from the host page before the browser's dialog opens, leaving your application's
sidebar, header, and everything else beside the document off the page, and it emits
`beforePrint` and `afterPrint` so you can set `document.title` or add page rules first.

```ts
import { Editor, StarterKit, Print } from '@domternal/core';

const editor = new Editor({
  element: document.getElementById('editor')!,
  extensions: [StarterKit, Print],
});

editor.commands.printDocument();
```

The hiding itself is CSS, and it lives in
[`@domternal/theme`](https://www.npmjs.com/package/@domternal/theme), whose paper layer also
applies to the reader's own Ctrl/Cmd+P with no code involved. Set `isolateNativePrint: true` to
give that shortcut the same isolation as the command.

## SSR

The `generateHTML`, `generateJSON`, and `generateText` helpers render content
without an editor instance, for example on the server.

```ts
import { generateHTML, StarterKit } from '@domternal/core';

const html = generateHTML(
  { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hi' }] }] },
  [StarterKit],
);
```

`generateJSON(html, extensions)` does the reverse (HTML to doc JSON) and `generateText` extracts plain text.
