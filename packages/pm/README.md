# @domternal/pm

[![Version](https://img.shields.io/npm/v/@domternal/pm.svg)](https://www.npmjs.com/package/@domternal/pm)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/domternal/domternal/blob/main/LICENSE)

The ProseMirror dependency layer for the [Domternal](https://domternal.dev) editor. It
re-exports the underlying `prosemirror-*` libraries under stable `@domternal/pm/*`
subpaths so every Domternal package imports ProseMirror from one place. Because the
`prosemirror-*` packages are pinned here as direct dependencies, your package manager
dedupes them to a single copy across `@domternal/core` and every extension. You rarely
install it yourself: it ships transitively with `@domternal/core`.

## Links

<u>[Website](https://domternal.dev)</u> &nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp; <u>[Documentation](https://domternal.dev/v1/packages)</u> &nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp; <u>[Live examples](https://domternal.dev/examples)</u>

## Install

Already a dependency of `@domternal/core`, so most apps never add it directly. Install
it explicitly only when you import ProseMirror primitives in your own code:

```bash
pnpm add @domternal/pm
```

There are no peer dependencies: the `prosemirror-*` libraries are bundled as
dependencies of this package.

## Usage

Import from a subpath matching the ProseMirror package you need. Each subpath
re-exports the full API of its `prosemirror-*` counterpart.

```ts
import { Schema } from '@domternal/pm/model';
import { EditorState, Plugin, PluginKey } from '@domternal/pm/state';
import { EditorView } from '@domternal/pm/view';

const myPlugin = new Plugin({
  key: new PluginKey('my-plugin'),
  view: (view: EditorView) => ({ destroy: () => {} }),
});

// `state` and `view` are the same APIs you would get from
// 'prosemirror-state' and 'prosemirror-view' directly.
```

## Subpaths

| Subpath | Re-exports |
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
