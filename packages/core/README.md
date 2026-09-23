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

`onUpdate` and the `update` event run after every accepted change to the document, including
a change a plugin appended to a selection move (its payload lists those as
`appendedTransactions`); `onSelectionUpdate` runs when the selection moved without the move itself
changing the document, before `onUpdate` when a plugin answered the move with a change, such as a
click that TrailingNode answers with a paragraph after a final heading. A transaction
that a plugin vetoes changes nothing and runs no callback, while the command that dispatched it
still returns `true`. The full callback contract:
https://domternal.dev/v1/guides/editor-api/#transaction-flow

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
[`@domternal/extension-paste-cleanup`](https://github.com/domternal/domternal/tree/main/packages/extension-paste-cleanup) (in development)
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
- Paste placements are a stack too, asked from the latest registration down. A node whose
  textblock takes text only, inside a parent that takes no block beside it, can register one
  with `registerClipboardPastePlacement(view, place)` to say where content pasted into that
  textblock goes. A paste handler that builds its own transaction starts it from
  `placeClipboardPaste(view, content)`, with the whole nodes it will insert: the transaction of
  the first placement that moves the paste, whose selection is where the content belongs, or
  `undefined` to insert at the selection. The placement is then part of the paste's one
  transaction, so a paste that a transaction filter refuses leaves nothing behind, and undo takes
  it back in one step. A placement that throws, or returns a transaction that does not start from
  the view's current state, counts as none.
- One rule decides when a paste's image files are the paste. `pasteHasOwnText(event, slice)`
  says whether the pasted content has text of its own: characters that show nothing (white space,
  a no-break space and Unicode format characters such as zero-width spaces and joiners or the
  soft hyphen) do not count, nor alt text a handler left in place of images it removed, nor a
  plain-text clipboard without HTML whose lines are exactly its image files' names, as a file
  manager copies files. Without text of its own, `pasteClipboardImageFiles(view, event, slice)`
  hands every image file, in clipboard order, to the latest destination's `insertFiles` (the
  optional third argument of `registerClipboardImageDestination`), with the alt text of the one
  image the content held when there is one image and one file, and returns whether it took them.
  `dropClipboardImageFiles(view, event, slice)` does the same for a drop at its position, where
  the files win over whatever else the drop carries.
  A paste whose content has text of its own keeps that content, because Office applications and
  Google Docs put a picture of the copied selection next to it. The Image extension, Paste Cleanup
  and the Link paste all ask this rule, so their paste handlers cannot disagree.

## Pasted clipboard context

HTML copied from a ProseMirror editor carries its structural context in a `data-pm-slice`
attribute on its first element: the open depths and the wrapper nodes, such as lists, list items,
blockquotes and table parts, that the copied content sat in. Any page can write that attribute,
and ProseMirror rebuilds the wrappers around the pasted content without checking that they can hold
it. Core treats the context as structure, never as trust, for every paste and drop, with or without
PasteCleanup:

- A context ProseMirror's copy does not write for Domternal's nodes is ignored. After every
  `transformPastedHTML` has run, a context that names a paragraph, heading or other textblock, an
  inline or leaf node, text or the document, one of more than 512 wrappers, or one that is not a
  JSON array, is emptied, so the HTML pastes as it would without a context. Only the marker's value
  is rewritten: the open depths and a table wrapper count stay, and the rest of the HTML is kept as
  written. ProseMirror records a textblock or an inline node only for content copied from inside
  an inline node with content, which no Domternal node has; such content pastes as it would without
  the context.
- A wrapper that cannot hold its content is removed from the pasted or dropped slice, so the
  slice fits the schema instead of throwing inside ProseMirror's replace.
- Once ProseMirror starts parsing a paste or drop, core prevents the browser's default action. A
  paste handler that throws later, whether core's, an extension's or the application's, then
  inserts nothing and the error surfaces, instead of the browser inserting the raw clipboard HTML
  and requesting its remote images. Composition input, read-only editors, pastes without clipboard
  data and events a handler already claimed are left as before.

## URL policy

`checkUrl(value, options)` decides whether an address may be stored, rendered and opened, and
returns the spelling to use. It reads the value the way browsers do: leading and trailing control
characters and spaces are stripped, and tabs and line breaks inside it are removed, so a scheme
hidden behind them is judged as the browser would see it.

```ts
import { checkUrl, isValidUrl } from '@domternal/core';

checkUrl(' https://example.com/');           // { status: 'allowed', url: 'https://example.com/' }
checkUrl('java\tscript:alert(1)');           // { status: 'unsafe' }
checkUrl('ftp://example.com/');              // { status: 'unsupported' }
checkUrl('#intro', { allowRelative: true }); // { status: 'allowed', url: '#intro' }
isValidUrl('https://example.com/');          // true
```

