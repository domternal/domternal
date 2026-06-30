# @domternal/angular

[![Version](https://img.shields.io/npm/v/@domternal/angular.svg)](https://www.npmjs.com/package/@domternal/angular)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/domternal/domternal/blob/main/LICENSE)

Angular components for the [Domternal](https://domternal.dev) editor: six standalone,
signals-driven, OnPush, zoneless-ready components that wrap the headless core with
Angular-native APIs. `DomternalEditorComponent` implements `ControlValueAccessor`, so
it drops into `ngModel` and reactive forms. The toolbar, bubble menu, floating menu,
emoji picker, and Notion color picker auto-render from the extensions you load.

## Links

<u>[Website](https://domternal.dev)</u> &nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp; <u>[Documentation](https://domternal.dev/v1/guides/angular)</u> &nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp; <u>[Live examples](https://domternal.dev/examples)</u>

## Install

```bash
pnpm add @domternal/angular @domternal/core @domternal/theme
```

`@angular/core` (>=17.1), `@angular/forms` (>=17.1), and `@domternal/core` (>=0.11.0)
are peer dependencies. Add the theme ([`@domternal/theme`](https://www.npmjs.com/package/@domternal/theme))
to your global stylesheet (e.g. `styles.scss`):

```scss
@use '@domternal/theme';
```

## Usage

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
  imports: [
    DomternalEditorComponent,
    DomternalToolbarComponent,
    DomternalBubbleMenuComponent,
  ],
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

The toolbar and bubble menu render their buttons from the loaded extensions, so no
manual button wiring is needed.

### Reactive forms

`DomternalEditorComponent` is a `ControlValueAccessor`, so it binds directly to
`ngModel` or a `FormControl`. Set `outputFormat="json"` to emit JSON instead of HTML;
calling `disable()`/`enable()` on the bound `FormControl` toggles the editor's editable
state.

```ts
import { Component } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { DomternalEditorComponent } from '@domternal/angular';
import { StarterKit } from '@domternal/core';

@Component({
  selector: 'app-form-editor',
  imports: [ReactiveFormsModule, DomternalEditorComponent],
  template: `
    <domternal-editor [extensions]="extensions" [formControl]="editorControl" />
  `,
})
export class FormEditorComponent {
  extensions = [StarterKit];
  editorControl = new FormControl('<p>Initial content</p>');
}
```

## Components

All components are standalone (no NgModule). Import them directly from
`@domternal/angular`:

- `DomternalEditorComponent` (`<domternal-editor>`): the editor, with reactive
  `extensions` / `content` / `editable` / `autofocus` / `outputFormat` inputs,
  `editorCreated` and content/selection/focus outputs, and read-only `htmlContent`,
  `jsonContent`, `isEmpty`, `isFocused`, `isEditable` signals.
- `DomternalToolbarComponent` (`<domternal-toolbar>`): auto-rendered formatting
  toolbar with keyboard navigation, custom `icons`, and `layout` overrides.
- `DomternalBubbleMenuComponent` (`<domternal-bubble-menu>`): inline selection menu
  with `items` / `contexts` / `shouldShow` controls and content projection.
- `DomternalFloatingMenuComponent` (`<domternal-floating-menu>`): insert menu shown
  on empty lines.
- `DomternalEmojiPickerComponent` (`<domternal-emoji-picker>`): searchable emoji
  panel, driven by an `emojis: EmojiPickerItem[]` input.
- `DomternalNotionColorPickerComponent` (`<domternal-notion-color-picker>`):
  Notion-style text and background color palette.

`DEFAULT_EXTENSIONS` (`[Document, Paragraph, Text, BaseKeymap, History]`) and the core
`Editor` class plus `Content`, `AnyExtension`, `FocusPosition`, and `JSONContent` types
are re-exported for convenience.
