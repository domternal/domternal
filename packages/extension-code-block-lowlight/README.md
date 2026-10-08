# @domternal/extension-code-block-lowlight

[![Version](https://img.shields.io/npm/v/@domternal/extension-code-block-lowlight.svg)](https://www.npmjs.com/package/@domternal/extension-code-block-lowlight)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/domternal/domternal/blob/main/LICENSE)

Syntax-highlighted code blocks for the [Domternal](https://domternal.dev) editor,
powered by lowlight. `CodeBlockLowlight` adds language detection and Tab indentation
to the core `CodeBlock`, while retaining its commands, input rules, and toolbar actions.
The package also includes HTML export helpers.

[Documentation](https://domternal.dev/v1/extensions/code-block-lowlight/) · [Live examples](https://domternal.dev/examples/)

## Install

The package declares Node.js 22 or later for tooling.

```bash
pnpm add @domternal/core @domternal/pm @domternal/extension-code-block-lowlight lowlight@^3 @domternal/theme
```

Requires `@domternal/core` and `@domternal/pm` `>=1.3.0 <2.0.0`, plus `lowlight`
`^3.0.0`. Use version 1.3.1 for all installed Domternal packages.
Supply a configured lowlight instance as shown below. The theme supplies
syntax colors; you can use your own highlight.js-compatible stylesheet instead.

## Quick start

Add a host, then run the TypeScript after it is mounted in a browser app that
supports CSS imports:

```html
<div class="dm-editor"><div id="editor"></div></div>
```

```ts
import { Editor, StarterKit } from '@domternal/core';
import { CodeBlockLowlight } from '@domternal/extension-code-block-lowlight';
import { createLowlight, common } from 'lowlight';
import '@domternal/theme';

const lowlight = createLowlight(common);
const extensions = [
  StarterKit.configure({ codeBlock: false }),
  CodeBlockLowlight.configure({ lowlight }),
];

const editor = new Editor({
  element: document.getElementById('editor')!,
  extensions,
  content: '<pre><code class="language-javascript">const answer = 42;</code></pre>',
});
```

Disable `StarterKit`'s `codeBlock` as shown: both extensions use the `codeBlock`
node name and must not be registered together. Call `editor.destroy()` when
removing the editor.

## Commands and languages

```ts
import type { CodeBlockLowlightStorage } from '@domternal/extension-code-block-lowlight';

editor.chain().focus().toggleCodeBlock({ language: 'typescript' }).run();
editor.commands.setCodeBlock({ language: 'javascript' });

const codeBlocks = editor.storage.codeBlock as CodeBlockLowlightStorage;
const languages = codeBlocks.listLanguages();
```

Storage uses `codeBlock`, not `codeBlockLowlight`. The default `common` language set
is a useful starting point. For a smaller bundle, call `createLowlight()` without a
set and register only the languages you need with `lowlight.register(name, syntax)`.

## Common options

| Option | Default | Use |
| --- | --- | --- |
| `lowlight` | `null` | Required configured lowlight instance. Without it, highlighting is skipped and an editor error is reported. |
| `defaultLanguage` | `null` | Language to use when the block has no language. |
| `autoDetect` | `true` | Detect a language when no registered explicit or default language applies. |
| `tabIndentation` | `true` | Tab inserts spaces and Shift-Tab removes leading spaces in code blocks. |
| `tabSize` | `2` | Spaces per indentation step. |

Core `CodeBlock` options such as `languageClassPrefix`, `exitOnTripleEnter`, and
`HTMLAttributes` remain available. Highlighting emits `hljs-*` token classes;
`@domternal/theme` colors them using overridable `--dm-syntax-*` variables.

## Export highlighted HTML

Editor decorations are not part of `editor.getHTML()`. For highlighted output, use
one of these paths with the `editor`, `extensions`, and `lowlight` from the example:

```ts
import { inlineStyles } from '@domternal/core';
import {
  generateHighlightedHTML,
  createCodeHighlighter,
} from '@domternal/extension-code-block-lowlight';

// HTML with syntax token classes for a page that loads syntax CSS.
const html = generateHighlightedHTML(editor.getJSON(), extensions, lowlight);

// HTML with inline styles for an email or another destination without the theme.
const styledHtml = inlineStyles(editor.getHTML(), {
  codeHighlighter: createCodeHighlighter(lowlight),
});
```

Both helpers accept `{ defaultLanguage?, autoDetect? }` as their final argument.
Export auto-detection defaults to `false`; set it explicitly if you want detection
outside the editor. `generateHighlightedHTML` also accepts `document` for a custom
DOM implementation. Server rendering needs a DOM document, supplied explicitly or
through the core's optional `linkedom` dependency. Use the same document schema for
stored JSON. See the [export reference](https://domternal.dev/v1/extensions/code-block-lowlight/#utility-functions)
for details.
