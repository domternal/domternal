# @domternal/vanilla

Polished DOM components for the [Domternal](https://domternal.dev) rich-text editor.

Use in **Astro**, **Svelte**, **Solid**, **Lit/Web Components**, or **plain HTML** - any environment without a framework runtime.

> **Status: pre-release (in development for v0.7.0).** Not yet published to npm.
> Component classes (`DomternalEditor`, `DomternalToolbar`, etc.) are scheduled
> for v0.7.0 first release. Current scaffold exports shared utilities only.

## Currently exported (scaffold phase)

```ts
import {
  // SSR safety
  isBrowser,
  assertBrowser,
  // Plugin key generation
  createPluginKey,
  // Icon rendering
  renderIconInto,
  resolveIcon,
  // Typed event subscription
  subscribe,
  // Shared types
  type CustomContentOption,
} from '@domternal/vanilla';
```

These low-level helpers are stable and can be used today by power users building
custom DOM wrappers over `@domternal/core` primitives.

## v0.7.0 release preview

When v0.7.0 ships, the full component API will be available:

```bash
pnpm add @domternal/vanilla @domternal/core @domternal/extension-block-menu @domternal/theme
```

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

Full API reference and Astro/Svelte/Solid integration guides will live at
[domternal.dev](https://domternal.dev) when v0.7.0 ships.

## License

MIT
