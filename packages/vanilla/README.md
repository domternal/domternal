# @domternal/vanilla

[![Version](https://img.shields.io/npm/v/@domternal/vanilla.svg)](https://www.npmjs.com/package/@domternal/vanilla)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/domternal/domternal/blob/main/LICENSE)

Framework-free DOM components for the [Domternal](https://domternal.dev) editor.
Each component is a class you instantiate against a host element:
`DomternalEditor`, `DomternalToolbar`, `DomternalBubbleMenu`, `DomternalFloatingMenu`,
`DomternalEmojiPicker`, and `DomternalNotionColorPicker`. Every class extends
`EventTarget`, exposes plain getters and mutator methods, dispatches `CustomEvent`s for state
changes, and tears down with an idempotent `destroy()`. Use it in Astro, Svelte, Solid,
Lit, Web Components, or plain HTML - anywhere without a framework runtime.

## Links

<u>[Website](https://domternal.dev)</u> &nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp; <u>[Documentation](https://domternal.dev/v1/guides/vanilla)</u> &nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp; <u>[Live examples](https://domternal.dev/examples)</u>

## Install

```bash
pnpm add @domternal/core @domternal/theme @domternal/vanilla
```

`@domternal/core` is a peer dependency. `@domternal/theme` supplies the editor styles
(import it once in your app).

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

## Exports

- `DomternalEditor` / `DomternalEditorOptions` - wraps core's `Editor`, plus
  `DEFAULT_EXTENSIONS` (Document, Paragraph, Text, BaseKeymap, History).
- `DomternalToolbar`, `DomternalBubbleMenu`, `DomternalFloatingMenu`,
  `DomternalEmojiPicker`, `DomternalNotionColorPicker` - the floating UI components.
- Shared helpers: `isBrowser`, `assertBrowser`, `createPluginKey`, `renderIconInto`,
  `resolveIcon`, `subscribe`.
