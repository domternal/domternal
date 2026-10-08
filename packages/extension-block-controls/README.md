# @domternal/extension-block-controls

[![Version](https://img.shields.io/npm/v/@domternal/extension-block-controls.svg)](https://www.npmjs.com/package/@domternal/extension-block-controls)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/domternal/domternal/blob/main/LICENSE)

Block handles, drag reordering, context menus, slash commands, and block-aware paste
for the [Domternal](https://domternal.dev) editor. Choose the extensions your app
needs, or combine them for a Notion-style editing experience.

[Documentation](https://domternal.dev/v1/extensions/block-controls/) · [Live examples](https://domternal.dev/examples/)

## Install

The package declares Node.js 22 or later for tooling.

```bash
pnpm add @domternal/core @domternal/pm @domternal/extension-block-controls @domternal/vanilla @domternal/theme
```

The extension requires `@domternal/core` and `@domternal/pm` `>=1.3.0 <2.0.0`.
Use version 1.3.1 for all installed Domternal packages.
The example uses `@domternal/vanilla` for the rendered insert menu and
`@domternal/theme` for styling; both are optional if you provide your own UI.

## Quick start

Add a host to your page, then run the TypeScript after it is mounted in a browser
app that supports CSS imports:

```html
<div class="dm-editor">
  <div id="editor"></div>
  <div id="insert-menu"></div>
</div>
```

```ts
import { Editor, StarterKit, UniqueID } from '@domternal/core';
import {
  BlockHandle,
  BlockContextMenu,
  SlashCommand,
  SmartPaste,
  KeyboardReorder,
} from '@domternal/extension-block-controls';
import { DomternalFloatingMenu } from '@domternal/vanilla';
import '@domternal/theme';

const editor = new Editor({
  element: document.getElementById('editor')!,
  extensions: [
    StarterKit,
    UniqueID,
    BlockHandle.configure({ nested: true }),
    BlockContextMenu,
    SlashCommand,
    SmartPaste,
    KeyboardReorder,
  ],
  content: '<p>Hover beside this block, or type / on a new line.</p>',
});

const insertMenu = new DomternalFloatingMenu(
  document.getElementById('insert-menu')!,
  { editor, requireExplicitTrigger: true },
);
```

Hover beside a block to reveal its handle. Click `+` to insert a paragraph and
open the insert menu, click the drag handle for block actions, or drag it to reorder.
Type `/` for the slash menu. `Mod-Shift-ArrowUp` and `Mod-Shift-ArrowDown` move the
current top-level block (`Mod` is Command on macOS and Ctrl elsewhere).

When removing this editor, call `insertMenu.destroy()` before `editor.destroy()`.

## Choose your controls

| Extension | What it adds |
| --- | --- |
| `BlockHandle` | Hover handle, `+` button, drag reordering, and a drop indicator. `nested: true` enables individual list and task-item handles. |
| `BlockContextMenu` | Delete, Duplicate, and Turn into actions. Copy link needs `UniqueID`; Colors needs the core `BlockColor` extension. |
| `SlashCommand` | A searchable insert popup with a built-in DOM renderer. |
| `SmartPaste` | Preserves block structure when pasting at a caret or text selection inside a textblock. |
| `KeyboardReorder` | Keyboard shortcuts for moving top-level blocks. |
| `FloatingMenu` | Visibility and positioning for an insert menu whose DOM you supply. |

`DomternalFloatingMenu` in the example renders the menu and registers its positioning
plugin. Do not also register `FloatingMenu` for that same menu. For a custom UI, use
`FloatingMenu.configure({ element, requireExplicitTrigger: true })` and render the
items yourself, or use the floating-menu component from your framework package.

Slash and floating-menu items come from installed extensions' `addFloatingMenuItems()`
hooks. Registering a node such as Details or Math adds its insert action automatically.

## Common configuration

- Use `BlockHandle.configure({ disableDrag: true })` to retain the buttons while
  disabling drag reordering.
- Use `BlockContextMenu.configure({ copyLinkEnabled: false })` to hide Copy link.
  `turnIntoTargets` curates conversion choices; `onCopyLink` builds the copied URL.
- Use the `items` callback in `SlashCommand.configure()` to filter or reorder the
  insert menu. See the [item contract](https://domternal.dev/v1/extensions/floating-menu/)
  for available fields and commands.
- Pass `icons` to `SlashCommand.configure()` to override the default popup's SVGs.
  Icon values must be trusted application constants. Pass the same map separately
  to your toolbar or floating-menu component when those surfaces need it too.

## Paste behavior

`SmartPaste` controls where parsed blocks are inserted. It keeps copied inline text
inline, preserves list structure where the schema allows it, and respects nodes such
as Details that redirect block pastes into their content. Selections whose start is outside a textblock, such as whole-document and
block-node selections, use ProseMirror's default paste handling. See the
[paste behavior reference](https://domternal.dev/v1/extensions/block-controls/#smartpaste)
for list merging, nested selections, and fallback behavior.

HTML cleanup is a separate, explicit choice. Add
[`PasteCleanup`](https://domternal.dev/v1/extensions/paste-cleanup/) when you want its
Office cleanup, typography, or unsupported-content policy. `SmartPaste` does not
enable that policy. With both extensions, explicit list markers and ordered-list
starts are preserved; incompatible explicit markers keep pasted lists separate.

## Custom integrations

Use [`addBlockMenuItems()`](https://domternal.dev/v1/extensions/block-controls/#contributed-items-addblockmenuitems)
to contribute actions while retaining the menu's keyboard navigation. Marks that
reference external identity can declare `keepOnDuplicate: false` to exclude them
from duplicated blocks.

Custom layout extensions can use the experimental `dropZoneProviders` and
`nested.anchorContainers` options. Implement both sides of the containment model
so blocks can move into and back out of the layout. See
[drop zones](https://domternal.dev/v1/extensions/block-controls/#drop-zone-providers-experimental)
and [anchor containers](https://domternal.dev/v1/extensions/block-controls/#anchor-containers-experimental).

## Localization

`blockControlsMessages` provides typed message keys. German `deMessages` and
`deSearchAliases` are exported from `@domternal/extension-block-controls/locales/de`.
Merge them with the core catalog as described in the
[localization guide](https://domternal.dev/v1/guides/i18n/). Missing messages fall
back to English; labels for your custom items remain yours to translate.
