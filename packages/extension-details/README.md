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

Version 1.3.0 requires both `@domternal/core` and `@domternal/pm` in the range
`>=1.3.0 <2.0.0`. Upgrade these packages together with this extension.

## Usage

The `Details` extension automatically pulls in its child nodes (`DetailsSummary`
and `DetailsContent`), so adding `Details` to your extension list is enough.

```ts
import { Editor, Document, Text, Paragraph } from '@domternal/core';
import { Details } from '@domternal/extension-details';
import '@domternal/theme';

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
- `openDetails()` / `closeDetails()` - expand or collapse the current details (requires `persist: true`)
- `setDetailsOpen(open: boolean)` - set the open state explicitly (requires `persist: true`)

`openDetails()`, `closeDetails()`, and `setDetailsOpen()` only change a saved
attribute, so they no-op unless `persist: true` is set.

Adding `Details` also registers a toolbar button and a slash-menu entry
("Toggle block") that run `toggleDetails`.

## Options

`Details.configure({ ... })` accepts:

- `persist` (default `false`) - when `true`, the `open` attribute is saved and
  restored so the open/closed state lives in the document. In a read-only
  editor the toggle still expands and collapses so the content can be read, but
  nothing is written back
- `openClassName` (default `'is-open'`) - CSS class applied while a block is
  open. The theme's rules target the default, so change it only alongside
  matching CSS of your own
- `HTMLAttributes` - extra attributes for the rendered element

`DetailsSummary` and `DetailsContent` are exported too, each taking a single
`HTMLAttributes` option, for the rare case where a child node needs configuring.

## Keyboard shortcuts

- `Backspace` at the start of the summary unwraps the block
- `Enter` in the summary opens a collapsed block and puts the cursor in its
  content; in an open block it starts a new block at the top of the content
- `ArrowRight` at the end of the summary, or `ArrowDown` anywhere in it, places
  a gap cursor after a collapsed block. Both need the `Gapcursor` extension
  from `@domternal/core` and fall through to the default handling without it
- `Enter` on the last block of the content, when that block is empty, removes
  it and creates a block after the accordion, so a second `Enter` escapes

## Copy and paste

- A paste into the summary that brings blocks, such as several paragraphs, a
  list, Markdown lines or an image file, goes where `Enter` in the summary puts
  the cursor: a new block at the top of the content, which opens. The summary
  keeps its text. The new block and the paste are one transaction: a paste that
  a transaction filter refuses, such as one past a `CharacterCount` limit,
  leaves the accordion as it was and closed, a paste whose images Paste Cleanup
  prepares first is applied, and undo takes it back in one step. `Details`
  registers a paste placement through `@domternal/core/clipboard`, which
  Markdown, SmartPaste and the image node's file paste start from, and a
  `detailsPaste` extension, at priority 90, that pastes what none of them took
  as ProseMirror's own paste would. Inline content, a single paragraph or
  heading, a line copied with its line break, and text copied from inside a
  code block, list item, quote, table cell or another summary still join the
  summary's text. Image files the image node does not store leave the
  accordion as it was. Before, the paste split the accordion in two and moved
  the content into a second, collapsed one with an empty summary. Dropping
  blocks onto the summary is not covered yet
- Blocks copied from inside the content, without the summary, paste as those
  blocks. The copy records the accordion around them, and the paste used to
  rebuild it as a collapsed block with an empty summary, which hid what was
  pasted. A copy that includes the summary pastes the whole block. This also
  holds for content nested in the content of another accordion, and for an
  accordion inside a list item, quote or table cell, whose blocks paste in that
  container

## Localization

This package exports `detailsMessages` for typed custom catalogs. Optional German UI
messages and search aliases are available from `@domternal/extension-details/locales/de`
as `deMessages` and `deSearchAliases`. Merge them with the core and other enabled feature
catalogs. Missing entries fall back to English.
