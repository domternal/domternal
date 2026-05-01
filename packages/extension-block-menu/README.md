# @domternal/extension-block-menu

[![Version](https://img.shields.io/npm/v/@domternal/extension-block-menu.svg)](https://www.npmjs.com/package/@domternal/extension-block-menu)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/domternal/domternal/blob/main/LICENSE)

Notion-style block manipulation extensions for the Domternal editor.

This package ships six complementary block-manipulation features that all share the same `addFloatingMenuItems()` extension hook and item contract in `@domternal/core`:

- **FloatingMenu** - shows an insert menu when the cursor is on an empty paragraph.
- **BlockHandle** - renders a gutter handle on hover: `+` to insert below, `⋮⋮` to drag-reorder or open the context menu.
- **SlashCommand** - opens a filtered suggestion popup when the user types `/`.
- **KeyboardReorder** - `Mod-Shift-Up` / `Mod-Shift-Down` moves the current top-level block.
- **BlockContextMenu** - small popup with Delete, Duplicate, Copy link, Colors, and Turn-into options.
- **SmartPaste** - preserves block formatting (heading, codeBlock, blockquote, lists, etc.) when pasting at inline positions, instead of letting ProseMirror's default fitter strip the wrapper.

All six features are opt-in - add any subset to your editor's `extensions` list.

## Links

<u>[Website](https://domternal.dev)</u> &nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp; <u>[Documentation](https://domternal.dev/v1/introduction)</u>

## Documentation

- <u>[Getting Started](https://domternal.dev/v1/getting-started)</u> - install and create your first editor
- <u>[Introduction](https://domternal.dev/v1/introduction)</u> - core concepts, architecture, and design decisions
- <u>[Packages & Bundle Size](https://domternal.dev/v1/packages)</u> - what each package includes and bundle size breakdown

## License

<u>[MIT](https://github.com/domternal/domternal/blob/main/LICENSE)</u>
