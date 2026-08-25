# Domternal

[![Domternal Editor](https://domternal.dev/readme/readme-banner.png?v=4)](https://domternal.dev)

A rich text editor toolkit built on [ProseMirror](https://prosemirror.net/), with a headless core and first-class **Angular**, **React**, **Vue**, and **Vanilla** components. Take the core alone and drive the DOM yourself, add the toolbar and theme for a finished editor, or mount the components for your framework. Notion-style block editing, drag handle, slash menu and floating outline included, and every package is tree-shakeable.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/domternal/domternal/actions/workflows/ci.yml/badge.svg)](https://github.com/domternal/domternal/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/domternal/domternal/graph/badge.svg)](https://codecov.io/gh/domternal/domternal)
[![npm](https://img.shields.io/npm/v/@domternal/core.svg?label=%40domternal%2Fcore)](https://www.npmjs.com/package/@domternal/core)

**[Website](https://domternal.dev)** · **[Getting Started](https://domternal.dev/v1/getting-started)** · **[Packages & Bundle Size](https://domternal.dev/v1/packages)**

**[Live examples](https://domternal.dev/playground)** - full editors for Angular, React, Vue, and Vanilla, editable in the browser

## Features

- **Headless core** - use with any framework or vanilla JS/TS
- **Angular components** - editor, toolbar, bubble menu, floating menu, emoji picker, notion color picker (Angular 17.1+, signals, OnPush, zoneless-ready)
- **React components** - composable `Domternal` component, toolbar, bubble menu, floating menu, emoji picker, notion color picker, custom node views (React 18+)
- **Vue components** - composable `Domternal` component, `useEditor`/`useEditorState` composables, toolbar, bubble menu, floating menu, emoji picker, notion color picker, custom node views (Vue 3.3+)
- **Vanilla wrapper** - framework-free class-based API for Astro, Svelte, Solid, plain HTML, and Web Components - editor, toolbar, bubble menu, floating menu, emoji picker, notion color picker
- **Notion-style block UX** - drag-to-reorder, block context menu, slash command, smart paste, keyboard reorder, floating Table of Contents, from `@domternal/extension-block-controls` and `@domternal/extension-toc`, with `preset: 'notion'` for the layout and preset-aware behavior
- **Print to paper or PDF** - `printDocument()` leaves your app's chrome off the page, and the theme's paper layer applies to the reader's own Ctrl/Cmd+P with no code involved
- **74 extensions across core and 10 extension packages** - nodes, marks, and behavior extensions
- **130+ chainable commands** - `editor.chain().focus().toggleBold().run()`
- **Full table support** - cell merging, column resize, row/column controls, cell toolbar
- **Tree-shakeable** - import only what you use, your bundler strips the rest
- **~48 KB gzipped** (own code), [~129 KB total](https://domternal.dev/v1/packages) with ProseMirror - see Packages for full bundle breakdown
- **TypeScript first** - every package builds under `strict`, with `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`
- **17,800+ tests** - 4,700+ unit and 13,100+ E2E across 309 Playwright spec files and 4 demo apps
- **Light and dark theme** - 160 CSS custom properties for full visual control
- **Inline styles export** - `getHTML({ styled: true })` produces inline CSS ready for email clients, CMS, and Google Docs
- **SSR helpers** - `generateHTML`, `generateJSON`, `generateText` for server-side rendering

## Quick Start

### Headless (Vanilla JS/TS)

```bash
pnpm add @domternal/core
```

```ts
import { Editor, Document, Text, Paragraph, Bold, Italic, Underline } from '@domternal/core';

const editor = new Editor({
  element: document.getElementById('editor')!,
  extensions: [Document, Text, Paragraph, Bold, Italic, Underline],
  content: '<p>Hello <strong>World</strong>!</p>',
});
```

The example above wires the minimum schema by hand to show the headless model; in practice use `StarterKit` for a batteries-included setup with headings, lists, code blocks, history, and more.

> **[Getting Started Guide](https://domternal.dev/v1/getting-started)** - headless core, themed UI with toolbar, and Angular/React/Vue component setup

## Packages

| Package | Description |
|---|---|
| [`@domternal/core`](https://www.npmjs.com/package/@domternal/core) | Editor engine with 13 nodes, 9 marks, 28 extensions, toolbar controller, and 52 built-in icons |
| [`@domternal/theme`](https://www.npmjs.com/package/@domternal/theme) | Light and dark themes with 160 CSS custom properties |
| [`@domternal/angular`](https://www.npmjs.com/package/@domternal/angular) | Angular 17.1+ wrapper: 6 components (editor, toolbar, bubble menu, floating menu, emoji picker, notion color picker) |
| [`@domternal/react`](https://www.npmjs.com/package/@domternal/react) | React 18+ wrapper: composable component, toolbar, bubble menu, floating menu, emoji picker, notion color picker, node views |
| [`@domternal/vue`](https://www.npmjs.com/package/@domternal/vue) | Vue 3.3+ wrapper: composable component, composables, toolbar, bubble menu, floating menu, emoji picker, notion color picker, node views |
| [`@domternal/vanilla`](https://www.npmjs.com/package/@domternal/vanilla) | Framework-free class-based wrapper for Astro, Svelte, Solid, plain HTML, and Web Components |
| [`@domternal/pm`](https://www.npmjs.com/package/@domternal/pm) | ProseMirror re-exports (state, view, model, transform, commands, keymap, history, tables, and more) |
| [`@domternal/extension-block-controls`](https://www.npmjs.com/package/@domternal/extension-block-controls) | Notion-style block UX: block handle, context menu, drag-to-reorder, keyboard reorder, slash command, floating menu, smart paste (formerly `@domternal/extension-block-menu`) |
| [`@domternal/extension-toc`](https://www.npmjs.com/package/@domternal/extension-toc) | Notion-style Table of Contents: floating outline, inline `/toc` block, `scrollToHeading` command |
| [`@domternal/extension-table`](https://www.npmjs.com/package/@domternal/extension-table) | Tables with 18 commands: merge, split, resize, cell styling, row/column controls |
| [`@domternal/extension-math`](https://www.npmjs.com/package/@domternal/extension-math) | LaTeX math: inline and block equations with a pluggable renderer (KaTeX) |
| [`@domternal/extension-markdown`](https://www.npmjs.com/package/@domternal/extension-markdown) | GitHub-flavored Markdown import and export: markdown paste, `insertMarkdown`/`setMarkdownContent`, headless parser and serializer with fidelity warnings |
| [`@domternal/extension-image`](https://www.npmjs.com/package/@domternal/extension-image) | Image with paste/drop upload, URL input, XSS protection, bubble menu |
| [`@domternal/extension-emoji`](https://www.npmjs.com/package/@domternal/extension-emoji) | Emoji picker panel and `:shortcode:` autocomplete |
| [`@domternal/extension-mention`](https://www.npmjs.com/package/@domternal/extension-mention) | `@mention` autocomplete with multi-trigger and async support |
| [`@domternal/extension-details`](https://www.npmjs.com/package/@domternal/extension-details) | Collapsible details/accordion blocks |
| [`@domternal/extension-code-block-lowlight`](https://www.npmjs.com/package/@domternal/extension-code-block-lowlight) | Syntax-highlighted code blocks powered by lowlight |

`@domternal/extension-block-menu`, the deprecated shim left from the v0.10.0 rename, shipped through the 0.x line only and is not published for 1.x. Import `@domternal/extension-block-controls` directly.

See [Packages & Bundle Size](https://domternal.dev/v1/packages) for a full breakdown of what each package includes and how tree-shaking works.

## Documentation

Full documentation, live playgrounds, and API reference at **[domternal.dev](https://domternal.dev)**.

- [Getting Started](https://domternal.dev/v1/getting-started) - install and create your first editor
- [Introduction](https://domternal.dev/v1/introduction) - core concepts, architecture, and design decisions
- [Packages & Bundle Size](https://domternal.dev/v1/packages) - what each package includes and bundle size breakdown

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for commit conventions, PR guidelines, and development setup.

```bash
pnpm install    # Install dependencies
pnpm build      # Build all packages
pnpm test       # Run tests
pnpm lint       # Run linter
pnpm typecheck  # Type check
```

Requires Node.js >= 22 and pnpm >= 10.

## License

[MIT](LICENSE)
