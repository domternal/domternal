# @domternal/theme

[![Version](https://img.shields.io/npm/v/@domternal/theme.svg)](https://www.npmjs.com/package/@domternal/theme)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/domternal/domternal/blob/main/LICENSE)

Default styles for the [Domternal](https://domternal.dev) editor, toolbar, menus,
pickers, and document content. Includes light and dark themes, CSS custom
properties for customization, and print styles. This package contains CSS and Sass
source, with no JavaScript runtime.

## Install

```bash
pnpm add @domternal/theme
```

The package declares Node.js 22 or later for tooling and has no peer dependencies. Keep the theme on the same Domternal release as
your editor and framework wrapper so component markup and styles stay aligned.

## Usage

Import once in your application's entry point:

```ts
import '@domternal/theme';
```

For a Sass pipeline, use the source entry point instead:

```scss
@use '@domternal/theme/scss';
```

React, Vue, and Angular components add the editor's `.dm-editor` class. With
`@domternal/core` or `@domternal/vanilla`, add that class to the host yourself.

## Light and dark mode

Light is the default. Add a theme class to a common ancestor of the editor and its
UI so sibling toolbars and menus receive the same palette:

```html
<div class="dm-theme-dark">
  <div class="dm-toolbar">...</div>
  <div class="dm-editor">...</div>
</div>
```

Use `dm-theme-auto` to follow the system preference, or `dm-theme-light` to force a
light palette. Toggle the class at runtime without recreating the editor.
For a borderless document layout, create the editor with `preset: 'notion'`; see
[Notion mode](https://domternal.dev/v1/guides/notion-mode/).

## Customize the theme

Load overrides after the theme. Defaults live on the component elements, so target
`.dm-editor` and `.dm-toolbar` rather than setting variables only on an ancestor:

```css
.my-app .dm-editor,
.my-app .dm-toolbar {
  --dm-accent: #e11d48;
  --dm-accent-hover: #be123c;
  --dm-accent-surface: rgba(225, 29, 72, 0.1);
}

.my-app .dm-editor {
  --dm-editor-bg: #fefce8;
  --dm-editor-border-radius: 0.5rem;
}
```

The [theming guide](https://domternal.dev/v1/guides/theming/) covers custom palettes,
separately mounted UI, scrolling, Sass, and the complete
[CSS property reference](https://domternal.dev/v1/guides/theming/#css-custom-properties-reference).

## Rendering and print behavior

- Print styles hide editor controls and use a light palette, including when the
  screen theme is dark. To isolate the editor from your application's surrounding
  UI, use the [Print extension](https://domternal.dev/v1/extensions/print/).
  Color overrides for print need `!important` in a later `@media print` rule;
  see [printing](https://domternal.dev/v1/guides/theming/#printing).
- Highlights and shaded table cells retain authored backgrounds. In the live
  editor, text without an authored color adapts to that background. This behavior
  is not serialized into `getHTML()`; use a read-only editor to display saved
  content with the same contrast handling. See
  [text on kept backgrounds](https://domternal.dev/v1/guides/theming/#text-on-kept-backgrounds)
  for custom themes, browser fallbacks, and experimental tone helpers.
- The native `hidden` attribute hides themed elements;
  [`hidden="until-found"` keeps its browser behavior](https://domternal.dev/v1/guides/theming/#hiding-an-element).
- The stylesheet includes [PasteCleanup feedback](https://domternal.dev/v1/extensions/paste-cleanup/)
  and [floating-menu descriptions](https://domternal.dev/v1/extensions/floating-menu/).
  Load the corresponding extensions or components to enable those features.

## Entry points

| Import | Contents |
| --- | --- |
| `@domternal/theme` | Compiled CSS, or Sass source with Sass-aware resolution |
| `@domternal/theme/css` | Explicit compiled CSS |
| `@domternal/theme/scss` | Sass source |
