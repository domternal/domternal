# Localization maintenance gate

Run `pnpm test:i18n` to check the catalog and known UI text sinks. After reviewing an intentional public message change, run `pnpm i18n:update` and commit the resulting `inventory.json` diff. Updating the inventory never accepts an unexplained UI literal.

The AST checker runs with this repository's installed TypeScript package and needs no build artifacts, network access, browser or editor runtime imports. The full `test:i18n` command additionally runs generator and package lifecycle tests, then checks central-source types. Those stages require installed build tools and compatible package types. No stage starts a browser.

## Official translation source

Maintain one `locales/<locale>.ts` per language, grouped by the package that owns each English message. Normal root and owner package builds automatically discover sources, generate package modules and update locale exports. `pnpm locales:generate` runs that step explicitly; `pnpm locales:check` validates committed output and central-source types without changing files. See [the contribution instructions](../../locales/README.md).

The generator reads TypeScript syntax without executing owner functions, copies scoped helpers and translation expressions, and emits independent public locale modules. Generated modules import types only. Missing, extra, duplicate, incorrectly owned or unsearchable keys, runtime imports, mutable maps, unsupported source shapes and invalid locale names fail. Complete all message maps before adding a source; application overrides remain partial.

Generator tests exercise source discovery, export synchronization, stale generated files and safe ownership. Lifecycle tests cover source, manifest and artifact changes, invalid build receipts, compiler failures and a source edit during a build. A scratch workspace adds only a French source, runs the real package and root/Nx builds, checks standalone runtime and declaration imports and proves that stale packing fails. This synthetic catalog is a fixture, not a shipped French translation. CI checks committed output before builds can regenerate it.

## Catalog contract

`namespaces.json` assigns a reviewed key prefix to each package that owns messages. The checker extracts `defineMessage` calls, including renamed imports and local factory functions that directly return a definition. Factory arguments are substituted statically; callbacks are recorded as source and never executed. An unresolved key or descriptor fails instead of silently disappearing from the inventory.

Every English definition must have a unique namespaced key, the owning package's name, a translator description, a valid text or function default, and a matching `MessageParameters` declaration. Required defaults cannot be empty. Alias arrays contain unique non-empty strings and require `SearchableMessages` membership. Destructured callback parameter names must exist in the declared object shape. Clearly non-string callback returns fail.

The English definition set is complete: orphan declarations and missing definitions fail. Application `i18n.messages` overrides remain partial and are not catalog declarations. Each message-owning Free package ships its complete official German catalog as `@domternal/<package>/locales/de`, exporting `deMessages` and `deSearchAliases`. These optional subpaths do not change the English default or add German messages to the main editor bundle.

Every maintained locale module uses type-only imports and an explicit readonly `CompleteMessages<typeof packageMessages>` annotation. The annotation preserves the owning package's message registry in published declarations; `satisfies` alone can lose that dependency. The built ESM and CommonJS consumer fixtures verify each package's complete key set, readonly catalog, message parameters and composable partial application overrides. Separate compiler programs load one locale package at a time in each module system, so another extension cannot accidentally register its keys for it.

The consumer gate also imports the locale subpaths from isolated temporary packages containing only their locale bundles and manifests. Missing keys, extra keys, invalid search aliases, mutable exports and an accidental dependency on the editor runtime fail this check. These checks discover all maintained languages automatically; do not apply official-catalog completeness to application overrides. Existing package typechecks and built consumer fixtures remain responsible for full function typing, referenced definitions, and declaration merging. The AST gate complements those compiler checks.

`inventory.json` is sorted by stable message key and contains owner, English text or callback source, parameter type and fields, description, empty-string policy, alias metadata, searchable membership, and the source path. It has no generation timestamp or machine-specific paths. This data is suitable for a generated website reference. A removed or renamed key, changed parameter, changed English default, or changed ownership produces a reviewable diff.

## UI regression scope

The scanner covers shipped package `src` files, excluding test files, declaration output, and generated dependency/build directories. It checks:

- DOM text/property assignments and human-facing `setAttribute` calls.
- Known UI descriptor properties and direct button-helper arguments.
- JSX text/attributes and literal expression children, including conditional and array children.
- Vue `h` text in both two-argument and three-argument forms.
- Angular inline templates and HTML/Vue template text/attributes.
- Literal CSS/SCSS generated content.
- Local `const` values reaching these sinks, resolved through TypeScript symbols.

Technical keys such as commands, node names, group identity, CSS classes, and data attributes are not translated text sinks. This is a focused regression gate, not a general dataflow or template compiler: strings assembled through arbitrary application callbacks, imported external data, deeply nested template expressions, custom helper signatures, and computed styles still require manual surface review and pseudo-localized browser coverage. It does not claim that every English string is UI copy or that all possible copy is statically discoverable.

`exclusions.json` contains only reviewed exceptions with an exact file, enclosing context, sink, literal text, occurrence count, and reason. An unused or changed exclusion fails. Sample glyphs, serialized document compatibility text, stable model-facing command metadata, and standalone helper compatibility defaults are documented individually. Do not add a broad file pattern or baseline new live UI copy merely to make the check pass. License marks, native UI, external data, and diagnostics can be excluded only when a specific finding actually belongs to that boundary.

The separate Free-to-Pro dependency guard covers all JS/TS files under package `src`, including noncatalog modules, CommonJS shims, tests, and declarations. It recognizes literal import/export, dynamic import, import types, `require`, `module.require`, and `require.resolve` forms. Existing source-boundary checks separately enforce ProseMirror identity and module augmentation paths.

The checker inspects source files only. It never logs user documents, translation parameter values, AI request content, or production missing-key events.
