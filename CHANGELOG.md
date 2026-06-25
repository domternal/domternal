# Changelog

## 0.11.0 (2026-06-25)

### Breaking

- Removed the never-emitted `paste`, `drop`, `delete`, and `unmount` editor events and their prop types (`PasteEventProps`, `DropEventProps`, `DeleteEventProps`). They were exported but never fired, so `editor.on('paste', ...)` and imports of those types will no longer compile. `mount` / `MountEventProps` are unchanged. (#115)

### Features

- feat(extension-image): edit alt text on existing images. Selecting an image adds an "Edit alt text" bubble action that opens an alt-only menu pre-filled with the current alt, and the action shows active when the image already has alt text. (#115)

### Fixes

- fix(angular, react, vue, vanilla): the editor honors the `skipUpdate` meta, so a programmatic `setContent(content, false)` no longer echoes through `onUpdate` / the Angular control-value accessor (it no longer marks reactive forms dirty on `writeValue`). (#115)
- fix(vue): `immediatelyRender: true` no longer renders a blank editor (the editor DOM is re-parented on mount), and changing the extensions array no longer leaks an orphan clone into the container. (#115)
- fix(vanilla): the toolbar no longer throws when keyboard navigation lands on an out-of-range button index. (#115)
- fix(core): a heading configured with an empty `levels` option falls back to level 1 instead of rendering `<hundefined>`; `unsetTextColor` / `unsetHighlight` also clear the named color/highlight token so the "Default" swatch resets token-based colors; `insertContent([])` returns false instead of deleting the selection, and malformed JSON/HTML returns false instead of throwing; the input-rule `compositionend` handler guards against a destroyed view. (#115)
- fix(theme): the light theme resets every dark-only token, so a `.dm-theme-light` region nested inside a dark context no longer leaks dark block colors, scrollbars, and shadows. (#115)
- fix(extension-toc): the floating table-of-contents card collapses on scroll inside a container (`activeScrollParent`), not only on window scroll. (#115)
- fix(extension-details): the disclosure toggle exposes `aria-expanded` and `aria-controls` so assistive technology can announce its open / closed state. (#115)
- fix(extension-image): the node view no longer writes the literal string `"null"` to an image's `alt` / `title` when those attributes are absent. (#115)

## 0.10.0 (2026-06-21)

### Packages

- New: `@domternal/extension-math` - LaTeX math (inline + block) with a pluggable renderer (KaTeX). Ships `MathInline`, `MathBlock`, the shared `MathEditing` edit popover, and a `MathRenderer` interface. (#110)
- Renamed: `@domternal/extension-block-menu` is now `@domternal/extension-block-controls`. The old package becomes a thin re-export shim, so existing imports keep working unchanged; it is deprecated and will be removed in v1.0.0. Switch your imports to `@domternal/extension-block-controls`. (#111)

### Features

- feat(extension-math): inline (`$...$`) and block (`$$`) authoring via slash menu, toolbar, input rules, and the text bubble menu, with a distinct radical icon for inline equations and turning a text selection into an equation. The shared edit popover has a live preview and is keyboard accessible (Enter on a selected equation opens it, WCAG 2.1.1), and rendered math is RTL-isolated. (#110, #112)
- feat(core): a command run from a toolbar or menu now returns focus to the editor on the next frame, yielding when the command opened a popover input (such as the math editor) so that field keeps focus. This keeps the selection highlight after keyboard activation of a toolbar button. (#112)

## 0.9.1 (2026-06-17)

### Fixes

- fix(core): outdenting a list item into a list of a different kind keeps its own kind and checked state (a to-do outdented next to bullets stays a to-do), instead of taking on the surrounding list's type. (#108)
- fix(core): pressing Enter at the end of a list item that has nested children adds a new sibling and leaves the children under the original item; Enter on an empty item with children no longer spawns a stray empty item. (#108)
- fix(core): the ordered-list `start` attribute is clamped to a valid positive integer, so malformed markup no longer writes `NaN` / `null` into the document. (#108)
- fix(core): GitHub-style (`contains-task-list`) markdown task lists import as real to-do lists with their checked state preserved, and a single `<ul>` that mixes to-do and plain items no longer fabricates a leading empty placeholder item. (#108)
- fix(theme): list indentation now scales with the editor font size, a colored task item keeps its checkbox aligned with its label, and list markers / checkboxes mirror correctly in RTL; a task list nested inside a bullet or ordered list no longer inherits an extra children-zone indent. (#108)

## 0.9.0 (2026-06-15)

### Features

- feat(core): the floating menu plugin now lives in `@domternal/core`, and `@domternal/extension-block-menu` is no longer a peer dependency of the framework wrappers. The Angular/React/Vue/Vanilla wrappers need only `@domternal/core` + `@domternal/theme`; add `@domternal/extension-block-menu` explicitly when you want the block handle, slash menu, or drag-and-drop. (#104)
- feat(react): `immediatelyRender` creates the editor synchronously on the first render instead of after mount. (#104)
- feat(extension-block-menu): per-item "Turn into" for lists. The slash command and block menu convert one list item at a time via the new `turnIntoBulletList` / `turnIntoOrderedList` / `turnIntoTaskList` commands, while the toolbar and keyboard shortcut still convert the whole list. (#105)
- feat(theme): Notion-style list spacing. In notion mode, adjacent lists of different type chunk together at the within-item gap instead of the wider container gap; in both modes a nested list sits tightly under its parent label. (#105)

### Fixes

- fix(core): the placeholder paints on the initial draw of an empty editor instead of waiting for the first transaction. (#104)
- fix(extension-mention, extension-emoji): suggestion items select on `mousemove`, so a resting pointer no longer overrides arrow-key navigation. (#104)
- fix(theme): content clips on the editor's inner wrapper so popups can escape short editors; added the `--dm-editor-padding-top` variable for two-value padding shorthands. (#104)
- fix(core, extension-table): `positionFloating` gained a flip-boundary option so the table cell toolbar stays inside the editor. (#104)
- fix(core, extension-block-menu): a list item keeps its kind (bullet / ordered / to-do) across drag, paste, and turn-into; split numbering restarts and container drags close both ways. (#105)
- fix(extension-block-menu): no-op block drops are suppressed. The drop indicator hides and the drop is ignored when the release target is the block's own slot. (#105)
- fix(core): Shift+Tab outdents only the targeted children-zone block, splitting the list and keeping the parent item intact (Notion parity). (#105)

## 0.8.0 (2026-06-09)

### Features

- feat(extension-block-menu): reworked block drag-and-drop onto a unified gap-first drop model. The drop indicator now snaps to the nearest gap between blocks and the pointer's horizontal position chooses the nesting depth, with Y and X dead-bands so the line no longer flickers between gaps or levels. Drag right to nest a block deeper, left to outdent it across ancestor levels. (#101, #102)
- feat(extension-block-menu): position-aware nested drop. A dragged block can now land as the first, in-between, or last child of a list item, not just as a sibling. (#101)
- feat(extension-block-menu): dropping a non-list block into a list keeps the block's own type and splits the list around it, instead of wrapping it in a bullet. A list item dropped into a list of the other kind keeps its kind too (a to-do dropped among bullets stays a to-do). (#102)
- feat(extension-block-menu): two same-type lists rejoin into one when the block separating them is dragged out from between them, healing the ordered-list numbering. (#102)
- feat(react): `ReactNodeViewRenderer` node-view types now match ProseMirror's `NodeViewConstructor` (`getPos`, `decorations`, `ignoreMutation`), so `addNodeView` no longer needs a cast. (#102)

### Internal

- test(demos): cross-wrapper functional parity for drag-and-drop, node views, and form integration. Added Angular `ngModel`, React node-view, and React compound demos with their e2e, and backported heading Notion-Enter and task-checkbox coverage to vanilla/react/vue. (#102)

## 0.7.5 (2026-06-03)

### Changes

- fix(core): `StarterKit` makes `ListIndent` opt-in (off by default). Tab on a paragraph that merely follows a list used to capture focus and pull the paragraph into the list; now Tab moves focus to the next field, which suits embedded / form usage. Opt back in with `StarterKit.configure({ listIndent: true })`. In-list Tab/Shift-Tab and block-menu drag-to-nest are unchanged. (#98)

### Fixes

- fix(core): extension instances are now cloned per editor, so several editors on one page no longer clobber each other. Previously creating a second editor repointed the first editor's node types at its own schema, and list `Enter` on the earlier editors dropped an indented child paragraph instead of a new list item. (#91)
- fix(core): `SelectionDecoration` no longer keeps a ghost range when focus moves from one editor to another on the same page. The "editor UI" blur check is now scoped to the editor that lost focus, so a click into a different editor collapses its selection.

## 0.7.4 (2026-05-29)

### Fixes

- fix(extension-table): table control dropdowns (row/column handles, cell color and alignment menus) now render inside the editor container instead of `document.body`, so they display correctly when the editor lives inside a modal or `<dialog>`. They are positioned with `fixed` so the editor's `overflow: hidden` can no longer clip them. (#93)
- fix(core): converting a nested list item via a slash or menu command (Heading, Code block, Quote, Details) now keeps it indented as a children-zone block of its parent (Notion-style "Turn into") instead of silently doing nothing. Top-level items still dissolve to a top-level block. (#94)
- fix(extension-table): the Table extension now pulls in Gapcursor, so a table at the end of the document is no longer a caret trap. ArrowDown or a click below the table drops a gap cursor and lets you type a new paragraph. (#94)
- fix(core): list markdown shortcuts (`- `, `* `, `+ `, `1. `, `[ ]`, `[x]`) now also join with the following same-type list, not just the preceding one. Creating a list item on a line between two lists merges them into a single list instead of orphaning the trailing one. (#95)

## 0.7.3 (2026-05-24)

### Fixes

- fix(theme): link and image popovers were invisible on light theme. Popovers mount to `document.body` so the `--dm-*` design tokens defined inside `.dm-editor` never cascade to them; `background: var(--dm-bg)` resolved to the CSS initial value (transparent) and the popover blended into the toolbar. Hoisted token fallbacks to SCSS variables in `_link-popover.scss` and `_image.scss`, each carrying both the cascade lookup and a literal fallback. Also strengthened the default `--dm-popover-shadow` so popovers lift visibly off the toolbar. (#88)

## 0.7.2 (2026-05-24)

### Features

- feat(extension-toc): `FloatingTocOutline.activeScrollParent` option enables `scroll-mode='container'`. The outline pins to the host viewport's vertical middle via CSS sticky (zero JS during scroll) and the scroll-spy follows the host scroll instead of the window. Pair with a fixed-height wrapper for Notion-style scrollable editors. (#86)
- feat(extension-toc,theme): tick column caps at ~50% of the host viewport with `overflow: hidden` (matches Notion behaviour); the hover card matches that height and scrolls its rows internally. New `--dm-toc-ticks-max-h` token controls the cap. (#86)
- feat(theme): new `--dm-editor-padding-top-extra` token adds a comfortable gap between the editor's top edge and the first row. Defaults to `1rem` and bumps automatically in Notion mode where there is no toolbar above the column. (#86)
- feat(demo-vanilla,demo-react,demo-vue,demo-angular): "Notion scrollable" demo mode. Editor sits inside a fixed-height wrapper that scrolls internally; the TOC scroll-spy follows the host scroll, not the window. Full e2e parity across all four demos. (#86)

### Fixes

- fix(theme,extension-block-menu): BlockHandle `dragstart` now hides the native dropcursor element correctly. The previous selector targeted `.ProseMirror-dropcursor`, a class `prosemirror-dropcursor` v1.8+ does not emit, so both the custom and native indicators rendered at once during a handle drag. The hide rule now targets `prosemirror-dropcursor-block` and `prosemirror-dropcursor-inline`. E2E regression coverage added across all four demos. (#86)
- fix(extension-toc): `FloatingTocOutline` default `minHeadings` lowered from 2 to 1 so the outline appears on a single-heading document (matches Notion). Click-to-scroll no longer bubbles to the window when `activeScrollParent` is set. (#86)
- fix(extension-toc,theme): zero-jitter container scroll. Absolute UI children (BlockHandle, BubbleMenu, FloatingMenu) are pinned at `top: 0` so the hidden box doesn't inflate the host's `scrollHeight` and create a ghost scroll. (#86)
- fix(theme): tokenised slim scrollbar on the TOC card and Notion scrollable container so contrast holds in dark mode. (#86)
- fix(theme): suppressed the sharp 2px accent border on `li.ProseMirror-selectednode::after` when BlockHandle is active. The translucent halo is now the single source of truth for selection feedback so dragging a list item no longer shows a doubled frame. (#86)

### Internal

- refactor(extension-toc): extracted shared `getHeadingLabel` and `setActiveMarker` helpers used by both `FloatingTocOutline` and `TableOfContentsBlock`. (#86)
- refactor(extension-block-menu): extracted `clearTriggeredFlag` helper in `FloatingMenu` (deduplicates the dismiss and update branches). (#86)
- refactor(demos): standardised `TOAST_MS[kind]` access pattern across all four demos; Angular's copy-link listeners switched to `AbortController` for parity with the other three. (#86)

## 0.7.1 (2026-05-23)

### Features

- feat(ci): layered safety nets to prevent silent surface regressions. Consumer type-surface test exercises every `RawCommands` augmentation through the dist; per-package API surface snapshots; CSS variable references validated against theme definitions; gzipped bundle size budgets per package; grep guard forbidding relative-path module augmentations; `publint --strict`. (#84)
- feat(theme): tables render as a "data view" globally - 15px font, 1.5 line-height, tight cell padding. Easier to scan than body-scale tables. Override on `.dm-editor .ProseMirror table` for body-scale. (#84)
- feat(theme): Notion mode suppresses the slash-command placeholder inside narrow `<td>` / `<th>` cells so long hints like `Press '/' for commands` don't wrap onto two lines. (#84)
- feat(core): new `copyThemeClass(view, target)` utility - copies the editor's `dm-theme-*` class onto a floating element portaled to `document.body` so the dark/light cascade reaches it. (#84)

### Fixes

- fix(core): `RawCommands` module augmentations now reach external consumers. 30+ source files switched from `declare module '../types/Commands.js'` to `declare module '@domternal/core'`; tsup + rollup-plugin-dts dropped relative-path augmentations during bundling, silently breaking `editor.commands.focus()` and the rest of the command surface in any consumer of `@domternal/core@0.7.0`. (#84)
- fix(theme): table dropdown text rendered dark-on-dark in dark mode because portaled popovers couldn't read `--dm-button-color`. Added fallback to `--dm-text`. (#84)
- fix(core,extension-image,theme): `LinkPopover` and image popover rewritten to read theme tokens instead of hardcoded hex values; removed their dark-theme override blocks. Both popovers now adapt automatically to light/dark via the standard cascade. (#84)
- fix(extension-block-menu,theme): native `prosemirror-dropcursor` no longer doubles up with BlockHandle's own `.dm-block-drop-indicator` during a handle drag. BlockHandle adds a `dm-block-handle-dragging` class for the drag's duration; the theme hides the native cursor only while that class is present. Non-handle drags (text selection, external file drops) keep the native cursor. (#84)
- fix(extension-toc): `Table of contents` slash menu item moved from `Basic` group (priority 600, first slot) to `Advanced` (priority 90, last slot). Sits next to `Toggle block` at the end of the menu instead of dominating the first position. (#84)
- fix(theme): Notion mode body and h1 / h2 / h3 `font-size` overrides removed. Both modes now share the base text scale, so toggling between classic and Notion shifts layout (narrow column, gutter, tight rhythm) without a text-size jump. (#84)
- fix(theme): Notion mode table cells match classic-mode cell height. Higher-specificity rule keeps `td > p` / `th > p` margin at 0 against the Notion paragraph-margin rule that was puffing cells. (#84)

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
