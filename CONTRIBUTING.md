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

## Changelog

`CHANGELOG.md` uses a fixed set of sections, in this order. Do not invent new
ones: fourteen different names accumulated over thirty releases before this was
written down, and a reader scanning for breaking changes under one name missed
the release that used the other.

| Section | What belongs in it |
|---|---|
| `Breaking` | Anything a consumer must change code for |
| `Features` | New capability or new public API |
| `Fixes` | Wrong behaviour that is now right, including packaging fixes |
| `Packages` | A package published for the first time, or renamed |
| `Accessibility` | Keyboard, screen reader, contrast, reduced motion |
| `Docs` | README changes, which ship in the npm tarball |
| `Internal` | Refactors, tests and CI. Visible to nobody who installs the package, so it goes last |

Omit a section rather than writing "none". Chore commits that change no shipped
artefact (repo config, workflows, planning) do not go in the changelog at all.

A pull request does not edit `CHANGELOG.md` and does not bump any version. Say
what changed in the PR description; it lands in the changelog at release time.
