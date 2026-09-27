# @domternal/theme

[![Version](https://img.shields.io/npm/v/@domternal/theme.svg)](https://www.npmjs.com/package/@domternal/theme)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/domternal/domternal/blob/main/LICENSE)

Ready-made light and dark styles for the [Domternal](https://domternal.dev) editor,
toolbar, bubble menu, floating menu, popovers, and every UI component. It is a
CSS-only package (no JavaScript), built from Sass and shipped as a single compiled stylesheet. Every
visual property is exposed as a CSS custom property, so you can rebrand colors,
fonts, spacing, and borders by overriding a variable instead of touching the source.
It also carries the paper layer: printing an editor produces the document rather than
the screen, with the toolbar, menus, popovers, and hover affordances hidden, and that
applies to the reader's own Ctrl/Cmd+P without any JavaScript. Colour is the one thing
printing takes back: the whole light palette is re-emitted on `.dm-editor` with
`!important`, so a dark document, and a custom palette with it, prints light. Hiding the host
application's own chrome around the editor is the one part that takes code: that layer is
gated behind the `dm-printing` class, which the `Print` extension in
[`@domternal/core`](https://www.npmjs.com/package/@domternal/core) sets.

## Links

<u>[Website](https://domternal.dev)</u> &nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp; <u>[Documentation](https://domternal.dev/v1/guides/theming)</u> &nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp; <u>[Live examples](https://domternal.dev/examples)</u>

## Install

```bash
pnpm add @domternal/theme
```

This package has no peer dependencies.

This package is part of the coordinated Domternal 1.2.0 release.
Upgrade installed `@domternal/*` packages together.

## Usage

Import the stylesheet once in your application entry point:

```ts
// JavaScript/TypeScript bundler (Vite, Webpack, esbuild)
import '@domternal/theme';
```

```scss
// Sass pipeline (imports the SCSS source)
@use '@domternal/theme/scss';
```

```html
<!-- Plain HTML link tag -->
<link rel="stylesheet" href="node_modules/@domternal/theme/dist/domternal-theme.css" />
```

Light mode is the default. Toggle dark mode by adding a class to the editor or any
ancestor element:

```html
<!-- Always dark -->
<div class="dm-theme-dark">
  <div class="dm-toolbar">...</div>
  <div class="dm-editor">...</div>
</div>

<!-- Follow the system preference -->
<div class="dm-theme-auto">...</div>

<!-- Force light inside a dark context -->
<div class="dm-theme-light">...</div>
```

For a Notion-style look (borderless surface, centered narrow column), create the editor
with `preset: 'notion'`, which paints the `dm-notion-mode` class on the `.dm-editor` host
for you; adding the class by hand still works and is what the preset does. The reading
measure is `--dm-notion-column-width` (default `44rem`) and sits on the content column, so
the host itself stays full width. See the theming guide for details.

Override any CSS custom property to customize the look, on screen. Print normalises the
colour tokens (see the paper layer above); to keep a colour of your own on the page,
redeclare it `!important` in your own `@media print` block loaded after this package.
The defaults are declared on
`.dm-editor` and `.dm-toolbar` themselves, and a declaration on the element beats one
inherited from an ancestor, so target those elements rather than a wrapper alone:

```css
/* Tokens the toolbar reads too */
.my-app .dm-editor,
.my-app .dm-toolbar {
  --dm-accent: #e11d48;
  --dm-accent-hover: #be123c;
  --dm-accent-surface: rgba(225, 29, 72, 0.1);
}

/* Editor-only tokens */
.my-app .dm-editor {
  --dm-editor-bg: #fefce8;
}
```

## Text on kept backgrounds

A highlight with its own color and a table cell with its own shading keep their background in every
theme: yellow stays yellow in the dark theme, and Word's dark blue cell shading stays dark blue in the
light one. The editor marks each of them in the view with the tone of that background
(`data-dm-tone="light"` or `"dark"`, plus `mid` for a mid tone; never in `getHTML()`), and the theme
draws on it:

- Text without a color of its own is black on a light background and white on a dark one, in every
  theme and in print, so it never falls below 4.58:1. The two colors are tokens on `.dm-editor`:
  `--dm-on-light-text` (`#000000`) and `--dm-on-dark-text` (`#ffffff`).
- Links, code, quotes, muted headings, mentions and form controls there take the palette of that
  background: a dark background uses the dark palette, a light one the light palette where the editor
  around it is dark. In the default light theme a light background changes no token, so your own light
  palette stays.
- On a mid-tone background (gray, teal, Word's blue accent) links, muted text and quotes take the black
  or white of the text; links keep their underline.
- Colors the author chose stay as chosen: an inline text color, a token color on the highlighted run
  (resolved in the background's palette) and a color a block sets for its content.

A dark theme of your own that does not use `dm-theme-dark` gets the light palette on light
backgrounds through a style query on `--dm-color-scheme: dark` in Chromium and Safari; add the
`dm-theme-dark` class as well for Firefox. To keep the theme's text color instead, set both tokens to
`inherit`. Highlights and shaded cells print with their background (`print-color-adjust: exact`).

## Floating menu descriptions

The 1.1 stylesheet supports the optional `FloatingMenuItem.description` rendered
by all four framework wrappers. Descriptions appear below the label, wrap long
text, and use `--dm-muted` for their colour. Upgrade the theme with the wrapper
so the menu markup and styles stay aligned.

## The hidden attribute

`hidden` works on every element this theme styles, and on anything inside one:

```js
toolbar.hidden = true;   // the toolbar is gone, not merely emptied
```

Worth stating because it is not free. `[hidden] { display: none }` comes from the user agent
stylesheet, and author styles beat the user agent stylesheet whatever their specificity, so any
component rule that sets `display` disables the attribute for that element. `.dm-toolbar` sets
`display: flex`, so a hidden toolbar used to leave an empty strip with the toolbar's background,
border and padding, and nothing in the console. One scoped rule restores it for the whole theme.

`hidden="until-found"` is deliberately left alone: it does not mean `display: none`, it means the
element stays findable and the browser reveals it when find-in-page lands inside.

## Entry points

| Import | Resolves to | Description |
|---|---|---|
| `@domternal/theme` | `dist/domternal-theme.css` | Default: compiled CSS |
| `@domternal/theme/css` | `dist/domternal-theme.css` | Explicit CSS import |
| `@domternal/theme/scss` | `src/index.scss` | SCSS source for Sass pipelines |
