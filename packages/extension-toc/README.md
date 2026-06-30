# @domternal/extension-toc

[![Version](https://img.shields.io/npm/v/@domternal/extension-toc.svg)](https://www.npmjs.com/package/@domternal/extension-toc)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/domternal/domternal/blob/main/LICENSE)

Notion-style Table of Contents for the [Domternal](https://domternal.dev) editor.

A shared heading-discovery data layer feeds three pieces that work together:

- `TableOfContents` - the headless heading observer that maintains a reactive heading list in `editor.storage.toc` and exposes the `scrollToHeading` command.
- `FloatingTocOutline` - a sticky right-rail outline with a hover-expanded card, anchored to the editor or the viewport.
- `TableOfContentsBlock` - an inline `/toc` atom node.

Active-heading tracking, smooth click-to-jump scrolling, and initial-load
`#hash` navigation are built in.

## Links

<u>[Website](https://domternal.dev)</u> &nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp; <u>[Documentation](https://domternal.dev/v1/extensions/table-of-contents)</u> &nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp; <u>[Live examples](https://domternal.dev/examples)</u>

## Install

```bash
pnpm add @domternal/extension-toc
```

`@domternal/core` and `@domternal/pm` are peer dependencies. `TableOfContents`
also requires the `UniqueID` extension (from `@domternal/core`) to be loaded: it
reads UniqueID's `id` attribute on headings as the navigation anchor and stays
inert without it.

## Usage

```ts
import { Editor, StarterKit, UniqueID } from '@domternal/core';
import {
  TableOfContents,
  FloatingTocOutline,
  TableOfContentsBlock,
} from '@domternal/extension-toc';
import '@domternal/theme';

const editor = new Editor({
  element: document.getElementById('editor')!,
  extensions: [
    StarterKit,
    // UniqueID's default `types` already stamps headings; pass `types` only
    // when TableOfContents' `anchorTypes` point at custom node types.
    UniqueID,
    TableOfContents.configure({ levels: [1, 2, 3] }),
    FloatingTocOutline.configure({ anchor: 'editor' }),
    TableOfContentsBlock,
  ],
});

// Jump to a heading by its UniqueID-assigned id (updates the URL hash).
editor.commands.scrollToHeading('introduction');

// Read the live heading list, or subscribe via the onUpdate option.
console.log(editor.storage.toc.content); // HeadingEntry[]
```

`UniqueID` stamps ids on headings; `TableOfContents` watches the document and
keeps `editor.storage.toc` in sync; `FloatingTocOutline` renders the sticky
outline; `TableOfContentsBlock` adds the `/toc` atom so users can insert an
inline contents list.

## Exports

```ts
import {
  TableOfContents,
  tocPluginKey,
  FloatingTocOutline,
  floatingTocOutlinePluginKey,
  TableOfContentsBlock,
  walkHeadings,
  scrollToHeading,
  createActiveStateTracker,
} from '@domternal/extension-toc';
```

`walkHeadings`, `scrollToHeading`, and `createActiveStateTracker` are exposed as
standalone helpers so you can build a custom outline UI on top of the same
data layer and active-tracking rule.
