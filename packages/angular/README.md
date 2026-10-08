# @domternal/angular

[![Version](https://img.shields.io/npm/v/@domternal/angular.svg)](https://www.npmjs.com/package/@domternal/angular)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/domternal/domternal/blob/main/LICENSE)

Angular components for the [Domternal](https://domternal.dev) rich text editor.
The standalone editor integrates with reactive forms and `ngModel` through
`ControlValueAccessor`. Toolbar, selection menu, insert menu, and picker components
use signals and OnPush change detection.

## Install

In an Angular application:

```bash
pnpm add @domternal/angular @domternal/core @domternal/theme
```

The current build is compiled with Angular 21.2.20. We recommend matching
`@angular/core`, `@angular/forms`, and `@angular/platform-browser` packages at that
version or later. Applications should use the same or a newer compiler, as described
in [Angular library compatibility](https://angular.dev/tools/libraries/creating-libraries#ensuring-library-version-compatibility).
The manifest still declares a broader `>=17.1.0` peer range; this is not a guarantee
of compatibility with older Angular releases.

Requires `@domternal/core >=1.3.0 <2.0.0`. Keep installed Domternal packages on the
same release. The package declares Node.js 22 or later for tooling; also follow
your Angular version's [Node.js requirements](https://angular.dev/reference/versions).

Load the theme in your global stylesheet, such as `styles.scss`:

```scss
@use '@domternal/theme/scss';
```

## Quick start

This standalone component binds the document to a form control and adds a toolbar:

```ts
import { Component, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import {
  DomternalEditorComponent,
  DomternalToolbarComponent,
} from '@domternal/angular';
import { StarterKit, type Editor } from '@domternal/core';

@Component({
  selector: 'app-text-editor',
  standalone: true,
  imports: [ReactiveFormsModule, DomternalEditorComponent, DomternalToolbarComponent],
  template: `
    @if (editor(); as ed) {
      <domternal-toolbar [editor]="ed" />
    }
    <domternal-editor
      [extensions]="extensions"
      [formControl]="content"
      (editorCreated)="editor.set($event)"
    />
  `,
})
export class TextEditorComponent {
  readonly editor = signal<Editor | null>(null);
  readonly extensions = [StarterKit];
  readonly content = new FormControl('<p>Hello from Angular!</p>', { nonNullable: true });
}
```

The editor owns its lifecycle; `editorCreated` provides the instance for commands
and sibling UI components. The toolbar renders the controls your extensions
contribute. Subscribe to the form control's `valueChanges` to save content.

## Forms and configuration

- Form values are HTML by default. Use `outputFormat="json"` with a JSON content
  value for structured documents. Calling `disable()` or `enable()` on the form
  control updates editability.
- Without a form, pass HTML or JSON through `[content]`, handle `(contentUpdated)`,
  and read `event.editor.getHTML()` or `getJSON()`. The component also exposes
  `htmlContent`, `jsonContent`, `isEmpty`, `isFocused`, and `isEditable` signals.
- The wrapper includes `Document`, `Paragraph`, `Text`, `BaseKeymap`, and `History`.
  For another undo manager, set `[history]="false"` and omit History from your
  extensions, including [StarterKit's history](https://domternal.dev/v1/extensions/history/#disabling-the-built-in-history).
- `preset="notion"` is read at creation. The `i18n` input updates UI translations
  when replaced, without recreating the editor or changing its form value.
- `(contentError)` reports invalid initial content. `(contentDiagnostic)` reports
  normalized values; initial reports arrive before `editorCreated`. See
  [content diagnostics](https://domternal.dev/v1/guides/editor-api/#content-diagnostics).
- Custom `icons` inputs contain raw SVG. Supply trusted, developer-authored constants.

The [Angular guide](https://domternal.dev/v1/guides/angular/) covers inputs, outputs,
form behavior, and the toolbar, bubble menu, floating menu, emoji picker, and
Notion color picker components.

## Further reading

- [Angular guide and component reference](https://domternal.dev/v1/guides/angular/)
- [Editor commands and content API](https://domternal.dev/v1/guides/editor-api/)
- [Theming](https://domternal.dev/v1/guides/theming/) and [localization with `i18n`](https://domternal.dev/v1/guides/i18n/#angular)
- [Optional clipboard HTML cleanup](https://domternal.dev/v1/extensions/paste-cleanup/)
