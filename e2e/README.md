# Tutorial regression coverage

The tutorial fixtures use the public Free ESM builds. Build the packages before
running them. The fixture server resolves a single React, Vue and ProseMirror
installation and prepares the fixtures' dependencies before browser interaction.
The normal matrix includes these specs; a focused configuration avoids starting
the four demo applications when they are unnecessary.

```sh
pnpm exec playwright test --config e2e/playwright.tutorial.config.ts --project=chromium
pnpm exec playwright test --config e2e/playwright.cross-browser.config.ts e2e/autolink-delimiters.spec.ts e2e/floating-menu-descriptions.spec.ts e2e/toolbar-dropdown-shortcuts.spec.ts e2e/theme-root-overrides.spec.ts --project=chromium
pnpm test:types-consumer
```

Use `--project=firefox` or `--project=webkit` for the other engines. Keep raw E2E
output in a log and monitor progress as described in the repository instructions.
Fixture source must stay unchanged while a run is active, since Vite reloads it.

Tests that access the native clipboard import `test` from `native-clipboard.ts`.
Its automatic fixture locks the clipboard across workers, files and repetitions
using the shared project output directory. Mixed files use that fixture only for
their native clipboard group. Keep browser projects on a shared output directory,
or run separate invocations sequentially when their output directories differ.

The original finding numbers below are stable references, independent of the
internal planning documents. Tests exercise the compatible behavior chosen for
each finding; they do not implement the deferred major-version proposals.

| Finding | Durable coverage |
| --- | --- |
| 1. Editor DOM adoption | `tutorial-lifecycle.spec.ts`; Core, Block Controls, React and Vue adoption unit suites; Pro `tutorial-adoption.spec.ts`. Includes delayed mounts, remounts, state/history identity, live controls, Vue state observers, SSR hydration and cleanup. |
| 2. React selector snapshots | `tutorial-lifecycle.spec.ts` and React `useEditorState.test.ts`: allocating selectors, selection changes, command availability and subscriptions. |
| 3. Slash menu custom icons | `tutorial-slash-contracts.spec.ts`, Block Controls `SlashCommand.test.ts` and `createSlashSuggestionRenderer.test.ts`. |
| 4. Slash ancestor exclusions | `tutorial-slash-contracts.spec.ts` and `filterByCursorAncestors.test.ts`: non-list ancestors, slash-only policy and nested list exceptions. |
| 5. Floating descriptions | `floating-menu-descriptions.spec.ts` across all four wrappers and React `tutorialMenuRendering.test.tsx`: literal text, wrapping, compact rows and disabled items. |
| 6. Shared TOC observation | `tutorial-toc-storage.spec.ts` and TOC activity/tracker unit suites: custom scroll roots, initial hash, DOM references, coherent notifications and cleanup without a visual outline. |
| 7. React children placement | `tutorial-lifecycle.spec.ts`: sibling placement, child state, rerenders and editor selection. |
| 8. Autolink boundaries | `autolink-delimiters.spec.ts` across all four wrappers and Core autolink unit suites: URL growth, delimiters, custom destinations, named links and undo/redo. |
| 9. Keyboard shortcut spelling | `tutorial-input-contracts.spec.ts` and Core `keyboardShortcutContracts.test.ts`: actual key dispatch separately from shortcut display. |
| 10. Dropdown shortcut titles | `toolbar-dropdown-shortcuts.spec.ts` across all four wrappers and React `tutorialMenuRendering.test.tsx`: platform formatting, labels, swatches and reset items. |
| 11. Literal text insertion | `tutorial-input-contracts.spec.ts` and Core `contentCommands.test.ts`: literal insertion versus parsed HTML, selection replacement and history. |
| 12. Strict storage access | `tests/consumer-types/tutorial-storage.ts` and `.cts`, executed by the public consumer gate: ESM/CJS declarations, explicit capability narrowing and intentional compile errors for unknown storage. |
| 13. Theme component roots | `theme-root-overrides.spec.ts` across all four wrappers: actual computed styles on the editor, toolbar and external outline. |
| 14. Lowlight storage and aliases | `tutorial-toc-storage.spec.ts` and `CodeBlockLowlight.storage.test.ts`: canonical languages, supported aliases, unknown saved values and explicit user changes. |
| 15. Canonical TOC JSON name | `tutorial-toc-storage.spec.ts` and `TableOfContentsExamples.test.ts`: public command insertion, undo, JSON reload and navigation. |
| 16. Heading-only IDs | `TableOfContentsExamples.test.ts`: default and heading-only configurations, HTML/JSON round trips and pasted heading uniqueness. |
| 17. Semantic HTML attributes | `tutorial-input-contracts.spec.ts` and Mention/Math `semanticHTML.test.ts`: parsing and serializing the documented identity attributes. |
| 18. Durable collaboration seed | The self-hosting repository's `seed-persistence.test.mjs` and `shutdown.test.mjs`: real server/client/SQLite persistence, restart, concurrent clients, failed writes and retry recovery. |
| 19. Export recipes | Pro `tutorial-export-recipes.spec.ts` and `tutorialRecipes.test.ts`: downloaded Word/PDF files, image resolution, complete comment schemas, authors and warning lifecycle. |
| 20. Custom toolbar focus | `tutorial-lifecycle.spec.ts`: real pointer, keyboard and touch actions with text/cell selections, form buttons, disabled controls and mixed inputs. |

Selections are seeded through the editor model and checked against native DOM
selection or selected table cells before real user actions. These tests do not
claim IME composition, native drag-to-select gestures or exhaustive coverage of
unrelated editor features. Compile-time findings use the consumer type gate;
server persistence uses real process integration tests rather than browser mocks.
