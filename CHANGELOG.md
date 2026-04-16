# Changelog

## 0.6.1 (2026-04-16)

### Fixes

- fix(angular): `@domternal/angular@0.6.0` was published without compiled output (#66)

### Improvements

- chore: add automatic `pnpm build` to `prepublishOnly` hook in all packages to prevent publishing without dist

## 0.6.0 (2026-04-15)

### Features

- feat(vue): add `@domternal/vue` wrapper with `Domternal` compound component, `useEditor`/`useEditorState` composables, `DomternalEditor` (v-model), `DomternalToolbar`, `DomternalBubbleMenu`, `DomternalFloatingMenu`, `DomternalEmojiPicker`, and `VueNodeViewRenderer` (Vue 3.3+) (#64)
- feat(vue): `useCurrentEditor()` inject for descendant components with Vue `appContext` forwarding into ProseMirror node views
- feat(vue): `VueNodeViewRenderer` with reactive node/selected props, `NodeViewWrapper`, `NodeViewContent`, drag handle, and nested editable content

### Fixes

- fix(core): add `Backspace` handler to `TaskItem` - pressing Backspace at start of first task item now lifts it out of the task list (parity with `BulletList`/`OrderedList`)

### Tests

- 2014 E2E tests for Vue demo app: 1923 ported from demo-react (41 spec files across all extensions) + 91 Vue-specific tests covering v-model two-way binding, `<Domternal>` compound component, `useCurrentEditor()` provide/inject chain, `useEditorState` selector mode, and `VueNodeViewRenderer` lifecycle/reactivity/inject forwarding (22 tests via Callout demo extension)

### Packages

- New: `@domternal/vue` - Vue 3 wrapper with composable components, composables, and Vue node view renderer with `appContext` chain forwarding

## 0.5.1 (2026-04-14)

### Fixes

- fix(core): `SelectionDecoration` preserves selection when focus moves to toolbar or editor UI (`data-dm-editor-ui`, `.dm-toolbar`, `.dm-bubble-menu` blur checks)
- fix(angular): ArrowDown dropdown trigger detection uses `document.activeElement` instead of `controller.focusedIndex` (parity with React)
- fix(angular,react): toolbar refocuses editor after keyboard-activated commands (Enter/Space) to preserve `::selection` highlight
- fix(angular,react): arrow keys enter emoji grid when focus is on grid container
- fix(angular,react): selecting emoji category tab via keyboard focuses first emoji in that category
- fix(theme): table dropdown hover fallback for dark mode

### Tests

- 26 new E2E tests (13 Angular + 13 React) for toolbar dropdown keyboard navigation, text color, font size, heading, ARIA attributes, and Enter on color swatch

## 0.5.0 (2026-04-13)

### Features

- feat(core): add `SelectionDecoration` to StarterKit (opt-out via `selectionDecoration: false`), collapses range selection on blur to prevent ghost selections
- feat(core): add `ariaLabel` option to `EditorOptions` for configurable editor label
- feat(core): editor element now has `role="textbox"`, `aria-multiline="true"`, and `aria-label` by default
- feat(core): dynamic `aria-readonly` attribute synced with `setEditable()` state
- feat(core): floating menu sets default `role="toolbar"` and `aria-label="Floating menu"`
- feat(theme): `:focus-visible` indicators on 16 interactive element types (toolbar, emoji, table, popovers, details)
- feat(theme): `prefers-reduced-motion` media query disabling all animations and transitions
- feat(angular): bubble menu ARIA parity with React (`role="toolbar"`, `aria-label`, `aria-pressed`, `role="separator"`)
- feat(angular,react): ArrowUp/ArrowDown keyboard navigation inside open toolbar dropdown menus
- feat(angular,react): emoji picker grid 2D keyboard navigation (arrows, Enter/Space to select)
- feat(angular,react): emoji picker tabs with `role="tab"` and `aria-selected`

### Fixes

- fix(theme): move `prefers-reduced-motion` block to end of stylesheet to correctly override all animation/transition rules
- fix(angular): add missing `tabindex="-1"` on frequently used and category emoji swatches
- fix(react): use `document.activeElement` for ArrowDown dropdown trigger detection instead of `controller.focusedIndex`

### Accessibility

- `aria-label="URL"` on link popover input, `aria-label="Image URL"` on image popover input
- `aria-label="Task status"` on task item checkboxes
- `aria-label="Search emoji"` on emoji picker search input
- `aria-label="Emoji suggestions"` and `aria-label="Mention suggestions"` on suggestion containers
- Table cell toolbar: `role="toolbar"` with `aria-label="Cell formatting"`
- Table dropdowns: `role="menu"` with `aria-label`, `role="menuitem"` on items, `role="separator"` on dividers
- Dropdown menu items: `tabindex="-1"` for keyboard focusability (Angular + React)

### Tests

- 105 new E2E accessibility tests (56 Angular + 49 React) covering editor ARIA, bubble menu, dropdown keyboard nav, emoji picker, task checkbox, link/image popover, emoji/mention suggestions, focus-visible, and prefers-reduced-motion
- 10 new E2E tests for SelectionDecoration blur behavior (5 Angular + 5 React)

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
