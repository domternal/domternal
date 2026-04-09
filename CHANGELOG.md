# Changelog

## 0.4.1 (2026-04-09)

### Fixes

- fix(angular,react): prevent page scroll when emoji picker opens by using `focus({ preventScroll: true })`
- fix(react): replace wrapper `<div>` with `<Fragment>` in emoji picker grid so categories render as rows instead of columns

## 0.4.0 (2026-04-09)

### Features

- feat(react): add `@domternal/react` wrapper with hooks, composable components, toolbar, bubble menu, floating menu, emoji picker, and React node views (#54)
- feat(react): scaffold React example app and demo app with full E2E test suite
- feat(core): export `NodeViewContext` interface for framework wrapper node view integration

### Fixes

- fix(react): `deleteNode` in `ReactNodeViewRenderer` uses `node.nodeSize` instead of hardcoded `1` for correct deletion of nodes with content
- fix(react): `useEditorState` skips expensive `getHTML()`/`getJSON()` on selection-only transactions
- fix(react): `DomternalEditor` renders children before editor div (toolbar above content)
- fix(react): bubble menu `activeVersion` triggers re-renders for active/disabled state updates
- fix(core): replace `AnyExtension` union type with interface to fix generic variance issue with `configure()`

### Accessibility

- Bubble menu: `role="toolbar"`, `aria-label`, `aria-pressed` on buttons, `role="separator"` on dividers
- `displayName` on all `Domternal` compound subcomponents for React DevTools
- `DomternalEditorRef` exposes `isEditable`

### Tests

- 1856 E2E tests for React demo app (38 spec files covering all extensions, toolbar, bubble menu, emoji picker, tables, mentions, and more)
- 60 React-specific E2E tests: bubble menu a11y, `aria-pressed` sync, active class updates, `useEditorState` reactive output, dark theme toggle, toolbar layout switch, context-aware bubble menu filtering

### Packages

- New: `@domternal/react` - React 18+ wrapper with `Domternal` composable component, `useEditor`, `useEditorState`, `DomternalEditor`, `EditorContent`, `DomternalToolbar`, `DomternalBubbleMenu`, `DomternalFloatingMenu`, `DomternalEmojiPicker`, `ReactNodeViewRenderer`

## 0.3.0 (2026-04-01)

### Features

- feat(mention): add default mention suggestion renderer with keyboard navigation and dark mode support (#52)
- feat(core): custom inputRules plugin with Backspace undo for all input rules (blockquote, lists, headings, code blocks) (#51)
- feat(core): add input rule helper wrappers (wrappingInputRule, textblockTypeInputRule, nodeInputRule, textInputRule, markInputRule) with undoable option (#51)

### Fixes

- fix(core): HR input rule trailing paragraph and undo cursor position (#52)
- fix(core): use event.code for heading shortcuts to fix macOS Alt key issues (#51)
- fix(core): toggleWrap lifts all paragraphs when unwrapping with AllSelection (#51)
- fix(core): prevent list input rules from firing inside existing list items (#51)
- fix(core): flatten mixed list+paragraph selections into single flat list (#51)
- fix(mention): add code mark guard to suggestion plugin (#52)
- fix(mention): fix keydown handling in suggestion plugin (#52)
- fix(theme): remove browser-default CSS from content styles (#51)
- fix(theme): adjust blockquote spacing, remove link cursor override (#51)
- fix(theme): add dark mode styles for mention dropdown (#52)

### Tests

- 195 new E2E tests: mention (81), horizontal rule, image (38), emoji (27), details (11), blockquote input rule, heading shortcuts, lists (#51, #52)

## 0.2.1 (2026-03-27)

### Fixes

- fix(theme,table): apply dark theme to table dropdowns appended to document.body (#49)
- fix(theme,table): improve syntax highlighting contrast ratios for WCAG AA (#49)
- fix(core,table): toolbar layout button name fixes (#48)

### Docs

- Unified README across all 10 packages with badges, features, and documentation links (#48)
- Rewrite main README (#47)

## 0.2.0 (2026-03-21)

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
