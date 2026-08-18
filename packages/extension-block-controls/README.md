# @domternal/extension-block-controls

[![Version](https://img.shields.io/npm/v/@domternal/extension-block-controls.svg)](https://www.npmjs.com/package/@domternal/extension-block-controls)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/domternal/domternal/blob/main/LICENSE)

Notion-style block controls for the [Domternal](https://domternal.dev) editor. Ships
six coordinated extensions: `BlockHandle`, `BlockContextMenu`, `SlashCommand`,
`SmartPaste`, `KeyboardReorder`, and `FloatingMenu` (each described under
[Extensions](#extensions) below). They cooperate through DOM events, so opening one
overlay closes the others.

## Links

<u>[Website](https://domternal.dev)</u> &nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp; <u>[Documentation](https://domternal.dev/v1/extensions/block-controls)</u> &nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp; <u>[Live examples](https://domternal.dev/examples)</u>

## Install

```bash
pnpm add @domternal/extension-block-controls
```

`@domternal/core` and `@domternal/pm` are peer dependencies and are pulled in by any
Domternal editor setup.

## Usage

Add the extensions you want to your editor's extension list. Most apps use the full set
together for the Notion experience:

```ts
import { Editor, StarterKit } from '@domternal/core';
import {
  BlockHandle,
  BlockContextMenu,
  SlashCommand,
  SmartPaste,
  KeyboardReorder,
  FloatingMenu,
} from '@domternal/extension-block-controls';
import '@domternal/theme';

const editor = new Editor({
  element: document.getElementById('editor')!,
  extensions: [
    StarterKit,
    BlockHandle.configure({ nested: true }),
    BlockContextMenu,
    SlashCommand,
    SmartPaste,
    KeyboardReorder,
    FloatingMenu.configure({
      element: document.getElementById('floating-menu')!,
      requireExplicitTrigger: true,
    }),
  ],
});
```

The `SlashCommand` and `FloatingMenu` popups draw their items from
`editor.floatingMenuItems` (collected from every extension's `addFloatingMenuItems()`
hook), so installed extensions register their own insert actions automatically.

## Extensions

- **`BlockHandle`** - hover gutter with a `+` insert button and a drag handle. The `+`
  button inserts an empty paragraph and opens the `FloatingMenu`; the drag handle opens
  the context menu on click and reorders with a nesting-aware drop indicator on drag.
  Two experimental extension points serve side-by-side layout extensions:
  `dropZoneProviders` (claim pointer positions during a handle drag and own the drop)
  and `nested.anchorContainers` (per-block handles inside listed containers, anchored
  to the container's edge). They are two halves of one containment model: always ship
  both together, or moves out of the container become irreversible.
- **`BlockContextMenu`** - Delete / Duplicate / Turn into actions, opened from the drag
  handle. Also shows a "Copy link" item when the block has an id (and `UniqueID` is
  loaded), and a "Colors" section when the `BlockColor` extension is loaded; each is
  toggleable via `turnIntoEnabled` / `copyLinkEnabled` / `blockColorEnabled`.
  `turnIntoTargets` curates the block types offered by "Turn into", and `onCopyLink`
  builds the URL written to the clipboard. Other extensions add their own entries
  through `addBlockMenuItems()` (see [Extension points](#extension-points)).
- **`SlashCommand`** - typing `/` opens a filtered, ranked popup of insertable blocks;
  selecting one replaces the `/query` range and runs the item's command.
- **`SmartPaste`** - keeps block-level formatting intact when pasting at an inline cursor.
- **`KeyboardReorder`** - `Mod-Shift-ArrowUp` / `Mod-Shift-ArrowDown` move the current
  top-level block.
- **`FloatingMenu`** - the empty-line insert menu; `requireExplicitTrigger` gates it
  behind the `+` button for Notion mode.

## Extension points

- `addBlockMenuItems()` - any extension contributes entries to the block handle menu,
  the same shape `addToolbarItems()` uses. An item declares `id`, `label`, `icon`,
  `group` (`primary`, `colors`, `turnInto`, `collaboration`), an optional `order`, and
  `run`; `isAvailable` hides it, `isEnabled` renders it inert with a reason. This
  package builds the button, so a contributed entry keeps the menu's `role="menuitem"`,
  roving tabindex, and arrow-key navigation. `BlockMenuItem`, `BlockMenuItemContext`,
  and `BlockMenuItemGroup` are exported for the declaration; the full contract is in
  the [documentation](https://domternal.dev/v1/extensions/block-controls/#contributed-items-addblockmenuitems).
- `keepOnDuplicate: false` on a mark (`Mark.create()` in `@domternal/core`) drops that
  mark from the copy Duplicate inserts, throughout the subtree. Set it on marks that
  reference identity living outside the document, such as a comment thread anchor.
- `dropZoneProviders` and `nested.anchorContainers` on `BlockHandle` are two more, both
  experimental and described under [Extensions](#extensions).