- `unsafe`: `javascript:` and `vbscript:` addresses whatever `protocols` lists, `data:` addresses
  other than an allowed image, credentials in a web, mail or phone address such as
  `https://google.com@evil.example/` (a user stays allowed where it is the standard form of a
  scheme `protocols` lists, such as `ssh://git@host/repo.git` or `ftp://anonymous@host/`), control
  characters and bidi embeddings, overrides and isolates anywhere, invisible format characters
  (every Unicode `Cf` character, such as a zero-width joiner, a bidi mark, a soft hyphen or a tag
  character) in the scheme, the host or the address of a scheme without a host (such as
  `mailto:` or `tel:`, whose address is everything before the query, and for `mailto:` also the
  `to`, `cc` and `bcc` fields), where a percent-encoded one counts too, since a mail client or
  dialer decodes the address, and values that are not strings (an array would otherwise be
  stringified into an address). Format characters, such as the zero-width joiners and marks of
  Persian, Arabic, Indic and emoji text, stay allowed in a path, query or fragment, which browsers
  percent-encode. A `mailto:`, `tel:` or `sms:` link without right-to-left letters may also hold
  LRM, LRE, LRI, PDF and PDI, which right-to-left environments write around a phone number or
  mail address to keep it left to right and which cannot reorder it; RLM, RLE, RLO and the other
  bidi controls reorder even a phone number, so they stay unsafe there.
- `unsupported`: a harmless value these options do not allow, such as another scheme, a relative
  reference without `allowRelative`, a network path (`//host`) or a backslash, which browsers
  read as a slash in web addresses, an address the URL parser rejects, and empty values, `null`
  and `undefined`. So is an `&` in a host, and an `&` that starts a character reference (`&#`, or
  a name and `;`, such as `&colon;`) in the first segment of a relative reference or right after
  its leading slash: HTML that leaves `&` unescaped in an attribute, as linkedom writes it,
  reaches the browser with character references decoded, where `javascript&colon;x` or
  `&#106;avascript:x` would spell a scheme. Any other `&`, as in `R&D-chart.png`, and every `&`
  in a path, query or fragment stays allowed: without a `;` HTML reads only the legacy Latin-1
  names, none of which spells a `:`, `/` or `\`.

The options are `protocols` (default `['http:', 'https:']`, compared in lower case with or
without the colon; `'any'` allows every scheme except `file:`), `allowRelative` (`/path`,
`./page`, `../page`, `page.html`, `?query`, `#fragment`; a colon in the first segment is refused),
`allowNetworkPath` and `allowDataImages`, the last two meant for image sources.

The policy guards against script and deception, so any release can change it: an address allowed
before can be refused once a new way to hide a scheme or a host is known. Check a stored address
where you use it instead of keeping an earlier answer.
`isValidUrl(value, options)` answers the same question with a boolean. Use `checkUrl` in a custom
link or image UI before opening an address yourself, and open it with `noopener`.

The `Link` mark applies the policy with its `protocols` and `allowRelative` at every entry and
again at every sink. `allowRelative` (default `true`) allows relative links: `/docs/page`,
`./page`, `../page`, `page.html`, `?query` and `#section`. A network path (`//host`), a backslash
and a colon in the first segment are refused either way; `allowRelative: false` refuses every
relative link, as 1.2 did.

- HTML parsing, `setLink` and `toggleLink` store only an allowed href, in its cleaned spelling.
- A stored href the policy refuses, such as one loaded from JSON or written by a collaborator,
  renders as plain text in a `span` in the editor, `getHTML()` and `generateHTML`, so there is no
  anchor to follow or to copy. Rendering never changes the document.
- A click in an editable editor opens only the clicked link's own href, and only when the policy
  allows it. `_self`, `_parent` and `_top` targets navigate that browsing context; any other
  target opens a new tab with `noopener`, so the opened page cannot reach the editor's page, and
  with `noreferrer` unless `addRelNoopener` is `false` and the link's `rel` lacks it. A
  read-only editor leaves clicks to the browser, which follows only a rendered, allowed href.
  `openOnClick: 'whenNotEditable'` never opens links while the editor is editable, and `false`
  never opens them. A relative link opens resolved against the page. A `#fragment` link scrolls
  to the element with that id, in the editor first and then in the page, without opening a tab
  or changing the location; nothing happens when no element matches. A read-only editor does the
  same for a plain click on a fragment link, so a hash router does not see a route change, and
  leaves a click that asks for a new tab or window to the browser. HTML from `getHTML()` or
  `generateHTML()` shown outside an editor follows a fragment link natively, which changes
  `location.hash`; an app with a hash router handles clicks on `a[href^="#"]` there itself.
