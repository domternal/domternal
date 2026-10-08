# Contributing to Domternal

## Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/). Format:

```
type(scope): description
      │            │
   package    what changed
```

### Types

| Type | Description |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `style` | Code style (formatting, semicolons, etc.) |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `perf` | Performance improvement |
| `test` | Adding or fixing tests |
| `chore` | Maintenance (build, CI, dependencies) |

### Scope

Scope is the **package name**: `core`, `angular`, `react`, etc.

Omit scope for changes that affect the whole repo (root configs, CI, etc.).

### Examples

```
feat(core): add editor state management
fix(angular): resolve change detection issue
docs(core): add API documentation
chore: upgrade TypeScript to 5.9
```

## Pull Requests

### PR Title

PR title follows the same format as commit messages:

```
feat(core): add toolbar plugin
```

### Merge Strategy

We use **Squash and Merge**. The PR title becomes the final commit message.

### PR Description

Include:
- **Summary** - Short summary of all the changes (required)
- **Features** - Which features were added (if any)
- **Fix** - What was fixed, which bugs (if any)
- **Changes** - Which changes were made (if any)
- **Verified** - What was tested and how (e.g. "built all packages, ran unit tests, tested in demo app")

A PR can have just one of Features/Fix/Changes, or all of them. The
[PR template](.github/PULL_REQUEST_TEMPLATE.md) pre-fills these sections.

## Development

```bash
pnpm install    # Install dependencies
pnpm build      # Build all packages
pnpm test       # Run tests
pnpm lint       # Run linter
pnpm typecheck  # Run type checker
```

### Repository gates

Beyond the lint, type and test runs above, CI runs a set of standalone checks. Each one guards a failure that is silent in ordinary use, and each is a plain Node script with its own unit tests, so you can run one on its own while working on it:

| Command | What it refuses to let through |
|---|---|
| `pnpm test:api-surface` | A change to a published entry's exports that its committed snapshot does not record, an entry whose surface cannot be read at all, or a snapshot left behind by a package that no longer exists. Run `node tests/api-surface/dump.mjs` and commit the result when the change is intended. |
| `pnpm test:single-prosemirror` | Any identity-compared package locked at more than one version, in this lockfile or in a nested project's. |
| `pnpm test:frozen-contract` | A registration passing the wrong export for its module, or the table in `prosemirrorSingleton.ts` drifting from the one CI enforces. |
| `pnpm test:pm-ranges` | `@domternal/pm` and a library that peers on ProseMirror declaring ranges no single copy can satisfy. |
| `pnpm test:dedupe-reachable` | A `resolve.dedupe` entry the project root cannot reach, which Vite 8 ignores in silence. |
| `pnpm test:externals` | A package that could inline a module which has to stay shared, and a relative import the walk could not follow. |
| `pnpm test:ssr-import` | A built entry that does not evaluate in plain Node. One top-level `document` or `window` breaks every server-rendered consumer before their first render, and nothing else here ever loads a bundle. The ESM and CommonJS halves load in separate processes, because no consumer imports both and a package that guards its own identity through `globalThis` would otherwise warn on a clean tree: split like that, such a warning has no innocent cause left and fails the gate. |
| `pnpm test:subpath-reexports` | A re-export subpath such as `@domternal/core/clipboard` that stops being a thin re-export of its package's main bundle. Built as its own entry it would carry a second copy of every registry it names, so a registration made through it would never reach the Editor. The gate reads the built ESM and CommonJS files and runs probes in separate processes that register through the subpath and observe the Editor's own paste and copy. A third probe asserts that an ESM Editor and the CommonJS subpath stay separate, so no join between copies can appear unnoticed. |
| `pnpm test:package-policy` | A version bumped without the `>=MAJOR.MINOR.0` floors that travel with it, a package left behind by a release, a manifest that would publish something a consumer cannot resolve, a declared Node floor that disagrees with `.nvmrc`, and a peer range that excludes the version this repository actually builds against. It runs the publish transform itself, so it cannot disagree with what publishing does. |
| `pnpm test:package-artifacts` | A tarball missing a file it must carry, carrying one nothing allows, growing past its budget, or exporting a path that is not inside it. |
| `pnpm test:release-readiness` | A package listed in `scripts/release-readiness.json` that the publish path would not refuse before rewriting its manifest, a missing or malformed list, an entry naming no package in this workspace, a listed package marked `private`, which would drop it from the gates that skip private packages, and a package script other than `prepublishOnly` that runs the publish transform. Listed packages are built, packed and checked like every other package; only publishing them is refused. |
| `pnpm test:hidden-attribute` | A stylesheet that would take the `hidden` attribute away, or a `display` rule outside the scope the restoring rule covers. |
| `pnpm test:css-vars` | A CSS variable referenced without a fallback and never defined, anywhere in `packages/*/src`, including references and definitions written from TypeScript. |
| `pnpm test:bundle-size` | A published entry growing past its budget, or shipping with no budget at all. |
| `pnpm test:third-party-notices` | A shipped tarball missing the notices it has to carry, or a bundled dependency that no notice declares. |
| `pnpm test:types-consumer` | A published declaration graph an external consumer cannot compile, checked from both an ESM and a CommonJS fixture against the built dists. |
| `pnpm test:evidence` | A preserved historical evidence tool whose bytes no longer match its `MANIFEST.json` or the digest its report records, a committed evidence report the maintained tool in `tests/evidence/` no longer reproduces or serializes byte for byte, a report over the 2 MiB ceiling, and any script, workflow or test that executes a historical tool or Python. A redaction of committed evidence must be declared in its `MANIFEST.json` (version 2) with every file it changed, where the unredacted originals are and every digest it replaced or withheld; the gate holds it with the redacted bytes alone, because the originals of the 2026-10-03 redaction were removed from the repository history on the owner's request. `pnpm evidence:replay --archive <dir>` repeats the full comparison locally against the stored inputs; it needs the evidence archive and is not a CI gate. |
| `pnpm test:privacy` | An e-mail address, a home or drive path, a file URL naming a person's folder or another host, Office author data inside a package or capture bundle, or the login, host name or Git e-mail of the machine running the check, in any tracked file, also when escaped or inside a Word package or an image. Documentation and tests use placeholders: reserved domains such as `example.com`, users such as `me` or `$USER`, and `$HOME`; the allowed forms and their reasons are listed at the top of `tests/privacy/check.mjs`. A finding prints the file, line and category, never the text. |
| `pnpm test:ci-wiring` | A gate `package.json` declares that CI never runs, whether it was forgotten, commented out or left with `if: false`, a mandatory gate (`test:privacy`) removed together with its step or hollowed out, a package the validation step never names, and a Lint or e2e type-check step placed before the Build step whose output they read. |

