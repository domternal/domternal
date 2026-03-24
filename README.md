# Domternal

[![Domternal Editor](https://domternal.dev/readme/readme-banner.png)](https://domternal.dev)

A lightweight, extensible rich text editor toolkit built on [ProseMirror](https://prosemirror.net/). Framework-agnostic headless core with first-class **Angular** support. Use it headless with vanilla JS/TS, add the built-in toolbar and theme, or drop in ready-made Angular components.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/domternal/domternal/actions/workflows/ci.yml/badge.svg)](https://github.com/domternal/domternal/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@domternal/core.svg?label=%40domternal%2Fcore)](https://www.npmjs.com/package/@domternal/core)

**[Website](https://domternal.dev)** · **[Getting Started](https://domternal.dev/v1/getting-started)** · **[Packages & Bundle Size](https://domternal.dev/v1/packages)** · **[StackBlitz (Angular)](https://stackblitz.com/edit/domternal-angular-full-example)** · **[StackBlitz (Vanilla TS)](https://stackblitz.com/edit/domternal-vanilla-full-example)**

## Features

- **Headless core** - use with any framework or vanilla JS/TS
- **Angular components** - editor, toolbar, bubble menu, floating menu, emoji picker (signals, OnPush, zoneless-ready)
- **57 extensions across 10 packages** - 23 nodes, 9 marks, and 25 behavior extensions
- **140+ chainable commands** - `editor.chain().focus().toggleBold().run()`
- **Full table support** - cell merging, column resize, row/column controls, cell toolbar, all free and MIT licensed
- **Tree-shakeable** - import only what you use, your bundler strips the rest
- **~38 KB gzipped** (own code), [~108 KB total](https://domternal.dev/v1/packages) with ProseMirror
- **TypeScript first** - 100% typed, zero `any`
- **4,200+ tests** - 2,675 unit tests and 1,550 E2E tests across 34 Playwright specs
- **Light and dark theme** - 70+ CSS custom properties for full visual control
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

Import only what you need for full control and zero bloat. Use `StarterKit` for a batteries-included setup with headings, lists, code blocks, history, and more.

> **[Try the full Vanilla TS example on StackBlitz](https://stackblitz.com/edit/domternal-vanilla-full-example)** with toolbar, bubble menu, and all extensions.

### With Theme and Toolbar (Vanilla JS/TS)

```bash
pnpm add @domternal/core @domternal/theme
```

```html
<div id="editor" class="dm-editor"></div>
```

```ts
import { Editor, StarterKit, defaultIcons } from '@domternal/core';
import '@domternal/theme';

const editorEl = document.getElementById('editor')!;

// Toolbar
const toolbar = document.createElement('div');
toolbar.className = 'dm-toolbar';
toolbar.innerHTML = `<div class="dm-toolbar-group">
  <button class="dm-toolbar-button" data-mark="bold">${defaultIcons.textB}</button>
  <button class="dm-toolbar-button" data-mark="italic">${defaultIcons.textItalic}</button>
  <button class="dm-toolbar-button" data-mark="underline">${defaultIcons.textUnderline}</button>
</div>`;
editorEl.before(toolbar);

// Editor
const editor = new Editor({
  element: editorEl,
  extensions: [StarterKit],
  content: '<p>Hello world</p>',
});

// Toggle marks on click (event delegation)
toolbar.addEventListener('click', (e) => {
  const btn = (e.target as Element).closest<HTMLButtonElement>('[data-mark]');
  if (!btn) return;
  editor.chain().focus().toggleMark(btn.dataset.mark!).run();
});

// Active state sync
editor.on('transaction', () => {
  toolbar.querySelectorAll<HTMLButtonElement>('[data-mark]').forEach((btn) => {
    btn.classList.toggle('dm-toolbar-button--active', editor.isActive(btn.dataset.mark!));
  });
});
```

`StarterKit` includes 13 nodes, 6 marks, and 7 behavior extensions out of the box. Every extension can be disabled or configured individually.

### Angular

Requires Angular 17.1+. Standalone components with signals, OnPush change detection, reactive forms (`ControlValueAccessor`), and zoneless mode support.

```bash
pnpm add @domternal/core @domternal/theme @domternal/angular
```

```ts
import { Component, signal } from '@angular/core';
import {
  DomternalEditorComponent,
  DomternalToolbarComponent,
  DomternalBubbleMenuComponent,
} from '@domternal/angular';
import { Editor, StarterKit, BubbleMenu } from '@domternal/core';

@Component({
  selector: 'app-editor',
  imports: [DomternalEditorComponent, DomternalToolbarComponent, DomternalBubbleMenuComponent],
  template: `
    @if (editor(); as ed) {
      <domternal-toolbar [editor]="ed" />
    }
    <domternal-editor
      [extensions]="extensions"
      [content]="content"
      (editorCreated)="editor.set($event)"
    />
    @if (editor(); as ed) {
      <domternal-bubble-menu [editor]="ed" />
    }
  `,
})
export class EditorComponent {
  editor = signal<Editor | null>(null);
  extensions = [StarterKit, BubbleMenu];
  content = '<p>Hello from Angular!</p>';
}
```

Add the theme to your global stylesheet:

```scss
@use '@domternal/theme';
```

> **[Try the full Angular example on StackBlitz](https://stackblitz.com/edit/domternal-angular-full-example)** with all extensions, toolbar, and bubble menu.

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

Requires Node.js >= 20 and pnpm >= 10.

## License

[MIT](LICENSE)
