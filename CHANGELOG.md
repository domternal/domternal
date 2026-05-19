# Changelog

## 0.7.0 (2026-05-19)

### Breaking changes

- `listItem`/`taskItem` schema is now Notion-strict (`paragraph block*`). Existing content where the first child is not a paragraph may need migration.

### Packages

- New: `@domternal/vanilla` - framework-free DOM wrapper for Astro, Svelte, Solid, plain HTML, and Web Components. Class-based API (`new DomternalEditor(host, opts)` + `.destroy()` + setters), ESM-only with subpath exports, SSR-safe. Ships `DomternalEditor`, `DomternalToolbar`, `DomternalBubbleMenu`, `DomternalFloatingMenu`, `DomternalEmojiPicker`, `DomternalNotionColorPicker`.
- New: `@domternal/extension-block-menu` - Notion-style block UX: `BlockHandle` (hover gutter with drag and plus button), `BlockContextMenu` (Delete / Duplicate / Turn into / Colors / Copy link), `KeyboardReorder` (Mod-Shift-Up/Down), `SlashCommand`, `SmartPaste`.
- New: `@domternal/extension-toc` - Notion-style Table of Contents. Ships `TableOfContents` (heading observer + `scrollToHeading` command), `FloatingTocOutline` (sticky outline with IntersectionObserver active tracking and hover-expanded card), `TableOfContentsBlock` (inline `/toc` atom node).

### Features

