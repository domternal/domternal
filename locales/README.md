# Maintained UI translations

Edit `locales/de.ts` to change the German Free UI translations. It is the only hand-maintained German translation source in this repository. The Pro repository has its own `locales/de.ts` for Pro UI.

Each exported function groups the messages for one owning package. Its `deMessages` map must cover that package's English definitions exactly. Its `deSearchAliases` map contains optional German discovery terms for searchable messages. Keep technical command aliases, document text, names and other caller-provided values unchanged.

After editing the central file, run:

```sh
pnpm locales:generate
pnpm locales:check
pnpm test:i18n
```

The generator reads TypeScript syntax without executing the catalog functions. It writes the small `packages/<owner>/src/locales/de.ts` modules. Commit the central source and its generated files together. Never edit a generated locale file directly: the drift check rejects differences until the central source is regenerated.

Generation fails for missing, extra, duplicate or incorrectly owned message keys, unsupported source shapes and invalid search aliases. TypeScript and locale unit tests additionally check callback parameters, formatting and runtime behavior. These checks establish structural completeness; they do not establish native-speaker language review.

English definitions remain with their owning features because they specify the public message IDs, parameter types, translator context and fallback behavior. When adding an English message definition, update its German entry in this central file and regenerate.

## Package delivery

Consumers import `deMessages` and `deSearchAliases` from an existing package's `/locales/de` entry. They do not install a separate German npm package. The ordinary package entry does not import the German catalog, and a locale entry does not initialize an editor. The central source is not shipped in package archives.

Applications combine the catalogs for their selected features into one editor configuration. They may override individual messages by spreading into a new object. Both exported maps and alias arrays are frozen. Setting `locale: 'de'` selects German formatting and grammar; loading the messages remains explicit.

The current generator validates the German `de.ts` contract. Adding another language requires a reviewed central source, matching generation and public export support, and coverage tests. Do not copy a German catalog to a new filename and assume that creates a supported language entry.

Before publishing, run the normal package build, API, artifact, consumer and relevant browser checks. E2E execution may be paused independently of source generation; a collected or written browser test is not a passing result.
