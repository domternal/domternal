# @domternal/extension-table

[![Version](https://img.shields.io/npm/v/@domternal/extension-table.svg)](https://www.npmjs.com/package/@domternal/extension-table)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/domternal/domternal/blob/main/LICENSE)

A lightweight, extensible rich text editor toolkit built on <u>[ProseMirror](https://prosemirror.net/)</u>. Framework-agnostic headless core with first-class Angular, React, Vue, and Vanilla wrappers.
Use it headless with vanilla JS/TS, add the built-in toolbar and theme, or drop in ready-made framework components. Fully tree-shakeable, import only what you use, unused extensions are stripped from your bundle.

## Links

<u>[Website](https://domternal.dev)</u> &nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp; <u>[Documentation](https://domternal.dev/v1/introduction)</u> &nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp;
<u>[StackBlitz (Angular)](https://stackblitz.com/edit/domternal-angular-full-example)</u> &nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp; <u>[StackBlitz (React)](https://stackblitz.com/edit/domternal-react-full-example)</u> &nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp; <u>[StackBlitz (Vue)](https://stackblitz.com/edit/domternal-vue-full-example)</u> &nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp; <u>[StackBlitz (Vanilla TS)](https://stackblitz.com/edit/domternal-vanilla-full-example)</u>

## Features

See <u>[Packages & Bundle Size](https://domternal.dev/v1/packages)</u> for a full breakdown of all packages and what each one includes.

- **Headless core** - use with any framework or vanilla JS/TS
- **Angular components** - editor, toolbar, bubble menu, floating menu, emoji picker, notion color picker (signals, OnPush, zoneless-ready)
- **React components** - composable `Domternal` component, toolbar, bubble menu, floating menu, emoji picker, notion color picker, custom node views (React 18+)
- **Vue components** - composable `Domternal` component, `useEditor`/`useEditorState` composables, toolbar, bubble menu, floating menu, emoji picker, notion color picker, custom node views (Vue 3.3+)
- **Vanilla wrapper** - framework-free class-based API for Astro, Svelte, Solid, plain HTML, and Web Components - editor, toolbar, bubble menu, floating menu, emoji picker, notion color picker
- **Notion-style block UX** - drag-to-reorder, block context menu, slash command, smart paste, keyboard reorder, floating Table of Contents
- **70+ extensions across 16 packages** - nodes, marks, and behavior extensions
- **125+ chainable commands** - `editor.chain().focus().toggleBold().run()`
- **Full table support** - cell merging, column resize, row/column controls, cell toolbar, all free and MIT licensed
- **Tree-shakeable** - import only what you use, your bundler strips the rest
- **~44 KB gzipped** (own code), <u>[see Packages](https://domternal.dev/v1/packages)</u> for full bundle breakdown with ProseMirror
- **TypeScript first** - 100% typed, zero `any`
- **15,000+ tests** - 4,000+ unit and 11,000+ E2E across 230+ Playwright specs and 4 demo apps
- **Light and dark theme** - 120+ CSS custom properties for full visual control
- **Inline styles export** - `getHTML({ styled: true })` produces inline CSS ready for email clients, CMS, and Google Docs
- **SSR helpers** - `generateHTML`, `generateJSON`, `generateText` for server-side rendering

## Documentation

- <u>[Getting Started](https://domternal.dev/v1/getting-started)</u> - install and create your first editor
- <u>[Introduction](https://domternal.dev/v1/introduction)</u> - core concepts, architecture, and design decisions
- <u>[Packages & Bundle Size](https://domternal.dev/v1/packages)</u> - what each package includes and bundle size breakdown
- <u>[Blog](https://domternal.dev/blog)</u>

## License

<u>[MIT](https://github.com/domternal/domternal/blob/main/LICENSE)</u>
