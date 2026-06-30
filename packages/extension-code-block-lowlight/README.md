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
it yourself and pass a configured instance via the required `lowlight` option.

## Usage

```ts
import { Editor, Document, Paragraph, Text } from '@domternal/core';
import { CodeBlockLowlight } from '@domternal/extension-code-block-lowlight';
import { createLowlight, common } from 'lowlight';

const lowlight = createLowlight(common); // ~40 common languages; use `all` for ~190

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
| `lowlight` | `Lowlight` | `null` (required) | The instance from `createLowlight()`. Throws at init if missing. |
| `defaultLanguage` | `string \| null` | `null` | Language used when a block has none set. |
| `autoDetect` | `boolean` | `true` | Detect the language via `highlightAuto()` when none is set. |
| `tabIndentation` | `boolean` | `true` | Tab inserts spaces inside code blocks; Shift-Tab outdents. |
| `tabSize` | `number` | `2` | Number of spaces per tab. |

## Server-side highlighting

`generateHighlightedHTML` renders JSON content to HTML with highlighted code blocks, and
`createCodeHighlighter` produces a `codeHighlighter` callback for `inlineStyles()` (email,
CMS, and Google Docs output):

```ts
import {
  generateHighlightedHTML,
  createCodeHighlighter,
} from '@domternal/extension-code-block-lowlight';
import { inlineStyles } from '@domternal/core';
import { createLowlight, common } from 'lowlight';

const lowlight = createLowlight(common);

const html = generateHighlightedHTML(json, extensions, lowlight);

const styled = inlineStyles(plainHtml, {
  codeHighlighter: createCodeHighlighter(lowlight),
});
```
