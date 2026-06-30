# @domternal/extension-math

[![Version](https://img.shields.io/npm/v/@domternal/extension-math.svg)](https://www.npmjs.com/package/@domternal/extension-math)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/domternal/domternal/blob/main/LICENSE)

LaTeX math for the [Domternal](https://domternal.dev) editor: inline (`$...$`) and
block (`$$`) equation nodes. The rendering engine is **pluggable** and supplied by
you, so the package itself stays light and you ship only the engine you choose.
[KaTeX](https://katex.org/) is the recommended default.

## Links

<u>[Website](https://domternal.dev)</u> &nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp; <u>[Documentation](https://domternal.dev/v1/nodes/math)</u> &nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp; <u>[Live examples](https://domternal.dev/examples)</u>

## Install

```bash
pnpm add @domternal/extension-math katex
```

`katex` is a peer dependency (alongside `@domternal/core` and `@domternal/pm`). You
may swap it for any engine implementing the `MathRenderer` interface.

## Usage

```ts
import katex from 'katex';
import 'katex/dist/katex.min.css';
import '@domternal/theme';
import { Editor, Document, Text, Paragraph } from '@domternal/core';
import { MathInline, MathBlock, createKatexRenderer } from '@domternal/extension-math';

const renderer = createKatexRenderer(katex);

const editor = new Editor({
  extensions: [
    Document,
    Text,
    Paragraph,
    MathInline.configure({ renderer }),
    MathBlock.configure({ renderer }),
  ],
});
```

> The KaTeX stylesheet (`katex/dist/katex.min.css`) is imported by your app. This
> package styles only the editor wrapper, edit popover, selected and error states
> via `@domternal/theme` (`_math.scss`), never the math glyphs themselves.

## Commands

- `insertMathInline(latex?)` - insert an inline equation (`latex` optional; opens the edit popover when empty).
- `insertMathBlock(latex?)` - insert a block (display) equation (`latex` optional; opens the edit popover when empty).

Type `$x^2$` for inline or `$$` for a block; click or press Enter on an equation to edit it.

`createKatexRenderer(katex, options?)` takes an options object as its second argument:
`{ throwOnError = false, output = 'htmlAndMathml' }`.