- An allowed link renders its `target` only when it is `_blank`, `_self`, `_parent` or `_top`
  (in any case, written in lower case), and its `title` and `class` only when they are strings.
  With `addRelNoopener` (the default), a `_blank` link's `rel` keeps its stored tokens except
  `opener` and gains `noopener` and `noreferrer`, so `nofollow` renders as
  `nofollow noopener noreferrer`.

The `LinkPopover` stores what the `Link` accepts, so its input follows the same policy. A value
that starts with `#`, `/`, `./`, `../` or `?` is stored as typed, `//host/x` and a bare host such
as `example.com` or `localhost:3000` get the Link's `defaultProtocol`, a bare email address
becomes a `mailto:` link, and anything else with a scheme is stored as typed. A refused address
keeps the popover open: the input is marked `aria-invalid`, the localized
`core.linkPopover.invalidUrl` message shows below it as `.dm-link-popover-error`, describes it
through `aria-describedby` and is its validity message, and a refused Apply announces it as an
alert. The reason stays until the value changes and follows a live locale change. Opening the
popover on a stored link the Link would not keep shows it already marked invalid, with the
reason and without an alert. Editing an existing link changes
only its href and keeps its `title`, `target`, `rel` and `class`. `LinkPopover.configure({
protocols })` narrows the schemes the popover accepts, read the way the Link reads its own; the
default `null` accepts every scheme the Link accepts, and an entry that names no scheme fails
editor creation with an `ExtensionConfigurationError`.

## Style values

Text color, highlight, font family, font size, alignment and line height are stored as values and
written into a `style` attribute when rendered. `isSafeCssValue(value)` decides whether a value
may be written there: a string of at most 256 characters with no control character, none of
`; { } [ ] < > \ " ' ! @ &`, no comment, balanced parentheses, and no function other than the
color and arithmetic functions (`rgb`, `rgba`, `hsl`, `hsla`, `hwb`, `lab`, `lch`, `oklab`,
`oklch`, `color`, `color-mix`, `light-dark`, `var`, `calc`, `min`, `max`, `clamp`), inside which
parentheses may also group arithmetic, as in `calc(1rem + (2vw - 1rem) * 0.5)`. Such a value
cannot add a declaration, such as `position: fixed`, or load a resource through `url()`.

```ts
import { isSafeCssValue } from '@domternal/core';

isSafeCssValue('#ff0000');                    // true
isSafeCssValue('calc(1em + 2px)');            // true
isSafeCssValue('red;position:fixed');         // false
isSafeCssValue('url(https://example.com/x)'); // false
```

- The editor DOM, `getHTML()` and `generateHTML()` write a stored value only when it is safe. Any
  other value is left out of the `style` attribute and kept in the document, so the stored JSON
  does not change. The other values of the same mark still render.
- `setTextColor`, `setHighlight`, `toggleHighlight` (when it adds a highlight), `setFontFamily`,
  `setFontSize`, `setTextAlign` and `setLineHeight` return `false` for a value that is not safe.
  An empty or blank value, such as a "Default" option's `''`, clears the style instead, as the
  matching unset command does, and returns `true`.
- Alignment renders any safe value as stored, such as the `-webkit-center` Chrome writes for
  centered content. `setTextAlign` also needs the value in `alignments`.
- A line height stored as a finite number, such as `1.5`, renders as that number.
- A font family list is written with each name that holds a space quoted, and quotes in the stored
  value are dropped first, so `"Times New Roman", serif` renders as `'Times New Roman', serif`.
- `LineHeight` renders only its configured `lineHeights`; with an empty list, any safe value.
- Use `isSafeCssValue` before writing a stored style value into markup yourself, such as in an
  exporter. Like the URL policy, the rule can change in any release: a value accepted before can
  be refused once a new way to add a declaration or load a resource is known.

## Content normalization

