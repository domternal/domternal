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
| `pnpm test:api-surface` | A change to a package's public exports that its committed snapshot does not record. Run `node tests/api-surface/dump.mjs` and commit the result when the change is intended. |
| `pnpm test:single-prosemirror` | Any identity-compared package locked at more than one version, in this lockfile or in a nested project's. |
| `pnpm test:frozen-contract` | A registration passing the wrong export for its module, or the table in `prosemirrorSingleton.ts` drifting from the one CI enforces. |
| `pnpm test:pm-ranges` | `@domternal/pm` and a library that peers on ProseMirror declaring ranges no single copy can satisfy. |
| `pnpm test:dedupe-reachable` | A `resolve.dedupe` entry the project root cannot reach, which Vite 8 ignores in silence. |
| `pnpm test:externals` | A package that could inline a module which has to stay shared, and a relative import the walk could not follow. |
| `pnpm test:hidden-attribute` | A stylesheet that would take the `hidden` attribute away, or a `display` rule outside the scope the restoring rule covers. |
| `pnpm test:css-vars` | A CSS variable referenced without a fallback and never defined. |
| `pnpm test:bundle-size` | A package growing past its budget. |
| `pnpm test:third-party-notices` | A shipped tarball missing the notices it has to carry. |

A gate that fails prints what to do about it. If you are adding one, give it unit tests and prove it fails by breaking the thing it guards, then putting it back.

### E2E tests

NEW cross-framework behavior specs go into the root `e2e/` matrix suite (`pnpm test:e2e:matrix`): one spec runs against all four demo apps via `e2e/targets.ts`. The per-app suites under each demo app's `e2e/` directory are the legacy layout and remain for existing specs and for behavior specific to one framework wrapper.

## Releases

Releases are handled by the maintainer, along with the `CHANGELOG.md` entry and
every version bump.

## License of contributions

By submitting a contribution you agree that it is licensed under the MIT
license of this repository.
