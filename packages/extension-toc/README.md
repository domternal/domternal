# @domternal/extension-toc

[![Version](https://img.shields.io/npm/v/@domternal/extension-toc.svg)](https://www.npmjs.com/package/@domternal/extension-toc)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/domternal/domternal/blob/main/LICENSE)

A live table of contents for the [Domternal](https://domternal.dev) editor, with
active-heading tracking, smooth scrolling, and URL hash navigation. Use the
floating outline, an insertable contents block, or the heading data for your own UI.

[Documentation](https://domternal.dev/v1/extensions/table-of-contents/) · [Live examples](https://domternal.dev/examples/)

## Install

The package declares Node.js 22 or later for tooling.

```bash
pnpm add @domternal/core @domternal/pm @domternal/extension-toc @domternal/theme
```

Requires `@domternal/core` and `@domternal/pm` `>=1.3.0 <2.0.0`.
Use version 1.3.1 for all installed Domternal packages.
`TableOfContents` also requires the core `UniqueID` extension for heading anchors.
The theme supplies the outline and contents-block styles.

## Quick start

Add a host, then run the TypeScript after it is mounted in a browser app that
supports CSS imports:

```html
<div class="dm-editor"><div id="editor"></div></div>
```

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
    UniqueID,
    TableOfContents.configure({ levels: [1, 2, 3] }),
    FloatingTocOutline.configure({ anchor: 'editor' }),
    TableOfContentsBlock,
  ],
  content: `
    <div data-type="table-of-contents"></div>
    <h1 id="introduction">Introduction</h1>
    <p>Start reading here.</p>
    <h2>Next steps</h2>
    <p>Add more headings to update the outline.</p>
  `,
});
```

The contents block appears inside the document. The floating outline appears at
viewport widths above its default `1024px` breakpoint; set `mobileBreakpoint: 0`
on `FloatingTocOutline` to keep it visible on smaller screens. Call
`editor.destroy()` when removing the editor.

## Choose the UI

| Extension | Purpose |
| --- | --- |
| `TableOfContents` | Required data layer. Tracks headings and the active section in `editor.storage.toc`. |
| `FloatingTocOutline` | Optional right-side outline. Hover or focus to expand its heading list. |
| `TableOfContentsBlock` | Optional document node that renders a contents list from the same data. |

The visual extensions need `TableOfContents`; neither replaces it. For a custom
outline, use `TableOfContents` alone and subscribe with its `onUpdate` callback.

## Navigation and insertion

```ts
import type { TocStorage } from '@domternal/extension-toc';

editor.commands.scrollToHeading('introduction');

const toc = editor.storage.toc as TocStorage;
const headings = toc.content;
const activeId = toc.activeId;

editor.commands.insertContent({ type: 'tableOfContents' });
```

`scrollToHeading()` takes an actual heading ID and updates the URL hash. An initial
`#hash` also navigates to its matching heading once the editor is connected.
`TableOfContentsBlock` contributes a `/toc` action when
[`SlashCommand`](https://domternal.dev/v1/extensions/block-controls/) is installed;
slash commands are not included by this package.

## Common options

- `TableOfContents.levels` chooses heading levels, defaulting to `[1, 2, 3]`.
  Entries use the level each heading renders at.
- `TableOfContents.onUpdate(storage)` runs when headings or the active section
  change. Entries include `id`, `level`, `textContent`, `pos`, `domNode`,
  `isActive`, and `isScrolledOver`.
- `TableOfContents.activeScrollParent` sets an editor's scroll container; the
  default is the window. `activeOffset` moves the activation line below a sticky
  toolbar, in pixels.
- `FloatingTocOutline.anchor` is `'editor'` or `'viewport'`. `minHeadings` controls
  when to show it, and `outlineHost` overrides where it mounts.
- `TableOfContentsBlock.emptyStateText` customizes the message shown when there
  are no headings. `HTMLAttributes` adds attributes to the serialized block.

Keep `UniqueID` unconfigured for its default block IDs, which already include
headings. If you use custom `anchorTypes`, include them in `UniqueID.types` too.
Setting `UniqueID.types` replaces its defaults, so retain any other node types
that need Copy link or stable IDs. Without `UniqueID`, the TOC stays inactive.

The contents block serializes to an empty `<div data-type="table-of-contents">`;
the live list is rendered by its editor node view. For a static page, render the
heading list in your output pipeline. See the
[full reference](https://domternal.dev/v1/extensions/table-of-contents/) for tracking
options and the `walkHeadings`, `scrollToHeading`, and `createActiveStateTracker`
helpers.

## Localization

`tocMessages` provides typed message keys. German `deMessages` and `deSearchAliases`
are exported from `@domternal/extension-toc/locales/de`. See the
[localization guide](https://domternal.dev/v1/guides/i18n/) for combining catalogs.
Missing messages fall back to English; heading text remains unchanged.
