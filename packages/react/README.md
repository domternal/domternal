# @domternal/react

[![Version](https://img.shields.io/npm/v/@domternal/react.svg)](https://www.npmjs.com/package/@domternal/react)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/domternal/domternal/blob/main/LICENSE)

A lightweight, extensible rich text editor toolkit built on <u>[ProseMirror](https://prosemirror.net/)</u>. Framework-agnostic headless core with first-class React support.  
Use it headless with vanilla JS/TS, add the built-in toolbar and theme, or drop in ready-made React components. Fully tree-shakeable, import only what you use, unused extensions are stripped from your bundle.

## Links

<u>[Website](https://domternal.dev)</u> &nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp; <u>[Documentation](https://domternal.dev/v1/introduction)</u> &nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp; <u>[StackBlitz (Vanilla TS)](https://stackblitz.com/edit/domternal-vanilla-full-example)</u> &nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp; <u>[StackBlitz (Angular)](https://stackblitz.com/edit/domternal-angular-full-example)</u>

## Features

See <u>[Packages & Bundle Size](https://domternal.dev/v1/packages)</u> for a full breakdown of all packages and what each one includes.

- **Headless core** - use with any framework or vanilla JS/TS
- **React components** - `Domternal` composable component, toolbar, bubble menu, floating menu, emoji picker, custom node views
- **57 extensions across 11 packages** - 23 nodes, 9 marks, and 25 behavior extensions
- **140+ chainable commands** - `editor.chain().focus().toggleBold().run()`
- **Full table support** - cell merging, column resize, row/column controls, cell toolbar, all free and MIT licensed
- **Tree-shakeable** - import only what you use, your bundler strips the rest
- **TypeScript first** - 100% typed
- **6,000+ tests** - 2,687 unit tests and 3,700+ E2E tests
- **Light and dark theme** - 70+ CSS custom properties for full visual control
- **Inline styles export** - `getHTML({ styled: true })` produces inline CSS ready for email clients, CMS, and Google Docs
- **SSR helpers** - `generateHTML`, `generateJSON`, `generateText` for server-side rendering

## Quick Start

```tsx
import { Domternal } from '@domternal/react';
import { StarterKit, BubbleMenu } from '@domternal/core';

export default function Editor() {
  return (
    <Domternal
      extensions={[StarterKit, BubbleMenu]}
      content="<p>Hello!</p>"
    >
      <Domternal.Toolbar />
      <Domternal.Content />
      <Domternal.BubbleMenu />
    </Domternal>
  );
}
```

## Documentation

- <u>[Getting Started](https://domternal.dev/v1/getting-started)</u> - install and create your first editor
- <u>[Introduction](https://domternal.dev/v1/introduction)</u> - core concepts, architecture, and design decisions
- <u>[Packages & Bundle Size](https://domternal.dev/v1/packages)</u> - what each package includes and bundle size breakdown
- <u>[Blog](https://domternal.dev/blog)</u>

## License

<u>[MIT](https://github.com/domternal/domternal/blob/main/LICENSE)</u>
