# @domternal/core

[![Version](https://img.shields.io/npm/v/@domternal/core.svg)](https://www.npmjs.com/package/@domternal/core)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/domternal/domternal/blob/main/LICENSE)

The framework-agnostic editor engine of [Domternal](https://domternal.dev), built on
[ProseMirror](https://prosemirror.net/). It provides the headless `Editor` class, the
extension system (`Extension`, `Node`, `Mark`), a chainable command API, and the
built-in nodes, marks, and behaviors (paragraph, heading, lists, tasks, links,
inline formatting, history, keymaps) bundled as `StarterKit`. Use it directly with
vanilla JS/TS, or as the runtime under the Angular, React, Vue, and Vanilla wrappers.
Every export is tree-shakeable, so unused extensions are stripped from your bundle.

## Links

<u>[Website](https://domternal.dev)</u> &nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp; <u>[Documentation](https://domternal.dev/v1/getting-started)</u> &nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp; <u>[Live examples](https://domternal.dev/examples)</u>

## Install

```bash
pnpm add @domternal/core
```

`linkedom` is an optional peer dependency: install it only if you call `generateHTML` or
`generateJSON` outside a browser. `generateText` reads the document model and never touches
the DOM, so it runs anywhere without it.

```bash
pnpm add linkedom
```

The 1.2.0 release installs `@domternal/pm` in the range `>=1.2.0 <2.0.0`.
Upgrade installed `@domternal/*` packages together to 1.2.0.

### One copy of the core, and of ProseMirror

ProseMirror compares classes by identity, and so does this package. Two copies of
`@domternal/core` give two `Extension` base classes, two schemas and two `Gapcursor`s
under a single plugin key; two copies of `prosemirror-model` make `Fragment.from` reject a
fragment the editor itself produced. Neither is a size problem, and nothing warns at
install time.

The core detects both at runtime. Building an editor beside a second copy of
`prosemirror-model`, `prosemirror-state`, `prosemirror-view`, `prosemirror-transform` or of
`@domternal/core` itself warns on the console, naming both packages and the fix. Handing an
editor an extension that another copy of the core built throws, because that can never
work. The dedupe recipe per package manager and bundler:
https://domternal.dev/v1/guides/single-prosemirror-copy/

## Usage

```ts
import { Editor, StarterKit } from '@domternal/core';

const editor = new Editor({
  element: document.getElementById('editor')!,
  extensions: [StarterKit],
  content: '<p>Hello <strong>world</strong></p>',
  onUpdate: ({ editor }) => {
    console.log(editor.getJSON());
  },
});

// Chainable command API
editor.chain().focus().toggleBold().run();

// Read content
const html = editor.getHTML();
const json = editor.getJSON();

// Tear down
editor.destroy();
```

The engine ships no styles. Import [`@domternal/theme`](https://www.npmjs.com/package/@domternal/theme) for ready-made light/dark editor styling, or supply your own CSS.

`StarterKit` bundles the common nodes, marks, and behaviors; each entry can be
configured or disabled individually. Every entry is on by default except `listIndent`,
which ships off because its Tab keymap also captures Tab on a paragraph that merely
follows a list. Pass `true` to switch it on.

```ts
StarterKit.configure({
  codeBlock: false,                  // disable an extension
  heading: { levels: [1, 2, 3] },    // configure an extension
  link: { openOnClick: false },
  listIndent: true,                  // opt in: Tab indents a block under the previous list
});
```

To trim the bundle further, skip `StarterKit` and compose only the extensions you
need:

```ts
import { Editor, Document, Paragraph, Text, Bold, History } from '@domternal/core';

const editor = new Editor({
  element: document.getElementById('editor')!,
  extensions: [Document, Paragraph, Text, Bold, History],
});
```

Framework toolbar, bubble-menu, and floating-menu `icons` options accept `IconSet`
values as raw SVG markup. Use only trusted, developer-authored constants. Never build an
`IconSet` from user input, persisted document content, or an API response.

## Localization

Each editor owns an independent UI language configuration. English messages are built in;
the optional German catalog is a separate import so it is included only when you use it.
The core catalog also covers the built-in UI rendered by the Angular, React, Vue, and
Vanilla wrappers.

```ts
import { Editor, StarterKit, type I18nOptions } from '@domternal/core';
import {
  deMessages,
  deSearchAliases,
} from '@domternal/core/locales/de';

const german = {
  locale: 'de',
  messages: deMessages,
  searchAliases: deSearchAliases,
} satisfies I18nOptions;

const editor = new Editor({
  element: document.getElementById('editor')!,
  extensions: [StarterKit],
  i18n: german,
});

// Replace the language configuration on the existing editor.
editor.i18n.set({ locale: 'en' });
```

Setting `locale: 'de'` selects German formatting and grammar but does not load German
messages. Import and merge the `/locales/de` catalogs for every enabled extension whose
UI you want to translate. A partial catalog is valid: missing or invalid messages fall
back to the owning package's English text.

`editor.i18n.set()` replaces the complete configuration. Include any messages, search
aliases, resolver, time zone, and custom formatters you want to keep. The update changes
Domternal's UI without translating or modifying the document, selection, or undo history.
Domternal does not add a language selector; the application owns that control and the
user's preference. See the [localization guide](https://domternal.dev/v1/guides/i18n)
for partial catalogs, extension catalogs, wrapper APIs, and custom resolvers.

## Moving an existing editor

Use `editor.adoptDom(element)` to move the existing editor view into a new mount
element while preserving its document, selection, undo history, and plugin state:

```ts
editor.adoptDom(document.getElementById('next-editor-mount')!);
```

The `adopt` event reports a changed DOM context and lets host-dependent UI rebind.
The original `mount` and `create` events remain creation-time events; they are not
repeated by adoption. Calling `adoptDom` with an unchanged DOM context is a no-op.
React and Vue wrappers use this path when attaching an existing editor.

Custom plugin views can use `createAdoptablePluginView(editor, view, createView)`
to recreate their DOM bindings after adoption while retaining plugin state. The
factory must return a ProseMirror plugin view and clean up its own DOM resources
in `destroy`. The event payload type is exported as `AdoptEventProps`.

## Presets

`preset: 'notion'` switches the editor to the Notion-style experience in one option. It paints
the `dm-notion-mode` class on the `.dm-editor` host for you, and preset-aware code follows it:
the bubble menu serves the Notion text context, and images offer align controls instead of
float. `'classic'` is the default.

```ts
const editor = new Editor({
  element: document.getElementById('editor')!,
  extensions: [StarterKit],
  preset: 'notion',
});
```

`editor.preset` reports the resolved value, and still reports `'notion'` for a host that carries
the theme class alone, so setups that predate the option are unaffected.

## Printing

`Print` is not part of `StarterKit`, so add it explicitly. `printDocument()` isolates the
document from the host page before the browser's dialog opens, leaving your application's
sidebar, header, and everything else beside the document off the page, and it emits
`beforePrint` and `afterPrint` so you can set `document.title` or add page rules first.

```ts
import { Editor, StarterKit, Print } from '@domternal/core';

const editor = new Editor({
  element: document.getElementById('editor')!,
  extensions: [StarterKit, Print],
});

editor.commands.printDocument();
```

The hiding itself is CSS, and it lives in
[`@domternal/theme`](https://www.npmjs.com/package/@domternal/theme), whose paper layer also
applies to the reader's own Ctrl/Cmd+P with no code involved.

Adding `Print` also registers a printer toolbar button, which stays live in a read-only
editor, and binds `Mod-P` to `printDocument` while the caret is in the editor.

`Print.configure({ ... })` accepts:

- `toolbar` (default `true`) - show the toolbar button
- `root` (default `null`) - `(editor) => HTMLElement | null` choosing what to print; unset
  prints the editor's `.dm-editor` wrapper, falling back to the ProseMirror element
- `isolateNativePrint` (default `false`) - give the reader's own Ctrl/Cmd+P the same
  isolation as the command

## Clipboard coordination (experimental)

Extensions that cooperate on paste and copy, such as
[`@domternal/extension-paste-cleanup`](https://www.npmjs.com/package/@domternal/extension-paste-cleanup)
and the image extension, coordinate through the `@domternal/core/clipboard` subpath. Most
applications never import it. A custom image node uses it to declare where pasted images may go:

```ts
import { registerClipboardImageDestination } from '@domternal/core/clipboard';
```

- Every name on the subpath is `@experimental` and can change before it is declared stable. The
  main `@domternal/core` entry does not declare them.
- The subpath shares its registries with the main entry of the same installed copy and module
  format. ESM and CommonJS builds loaded side by side keep separate registries, so load one format.
- A view accepts one HTML preparation coordinator and one copy annotation. A second registration
  throws instead of taking over, so the active owner disposes first.
- Image destinations are a latest-wins stack instead, so a schema with two image-like node types
  can register both. The latest active `registerClipboardImageDestination` applies, disposing it
  restores the one registered before it, and disposing an earlier one leaves the latest in place.
  Precedence follows registration time: plugin views register in plugin order, which follows
  extension priority, and plugin views recreated by a reconfiguration register again above any
  registration made directly. When the latest policy reader throws or returns `undefined`, the
  view has no destination; an earlier registration is not a fallback.

## Content normalization

JSON content can hold values the editor cannot represent: a list marker this version does not
know, or a heading level the `Heading` configuration lacks, such as `5` with the default levels 1
to 4, or a value that is not a level at all. The JSON entry points (the initial `content`,
`setContent`, `insertContent`, `createDocument`, `generateHTML`, and `generateText`) replace such
a value instead of failing the whole document, and report it:

- An unknown list marker becomes `null`, the default marker (`unknown-list-marker`).
- A heading level moves to the nearest configured level of equal or lower importance, otherwise
  to the deepest configured level (`unsupported-heading-level`), so a heading is never promoted
  while a deeper level exists and the outline keeps its order. With levels 1 to 4, `5` and `6`
  load as `4`; with levels 2 and 3, `1` loads as `2`. A string that holds a decimal number, such
  as `"5"`, counts as that number. A number that is not a whole level is rounded up into 1 to 6
  first, and any other value loads as the first configured level.

Each diagnostic names the `code`, `nodeType`, `attribute`, and `path` of the replaced value, and
the `value` itself when it is a finite number or a string of at most 64 characters. The editor
reports through the `onContentDiagnostic` option and the `contentDiagnostic` event, with the
`source` that loaded the content, the first 100 diagnostics, and the `total`. `createDocument`
and the SSR helpers take an `onDiagnostic` callback instead.

```ts
const editor = new Editor({
  extensions: [StarterKit],
  content: storedJSON,
  onContentDiagnostic: ({ source, diagnostics, total }) => {
    console.warn(`${source} replaced ${String(total)} values`, diagnostics);
  },
});
```

The schema itself stays strict: `schema.nodeFromJSON` and `Node.check` still reject an unknown
list marker and a heading `level` that is not a whole number from 1 to 6, and so does
`Step.fromJSON` for the nodes a step carries. Run
`normalizeContent(json, editor.schema, { onDiagnostic })` before handing stored JSON to other
consumers that validate it, such as y-prosemirror's `prosemirrorJSONToYDoc`. It never mutates its
input and returns it as is when nothing changes.

A document can still hold such a value: a collaborative document binds without validation, a
collaborator configured with more heading levels writes them, and undo can restore a removed
node. A pasted slice keeps a valid level the configuration lacks, so moving content in a shared
document never rewrites another client's heading, and only an invalid level is replaced.
Rendering shows the replacement in the view, `getHTML()`, and the SSR helpers without changing
the document, so `getJSON()`, `isActive`, and exports still see the stored value.

`editor.commands.normalizeContentAttributes()` is the explicit migration. It replaces every such
value in one transaction outside the undo history and reports it with the source
`normalizeContentAttributes`. It returns `false` in a read-only editor or when nothing needs
replacing, so `editor.can().normalizeContentAttributes()` detects a document that needs it. Run
it only when every client shares this version and this heading configuration: a client with an
older marker vocabulary or fewer heading levels would replace values that another client supports.

`Heading.configure({ levels })` takes a non-empty list of whole numbers from 1 to 6, in any order.
The first one is the default level for content and commands without a level. Other values fail
`new Editor(...)` and the SSR helpers with an `ExtensionConfigurationError`. `updateAttributes`,
`setBlockType`, and `toggleBlockType` refuse a level that is not a whole number from 1 to 6, and
`setHeading` and `toggleHeading` accept only configured levels. HTML content is parsed through the
configured heading tags, so an unconfigured tag still becomes a paragraph; with
[`@domternal/extension-paste-cleanup`](https://www.npmjs.com/package/@domternal/extension-paste-cleanup),
a pasted heading moves to the nearest supported level instead.

## SSR

The `generateHTML`, `generateJSON`, and `generateText` helpers render content
without an editor instance, for example on the server.

```ts
import { generateHTML, StarterKit } from '@domternal/core';

const html = generateHTML(
  { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hi' }] }] },
  [StarterKit],
);
```

`generateJSON(html, extensions)` does the reverse (HTML to doc JSON), and
`generateText(content, extensions, options)` extracts plain text, separating blocks with a
blank line unless `blockSeparator` overrides it.

Outside a browser, `generateHTML` and `generateJSON` need a DOM and load `linkedom` through
`require`, which only resolves under CommonJS. From an ES module server, installing
`linkedom` is not enough: pass the document yourself.

```ts
import { parseHTML } from 'linkedom';

const { document } = parseHTML('<!DOCTYPE html><html><body></body></html>');
const html = generateHTML(content, [StarterKit], { document });
```
