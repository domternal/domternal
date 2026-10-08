# Content normalization and migrations

Use this guide when loading persisted JSON, interpreting attributes from a shared document or planning an explicit migration. For release-specific behavior changes, read the [changelog](https://github.com/domternal/domternal/blob/main/CHANGELOG.md).

[Core overview](../README.md) · [URL and style policy](url-and-style-policy.md) · [Editor API](https://domternal.dev/v1/guides/editor-api/)

## List markers

Ordered lists retain `decimal`, `lower-alpha`, `upper-alpha`, `lower-roman` and
`upper-roman`; bullet lists retain `disc`, `circle` and `square`. The persisted
`listStyleType` is `null` when the theme should choose its depth-based marker.
HTML `type` attributes and supported `list-style-type` values populate it. Task
lists keep their checked state and do not gain this attribute. Core's list
commands and [`SmartPaste`](https://github.com/domternal/domternal/tree/main/packages/extension-block-controls) keep lists
separate when their explicit markers differ; an explicit marker and `null` also
remain distinct. Marker classes do not preserve a source application's
exact glyph font, punctuation or indentation.

## Content normalization

JSON content can hold values the editor cannot represent: a list marker this version does not
know, a heading level the `Heading` configuration lacks, such as `5` with the default levels 1
to 4, or a value that is not a level at all, and a link href the [URL policy](url-and-style-policy.md#url-policy)
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
instead of a heading moving out and splitting them. Only the heading's text and inline formatting
carry over: its alignment, `id` and other block attributes are dropped without a report, as for
any element parsed as text. Content before the heading in the item, such
as text, a no-break space, a line break, an image or a paragraph element, even an empty `<p></p>`
as `getHTML` writes an empty item label, gives the item its paragraph, so the heading after it
stays a heading and such HTML loads back unchanged. A block before it, such as a horizontal rule,
leaves it after that block, a heading as in 1.2. White space and empty wrappers do not count. Only the
nodes the schema holds count: without a list item, details summary or code block node, or with a
list item whose content may start with a heading (`ListItem.extend({ content: 'block+' })`), the
heading stays a heading there, as in 1.2. A tag the levels lack ranks below every
parse rule at priority 1 or above, so an application node that parses such a tag keeps it, and
among nodes built from Heading, such as a title node with level 1 next to a heading node with
levels 2 to 4, the one whose levels hold the nearest level takes it.

### Observing repairs

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

### Validating JSON outside the editor

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

### Reading collaborative content

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

### Migrating a shared document

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
older clients still share the document. Run a migration on exactly one writer client, after synchronization. Repair unsupported table spans before a 1.2.0 client edits them; its table repair can otherwise remove cell content. Upgrade all clients and align their configuration before running an unrestricted migration.

### Adding a normalizer in an extension

Extensions register how loading normalizes their own attributes with the experimental
`registerAttributeNormalizer(validate, normalizer)`, keyed by the function the attribute spec uses
as `validate`, and add `pastedAttributesPlugin(code)` so pasted slices get the replacement too;
every entry point above then follows the attribute.

## Configuring links and headings

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
[`@domternal/extension-paste-cleanup`](https://github.com/domternal/domternal/tree/main/packages/extension-paste-cleanup),
a pasted heading moves to the nearest supported level before parsing and is reported.
