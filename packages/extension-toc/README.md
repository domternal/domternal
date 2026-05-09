# @domternal/extension-toc

[![Version](https://img.shields.io/npm/v/@domternal/extension-toc.svg)](https://www.npmjs.com/package/@domternal/extension-toc)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/domternal/domternal/blob/main/LICENSE)

Notion-style Table of Contents for the Domternal editor.

This package ships three opt-in pieces that all share a common heading-discovery data layer:

- **TableOfContents** - data layer: walks the doc, assigns stable `data-toc-id` attributes (independent of `UniqueID` so heading-level toggles do not break hash anchors), tracks the heading list and active state. Exposes `editor.storage.toc` and `editor.commands.scrollToHeading`.
- **FloatingTocOutline** - right-rail outline mounted outside `.dm-editor`. Three-state machine: `hidden` (when below `minHeadings` or on mobile), `collapsed` (compact ticks), `expanded` (hover or focus reveals a card with full heading text and per-level indent). Active tick + active row mirror the heading the user is currently reading.
- **TableOfContentsBlock** - inline `/toc` PM atom node. NodeView reactively renders the heading list inside the document. Slash-menu item registered via the standard `addFloatingMenuItems()` hook. Active state stays in sync with the floating outline.

All three pieces are opt-in - add any subset to your editor's `extensions` list. The data layer is the only required piece for the UI ones to work.

## Links

<u>[Website](https://domternal.dev)</u> &nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp; <u>[Documentation](https://domternal.dev/v1/extensions/table-of-contents)</u>

## Documentation

- <u>[Getting Started](https://domternal.dev/v1/getting-started)</u> - install and create your first editor
- <u>[Introduction](https://domternal.dev/v1/introduction)</u> - core concepts, architecture, and design decisions
- <u>[Packages & Bundle Size](https://domternal.dev/v1/packages)</u> - what each package includes and bundle size breakdown

## License

<u>[MIT](https://github.com/domternal/domternal/blob/main/LICENSE)</u>
