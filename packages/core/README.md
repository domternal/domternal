# @domternal/core

[![Version](https://img.shields.io/npm/v/@domternal/core.svg)](https://www.npmjs.com/package/@domternal/core)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/domternal/domternal/blob/main/LICENSE)

The headless editor engine for [Domternal](https://domternal.dev), built on
ProseMirror. Use it directly in JavaScript or TypeScript, or through the Angular,
React, Vue and Vanilla wrappers. It provides the `Editor` class, composable
extensions, chainable commands, document serialization and server-side helpers.

[Documentation](https://domternal.dev/v1/guides/editor-api/) · [Getting started](https://domternal.dev/v1/getting-started/) · [Examples](https://domternal.dev/examples)

## Install

The package declares Node.js 22 or later for tooling.

```bash
pnpm add @domternal/core
```

Core has no framework dependency and includes `@domternal/pm`. Use version 1.5.1
for all installed Domternal Free packages. Wrappers and extensions require Core
`>=1.5.0 <2.0.0`; extensions also require PM in that range. Core 1.5.1 requires
PM `>=1.5.1 <2.0.0` at runtime.
Import ProseMirror primitives from `@domternal/pm/*` to keep
[one shared copy](https://domternal.dev/v1/guides/single-prosemirror-copy/).

For ready-made editor styling, also install `@domternal/theme` and import it from
your application entry point, with `class="dm-editor"` on the mount or an ancestor.
Core has no bundled editor theme, toolbar or framework UI.

## Quick start

Add a mount element to your page:

```html
<div id="editor"></div>
```

Then create the editor in your browser entry point:

```ts
import { Editor, StarterKit } from '@domternal/core';

const editor = new Editor({
  element: document.getElementById('editor')!,
  extensions: [StarterKit],
  content: '<p>Hello <strong>world</strong>!</p>',
});

editor.on('update', () => {
  console.log(editor.getJSON());
});
```

`StarterKit` includes paragraphs, headings, lists, tasks, links, common text marks,
history and editing keymaps. It does not include tables, images, Office paste
cleanup or other optional extension packages.

Read or change the document through the same instance:

```ts
editor.chain().focus().toggleBold().run();
editor.commands.insertContent('<p>Another paragraph</p>');

const json = editor.getJSON();
const html = editor.getHTML();
const text = editor.getText();
```

Call `editor.destroy()` when removing the editor from your application. Framework
wrappers manage the lifetime of the instances they create.

## Choose your extensions

Configure or disable individual StarterKit features:

```ts
StarterKit.configure({
  heading: { levels: [1, 2, 3] },
  link: { openOnClick: false },
  codeBlock: false,
});
```

Pass the configured StarterKit in place of `StarterKit` in `extensions`. Headings
support levels 1 to 4 by default. `listIndent` is off by default because enabling
it also captures Tab in a paragraph immediately after a list.

For a smaller schema, replace StarterKit with the individual exports you need,
such as `Document`, `Paragraph`, `Text`, `Bold`, `BaseKeymap` and `History`.
Register optional packages in that same extension array:

- [Tables](https://domternal.dev/v1/nodes/table/) and [images](https://domternal.dev/v1/nodes/image/).
- [Block controls](https://domternal.dev/v1/extensions/block-controls/) for slash commands, drag handles and SmartPaste.
- [PasteCleanup](https://github.com/domternal/domternal/tree/main/packages/extension-paste-cleanup) for opt-in Word and Google Docs HTML cleanup.
- [Markdown](https://domternal.dev/v1/extensions/markdown/) for Markdown parsing and serialization.

Only imported extensions enter your JavaScript bundle. `preset: 'notion'` selects
the Notion presentation and behavior; it does not install optional extensions.
See the [configuration guide](https://domternal.dev/v1/guides/configuration/).

### Readable literal colors

Core and theme 1.4.0 add an optional display policy for literal text colors.
Enable it explicitly by adding the configured extension to your editor:

```ts
import { StarterKit, TextStyle, TextColor } from '@domternal/core';
import '@domternal/theme';

const extensions = [
  StarterKit,
  TextStyle,
  TextColor.configure({ contrast: 'auto' }),
];
```

The default, `original`, keeps authored colors. `auto` measures the live editor's
background and adjusts an opaque literal color only when its contrast is below
4.5:1. It mixes the color toward black or white rather than replacing every color
with the theme's text color. Readable colors and named color tokens stay unchanged.
This also works for saved documents in a read-only editor; it is not specific to
Word import.

The adjustment affects screen presentation only. JSON, HTML, clipboard HTML,
export, print and shared document data retain the original color. Theme changes
recalculate the presentation without editing the document. Transparent backgrounds
are composited when the complete solid background is known. Translucent text,
unresolved or unsupported color spaces, image or gradient backgrounds, painted
pseudo-elements and compositing effects are left unchanged. A custom textStyle
mark view of higher priority also takes precedence. This is a bounded readability
aid, not an accessibility guarantee for arbitrary application CSS.

Core produces view attributes and the matching theme supplies their screen styles.
Applications with their own styles can use the same narrowly scoped rule:

```css
@media screen {
  .dm-editor .ProseMirror [data-dm-text-contrast='adjusted'] {
    color: var(--dm-readable-color) !important;
  }
}
```

## Optional print preparation

The next release adds `Print.configure({ prepareResources: true })` to wait for
live images and fonts before command-driven printing. The default stays
immediate. A bounded timeout, `cancelPrintPreparation()` and the optional
`storage.print.preparation` result let an application report or cancel waiting.
The matching theme and standard Table node view also support eligible multirow
print headers without changing document JSON or selection. Browser pagination
and native-dialog limitations still apply. See the [Print guide](https://domternal.dev/v1/extensions/print/)
for configuration, resource limits and supported header structures.

### Full block backgrounds

Since 1.5.0, `BlockColor` keeps explicit hex, `rgb()` and `rgba()` fills in its existing
`bgColor` node attribute. A paragraph or heading with an inline
`background-color` therefore keeps a fill across the block, including an empty
paragraph. Named CSS colors in HTML become literal hex values; `transparent`
becomes a transparent `rgba()` fill. Nested inline highlights remain independent.
Alpha values are retained.

Palette tokens such as `red` and `gray` retain their theme meaning and take
precedence over an inline background when `data-bg-color` is present. The palette
commands still accept only their configured choices. Literal fills serialize as
`background-color`; tokens continue to serialize as `data-bg-color`.

View-only tone attributes let the matching theme keep default text readable on
known light or dark fills without changing the document. An unresolved translucent
fill does not receive a guessed tone. Explicit text colors retain the selected
`TextColor` contrast policy described above.

### Optional list labels

Available since 1.5.0, `ListLabels` can be added beside `StarterKit` to retain a
bounded custom bullet or an ordered counter with a text prefix and suffix. It is not included in StarterKit.
Existing schemas and stored JSON stay unchanged when this extension is omitted.

```ts
import { ListLabels, StarterKit } from '@domternal/core';

const extensions = [StarterKit, ListLabels];
// On an orderedList node:
const attrs = {
  start: 4,
  listLabel: { kind: 'counter', format: 'decimal', prefix: 'Section ', suffix: ') ' },
};
```

The browser updates markers as items are edited. Markers remain native list
presentation, with no duplicate marker text in clipboard text or document text.
The extension installs scoped companion CSS while the editor is alive. Set
`nonce` for the application's CSP policy, or `injectCSS: false` when the host
provides that CSS. `getListLabelStyleSheet(json)` supplies the companion stylesheet
for rendered HTML. HTML without it retains ordinary list fallbacks.
The pure `@domternal/core/list-labels` entry exposes the validator, formatter,
stylesheet collector and label types for workers and server code without loading
the editor runtime.

For compatibility, `ListLabel`, `readListLabel`, `formatListLabel` and
`getNodeListLabel` retain the original `counter` and `text` contract. The readers
and formatter return `null` for compound and picture labels. Use
`ExtendedListLabel`, `readExtendedListLabel`, `parseExtendedListLabel`,
`formatExtendedListLabel` and `getNodeExtendedListLabel` when opting into the
additional variants. All except the node reader are also available from the pure
`@domternal/core/list-labels` entry. Existing exhaustive TypeScript switches do
not need new cases.

Compound labels can reference enclosing ordered items without storing a copied
number such as `1.2` in the document. For example, an inner list can use
`{ kind: 'compound', parts: [{ ancestor: 1, format: 'inherit' }, '.', { ancestor: 0, format: 'inherit' }, ') '], fallback: 'decimal' }`.
The marker updates after an ancestor's number or format changes, including undo
and collaborative edits. A missing or unordered referenced ancestor uses the
ordinary fallback. Serialized HTML is a snapshot; regenerate it after editing
the source document. See the contract below for the bounded template rules.

A bullet list can also use `{ kind: 'image', src: pngDataUrl, text: '◆' }` for a
small local picture marker. The qualified profile accepts static 8-bit RGB/RGBA
PNG up to 32×32 pixels and 4 KiB, with a required readable text fallback. It
does not fetch remote marker assets or accept SVG. Companion CSS displays the
picture; the existing marker remains available when that CSS is absent.

All collaborative writers must enable the same list-label schema. An older
writer without the extension can remove the unknown attribute when it edits a
list. See the [list-label contract](docs/content.md#optional-list-labels) for
supported records, diagnostics, serialization and rendering limits.

Whole HTML list items that begin with a nested list receive an empty paragraph
label during parsing, so their outer numbering, checked state and later siblings
stay together. This works on load, paste, drop and server-side HTML conversion
without Paste Cleanup. Native partial copies keep their open slice boundaries;
the original DOM and already valid list items are unchanged.

## Content and validation

Use JSON for structured storage and HTML or plain text when your application needs
those formats. Loading JSON normalizes unsupported attributes and refused links;
`onContentDiagnostic` reports those repairs. Rendering an existing shared document
can show a normalized value without rewriting its stored data.

Before migrating persisted or collaborative content, read the
[content normalization guide](https://github.com/domternal/domternal/blob/main/packages/core/docs/content.md)
and [release notes](https://github.com/domternal/domternal/blob/main/CHANGELOG.md).
URL and style checks apply to built-in content paths. Custom renderers, exporters
and uploads still need application validation; custom `IconSet` SVG must be trusted
application code. See the [security guide](https://domternal.dev/v1/guides/security/).

`onUpdate` runs for accepted document changes, including changes appended by
plugins. A transaction vetoed by a plugin does not run update callbacks. See the
[transaction contract](https://domternal.dev/v1/guides/editor-api/#transaction-flow)
when connecting autosave or external state.

## Server-side rendering

`generateHTML`, `generateJSON` and `generateText` work without an editor instance.
HTML serialization and parsing need a DOM. For a Node.js ES module, install the
optional `linkedom` peer and pass its document explicitly:

```bash
pnpm add linkedom
```

```ts
import { generateHTML, generateText, StarterKit } from '@domternal/core';
import { parseHTML } from 'linkedom';

const content = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }],
};
const { document } = parseHTML('<!doctype html><html><body></body></html>');

const html = generateHTML(content, [StarterKit], { document });
const text = generateText(content, [StarterKit]);
```

`generateJSON(html, extensions, { document })` parses HTML into JSON.
`generateText` does not need a DOM. CommonJS can load installed `linkedom`
automatically; browser calls use the browser document. See
[server-side utilities](https://domternal.dev/v1/guides/editor-api/#server-side-utilities).

## Localization

Custom translation catalogs use `CompleteMessages<typeof definitions>`. In Core
1.4.0, definitions without `optionalTranslation: true` remain required. A definition
marked `optionalTranslation: true` may fall back to its English default until the
application translates it, so additive messages need not break existing catalogs. Use
`Required<CompleteMessages<typeof definitions>>` to require every current message
in a maintained language pack. Runtime `i18n.messages` overrides remain partial.

## Guides

- [Editor API](https://domternal.dev/v1/guides/editor-api/): commands, events, lifecycle and DOM adoption.
- [Localization](https://domternal.dev/v1/guides/i18n/): per-editor language, English fallback and optional `/locales/de` catalogs.
- [Theming](https://domternal.dev/v1/guides/theming/) and [printing](https://domternal.dev/v1/extensions/print/).
- [Content normalization and migrations](https://github.com/domternal/domternal/blob/main/packages/core/docs/content.md).
- [URL and style policy](https://github.com/domternal/domternal/blob/main/packages/core/docs/url-and-style-policy.md): custom link controls and exporters.
- [Clipboard coordination](https://github.com/domternal/domternal/blob/main/packages/core/docs/clipboard.md): experimental APIs for extension authors.

## License

[MIT](https://github.com/domternal/domternal/blob/main/LICENSE).
