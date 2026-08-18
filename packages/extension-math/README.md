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

`katex` is a peer dependency (alongside `@domternal/core` and `@domternal/pm`), and the
supported range is `^0.16.0 || ^0.17.0`. You may swap it for any engine implementing the
`MathRenderer` interface, since the package never imports KaTeX itself.

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

## Options

Both nodes take the same two options:

- `renderer` (`MathRenderer | null`, default `null`) - turns LaTeX into HTML in the node
  view and in the edit popover's live preview. With `null` the nodes still store and
  round-trip LaTeX and editing still works, but the raw source is shown instead of math.
- `HTMLAttributes` (`Record<string, unknown>`, default `{}`) - attributes merged onto the
  rendered `<span data-type="math-inline">` or `<div data-type="math-block">`.

## Commands

- `insertMathInline(latex?)` - insert an inline equation. Called without `latex`, the
  selected text becomes the source (select `x^2`, get that equation); with no selection
  either, an empty equation is inserted and the edit popover opens on it.
- `insertMathBlock(latex?)` - insert a block (display) equation. Called without `latex`,
  an empty equation is inserted and the edit popover opens on it. On an empty line the
  equation replaces the line instead of being added after it.

Type `$x^2$` for inline, or `$$` at the start of a line for a block. Click an equation,
or press `Enter` while it is selected, to open the edit popover: `Enter` applies,
`Shift-Enter` adds a newline to the source, `Escape` cancels, clicking or tabbing away
applies, and applying an empty field deletes the equation.

## Exports

`createKatexRenderer(katex, options?)` takes an options object as its second argument:
`{ throwOnError = false, output = 'htmlAndMathml' }`.

Both nodes also pull in a shared `MathEditing` extension, which owns the edit popover
and is exported with its `mathEditPluginKey`, so a host can open the popover itself by
dispatching `tr.setMeta(mathEditPluginKey, { pos, latex, displayMode })`. The
`MATH_INLINE_NAME` and `MATH_BLOCK_NAME` node names and the option, renderer, and event
types are exported too.
