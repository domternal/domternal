# @domternal/core

Lightweight, framework-agnostic rich text editor engine with 13 nodes, 9 marks, 25 extensions, 112+ chainable commands, and 45 built-in icons.

Part of the [Domternal](https://github.com/domternal/domternal) toolkit. Full docs at [domternal.dev](https://domternal.dev).

## Installation

```bash
npm install @domternal/core
```

## Quick Start

### Headless (Vanilla JS/TS)

Import only the extensions you need for full control and zero bloat:

```ts
import { Editor, Document, Text, Paragraph, Bold, Italic, Underline } from '@domternal/core';

const editor = new Editor({
  element: document.getElementById('editor')!,
  extensions: [Document, Text, Paragraph, Bold, Italic, Underline],
  content: '<p>Hello <strong>World</strong>!</p>',
});
```

### With Theme and Toolbar

Use `StarterKit` for a batteries-included setup, and pair it with `@domternal/theme` for styled UI:

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

### StarterKit Contents

Every extension in the kit can be disabled with `false` or configured with options:

```ts
StarterKit.configure({
  codeBlock: false,                     // disable an extension
  heading: { levels: [1, 2, 3, 4] },   // limit heading levels
  history: { depth: 50 },               // configure undo stack
  link: { openOnClick: false },         // keep links non-clickable while editing
  linkPopover: false,                   // disable the built-in link popover
})
```

| Category | Included |
|---|---|
| **Nodes** | Document, Text, Paragraph, Heading, Blockquote, CodeBlock, BulletList, OrderedList, ListItem, TaskList, TaskItem, HorizontalRule, HardBreak |
| **Marks** | Bold, Italic, Underline, Strike, Code, Link |
| **Behaviors** | BaseKeymap, History, Dropcursor, Gapcursor, TrailingNode, ListKeymap, LinkPopover |

## License

[MIT](https://github.com/domternal/domternal/blob/main/LICENSE)
