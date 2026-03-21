# @domternal/angular

Angular components for the Domternal editor: editor, toolbar, bubble menu, floating menu, and emoji picker. Standalone components with signals, OnPush change detection, reactive forms (`ControlValueAccessor`), and zoneless mode support.

Part of the [Domternal](https://github.com/domternal/domternal) toolkit. Full docs at [domternal.dev](https://domternal.dev).

Requires Angular 17.1+.

## Installation

```bash
npm install @domternal/core @domternal/theme @domternal/angular
```

## Quick Start

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

### Global Styles

Add the theme to your global stylesheet to load editor and toolbar styles:

```scss
@use '@domternal/theme';
```

### Available Components

| Component | Description |
|---|---|
| `<domternal-editor>` | The core editor surface |
| `<domternal-toolbar>` | Auto-renders toolbar buttons based on provided extensions |
| `<domternal-bubble-menu>` | Contextual formatting menu on text selection |
| `<domternal-floating-menu>` | Block-level insertion menu on empty lines |
| `<domternal-emoji-picker>` | Emoji picker panel for the Emoji extension |

The toolbar and bubble menu components auto-render buttons based on the extensions you provide. No manual button wiring needed.

## License

[MIT](https://github.com/domternal/domternal/blob/main/LICENSE)
