# @domternal/vanilla

[![Version](https://img.shields.io/npm/v/@domternal/vanilla.svg)](https://www.npmjs.com/package/@domternal/vanilla)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/domternal/domternal/blob/main/LICENSE)

Framework-free DOM components for the [Domternal](https://domternal.dev) rich text
editor. Mount an editor, toolbar, and menus on ordinary elements, with getters,
methods, and `CustomEvent` subscriptions. Use it in plain JavaScript or client-side
integrations for Astro, Svelte, Solid, Lit, and Web Components.

## Install

```bash
pnpm add @domternal/vanilla @domternal/core @domternal/theme
```

The package declares Node.js 22 or later for tooling. Requires `@domternal/core >=1.3.0 <2.0.0`.
Use version 1.3.1 for all installed Domternal packages. The theme supplies the default styles.

## Quick start

Add the mount elements to your page:

```html
<div id="toolbar"></div>
<div id="editor" class="dm-editor"></div>
<div id="bubble"></div>
```

Run this through your application's bundler after those elements exist:

```ts
import { StarterKit } from '@domternal/core';
import {
  DomternalEditor,
  DomternalToolbar,
  DomternalBubbleMenu,
} from '@domternal/vanilla';
import '@domternal/theme';

const dm = new DomternalEditor(document.getElementById('editor')!, {
  extensions: [StarterKit],
  content: '<p>Hello from JavaScript!</p>',
  onUpdate: ({ editor }) => console.log(editor.getHTML()),
});

const toolbar = new DomternalToolbar(document.getElementById('toolbar')!, {
  editor: dm.editor,
});
const bubble = new DomternalBubbleMenu(document.getElementById('bubble')!, {
  editor: dm.editor,
  items: ['bold', 'italic', 'underline'],
});
```

UI components add their own CSS classes and render controls from the loaded
extensions. Keep `dm-editor` on the editor host to apply the theme. Module imports are safe during SSR, but constructors require a browser:
instantiate them in your framework's client mount hook.

Destroy each UI instance before the editor when your page or component unmounts:

```ts
bubble.destroy();
toolbar.destroy();
dm.destroy();
```

## Read and update content

```ts
const html = dm.htmlContent;
const json = dm.jsonContent;

// Replace content without notifying update listeners.
dm.setContent('<p>Loaded document</p>', false);

// Access the underlying editor for commands and other APIs.
dm.editor.chain().focus().toggleBold().run();
```

Use the `onUpdate` option or `dm.addEventListener('update', handler)` to subscribe
to document changes. The [Vanilla guide](https://domternal.dev/v1/guides/vanilla/)
documents getters, methods, options, and each component's events.

## Configuration notes

- The wrapper includes `Document`, `Paragraph`, `Text`, `BaseKeymap`, and `History`.
  To use another undo manager, set `history: false` and omit History from your
  extensions, including [StarterKit's history](https://domternal.dev/v1/extensions/history/#disabling-the-built-in-history).
- `content` accepts HTML or JSON. Use `getHTML()` or `getJSON()` on `dm.editor`
  to choose an output format; the wrapper's `outputFormat` option is only a hint
  for host integrations.
- Use `dm.setEditable(false)` for read-only mode. `preset: 'notion'` is read at creation. Set initial translations with `i18n` and
  replace them live with `dm.editor.i18n.set()`.
- Initial `onContentError` and `onContentDiagnostic` reports arrive during
  construction. Provide callbacks to receive them; event listeners added afterward
  receive only later reports. See [content diagnostics](https://domternal.dev/v1/guides/editor-api/#content-diagnostics).
- Custom `icons` contain raw SVG. Supply trusted, developer-authored constants.

## Further reading

- [Vanilla guide and component reference](https://domternal.dev/v1/guides/vanilla/)
- [Editor commands and content API](https://domternal.dev/v1/guides/editor-api/)
- [Theming](https://domternal.dev/v1/guides/theming/) and [localization with `i18n`](https://domternal.dev/v1/guides/i18n/#vanilla)
- [Optional clipboard HTML cleanup](https://domternal.dev/v1/extensions/paste-cleanup/)