- feat(core): `FloatingMenu` items API with controller (role=menu, Alt-F10 / Mod-/ keymap, click-outside, roving tabindex). Default items contributed by Heading, Lists, Blockquote, CodeBlock, HorizontalRule, Image, Table, Details via `addFloatingMenuItems` hook. (#75)
- feat(angular,react,vue): render `FloatingMenu` via controller with role=menu, groups, roving-tabindex keyboard nav. (#75)
- feat(core): `NotionColorPicker` extension with named-token color attrs (`colorToken`, `backgroundColorToken`) on `textStyle` mark, hex/token mutual exclusion, last-action-wins for inline color conflicts. (#80)
- feat(angular,react,vue,vanilla): `DomternalNotionColorPicker` component - circular 5x2 grid, dark palette, persistent picker, A trigger glyph with slash. (#80)
- feat(core): Notion-style list/task UX. Strict `paragraph block*` schema with children-zone indent, `ListIndent` extension (`Tab`/`Shift-Tab` outside list items indents as nested child), Enter on empty children-zone paragraph inserts sibling inside the li, non-empty Enter splits in place, Backspace at offset 0 lifts as top-level paragraph. (#77)
- feat(core): Notion-style Enter on heading - end-of-heading inserts paragraph below, empty heading converts in place. (#77)
- feat(core): Notion-style `/h1` in a list-item label dissolves the item (setBlockType lift fallback). (#77)
- feat(core): `TaskItem` checkbox click toggles checked state via NodeView and applies strikethrough; Enter on a checked task spawns an unchecked sibling. (#80)
- feat(extension-block-menu): drag-to-reorder with custom drop indicator (sibling/nested modes via X-threshold over list items), auto-scroll near viewport edges, cross-list-type drop auto-conversion, wrap dropped block into listItem when target is a list. (#76, #77)
- feat(extension-block-menu): nested drag handle for inner blocks of list/task items via `BlockHandle.nested` (configurable allowed nodes, deepest-block-at-Y resolution). (#77)
- feat(extension-block-menu): `BlockContextMenu` Colors picker, Copy link via new `writeToClipboard` utility (async Clipboard API + execCommand fallback) with split success/error events. Turn into routes wrapper commands and accepts wrapper sources (list-type swap from list-item drag handle). (#76, #80)
- feat(extension-block-menu): `SlashCommand` works in a list-item label and cooperates with other overlays via `dm:dismiss-overlays`. (#76, #77, #78)
- feat(extension-toc): `FloatingTocOutline` editor anchor mode with middle/center/frozen state machine, expanded card scroll-closes and viewport-clamps, level-encoded width buttons, hover-expanded card with text labels and per-level indent. (#78, #80)
- feat(extension-toc): inline `/toc` atom node with reactive heading list, initial-load `#hash` auto-scroll opens collapsed details ancestors. (#78)
- feat(angular,react,vue,vanilla): `icons` prop / input on `DomternalBubbleMenu` (parity with `DomternalToolbar`). (#81)
- feat(extension-block-menu,angular,theme): Notion-style empty-paragraph placeholder and `requireExplicitTrigger` on FloatingMenu (opens only on the `+` button). (#76, #80)
- feat(theme): `.dm-notion-mode` opt-in class with task checkbox token overrides, Notion-style centered content + side gutter for block handle (no text shift on color toggle), task list aligns with bullet list. (#78, #80)
- feat(demos): Notion mode in all four demo apps (default/custom/notion toggle) with the full extension stack. (#75, #76, #77, #80)
- feat(angular,theme): text-align dropdown in Notion bubble menu with dynamic icon, Escape close, cross-overlay dismissal, scoped active highlight. (#80)
- feat(core): `BlockColor` extension - global `bgColor` and `textColor` block attrs preserved across `turnIntoBlock`. (#76)
- feat(core): `UniqueID` extension renames duplicate ids on `setContent`. (#80)
- feat(emoji): toolbar option to hide the emoji button from the toolbar (default: `true`). (#71)

### Fixes

- fix(angular,react,vue): show image bubble menu by default when the `Image` extension is loaded. (#71)
- fix(core): Backspace on an empty paragraph after a list deletes it and places the caret at the end of the last item, instead of wrapping it back as a list item. (#78)
- fix(core): `toggleList` in a children-zone paragraph wraps that paragraph in a fresh list, instead of converting the ancestor. (#78)
- fix(core): Backspace on an empty paragraph between two lists of the same type joins them back into one. (#78)
- fix(extension-block-menu): slash menu activates only on a real typing event of the trigger char (not pure selection changes or bulk inserts); query tracks only typed chars. (#78)
- fix(extension-block-menu): `SmartPaste` handles same-type slice paste (fixes heading-into-heading shred bug) and trailing hard-break (Shift+Enter). (#76, #80)
- fix(extension-block-menu): Delete on a list item no longer kills the whole list. (#76)
- fix(extension-block-menu): `turnIntoBlock` preserves global attrs (`bgColor`, `textColor`, `id`) across block type change. (#76)
- fix(extension-block-menu): drag and drop edge cases - PM dispatch deferred out of `dragstart` tick, drop works in handle gutter and side margins, fast-drag race between `dragstart` and `drop` handled, dragging the only nested list item collapses its wrapper. (#76, #77)
- fix(extension-block-menu): `SlashCommand` misposition and page scroll on open. (#76)
- fix(extension-block-menu): hover detection on the editor parent so the block handle surfaces in the side gutter (Notion centered layout). (#76)
- fix(extension-block-menu): virtual-ref preserves color picker and context-menu position when the bubble menu rebuilds its anchor. (#80)
- fix(extension-toc): active heading tracks viewport-top crossing and always keeps one tick lit. (#80)
- fix(angular,core): `LinkPopover` triggered from the bubble menu anchors to the Link button (bottom-start) and reparents into `.dm-editor`. (#80)
- fix(core): bubble menu hides A and `...` triggers on node selection (image); `...` disabled on multi-block selection. (#80)
- fix(theme): notion-demo page background and border follow the dark theme. (#78)
- fix(theme): scope task-item checked strikethrough to the label paragraph so nested children stay unstruck. (#80)
- fix(react): migrate to React 19 `RefObject`; runtime guard for `useEditorState` mode. (#74)
- fix(angular): resolve ESLint errors in wrapper components; raise bundle size budgets for demo and example apps. (#74)
- fix(extension-block-menu): security + correctness review fixes (XSS, empty-doc guard, position mapping, `duplicateBlock` marks). (#76)

### Accessibility

- `role="menu"` + `aria-label="Floating menu"` on FloatingMenu with roving tabindex. (#75)
- `BlockContextMenu`: `aria-activedescendant`, arrow nav, Esc close, focus return on outside-click. (#76)
- `DomternalNotionColorPicker`: `aria-haspopup`, `aria-modal="false"`, disconnected-anchor defense, keyboard arrow nav across the swatch grid. (#80)
- `prefers-reduced-motion` guards on TOC tick highlight, card slide, drop-indicator transition. (#78, #80)
- Forced-colors mode guard on TOC outline. (#78)

### Tests / CI

- Codecov integration with per-package flags and coverage badge. `publint` + `arethetypeswrong` validation extended to React, Vue, Vanilla, extension-block-menu, and extension-toc. (#72, #80)
- E2E retries set to `2` in all demo Playwright configs. (#74)
- Demo-vanilla: 56 e2e spec files (41 shared + 15 Notion). Demo-angular full Notion mode e2e coverage. Demo-react / demo-vue Notion-specific specs.
- Coverage raised across packages: `extension-table` 95.56% statements, `extension-block-menu` ~89% lines, `core` 94.42% (all files ≥80%). `FloatingMenuController` 100%. (#73, #75)

## 0.6.2 (2026-04-16)

### Fixes

- fix(vue): `Domternal` compound subcomponents (`Domternal.Toolbar`, `Domternal.BubbleMenu`, etc.) were tree-shaken away in production builds due to `sideEffects: false`. Moved assignments into `Domternal.ts` so bundlers can't drop them.
- fix(vue): `editable` prop on `<Domternal>` and `<DomternalEditor>` was not syncing at runtime. Added reactive `watch` since `useEditor`'s internal watcher can't track plain object props.
- fix(react,vue): toolbar keyboard activation (Enter/Space) did not work in `EditorContent`. Added `data-dm-editor-ui` attribute so `SelectionDecoration` preserves selection on toolbar focus.

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
