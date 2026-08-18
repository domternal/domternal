# @domternal/extension-code-block-lowlight

[![Version](https://img.shields.io/npm/v/@domternal/extension-code-block-lowlight.svg)](https://www.npmjs.com/package/@domternal/extension-code-block-lowlight)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/domternal/domternal/blob/main/LICENSE)

Syntax highlighting for the [Domternal](https://domternal.dev) editor's code blocks,
powered by [lowlight](https://github.com/wooorm/lowlight) (a lightweight highlight.js
wrapper, 190+ languages). `CodeBlockLowlight` extends the core `CodeBlock` node with
language auto-detection, Tab/Shift-Tab indentation, and incremental re-highlighting that
only updates the blocks affected by an edit. It inherits every command, shortcut, toolbar
item, and input rule from `CodeBlock`, so it is a drop-in replacement. Server-side and
inline-style highlighting helpers (`generateHighlightedHTML`, `createCodeHighlighter`) are
included for SSR and email rendering.

## Links

<u>[Website](https://domternal.dev)</u> &nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp; <u>[Documentation](https://domternal.dev/v1/extensions/code-block-lowlight)</u> &nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp; <u>[Live examples](https://domternal.dev/examples)</u>

## Install

```bash
pnpm add @domternal/extension-code-block-lowlight lowlight
```

`lowlight` is a peer dependency (alongside `@domternal/core` and `@domternal/pm`). Install
it yourself and pass a configured instance via the required `lowlight` option. For a
smaller bundle, start from an empty `createLowlight()` and register only the languages you
need with `lowlight.register(name, syntax)`.

## Usage

```ts
import { Editor, Document, Paragraph, Text } from '@domternal/core';
import { CodeBlockLowlight } from '@domternal/extension-code-block-lowlight';
import { createLowlight, common } from 'lowlight';

const lowlight = createLowlight(common); // ~37 common languages; use `all` for ~190

const editor = new Editor({
  element: document.getElementById('editor')!,
  extensions: [
    Document,
    Paragraph,
    Text,
    CodeBlockLowlight.configure({
      lowlight,
      defaultLanguage: 'javascript',
      autoDetect: true,
      tabIndentation: true,
      tabSize: 2,
    }),
  ],
});

// Inherited from CodeBlock
editor.commands.toggleCodeBlock({ language: 'typescript' });

// Languages registered on the lowlight instance.
// Storage is keyed by the inherited `codeBlock` name, not `codeBlockLowlight`.
editor.storage.codeBlock.listLanguages();
```

> `CodeBlockLowlight` **replaces** the built-in `CodeBlock`. Do not register both. With
> `StarterKit`, disable the core code block: `StarterKit.configure({ codeBlock: false })`.

## Options

| Option | Type | Default | Description |
|---|---|---|---|
| `lowlight` | `Lowlight` | `null` (required) | The instance from `createLowlight()`. Without it the editor still builds, highlighting is skipped, and the failure surfaces as an `error` event (`onError`). |
| `defaultLanguage` | `string \| null` | `null` | Language used when a block has none set. |
| `autoDetect` | `boolean` | `true` | Detect the language via `highlightAuto()` when none is set. |
| `tabIndentation` | `boolean` | `true` | Tab inserts spaces inside code blocks; Shift-Tab outdents. |
| `tabSize` | `number` | `2` | Number of spaces per tab. |
| `languageClassPrefix` | `string` | `'language-'` | Inherited from `CodeBlock`: class prefix for the language on the `<code>` element. |
| `exitOnTripleEnter` | `boolean` | `true` | Inherited from `CodeBlock`: three consecutive Enter presses leave the block. |
| `HTMLAttributes` | `Record<string, unknown>` | `{}` | Inherited from `CodeBlock`: attributes merged onto the rendered `<pre>`. |

> The plugin adds highlight.js token classes (`hljs-keyword`, `hljs-string`, and the
> rest) but ships no CSS. `@domternal/theme` (`_syntax.scss`) colors them, each token
> reading a `--dm-syntax-*` variable you can override; without the theme, import any
> highlight.js stylesheet instead.

## Server-side highlighting

`generateHighlightedHTML` renders JSON content to HTML with highlighted code blocks, and
`createCodeHighlighter` produces a `codeHighlighter` callback for `inlineStyles()` (email,
CMS, and Google Docs output). These are two independent paths: use whichever fits your
pipeline. For `generateHighlightedHTML(json, extensions, lowlight)`, `extensions` must be
the same array you used to build the editor and `json` is its document JSON (e.g.
`editor.getJSON()`). The example below shows both helpers running over the same `html`:

```ts
import {
  generateHighlightedHTML,
  createCodeHighlighter,
} from '@domternal/extension-code-block-lowlight';
import { inlineStyles } from '@domternal/core';
import { createLowlight, common } from 'lowlight';

const lowlight = createLowlight(common);

const html = generateHighlightedHTML(json, extensions, lowlight);

const styled = inlineStyles(html, {
  codeHighlighter: createCodeHighlighter(lowlight),
});
```

Both SSR helpers accept an optional options object as their last argument:
`{ defaultLanguage?, autoDetect? }`, and for `generateHighlightedHTML` also `document`,
forwarded to `generateHTML` for environments that supply their own DOM implementation. For SSR,
`autoDetect` defaults to `false` (the opposite of the editor extension's `true`), so pass
`{ autoDetect: true }` if you want detection during server rendering.

## License

MIT
