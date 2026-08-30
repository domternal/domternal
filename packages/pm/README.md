# @domternal/pm

[![Version](https://img.shields.io/npm/v/@domternal/pm.svg)](https://www.npmjs.com/package/@domternal/pm)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/domternal/domternal/blob/main/LICENSE)

The ProseMirror dependency layer for the [Domternal](https://domternal.dev) editor. It
re-exports the underlying `prosemirror-*` libraries under stable `@domternal/pm/*`
subpaths so every Domternal package imports ProseMirror from one place. Because the
`prosemirror-*` packages are declared here once, as ordinary dependencies of this package,
your package manager dedupes them to a single copy across `@domternal/core` and every
extension. You rarely install it yourself: it ships transitively with `@domternal/core`.

## Links

<u>[Website](https://domternal.dev)</u> &nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp; <u>[Documentation](https://domternal.dev/v1/packages)</u> &nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp; <u>[Live examples](https://domternal.dev/examples)</u>

## Install

Install it explicitly when you import ProseMirror primitives in your own code, or when a
strict peer resolver asks for it: every `@domternal/extension-*` package declares
`@domternal/pm` as a peer dependency with the same minor floor and next-major ceiling as
`@domternal/core`.

```bash
pnpm add @domternal/pm
```

`@domternal/pm` itself has no peer dependencies: the `prosemirror-*` libraries are its own
dependencies.

## One copy, always

ProseMirror compares by identity, not by shape. Two copies of `prosemirror-model` make
`Fragment.from` reject a fragment the editor itself produced ("Can not convert <> to a
Fragment"), two copies of `prosemirror-state` collide on a keyed plugin. That is a crash,
not a few extra kilobytes, and nothing warns at install time.

Declaring the libraries here once is what normally prevents it. It stops being enough when
another library in your app declares the same packages as **peer dependencies** and takes
whatever your application root offers: `y-prosemirror` is the common case, and the one
that reaches Domternal Pro's collaboration. The two resolutions can then differ with
nothing warning at install or build time.

Domternal detects it at runtime and names both packages and the fix. The dedupe recipe per
package manager and bundler:
https://domternal.dev/v1/guides/single-prosemirror-copy/

### Why these are dependencies and not peers

Declaring them as peer dependencies would make a second copy impossible, since there would be
nothing here to bring. It is not worth what it costs: peers are installed automatically by npm 7
and later, by pnpm and by Bun, but by neither version of Yarn, so every Yarn user would have to
install twelve ProseMirror packages by hand. An install that fails outright is a worse first day
than a duplicate that is rare, loud when it happens, and fixed by one block of JSON.

What is done instead: the ranges declared here are checked in CI against those of every library
that shares ProseMirror with this one, so a release cannot make the two impossible to reconcile,
and a duplicate that does form is reported by name at runtime.

## Usage

Import from a subpath matching the ProseMirror package you need. Each subpath
re-exports the full API of its `prosemirror-*` counterpart. There is no root export, so
`import { Plugin } from '@domternal/pm'` does not resolve.

```ts
import { Plugin, PluginKey } from '@domternal/pm/state';
import type { EditorView } from '@domternal/pm/view';

const myPlugin = new Plugin({
  key: new PluginKey('my-plugin'),
  view: (view: EditorView) => ({ destroy: () => {} }),
});

// Every `@domternal/pm/*` subpath re-exports its `prosemirror-*`
// counterpart unchanged.
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
