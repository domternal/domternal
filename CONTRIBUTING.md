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
| `pnpm test:package-policy` | A version bumped without the `>=MAJOR.MINOR.0` floors that travel with it, a package left behind by a release, a manifest that would publish something a consumer cannot resolve, a declared Node floor that disagrees with `.nvmrc`, and a peer range that excludes the version this repository actually builds against. It runs the publish transform itself, so it cannot disagree with what publishing does. |
| `pnpm test:package-artifacts` | A tarball missing a file it must carry, carrying one nothing allows, growing past its budget, or exporting a path that is not inside it. |
| `pnpm test:hidden-attribute` | A stylesheet that would take the `hidden` attribute away, or a `display` rule outside the scope the restoring rule covers. |
| `pnpm test:css-vars` | A CSS variable referenced without a fallback and never defined, anywhere in `packages/*/src`, including references and definitions written from TypeScript. |
| `pnpm test:bundle-size` | A published entry growing past its budget, or shipping with no budget at all. |
| `pnpm test:third-party-notices` | A shipped tarball missing the notices it has to carry, or a bundled dependency that no notice declares. |
| `pnpm test:types-consumer` | A published declaration graph an external consumer cannot compile, checked from both an ESM and a CommonJS fixture against the built dists. |
| `pnpm test:ci-wiring` | A gate `package.json` declares that CI never runs, whether it was forgotten, commented out or left with `if: false`, and a package the validation step never names. |

A gate that fails prints what to do about it. If you are adding one, give it unit tests and prove it fails by breaking the thing it guards, then putting it back. Add it to CI in the same commit: `pnpm test:ci-wiring` will otherwise fail, which is the point of it.

Two of them do their real work only on a machine that has the nested `domternal.dev` checkout, and print `SKIPPED` in CI rather than a green line they have not earned: `test:dedupe-reachable` (the only `resolve.dedupe` list lives there) and `test:pm-ranges` (it is the only importer that pulls in y-prosemirror). `pnpm test:ci-wiring` counts them apart for that reason.

Two more runs cover ground the gates do not. `pnpm lint` finishes with an ESLint pass over `tests/`, `scripts/` and `e2e/`, which no package owns, and `pnpm typecheck:e2e` type-checks the matrix suite against `e2e/tsconfig.json`. Coverage floors live in each package's `vitest.config.ts` and are enforced by `pnpm test:coverage`.

### E2E tests

NEW cross-framework behavior specs go into the root `e2e/` matrix suite (`pnpm test:e2e:matrix`): one spec runs against all four demo apps via `e2e/targets.ts`. The per-app suites under each demo app's `e2e/` directory are the legacy layout and remain for existing specs and for behavior specific to one framework wrapper.

## Releases

Releases are handled by the maintainer, along with the `CHANGELOG.md` entry and
every version bump.

## License of contributions

By submitting a contribution you agree that it is licensed under the MIT
license of this repository.
