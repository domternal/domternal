# @domternal/extension-details

[![Version](https://img.shields.io/npm/v/@domternal/extension-details.svg)](https://www.npmjs.com/package/@domternal/extension-details)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/domternal/domternal/blob/main/LICENSE)

Collapsible blocks for the [Domternal](https://domternal.dev) editor. Each block has
an accessible disclosure button, an editable summary, and content that can contain
paragraphs, lists, or other registered block nodes. Documents serialize to semantic
`<details>` and `<summary>` HTML.

[Documentation](https://domternal.dev/v1/nodes/details/) · [Live examples](https://domternal.dev/examples/)

## Install

The package declares Node.js 22 or later for tooling.

```bash
pnpm add @domternal/core @domternal/pm @domternal/extension-details @domternal/theme
```

Requires `@domternal/core` and `@domternal/pm` `>=1.3.0 <2.0.0`.
Use version 1.3.1 for all installed Domternal packages.
The theme is optional if you provide your own styles.

## Quick start

Add a host, then run the TypeScript after it is mounted in a browser app that
supports CSS imports:

```html
<div class="dm-editor"><div id="editor"></div></div>
```

```ts
import { Editor, StarterKit } from '@domternal/core';
import { Details } from '@domternal/extension-details';
import '@domternal/theme';

const editor = new Editor({
  element: document.getElementById('editor')!,
  extensions: [StarterKit, Details.configure({ persist: true })],
  content: `
    <details open>
      <summary>Project notes</summary>
      <div data-details-content><p>Keep supporting information here.</p></div>
    </details>
  `,
});
```

`Details` includes its `DetailsSummary` and `DetailsContent` child nodes
automatically. `StarterKit` supplies the basic nodes and keyboard behavior.
Call `editor.destroy()` when removing the editor.

## Commands

Run these with the cursor or selection in the blocks you want to change:

```ts
editor.chain().focus().setDetails().openDetails().run();
editor.commands.toggleDetails();
editor.commands.unsetDetails();
editor.commands.closeDetails();
editor.commands.setDetailsOpen(true);
```

`setDetails()` wraps selected blocks, `unsetDetails()` unwraps the surrounding
details block, and `toggleDetails()` chooses between them. `openDetails()`,
`closeDetails()`, and `setDetailsOpen()` require `persist: true`.

The extension also contributes a Toggle block action to compatible toolbars and
insert menus. Add [block controls](https://domternal.dev/v1/extensions/block-controls/)
to expose it in a slash menu.

## Options

| Option | Default | Use |
| --- | --- | --- |
| `persist` | `false` | Save the open state in document JSON and HTML. Otherwise expansion is local UI state. |
| `openClassName` | `'is-open'` | Class applied to expanded blocks. Update your CSS if you change it. |
| `HTMLAttributes` | `{}` | Attributes on the serialized details element. |

Read-only editors still let readers expand and collapse content without writing
the open state back to the document.

## Editing and paste behavior

- `Enter` in the summary opens the block and moves into its content. If already
  open, it inserts a new block at the start of the content.
- `Backspace` at the start of the summary unwraps the block. `Enter` in the final
  empty content block exits the details block.
- `ArrowRight` at the end of a collapsed summary, or `ArrowDown` within it, moves
  to a gap cursor after the block. This needs `Gapcursor`, included in `StarterKit`.
- Pasting multiple blocks into the summary inserts them at the start of the
  content and opens it. Inline text and a single paragraph or heading join the
  summary. A block paste is one undoable change.
- Copying content without its summary pastes those blocks; including the summary
  copies the whole details block. Dropping blocks onto a summary is not supported
  by the paste-placement behavior.

See the [full reference](https://domternal.dev/v1/nodes/details/) for child-node
configuration, serialization, and clipboard integration.

## Localization

`detailsMessages` provides typed message keys. German `deMessages` and
`deSearchAliases` are exported from `@domternal/extension-details/locales/de`.
See the [localization guide](https://domternal.dev/v1/guides/i18n/) for combining
catalogs. Missing messages fall back to English.
