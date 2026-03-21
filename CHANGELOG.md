# Changelog

## 0.1.0 (2026-03-21)

Initial public release.

### Packages

- `@domternal/core` - Framework-agnostic editor engine (13 nodes, 9 marks, 25 extensions, 112+ chainable commands, SSR helpers, toolbar controller with 45 built-in icons)
- `@domternal/pm` - ProseMirror re-exports (12 subpath exports: state, view, model, transform, commands, keymap, history, tables, inputrules, dropcursor, gapcursor, schema-list)
- `@domternal/theme` - Light and dark themes with 70+ CSS custom properties
- `@domternal/angular` - 5 Angular components (editor, toolbar, bubble menu, floating menu, emoji picker)
- `@domternal/extension-table` - Tables with cell merging, column resize, row/column controls (18 commands)
- `@domternal/extension-image` - Image with paste/drop upload, URL input, XSS protection, bubble menu
- `@domternal/extension-emoji` - Emoji picker panel and `:shortcode:` autocomplete
- `@domternal/extension-mention` - `@mention` autocomplete with multi-trigger and async support
- `@domternal/extension-details` - Collapsible details/accordion blocks
- `@domternal/extension-code-block-lowlight` - Syntax-highlighted code blocks powered by lowlight

### Highlights

- Built on ProseMirror with clean extension API
- Headless core works with any framework or vanilla JS/TS
- First-class Angular support (17.1+) with signals, OnPush, reactive forms, zoneless-ready
- Tree-shakeable, fully typed, SSR-ready
- SSR helpers: `generateHTML`, `generateJSON`, `generateText` for server-side rendering
- Inline styles export: `getHTML({ styled: true })` for email clients, CMS, and Google Docs
- Input rules for markdown-style shortcuts (e.g. `**bold**`, `# heading`, `> quote`, `- list`)
- Toolbar controller with automatic active state tracking and 45 Phosphor icons
- All floating elements (bubble menu, floating menu, popovers) powered by `@floating-ui/dom`
