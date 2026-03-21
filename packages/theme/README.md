# @domternal/theme

Light and dark themes for the Domternal editor with 70+ CSS custom properties for full visual control.

Part of the [Domternal](https://github.com/domternal/domternal) toolkit. Full docs at [domternal.dev](https://domternal.dev).

## Installation

```bash
npm install @domternal/theme
```

## Usage

### CSS Import

Import the pre-built CSS file in your JavaScript or HTML:

```ts
import '@domternal/theme';
```

Or link to the CSS file directly:

```html
<link rel="stylesheet" href="node_modules/@domternal/theme/dist/domternal-theme.css" />
```

### SCSS

If your project uses SCSS, use `@use` instead for access to SCSS variables and mixins:

```scss
@use '@domternal/theme';
```

### Dark Mode

The theme automatically switches between light and dark based on the user's system preference via `prefers-color-scheme`. You can also force a mode by adding a CSS class to the editor wrapper or a parent element:

- `.dm-theme-dark` - force dark mode
- `.dm-theme-light` - force light mode
- `.dm-theme-auto` - follow system preference (default behavior)

### Customization

Override any of the 70+ CSS custom properties on `.dm-editor` to customize the look:

```css
.dm-editor {
  --dm-editor-font-family: 'Inter', sans-serif;
  --dm-editor-font-size: 16px;
  --dm-editor-border-radius: 8px;
  --dm-accent: #3b82f6;
}
```

## License

[MIT](https://github.com/domternal/domternal/blob/main/LICENSE)
