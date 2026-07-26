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

### E2E tests

NEW cross-framework behavior specs go into the root `e2e/` matrix suite (`pnpm test:e2e:matrix`): one spec runs against all four demo apps via `e2e/targets.ts`. The per-app suites under each demo app's `e2e/` directory are the legacy layout and remain for existing specs and for behavior specific to one framework wrapper.

## Release

1. Branch: `git checkout -b release/X.Y.Z` from main
2. Bump `"version"` in all 18 `packages/*/package.json` + `domternal.dev/package.json`, and `VERSION` in `packages/core/src/index.ts` (a test enforces they match)
3. Bump `peerDependencies` and `prepublishOnly` hook versions. For patch releases, keep the existing minimum compatible version. For minor/major releases, bump to `>=X.Y.0`.
4. Update `CHANGELOG.md` and `domternal.dev` changelog
5. Update all 19 READMEs (root + 18 packages)
6. (skip) Verify: `pnpm test && pnpm build && pnpm typecheck && pnpm lint`
7. Open the release PR and merge to main (manual), then tag `vX.Y.Z` on main and push with tags
8. Publish in order: pm, core, theme, angular, react, vue, vanilla, then extensions
9. Create GitHub release from tag with title `vX.Y.Z` and changelog entry as body (manual)

### Publish notes

- **Order matters**: pm first, core second, then the rest. Other packages depend on them.
- **`prepublishOnly`** runs `pnpm build` automatically before every publish, so dist is always included.
- **If publish fails** after `prepublishOnly` already stripped `devDependencies`, `postpublish` won't run. Restore manually: `git checkout packages/*/package.json`
- **Tag on main**: always tag after merging to main, not on the release branch.
