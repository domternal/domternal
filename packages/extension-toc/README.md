# @domternal/extension-toc

[![Version](https://img.shields.io/npm/v/@domternal/extension-toc.svg)](https://www.npmjs.com/package/@domternal/extension-toc)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/domternal/domternal/blob/main/LICENSE)

Notion-style Table of Contents for the Domternal editor.

This package ships three opt-in pieces that all share a common heading-discovery data layer:

- **TableOfContents** - data layer: walks the doc, tracks the heading list and active state. Reads heading ids from the `UniqueID` extension (in `@domternal/core`). Exposes `editor.storage.toc` and `editor.commands.scrollToHeading`.
- **FloatingTocOutline** - right-rail outline mounted outside `.dm-editor`. Three-state machine: `hidden` (when below `minHeadings` or on mobile), `collapsed` (compact ticks), `expanded` (hover or focus reveals a card with full heading text and per-level indent). Active tick + active row mirror the heading the user is currently reading.
- **TableOfContentsBlock** - inline `/toc` PM atom node. NodeView reactively renders the heading list inside the document. Slash-menu item registered via the standard `addFloatingMenuItems()` hook. Active state stays in sync with the floating outline.

All three pieces are opt-in - add any subset to your editor's `extensions` list. The data layer is the only required piece for the UI ones to work.

## Required peer extension: UniqueID

`TableOfContents` reads `UniqueID`'s native `id` attribute on every heading - it does not write its own. Add `UniqueID` from `@domternal/core` to your extensions array. Without it, `TableOfContents` logs an error at init and renders inert (no storage updates, no outline), but the editor itself still works.

```ts
import { UniqueID } from '@domternal/core';
import { TableOfContents, FloatingTocOutline, TableOfContentsBlock } from '@domternal/extension-toc';

new Editor({
  extensions: [
    /* ...your other extensions */
    UniqueID,             // required peer dep
    TableOfContents,
    FloatingTocOutline,
    TableOfContentsBlock,
  ],
});
```

Sharing `UniqueID`'s id system unifies TOC navigation with the `BlockContextMenu` "Copy link to block" feature: the same id powers both, and native browser `<a href="#id">` navigation works without our JavaScript.

## Breaking changes from previous versions

This release removes the `tocId` schema attribute and its `generateId` option in favour of reading heading ids from the `UniqueID` extension.

- **Removed:** the `tocId` attribute on heading nodes (DOM attribute `data-toc-id`). Outline buttons now use their own `data-toc-anchor` marker; the heading itself uses native HTML `id` from UniqueID.
- **Removed:** `TableOfContents.configure({ generateId: ... })`. Configure id generation on `UniqueID.configure({ generateID: ... })` instead.
- **Preserved:** `editor.storage.toc.content[N].id` continues to work; the value is now sourced from UniqueID's id attribute rather than tocId.
- **Migration:** add `UniqueID` to your extensions array (see above). If you were customising the id format via `generateId`, move that option to UniqueID. If you were targeting `[data-toc-id]` in custom CSS, switch to the heading's `[id]`.

## Links

<u>[Website](https://domternal.dev)</u> &nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp; <u>[Documentation](https://domternal.dev/v1/extensions/table-of-contents)</u>

## Documentation

- <u>[Getting Started](https://domternal.dev/v1/getting-started)</u> - install and create your first editor
- <u>[Introduction](https://domternal.dev/v1/introduction)</u> - core concepts, architecture, and design decisions
- <u>[Packages & Bundle Size](https://domternal.dev/v1/packages)</u> - what each package includes and bundle size breakdown

## License

<u>[MIT](https://github.com/domternal/domternal/blob/main/LICENSE)</u>
