# @domternal/extension-math

[![Version](https://img.shields.io/npm/v/@domternal/extension-math.svg)](https://www.npmjs.com/package/@domternal/extension-math)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/domternal/domternal/blob/main/LICENSE)

Inline and block LaTeX equations for the [Domternal](https://domternal.dev) editor,
with input rules and an edit popover with live preview. Supply a rendering engine
through the `MathRenderer` interface, or use the included KaTeX adapter.

[Documentation](https://domternal.dev/v1/nodes/math/) · [Live examples](https://domternal.dev/examples/)

## Install

The package declares Node.js 22 or later for tooling.

```bash
pnpm add @domternal/core @domternal/pm @domternal/extension-math katex @domternal/theme
```

Requires `@domternal/core` and `@domternal/pm` `>=1.3.0 <2.0.0`, plus the declared
KaTeX peer `^0.16.0 || ^0.17.0`. The package does not import the engine itself.
Use version 1.3.1 for all installed Domternal packages.
`@domternal/theme` styles editor controls; KaTeX's separate stylesheet renders
math glyphs and must also be imported.

## Quick start

Add a host, then run the TypeScript after it is mounted in a browser app that
supports CSS imports:

```html
<div class="dm-editor"><div id="editor"></div></div>
```

```ts
import { Editor, StarterKit } from '@domternal/core';
import {
  MathInline,
  MathBlock,
  createKatexRenderer,
} from '@domternal/extension-math';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import '@domternal/theme';

const renderer = createKatexRenderer(katex);

const editor = new Editor({
  element: document.getElementById('editor')!,
  extensions: [
    StarterKit,
    MathInline.configure({ renderer }),
    MathBlock.configure({ renderer }),
  ],
  content: '<p>An equation: <span data-type="math-inline" data-latex="x^2"></span></p>',
});
```

Use either node or both. Each automatically includes the shared `MathEditing`
extension, so the edit popover needs no separate registration. Call
`editor.destroy()` when removing the editor.

## Writing and editing equations

Type `$x^2$` to insert an inline equation, or `$$` at the start of an empty line to
create a block equation. These rules do not run inside code blocks.

```ts
editor.chain().focus().insertMathInline('x^2').run();
editor.chain().focus().insertMathBlock('E = mc^2').run();
```

Call `insertMathInline()` without source to turn selected text into an equation;
with no selected text, it opens an empty equation for editing. `insertMathBlock()`
without source opens an empty block equation, replacing an empty line when possible.

Click an equation, or press `Enter` while it is selected, to edit it. In the popover,
`Enter` applies, `Shift-Enter` inserts a newline, and `Escape` cancels. Clicking or
tabbing away applies changes. Applying an empty source deletes the equation.

## Rendering and stored content

Both nodes accept `renderer` and `HTMLAttributes`. With `renderer: null` (the
default), LaTeX still round-trips and can be edited, but displays as raw source.
Serialized JSON stores the `latex` attribute; HTML stores it as `data-latex`.
`editor.getHTML()` preserves the equation data, not the rendered KaTeX markup.
Rendering equations on a published page is a separate step in your output pipeline.

`createKatexRenderer(katex, options?)` accepts `throwOnError` (default `false`) and
`output` (default `'htmlAndMathml'`, including MathML for accessibility). The adapter
always uses `trust: false`: document LaTeX cannot create links with `\href` or
`\url`, load images with `\includegraphics`, or set HTML attributes through KaTeX's
HTML commands. A custom renderer returns HTML and is responsible for safely
handling untrusted LaTeX.

See the [renderer reference](https://domternal.dev/v1/nodes/math/#the-pluggable-renderer)
for `MathRenderer`, and the [full API](https://domternal.dev/v1/nodes/math/#exports)
for `MathEditing`, `mathEditPluginKey`, node-name constants, and exported types.

## Localization

`mathMessages` provides typed message keys. German `deMessages` and
`deSearchAliases` are exported from `@domternal/extension-math/locales/de`.
See the [localization guide](https://domternal.dev/v1/guides/i18n/) for combining
catalogs. Missing messages fall back to English; authored LaTeX remains unchanged.