A gate that fails prints what to do about it. If you are adding one, give it unit tests and prove it fails by breaking the thing it guards, then putting it back. Add it to CI in the same commit: `pnpm test:ci-wiring` will otherwise fail, which is the point of it.

One of them runs only locally, and CI runs just its unit tests: `test:dedupe-reachable` does its real work only on a machine that has the nested `domternal.dev` checkout, where the only `resolve.dedupe` list lives, and prints `SKIPPED` without it. `pnpm test:ci-wiring` counts it apart for that reason, and fails if CI runs the full check, which would be a green line it has not earned. `test:pm-ranges` runs in full in CI: it compares `@domternal/pm` with every installed package that takes ProseMirror as a peer, and the y-prosemirror that `@domternal/core` installs for its collaboration tests is one, so it does real work after any full install, a fresh clone included.

Two more runs cover ground the gates do not. `pnpm lint` finishes with an ESLint pass over `tests/`, `scripts/` and `e2e/`, which no package owns, and `pnpm typecheck:e2e` type-checks the matrix suite against `e2e/tsconfig.json`. That config resolves `@domternal/*` to the built `dist` declarations, and the ESLint pass reads `e2e/` through it, so both need a prior `pnpm build`: in a fresh checkout they otherwise fail with unresolved-module (`TS2307`) and `no-unsafe-*` errors. CI runs its Build step before them, and `pnpm test:ci-wiring` keeps that order. Coverage floors live in each package's `vitest.config.ts` and are enforced by `pnpm test:coverage`.

### E2E tests

NEW cross-framework behavior specs go into the root `e2e/` matrix suite (`pnpm test:e2e:matrix`): one spec runs against all four demo apps via `e2e/targets.ts`. Name them `*.spec.ts`; the matrix collects no other file names. The per-app suites under each demo app's `e2e/` directory are the legacy layout and remain for existing specs and for behavior specific to one framework wrapper.

## Releases

Releases are handled by the maintainer, along with the `CHANGELOG.md` entry and
every version bump.

A package listed in `scripts/release-readiness.json` is developed and checked
like every other package, but publishing it is refused: its `prepublishOnly`
runs the package's build, if it has one, then stops with `[release-readiness]`
before the manifest is rewritten. Only a release pull request removes or
changes an entry, and the pull request that removes one also updates the README
and `context7.json` wording that still describes that package as unreleased. A
release empties `unreleased` and never deletes the file: a missing or malformed
list refuses every publish.

Publish each package with `pnpm publish` in its own directory. While the list
is not empty, do not use `pnpm -r publish`: it stops at the first listed package
after publishing the packages sorted before it. Never pass `--ignore-scripts`,
never publish a `.tgz`, and check that `pnpm config get ignore-scripts` is not
`true`: each of these skips both the readiness guard and the manifest
transform.

## License of contributions

By submitting a contribution you agree that it is licensed under the MIT
license of this repository.
