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

`linkedom` is an optional peer dependency: install it only if you call `generateHTML` or
`generateJSON` outside a browser. `generateText` reads the document model and never touches
the DOM, so it runs anywhere without it.

```bash
pnpm add linkedom
```

### One copy of the core, and of ProseMirror

ProseMirror compares classes by identity, and so does this package. Two copies of
`@domternal/core` give two `Extension` base classes, two schemas and two `Gapcursor`s
under a single plugin key; two copies of `prosemirror-model` make `Fragment.from` reject a
fragment the editor itself produced. Neither is a size problem, and nothing warns at
install time.

The core detects both at runtime. Building an editor beside a second copy of
`prosemirror-model`, `prosemirror-state`, `prosemirror-view`, `prosemirror-transform` or of
`@domternal/core` itself warns on the console, naming both packages and the fix. Handing an
editor an extension that another copy of the core built throws, because that can never
work. The dedupe recipe per package manager and bundler:
https://domternal.dev/v1/guides/single-prosemirror-copy/

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
configured or disabled individually. Every entry is on by default except `listIndent`,
which ships off because its Tab keymap also captures Tab on a paragraph that merely
follows a list. Pass `true` to switch it on.

```ts
StarterKit.configure({
  codeBlock: false,                  // disable an extension
  heading: { levels: [1, 2, 3] },    // configure an extension
  link: { openOnClick: false },
  listIndent: true,                  // opt in: Tab indents a block under the previous list
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
applies to the reader's own Ctrl/Cmd+P with no code involved.

Adding `Print` also registers a printer toolbar button, which stays live in a read-only
editor, and binds `Mod-P` to `printDocument` while the caret is in the editor.

`Print.configure({ ... })` accepts:

- `toolbar` (default `true`) - show the toolbar button
- `root` (default `null`) - `(editor) => HTMLElement | null` choosing what to print; unset
  prints the editor's `.dm-editor` wrapper, falling back to the ProseMirror element
- `isolateNativePrint` (default `false`) - give the reader's own Ctrl/Cmd+P the same
  isolation as the command

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

`generateJSON(html, extensions)` does the reverse (HTML to doc JSON), and
`generateText(content, extensions, options)` extracts plain text, separating blocks with a
blank line unless `blockSeparator` overrides it.

Outside a browser, `generateHTML` and `generateJSON` need a DOM and load `linkedom` through
`require`, which only resolves under CommonJS. From an ES module server, installing
`linkedom` is not enough: pass the document yourself.

```ts
import { parseHTML } from 'linkedom';

const { document } = parseHTML('<!DOCTYPE html><html><body></body></html>');
const html = generateHTML(content, [StarterKit], { document });
```
