# @domternal/extension-details

[![Version](https://img.shields.io/npm/v/@domternal/extension-details.svg)](https://www.npmjs.com/package/@domternal/extension-details)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/domternal/domternal/blob/main/LICENSE)

Collapsible accordion blocks for the [Domternal](https://domternal.dev) editor,
built on semantic `<details>` / `<summary>` HTML. Each block has a clickable
summary header and an expandable content area that holds any block-level content
(paragraphs, lists, code blocks, tables, and more). The toggle is an accessible
disclosure (`aria-expanded` / `aria-controls`), and open state can optionally be
persisted into the document so the serialized JSON/HTML reflects user choices.

## Links

<u>[Website](https://domternal.dev)</u> &nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp; <u>[Documentation](https://domternal.dev/v1/nodes/details)</u> &nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp; <u>[Live examples](https://domternal.dev/examples)</u>

## Install

```bash
pnpm add @domternal/extension-details
```

`@domternal/core` and `@domternal/pm` are peer dependencies.

## Usage

The `Details` extension automatically pulls in its child nodes (`DetailsSummary`
and `DetailsContent`), so adding `Details` to your extension list is enough.

```ts
import { Editor, Document, Text, Paragraph } from '@domternal/core';
import { Details } from '@domternal/extension-details';

const editor = new Editor({
  extensions: [
    Document,
    Text,
    Paragraph,
    Details.configure({ persist: true }),
  ],
  content:
    '<details><summary>Click to expand</summary><div data-details-content><p>Hidden content here.</p></div></details>',
});

// Wrap the current selection in a collapsible block, then open it
editor.chain().focus().setDetails().openDetails().run();
```

## Commands

- `setDetails()` - wrap the selected block(s) in a new details accordion
- `unsetDetails()` - unwrap the surrounding details back into plain blocks
- `toggleDetails()` - wrap if outside a details, unwrap if inside one
- `openDetails()` / `closeDetails()` - expand or collapse the current details
- `setDetailsOpen(open: boolean)` - set the open state explicitly

## Options

`Details.configure({ ... })` accepts:

- `persist` (default `false`) - when `true`, the `open` attribute is saved and
  restored so the open/closed state lives in the document
- `openClassName` (default `'is-open'`) - CSS class applied while a block is open
- `HTMLAttributes` - extra attributes for the rendered element
