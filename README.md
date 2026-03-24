# Domternal

A lightweight, extensible rich text editor toolkit built on [ProseMirror](https://prosemirror.net/). Framework-agnostic headless core with first-class **Angular** support. Use it headless with vanilla JS/TS, add the built-in toolbar and theme, or drop in ready-made Angular components.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/domternal/domternal/actions/workflows/ci.yml/badge.svg)](https://github.com/domternal/domternal/actions/workflows/ci.yml)

## Features

- **Headless core** - use with any framework or vanilla JS/TS
- **Angular components** - editor, toolbar, bubble menu, floating menu, emoji picker (signals, OnPush, zoneless-ready)
- **Full table support** - cell merging, column resize, row/column controls, cell toolbar - all free
- **23 nodes, 9 marks, 25 extensions** - paragraphs, headings, lists, task lists, code blocks, blockquotes, images, tables, details/accordion, emoji, mentions, and more
- **112+ chainable commands** - `editor.chain().focus().toggleBold().run()`
- **Tree-shakeable** - import only what you use, unused code is stripped from the bundle
- **TypeScript first** - every schema, command, option, and event is fully typed
- **Light and dark theme** - 70+ CSS custom properties for full visual control
- **Inline styles export** - `getHTML({ styled: true })` produces inline CSS ready for email clients, CMS, and Google Docs
- **SSR helpers** - `generateHTML`, `generateJSON`, `generateText` for server-side rendering

## Quick Start (Vanilla JS/TS)

### Headless Core (Vanilla JS/TS)

```ts
import { Editor, Document, Text, Paragraph, Bold, Italic, Underline } from '@domternal/core';

const editor = new Editor({
  element: document.getElementById('editor')!,
  extensions: [Document, Text, Paragraph, Bold, Italic, Underline],
  content: '<p>Hello <strong>World</strong>!</p>',
});
```

Import only what you need for full control and zero bloat. Use `StarterKit` for a batteries-included setup with headings, lists, code blocks, history, and more.

### More Setups

> **[Getting Started Guide](https://domternal.dev/v1/getting-started)** - headless core, themed UI with toolbar, and Angular component setup
>
> **[StackBlitz (Angular)](https://stackblitz.com/edit/domternal-angular-full-example)** - full Angular example with all extensions, toolbar, and bubble menu
>
> **[StackBlitz (Vanilla TS)](https://stackblitz.com/edit/domternal-vanilla-full-example)** - full vanilla example with toolbar, bubble menu, and all extensions

## Packages

| Package | Description |
|---|---|
| [`@domternal/core`](https://www.npmjs.com/package/@domternal/core) | Editor engine with 13 nodes, 9 marks, 25 extensions, toolbar controller, and 45 built-in icons |
| [`@domternal/theme`](https://www.npmjs.com/package/@domternal/theme) | Light and dark themes with 70+ CSS custom properties |
| [`@domternal/angular`](https://www.npmjs.com/package/@domternal/angular) | 5 Angular components: editor, toolbar, bubble menu, floating menu, emoji picker |
| [`@domternal/pm`](https://www.npmjs.com/package/@domternal/pm) | ProseMirror re-exports (state, view, model, transform, commands, keymap, history, tables, and more) |
| [`@domternal/extension-table`](https://www.npmjs.com/package/@domternal/extension-table) | Tables with 18 commands: merge, split, resize, cell styling, row/column controls |
| [`@domternal/extension-image`](https://www.npmjs.com/package/@domternal/extension-image) | Image with paste/drop upload, URL input, XSS protection, bubble menu |
| [`@domternal/extension-emoji`](https://www.npmjs.com/package/@domternal/extension-emoji) | Emoji picker panel and `:shortcode:` autocomplete |
| [`@domternal/extension-mention`](https://www.npmjs.com/package/@domternal/extension-mention) | `@mention` autocomplete with multi-trigger and async support |
| [`@domternal/extension-details`](https://www.npmjs.com/package/@domternal/extension-details) | Collapsible details/accordion blocks |
| [`@domternal/extension-code-block-lowlight`](https://www.npmjs.com/package/@domternal/extension-code-block-lowlight) | Syntax-highlighted code blocks powered by lowlight |

See [Packages & Bundle Size](https://domternal.dev/v1/packages) for a full breakdown of what each package includes and how tree-shaking works.

## Documentation

Full documentation, live playground, and API reference at [domternal.dev](https://domternal.dev).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

```bash
pnpm install    # Install dependencies
pnpm build      # Build all packages
pnpm test       # Run tests
pnpm lint       # Run linter
pnpm typecheck  # Type check
```

Requires Node.js >= 20 and pnpm >= 10.

## License

[MIT](LICENSE)
