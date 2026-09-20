# Maintained UI translations

Edit `locales/de.ts` to change the German Free UI translations. It is the only hand-maintained German translation source in this repository. The Pro repository has its own source for Pro UI. Generated package copies are build inputs, not additional places to edit translations.

Each exported function groups the messages for one owning package. Its `deMessages` map covers that package's English definitions exactly. Its `deSearchAliases` map contains optional discovery terms for searchable messages. Keep technical command aliases, document text, names and other caller-provided values unchanged.

## Add a language

1. Create `locales/fr.ts`, using `de.ts` as the structural template. Keep the owner function names, type imports and message IDs.
2. Rename `deMessages` to `frMessages` and `deSearchAliases` to `frSearchAliases` throughout the new file. Translate the UI wording, aliases, plural forms and other language-specific callbacks. Every owner needs a complete message map; alias maps may be empty.
3. Run the normal `pnpm build`. It discovers the new file, generates each owner's locale module and exact package exports, then builds the public runtime and type entries. An individual owner's `pnpm build` does the same for that package.
4. Run the locale, API, artifact and consumer checks. Commit the new central source, generated modules and updated package manifests together. Review the wording and relevant browser behavior before release.

No per-language build configuration, export registration or API snapshot needs to be added by hand. Use canonical language tags, such as `fr`, `pt-BR` or `zh-Hant-TW`; filenames are case-sensitive. The corresponding symbols are `frMessages`, `ptBRMessages` and `zhHantTWMessages`, with matching `SearchAliases` symbols. Unicode extensions and private-use tags do not belong in source filenames. Use runtime locale options for formatting preferences.

A new source must contain actual translations. Renaming a copy of German does not make it French. The generator validates structure; it does not translate or establish native-speaker review. Adding French here covers Free; supporting French across both products also requires the Pro repository's central source.

## Build and validation

Generation is automatic in root and locale-owning package builds. These commands remain available for focused work:

```sh
pnpm locales:generate
pnpm locales:check
pnpm test:i18n
```

`locales:generate` updates source modules and exact locale exports in package manifests. `locales:check` is read-only: missing, stale, unexpected or invalid output fails. CI checks committed output before any build can regenerate it. Commit generated output with its source rather than relying on CI to repair it.

The generator reads TypeScript syntax without executing catalog functions. It validates every central source before writing, rejects missing, extra, duplicate and incorrectly owned message keys, and rejects invalid aliases or runtime imports. It removes only obsolete files bearing its own generated-file header. Handwritten conflicts are errors. Package builds generate only that owner's files so parallel builds do not write the same outputs.

English definitions remain with their owning features because they specify public message IDs, parameter types, translator context and fallback behavior. When adding an English message, update every maintained language in this repository. TypeScript and locale tests check callback parameters and runtime behavior as well as structural completeness.

## Package delivery

Consumers import `deMessages` and `deSearchAliases` from an existing package's `/locales/de` entry, or the equivalent symbols and path for another maintained language. There is no separate npm package per language. Normal editor entries do not import locale catalogs, and locale entries do not initialize an editor. The central source is not shipped in package archives. Installed consumers do not run the generator.

Applications combine the catalogs for their selected features into one editor configuration and may override messages by spreading into a new object. Both exported maps and alias arrays are frozen. Locale selection and loading remain separate: `locale: 'fr'` selects French formatting and grammar; the application must explicitly supply its French messages. Authored content is unchanged.

Free `pnpm pack` checks the most recent normal package build and fails if translations or their built files have changed. Run `pnpm build` again when it asks. `prepublishOnly` builds before preparing the published manifest. The build receipt is local, ignored by Git and excluded from published archives. It records the validated inputs and built locale files so packaging rejects stale or incomplete output. Use the normal package build command without compiler overrides to create it. For custom build options, invoke `pnpm exec tsup` directly; custom builds do not create a receipt. Publication and version selection remain separate maintainer actions.

Each discovered language receives bounded runtime and archive allowances. A language with unusually large data can require an explicit size-budget review; adding a file does not disable those limits. API checks require the exact locale export names and artifact checks require both runtime and declaration formats.

Before publishing, run the normal package build, API, artifact, consumer and relevant browser checks against compatible dependencies. E2E execution may be paused independently; a collected or written browser test is not a passing result.
