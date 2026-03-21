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

## Packages

| Package | Description |
|---------|-------------|
| [`@domternal/core`](packages/core) | Framework-agnostic editor engine with 13 nodes, 9 marks, 25 extensions, toolbar controller, and 45 built-in icons |
| [`@domternal/theme`](packages/theme) | Light and dark themes with 70+ CSS custom properties |
| [`@domternal/angular`](packages/angular) | Angular components: editor, toolbar, bubble menu, floating menu, emoji picker |
| [`@domternal/pm`](packages/pm) | ProseMirror re-exports (state, view, model, transform, commands, keymap, history, tables, and more) |
| [`@domternal/extension-table`](packages/extension-table) | Tables with 18 commands: merge, split, resize, cell styling, row/column controls |
| [`@domternal/extension-image`](packages/extension-image) | Image with paste/drop upload, URL input, XSS protection, bubble menu |
| [`@domternal/extension-emoji`](packages/extension-emoji) | Emoji picker panel and `:shortcode:` autocomplete |
| [`@domternal/extension-mention`](packages/extension-mention) | `@mention` autocomplete with multi-trigger and async support |
| [`@domternal/extension-details`](packages/extension-details) | Collapsible details/accordion blocks |
| [`@domternal/extension-code-block-lowlight`](packages/extension-code-block-lowlight) | Syntax-highlighted code blocks powered by lowlight |

### Headless Core (Vanilla JS/TS)

```ts
import { Editor, Document, Text, Paragraph, Bold, Italic, Underline } from '@domternal/core';

const editor = new Editor({
  element: document.getElementById('editor')!,
  extensions: [Document, Text, Paragraph, Bold, Italic, Underline],
  content: '<p>Hello <strong>World</strong>!</p>',
});
```

### With Theme and Toolbar (Vanilla JS/TS)

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

```ts
import { Component, signal } from '@angular/core';
import {
  DomternalEditorComponent,
  DomternalToolbarComponent,
  DomternalBubbleMenuComponent,
} from '@domternal/angular';
import { Editor, StarterKit, BubbleMenu } from '@domternal/core';

@Component({
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
