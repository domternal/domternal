# @domternal/vanilla

[![Version](https://img.shields.io/npm/v/@domternal/vanilla.svg)](https://www.npmjs.com/package/@domternal/vanilla)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/domternal/domternal/blob/main/LICENSE)

Framework-free DOM components for the [Domternal](https://domternal.dev) editor.
Most are classes you instantiate against a host element: `DomternalEditor`,
`DomternalToolbar`, `DomternalBubbleMenu`, `DomternalFloatingMenu`, and
`DomternalEmojiPicker`. `DomternalNotionColorPicker` is the exception: it takes only an
options object and resolves its own `.dm-editor` host from the editor. Every class extends
`EventTarget`, exposes plain getters and mutator methods, dispatches `CustomEvent`s for state
changes, and tears down with an idempotent `destroy()`. Use it in Astro, Svelte, Solid,
Lit, Web Components, or plain HTML - anywhere without a framework runtime.

## Links

<u>[Website](https://domternal.dev)</u> &nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp; <u>[Documentation](https://domternal.dev/v1/guides/vanilla)</u> &nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp; <u>[Live examples](https://domternal.dev/examples)</u>

## Install

```bash
pnpm add @domternal/core @domternal/theme @domternal/vanilla
```

`@domternal/core` (>=1.2.0 <2.0.0) is a peer dependency. `@domternal/theme` supplies the editor
styles (import it once in your app).

This package is part of the coordinated Domternal 1.2.0 release.
Upgrade installed `@domternal/*` packages together.

## Usage

```ts
import { StarterKit } from '@domternal/core';
import {
  DomternalEditor,
  DomternalToolbar,
  DomternalBubbleMenu,
} from '@domternal/vanilla';
import '@domternal/theme';

const toolbarEl = document.getElementById('toolbar')!;
const editorEl = document.getElementById('editor')!;
const bubbleEl = document.getElementById('bubble')!;

const dm = new DomternalEditor(editorEl, {
  extensions: [StarterKit],
  content: '<p>Hello world</p>',
  onUpdate: ({ editor }) => console.log(editor.getHTML()),
});

new DomternalToolbar(toolbarEl, { editor: dm.editor });
new DomternalBubbleMenu(bubbleEl, { editor: dm.editor });

// Reactive-friendly getters:
console.log(dm.htmlContent, dm.isEmpty);

// CustomEvent subscription:
dm.addEventListener('update', () => console.log('content changed'));

// Cleanup (idempotent):
dm.destroy();
```

The matching mount points:

```html
<div id="toolbar"></div>
<div id="editor" class="dm-editor"></div>
<div id="bubble" class="dm-bubble-menu"></div>
```

> Construction is browser-only: every constructor calls `assertBrowser()` and throws in
> SSR. Module-scope imports stay SSR-safe, so gate instantiation behind a client-side
> entry point (e.g. an Astro `<script>` block or `client:only`).

## Options

`DomternalEditorOptions`, the second constructor argument:

| Option | Type | Default | Description |
|---|---|---|---|
| `extensions` | `AnyExtension[]` | `[]` | Extensions merged on top of `DEFAULT_EXTENSIONS`. |
| `history` | `boolean` | `true` | Whether the built-in History extension is loaded. Turn it off when an extension brings its own undo. |
| `content` | `Content` | `''` | Initial content, HTML string or JSON. |
| `editable` | `boolean` | `true` | Whether the editor is editable. |
| `i18n` | `I18nOptions` | `{}` | Initial UI translations and formatting. Use `dm.editor.i18n.set()` for live replacement. |
| `preset` | `'classic' \| 'notion'` | `'classic'` | `'notion'` paints `dm-notion-mode` on the `.dm-editor` host and switches preset-aware extensions to their Notion behavior. Create-time only. |
| `autofocus` | `FocusPosition` | `false` | Where to place the caret on mount. |
| `outputFormat` | `'html' \| 'json'` | `'html'` | Format hint for host frameworks comparing controlled content. Does not change editor behavior. |

`onCreate`, `onUpdate`, `onSelectionChange`, `onFocus`, `onBlur`, and `onDestroy` callbacks are
accepted alongside them, and the same moments are dispatched on the instance as `create`,
`update`, `selectionchange`, `focus`, `blur`, and `destroy` `CustomEvent`s.

Toolbar, bubble-menu, and floating-menu `icons` options accept raw SVG through `IconSet`.
Use only trusted, developer-authored constants. Never build an `IconSet` from user input,
persisted document content, or an API response.

The wrapper has no locale subpath. Import `I18nOptions` from `@domternal/core`, and import
`deMessages` and `deSearchAliases` from `@domternal/core/locales/de` for its built-in
toolbar, menus, and pickers. Merge locale entries from any loaded extensions. Missing
messages fall back to English, and changing the UI language does not change authored
content. See the [i18n guide](https://domternal.dev/v1/guides/i18n) for complete examples.

## Exports

- `DomternalEditor` / `DomternalEditorOptions` - wraps core's `Editor`, plus
  `DEFAULT_EXTENSIONS` (Document, Paragraph, Text, BaseKeymap, History).
- `DomternalToolbar`, `DomternalBubbleMenu`, `DomternalFloatingMenu`,
  `DomternalEmojiPicker`, `DomternalNotionColorPicker` - the floating UI components.
- Shared helpers: `isBrowser`, `assertBrowser`, `createPluginKey`, `renderIconInto`,
  `resolveIcon`, `subscribe`.
