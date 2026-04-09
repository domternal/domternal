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
- **Summary** - Brief summary of changes (required)
- **Features** - Key capabilities added (for `feat` PRs)
- **Changes** - What was modified (for `fix`/`refactor` PRs)
- **What** - Problem/issue being solved (optional)
- **Test plan** - Steps to verify (optional)

## Development

```bash
pnpm install    # Install dependencies
pnpm build      # Build all packages
pnpm test       # Run tests
pnpm lint       # Run linter
pnpm typecheck  # Run type checker
```

## Release

1. Branch: `git checkout -b release/X.Y.Z` from main
2. Bump `"version"` in all 11 `packages/*/package.json` + `domternal.dev/package.json`
3. Bump `peerDependencies` and `prepublishOnly` hook versions to `>=X.Y.Z`
4. Bump `examples/*/package.json` deps to `^X.Y.Z`
5. Update `CHANGELOG.md` and `domternal.dev` changelog
6. Update all 12 READMEs (root + 11 packages)
7. Verify: `pnpm test && pnpm build && pnpm typecheck && pnpm lint`
8. Merge to main, tag `vX.Y.Z`, push with tags
9. Publish: pm, core, theme, angular, react, then extensions
10. Create GitHub release from tag