JSON content can hold values the editor cannot represent: a list marker this version does not
know, a heading level the `Heading` configuration lacks, such as `5` with the default levels 1
to 4, or a value that is not a level at all, and a link href the [URL policy](#url-policy)
refuses. The JSON entry points (the initial `content`, `setContent`, `insertContent`,
`createDocument`, `normalizeContent`, `generateHTML`, and `generateText`) replace such a value,
or remove the link that carries it, instead of failing the whole document, and report it:

- An unknown list marker becomes `null`, the default marker (`unknown-list-marker`).
- A heading level moves to the nearest configured level of equal or lower importance, otherwise
  to the deepest configured level (`unsupported-heading-level`), so a heading is never promoted
  while a deeper level exists and the outline keeps its order. With levels 1 to 4, `5` and `6`
  load as `4`; with levels 2 and 3, `1` loads as `2`. A string that holds a decimal number, such
  as `"5"`, counts as that number. A number that is not a whole level is rounded up into 1 to 6
  first, and any other value loads as the first configured level.
- A link whose href the Link's URL policy refuses is removed and its text kept, including a link
  mark without an href. `unsafe-url` reports an href no configuration allows: a `javascript:`,
  `vbscript:` or `data:` address, credentials in a web, mail or phone address, a control
  character or bidi override anywhere, a format character such as a zero-width joiner in the
  scheme or host, or a value that is not a string. `unsupported-url` reports an href this
  configuration does not allow: a scheme outside `protocols`, a relative link with
  `allowRelative: false`, a network path, a backslash, an address the URL parser rejects, or an
  empty or missing href. An allowed href is kept exactly as stored.

HTML follows the same placement without a report, since HTML is converted rather than loaded:
initial and set HTML content, `insertContent`, `createDocument`, `generateJSON`, and a paste or
drop without PasteCleanup parse every `h1` to `h6` tag as a heading at the nearest configured
level, so with levels 1 to 4 an `h5` becomes a level 4 heading instead of a paragraph. Where a
heading cannot stand, every heading tag, a configured level too, parses as that block's text: at
the start of a list or task item, whose first block is a paragraph, and inside a details summary
or a preformatted block, so the list keeps its items and numbering and the summary its text
instead of a heading moving out and splitting them. Text or a paragraph element before the
heading, even an empty `<p></p>` as `getHTML` writes an empty item label, gives the item its
paragraph, so the heading after it stays a heading and such HTML loads back unchanged. Only the
nodes the schema holds count: without a list item, details summary or code block node, or with a
list item whose content may start with a heading (`ListItem.extend({ content: 'block+' })`), the
heading stays a heading there, as in 1.2. A tag the levels lack ranks below every
parse rule at priority 1 or above, so an application node that parses such a tag keeps it, and
among nodes built from Heading, such as a title node with level 1 next to a heading node with
levels 2 to 4, the one whose levels hold the nearest level takes it.

Each diagnostic names the `code`, `nodeType`, `attribute`, and `path` of the replaced value, and
the `value` itself when it is a finite number or a string of at most 64 characters. For a removed
link, `nodeType` is the node that carried it, such as `text` or an inline `image`, and `markType`
names the mark, such as `link`. The editor
reports through the `onContentDiagnostic` option and the `contentDiagnostic` event, with the
`source` that loaded the content, the first 100 diagnostics, and the `total`. `createDocument`
and the SSR helpers take an `onDiagnostic` callback instead. The `code` and `source` lists are
open: a minor release can add a value when the editor learns to normalize another attribute or
gains another entry point, so keep a default branch when you switch on them.

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
list marker, a heading `level` that is not a whole number from 1 to 6, and a link `href` that is
neither a string nor `null`, and so does `Step.fromJSON` for the nodes and marks a step carries.
Validation accepts every string href, so a document a collaborator with wider `protocols` wrote
still loads. Run
`normalizeContent(json, editor.schema, { onDiagnostic })` before handing stored JSON to other
consumers that validate it, such as y-prosemirror's `prosemirrorJSONToYDoc`. It never mutates its
input and returns it as is when nothing changes. Where it removes a link, it joins the text left
beside a neighbor with the same marks, as loading does, so the result equals the loaded
document's `getJSON()` for JSON an editor wrote.

A document can still hold such a value: a collaborative document binds without validation, a
collaborator configured with more heading levels or wider link `protocols` writes them, and undo
can restore a removed node. Dragging content within the editor moves its nodes with the levels
they store, and only an invalid level is replaced. Copy and paste carry HTML, which holds the
rendered level, so a heading cut and pasted, even within the same editor, stores the level it
rendered at.
Rendering shows the replacement in the view, `getHTML()`, and the SSR helpers without changing
the document, and a refused link renders as its text and never opens. `getJSON()` and
`node.attrs` keep the stored value. The readers that drive editing UI read a node attribute as it
renders: `isActive` and `getAttributes` report a heading level the `levels` lack as the level it
renders at, such as `4` for a stored `5` with levels 1 to 4, and an unknown list marker as
`null`, and `toggleHeading` and `toggleBlockType` toggle off a block that renders at the
requested level, an empty one included. So the toolbar marks the level a reader sees, and nothing is rewritten until an
explicit write such as `setHeading` stores a new value. Mark attributes read as stored, so a link
editor can still fix or remove a refused href.

Two experimental helpers answer the same questions for your own code.
`isSupportedAttributeValue(editor.schema, 'link', 'href', href)` answers whether loading would
keep a value; check it before a custom link UI opens or exports a stored href.
`resolveAttributeValue(editor.schema, 'heading', 'level', node.attrs.level)` returns the value
as this configuration renders and reads it, `null` for a mark the value removes; use it where
you read stored attributes yourself, such as in an exporter.

`editor.commands.normalizeContentAttributes()` is the explicit migration. It replaces every such
value, and removes every such link, in one transaction outside the undo history and reports it
with the source `normalizeContentAttributes`. It returns `false` in a read-only editor or when
nothing needs replacing, so `editor.can().normalizeContentAttributes()` detects a document that
needs it. Run it only when every client shares this version and this heading and link
configuration: a client with an older marker vocabulary, fewer heading levels or narrower
`protocols` would replace values, or remove links, that another client supports. An `unsafe-url`
removal is the same under every configuration, and so is an `unsupported-table-span` repair from
`@domternal/extension-table`: `normalizeContentAttributes({ codes: ['unsafe-url',
'unsupported-table-span'] })` replaces only values reported with those codes, so it can run while
older clients still share the document.

Extensions register how loading normalizes their own attributes with the experimental
`registerAttributeNormalizer(validate, normalizer)`, keyed by the function the attribute spec uses
as `validate`, and add `pastedAttributesPlugin(code)` so pasted slices get the replacement too;
every entry point above then follows the attribute.

`Link.configure({ protocols })` takes schemes such as `'https:'`, in any case and with or without
the colon or slashes, so `['HTTPS']` and `['https://']` mean `https:`, and Tiptap's
`{ scheme: 'tel', optionalSlashes: true }` means `tel:`. An unset value (`undefined` or `null`),
such as `Link.configure({ protocols: props.protocols })` without the prop, means the default
schemes. The option is typed `readonly (string | LinkProtocolOptions)[] | null`, so each of these
forms and an `as const` list type-check, and `allowRelative` (Link) and `maxFiles` (Image) are
optional in their options types, so an options object written in full for 1.2 still compiles. An entry that names no scheme, or that is `javascript:`, `vbscript:` or `data:`, fails
`new Editor(...)` and the SSR helpers with an `ExtensionConfigurationError`, and so does a value
that is not a list. `setMark`, `toggleMark` and `updateAttributes` return `false` for a
link href that is not a string or that the policy refuses, and a stored href does not block a
change to another attribute. Autolink and link paste create a link only for an allowed address:
pasted text must be a single line, and an address with credentials is never linked.

The link `href` is recognized by its validator, so an extension that redefines the attribute
keeps the parent's spec to keep JSON loading, validation and `isSupportedAttributeValue` on the
policy:

```ts
const MyLink = Link.extend({
  addAttributes() {
    const parent = this.parent?.() ?? {};
    return { ...parent, href: { ...parent.href, parseHTML: element => element.getAttribute('href') } };
  },
});
```

Rendering, clicks and the LinkPopover apply the Link's `protocols` and `allowRelative` either way,
and the LinkPopover refuses a script address for any link mark.

`Heading.configure({ levels })` takes a non-empty list of whole numbers from 1 to 6, in any order.
A repeated level counts once, at its first position, so each toolbar item, menu item, shortcut and
parse rule appears once, and the option array itself is left as given. The first level is the
default level for content and commands without a level. Other values fail `new Editor(...)` and
the SSR helpers with an `ExtensionConfigurationError`. `updateAttributes`, `setBlockType`, and
`toggleBlockType` refuse a level that is not a whole number from 1 to 6, and `setHeading` and
`toggleHeading` accept only configured levels. HTML content parses every heading tag at the
nearest configured level, as [Content normalization](#content-normalization) describes; with
[`@domternal/extension-paste-cleanup`](https://github.com/domternal/domternal/tree/main/packages/extension-paste-cleanup) (in development),
a pasted heading moves to the nearest supported level before parsing and is reported.

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

linkedom writes attribute values without escaping `&`, so the browser that reads its output would
decode every character reference in them. `generateHTML`, `getHTML` in a headless editor and
`inlineStyles` escape `&` in attribute values themselves when the document's serializer does
not, so a stored value such as `Tom &amp; Jerry` reaches the browser as stored. The output of a
browser or jsdom document is unchanged.
