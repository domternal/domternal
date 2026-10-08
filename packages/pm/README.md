# @domternal/pm

[![Version](https://img.shields.io/npm/v/@domternal/pm.svg)](https://www.npmjs.com/package/@domternal/pm)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/domternal/domternal/blob/main/LICENSE)

Shared ProseMirror dependencies for [Domternal](https://domternal.dev). Each
`@domternal/pm/*` subpath re-exports the corresponding `prosemirror-*` package,
including its TypeScript types. Domternal packages use these entry points to share
the same ProseMirror classes and plugins.

## Install

`@domternal/core` already depends on this package. Add it directly when your own
code imports from `@domternal/pm/*`, or when an extension's peer dependencies
require it:

```bash
pnpm add @domternal/pm
```

The package declares Node.js 22 or later for tooling and has no peer dependencies.
Use version 1.3.1 for all installed Domternal packages. Free 1.3.x extensions
require `@domternal/core` and `@domternal/pm` peers in `>=1.3.0 <2.0.0`;
Core 1.3.1 requires PM `>=1.3.1 <2.0.0` at runtime so its dependency fixes
are included.

## Usage

Always import a subpath. There is no `@domternal/pm` root export.

```ts
import { Plugin, PluginKey } from '@domternal/pm/state';

export const documentChangeLogger = new Plugin({
  key: new PluginKey('documentChangeLogger'),
  view: () => ({
    update(view, previousState) {
      if (!view.state.doc.eq(previousState.doc)) {
        console.log(view.state.doc.toJSON());
      }
    },
  }),
});
```

Register a plugin through an extension's `addProseMirrorPlugins()` hook or
`editor.registerPlugin()`. See [custom extensions](https://domternal.dev/v1/guides/configuration/#add-prosemirror-plugins)
and [dynamic plugins](https://domternal.dev/v1/guides/editor-api/#dynamic-plugin-management).

## Entry points

Every subpath supports ESM, CommonJS, and TypeScript:

| Import | Re-exports |
| --- | --- |
| `@domternal/pm/commands` | `prosemirror-commands` |
| `@domternal/pm/dropcursor` | `prosemirror-dropcursor` |
| `@domternal/pm/gapcursor` | `prosemirror-gapcursor` |
| `@domternal/pm/history` | `prosemirror-history` |
| `@domternal/pm/inputrules` | `prosemirror-inputrules` |
| `@domternal/pm/keymap` | `prosemirror-keymap` |
| `@domternal/pm/model` | `prosemirror-model` |
| `@domternal/pm/schema-list` | `prosemirror-schema-list` |
| `@domternal/pm/state` | `prosemirror-state` |
| `@domternal/pm/tables` | `prosemirror-tables` |
| `@domternal/pm/transform` | `prosemirror-transform` |
| `@domternal/pm/view` | `prosemirror-view` |

## Avoid duplicate ProseMirror copies

ProseMirror compares objects by identity. Loading two copies can cause fragment
conversion errors, keyed-plugin collisions, and broken selections. Prefer these
subpaths over direct `prosemirror-*` imports in code that interacts with Domternal.

Other dependencies and linked workspaces can still introduce duplicates.
The [single-copy guide](https://domternal.dev/v1/guides/single-prosemirror-copy/)
explains runtime diagnostics and the package-manager and bundler fixes, including
collaboration integrations.
