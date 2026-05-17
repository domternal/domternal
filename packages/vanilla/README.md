# @domternal/vanilla

Polished DOM components for the [Domternal](https://domternal.dev) rich-text editor.

Use in **Astro**, **Svelte**, **Solid**, **Lit/Web Components**, or **plain HTML** - any environment without a framework runtime.

> Status: **0.7.0** - first release. API may evolve before 1.0.

## Install

```bash
pnpm add @domternal/vanilla @domternal/core @domternal/extension-block-menu @domternal/theme
```

## Quickstart

```ts
import { Editor, StarterKit } from '@domternal/core';
import { DomternalToolbar, DomternalBubbleMenu } from '@domternal/vanilla';
import '@domternal/theme';

const editor = new Editor({
  element: document.getElementById('editor')!,
  extensions: [StarterKit],
});

new DomternalToolbar(document.getElementById('toolbar')!, { editor });
new DomternalBubbleMenu(document.getElementById('bubble')!, { editor });
```

Full API reference and Astro/Svelte/Solid integration guides: see [domternal.dev](https://domternal.dev).

## License

MIT
