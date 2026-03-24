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

## Contributor License Agreement (CLA)

Before your first pull request can be merged, you need to sign our [Contributor License Agreement (CLA)](https://gist.github.com/ThomasNowHere/cdca6f890b). The CLA confirms that you have the right to contribute your code and that you grant the project permission to use it. When you open a PR, the CLA Assistant bot will post a comment with a link to sign. You only need to sign once.

## Development

```bash
pnpm install    # Install dependencies
pnpm build      # Build all packages
pnpm test       # Run tests
pnpm lint       # Run linter
pnpm typecheck  # Run type checker
```
