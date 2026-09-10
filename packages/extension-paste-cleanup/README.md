# @domternal/extension-paste-cleanup

Opt-in clipboard HTML cleanup for Domternal. MIT licensed and part of Free.

**Development status:** unreleased. This package is not a DOCX importer and makes
no claim of complete Word, Google Docs, or LibreOffice fidelity. Its behavior is
verified with synthetic clipboard input; native Word, Google Docs, and LibreOffice
clipboard captures are not yet verified. Strict inline Office list metadata, read
together with Word's list level definitions and marker fonts, and a bounded subset
of inherited formatting are supported. Optional local image preparation supports
image-only pastes and explicit application-supplied bindings. An explicit resolver
mode can stage those raster assets in application-owned storage. Automatic Office
image association and general stylesheet resolution remain subsequent work.

## Editor integration

```ts
import { PasteCleanup } from '@domternal/extension-paste-cleanup';

const extensions = [
  // Include your usual document nodes, marks and history extension.
  PasteCleanup.configure({
    formatting: 'preserve',
    onPasteResult(result) {
      // Observe the accepted outcome after synchronous paste processing settles.
      console.log(result.operationId, result.status);
    },
  }),
];
```

The package has `@domternal/core` and `@domternal/pm` peer dependencies in
`>=1.2.0 <2.0.0`. It adds no toolbar or UI framework. Register it explicitly in
the same extension list used by Vanilla, React, Vue, or Angular. Installations
that do not import it do not load its parser or sanitizer.

HTML is cleaned before ProseMirror parses it into a slice. Existing Markdown,
Link, SmartPaste, UniqueID, and history handlers retain ownership of insertion.
Ordinary plain text and code block pastes keep their existing interpretation,
subject to resource limits. Clipboard access happens during the paste event;
the extension never reads the system clipboard later.

`onResult` receives a result for HTML cleanup and rejected input. Its exceptions
cannot disable cleanup. The observer is not an insertion receipt: downstream
editor handlers may still reject the paste. Source HTML is not stored in editor
storage, diagnostics, or a remote service.

## Clipboard ownership

PasteCleanup registers single clipboard slots from the experimental
`@domternal/core/clipboard` subpath on each editor it is installed in: the copy
annotation always, and the HTML preparation when `imageAssets` is enabled. Core
accepts one registration per editor for each slot, and whichever registers second
fails:

- When another registration already holds a slot, PasteCleanup throws an
  `ExtensionConfigurationError` that names the slot and how to resolve the conflict,
  with Core's refusal as its `cause`, and releases anything it had already claimed.
  During `new Editor(...)`, where only an earlier plugin view can hold the slot, the
  constructor throws it and destroys the partially built view with that plugin view,
  so nothing of the failed editor keeps running. When a later reconfiguration
  recreates the plugin views with the other one first, the reconfiguring call throws
  it and the other registration keeps its slot.
- When PasteCleanup already holds a slot, the later `registerClipboardCopyAnnotation`
  or `registerClipboardHTMLPreparation` call receives Core's error, and PasteCleanup
  keeps the slot. A plugin view that makes that call during `new Editor(...)` fails
  the constructor with Core's error, and the teardown releases PasteCleanup as well.

To resolve a conflict, remove the other registration from that editor or leave
PasteCleanup out of it. For the HTML preparation, `imageAssets: false` leaves the
slot to the other registration, and `imageAssets` with `mode: 'resolver'` stages
pasted images in application storage without a separate preparation.

## Feedback and accepted results

The default nonmodal notice displays warnings, removed-image guidance and blocked
input. It provides accessible status text, a details disclosure and dismissal
without moving focus or adding document content. A clean paste or intentional
formatting adaptation alone stays quiet, including when its informational findings
fill the diagnostic allowance. Load the normal `@domternal/theme` CSS
for styling. The notice follows editor adoption and is removed on destruction.

The routine clipboard envelope is removed without a diagnostic: `head`, `title`,
`meta`, `link`, `base` and `style` elements and Office `xml` islands, with their
content. Office paragraph marks (`o:p`), content controls (`w:*`) and smart tags
(`st1:*`) are unwrapped and keep their text. Scripts, frames, embedded objects,
templates, form controls, SVG and MathML still report `unsafe-content-removed`;
VML drawings, Office math, `font` and other unknown elements still report
`unsupported-formatting`.

Routine declarations are also dropped without a diagnostic: Office private
`mso-*` properties other than `mso-hide`, values that render like their absence
(zero margins and indents, `normal` spacing and font variants, `none` borders,
backgrounds and shadows, the `windowtext` default text color, which resets an
inherited color), vertical block spacing, pagination and typesetting controls,
table borders, cell padding and table layout, list indentation on semantic lists
and the level indentation of reconstructed Office list paragraphs. Nonzero
horizontal indentation outside lists and tables, borders outside tables,
background shorthands and images, hidden text, the `font` shorthand, letter
spacing, case transforms, small caps and other unsupported declarations still
report `unsupported-formatting`.

Use `feedback: 'application'` with an `onPasteResult` handler to own presentation.
Omitting that handler is a fatal configuration error. English definitions are
exported as `pasteCleanupMessages`; the optional `/locales/de` entry exports
`deMessages` and `deSearchAliases`. Merge the catalog with your other per-editor
i18n messages. Visible notices update when the locale changes.

`onPasteResult` runs once in a microtask for each observed normalization operation,
including plain-text transforms. Its frozen result contains `operationId`,
`source`, `formatting`, `status`, bounded `diagnostics`, `diagnosticsTruncated` and
`references`, without source HTML. `onResult` includes the same operation ID and
formatting policy synchronously. Both list the same diagnostics, except that an
applied paste's result leaves out the heading warning of a pasted heading that
merged into the block at the caret, as Formatting and assets describes.
Callback exceptions cannot revoke an accepted paste or disable cleanup.

| Status | Meaning |
| --- | --- |
| `applied` | A tagged paste transaction changed the installed editor document |
| `rejected` | Cleanup blocked the operation before insertion |
| `noop` | Nothing survived parsing, or an accepted transaction made no document change |
| `untracked` | No accepted receipt was found, for example after a plugin veto or a custom handler |

An empty cleaned slice preserves the selection instead of deleting selected text.

When the cleaned content has no text of its own, the clipboard's image files are the paste.
White space, a no-break space, invisible format characters such as zero-width spaces, and the
alt text cleanup leaves in place of the images it removes do not count as text, so a copied web
image (an `<img>` next to its file), a meta element, blank paragraphs or a `blob:` image with a
file paste the file instead of nothing or the alt text. Core's `pasteHasOwnText` decides, as it
does for the Image extension and the Link paste. Without `imageAssets`, the Image extension
inserts the files; one file keeps the alt text of the one image the content held. Such an
operation reports `untracked` without findings in `onPasteResult` and the notice, since nothing
of the cleaned content reached the document, while `onResult` still reports the cleanup as it
ran. A drop's image files win over its content, and one dropped file keeps the alt text cleanup
left in place of the one image it removed. Content with text of its own keeps the paste, since
Word, Excel and Google Docs put a picture of the copied selection next to it. A rejected paste
never reaches the files. With `allowBase64: false` and no `uploadHandler`, the Image cannot store
files and the cleaned content pastes as it would without them.

`untracked` does not prove that nothing was inserted. Custom asynchronous handlers
and legacy image-only routes that skip text/HTML transforms are outside this receipt
contract. The optional `imageAssets` coordinator does track its image-only route.
`applied` does not establish complete source or destination-schema fidelity.

`getPasteAffectedReferences(editor.view, operationId)` reads the latest installed
state. References use `precision: 'operation'` and describe changed transaction
regions, not exact diagnostic or comment anchors. Outside edits map their positions;
interior edits, undo, replacement or unsupported custom steps can expire them.
Check `expired` before using ranges, and reacquire them after document changes.
The store retains the most recent 16 accepted operations and at most 32 regions
per operation. A missing or destroyed receipt returns `undefined`. References are
ephemeral and must not be persisted or used to reapply formatting to edited content.

## Standalone HTML entry

```ts
import { normalizePasteHTML } from '@domternal/extension-paste-cleanup/html';

const result = normalizePasteHTML(clipboardHTML, {
  formatting: 'adapt',
  allowRemoteImages: false,
  allowDataImages: true,
  sourceURL: 'https://example.com/source/document',
  limits: { maxInputLength: 500_000, maxTableCells: 5_000 },
});
```

Both entries support ESM and CommonJS. The `/html` entry needs no browser DOM,
Editor, ProseMirror instance, fetch, conversion server, or image decoder. It uses
parse5 for HTML parsing, a narrow normalization policy, and hast-util-sanitize
before serialization. The bundled dependencies and licenses are recorded in
`THIRD-PARTY-LICENSES.md`; parse5 remains an external dependency.

The result contains:

- `status`: `cleaned` or `rejected`. Rejection always returns empty HTML.
- `html`: normalized editor input, still subject to the destination schema.
- `source`: an advisory signature, never proof of origin or trust.
- `diagnostics`: stable codes, severity, and an optional UTF-16 source offset. The code list
  is open: a minor release can add a code, so keep a default branch when you switch on it.
- `diagnosticsTruncated`: at least one finding was dropped because the
  `maxDiagnostics` allowance was full; the HTML itself is never truncated.
  When the allowance is full, a new finding replaces the least severe retained
  finding that is less severe than itself, choosing the newest of equally least
  severe ones; otherwise the new finding is dropped. An error therefore displaces
  informational findings before warnings, and a warning displaces the newest
  informational finding. Retained findings stay in emission order. Normalization
  emits at most one error, for the condition that rejected it, so a result
  rejected by normalization always keeps that error diagnostic. A coordinated
  clipboard image operation refused for another reason, such as cancellation or
  an asset limit, is identified by its `onPasteResult` `reason`; its
  diagnostics need not contain an error.

The result is editor input, not a destination-schema validation or a general
HTML publication policy. The receiving editor still controls its nodes, marks,
URL policies, custom renderers, identifiers and comment ownership. Unsupported
custom node attributes and slice contexts are not implicitly trusted. The
standalone entry has no own-copy verifier, so it treats every fragment,
including one with a `data-pm-slice` marker, as external content.

## Formatting and assets

`preserve` retains supported semantic tags and allowlisted inline typography,
alignment, table spans, dimensions and list starts. Inline bold, italic,
underline, strike, subscript and superscript styles become semantic marks where
the wrapper permits them. It does not reproduce page layout or arbitrary CSS.
Inherited inline font family, size, color, bold and italic resolve through source
wrappers, including descendant bold/italic resets. Relative `em` and `%` font
sizes resolve only when the source provides a known absolute base. Inline text
decoration and highlight retain supported source semantics; a block or cell fill
does not become text highlighting. Apart from Word list level definitions (see
the Office list section), stylesheet rules, CSS variables, the browser's computed
styles and arbitrary CSS inheritance are not resolved. The destination
schema determines which retained styles become document attributes.

Supported inline marks and effective typography are materialized around both text
and hard breaks, including break-only runs. The original `<br>` remains a void
element; paragraph alignment and line height stay on the paragraph. This also
preserves direct break styles and supported descendant resets without applying
them to following siblings. It does not establish identical line-box geometry in
every browser or destination schema.

The standalone normalizer and ordinary document parsing retain a final bare
`<br>`. ProseMirror's clipboard parser treats a final bare `<br>` directly inside
a block as a placeholder and can remove it. Breaks inside retained inline wrappers
are distinct from that case. Cleanup does not override this clipboard rule, so
preserving every unwrapped trailing break during paste is not guaranteed.

The editor integration checks requested built-in destination capabilities using
small constant probes against the actual schema parser. It checks semantic marks,
requested heading levels, retained text styles, paragraph alignment/line spacing,
lists and table structure. Missing or unconfirmed formatting support produces a
`destination-formatting-unconfirmed` warning. A pasted heading whose level the
editor cannot represent stays a heading: it moves to the nearest supported level
of equal or lower importance, otherwise to the deepest supported level, so a
heading is never promoted while a deeper level exists and the outline keeps its
order. With the default levels 1 to 4, `h5` and `h6` become `h4`; with levels 2
and 3, `h1` becomes `h2`. A moved heading keeps its alignment and the other
attributes a heading of its new level keeps, and each one is reported with a
`destination-heading-level-adapted` warning at its source offset. It becomes a
paragraph, with `destination-formatting-unconfirmed`, only when the editor
confirms no heading level at all, for example without a heading node. A heading
where the editor cannot place one, at the start of a list or task item, in a
details summary or in a preformatted block, keeps its tag and has no warning:
the editor parses every heading tag there as that block's text. Table
support that cannot be confirmed blocks the paste with
`destination-table-unsupported` and terminal reason `unsupported-content`,
preserving the selection instead of flattening cells into ambiguous text. This
block remains effective when diagnostic details are full and runs before
coordinated image reads or resolver callbacks.

The operation result and the notice keep a heading's warning only when that
heading reaches the document as a heading. ProseMirror merges the text of an open
first heading into the block at the caret: `<h5>Five</h5>` pasted in the middle
of a paragraph or of a heading adds the word to that block, so no heading
changed, and `onPasteResult` and the notice leave its warning out. A heading that
lands, for example in an empty paragraph, at the start of a paragraph, as a later
block of the paste or as a block that SmartPaste inserts, keeps its warning, and
so does one that fills an empty or wholly selected heading of its new level,
which ProseMirror keeps as the same node. When the outcome is ambiguous, such as
a heading warning that a full diagnostic allowance dropped or a parsed paste
whose headings differ from the cleaned HTML, every warning stays. `onResult`
describes the cleanup, so it still lists every moved heading. A drop has no paste
receipt, so its result stays `untracked` with every warning.

These are built-in reference capability checks, not a comparison of each source
word or style with the final editor document. Custom renamed nodes, custom clipboard
parsers, later transforms, insertion fitting, individual style values and runtime
rendering options can still change the result. In particular, paragraph alignment
and line-height probes do not establish every heading/cell context or a configured
LineHeight rendering allowlist. The standalone `/html` entry has no schema and
does not run these editor checks.

`adapt` removes external font family, font size, colors, text alignment and line
spacing while retaining structure and emphasis. Set `preserveTextAlignment: true`
to keep source text alignment in this mode. Inherited typography is never
materialized in `adapt`: it generates only semantic mark wrappers, which count
toward the node and depth allowances, and no inherited style text. Each discarded
source declaration is reported once as an informational `formatting-adapted`
finding located at the element that declared it, including when the HTML parser
duplicates misnested formatting elements. A relative font size without a known
base is adapted, not reported as unsupported.
Destination demands are collected after intentional adaptation, so removed theme
formatting does not trigger a missing-capability warning. Semantic emphasis and
structural capabilities are checked in both modes. Empty decorative text wrappers
do not request formatting; significant spaces and hard breaks count as meaningful
inline content, including when a styled wrapper contains only a break.

A `data-pm-slice` marker is ProseMirror structural context, not proof of origin.
HTML copied from another ProseMirror or Tiptap editor, Confluence or any other
page follows the chosen `preserve` or `adapt` policy. Its marker is kept only
when it is the fragment's single marker on the first root element; a table part
marker additionally needs a single root element whose wrapper levels each hold
one element, so ProseMirror's descent drops nothing. Its context must also be
one ProseMirror's copy could have written: wrappers such as lists, list and task
items, blockquotes, table parts, details and columns, each able to hold the
next, with the innermost able to hold the first pasted element. A context that
names a paragraph, heading or details summary, which ProseMirror records only
for content copied from inside an inline node with content and so never for
Domternal's nodes, or a wrapper that cannot hold what follows it, is removed as
a whole without a diagnostic, and the fragment pastes as external HTML. Under `adapt` the kept
context loses text alignment (unless `preserveTextAlignment` is set) and cell
backgrounds, and keeps structure such as list markers, starts, spans, widths
and task state. Every other marker, including nested and duplicate ones, is
removed, so it cannot change the policy of the whole fragment or drop pasted
blocks.

A Domternal own copy is recognized only by `data-domternal-copy="v1.<nonce>"`
on that anchor. PasteCleanup adds it to copies, cuts and drags from its editor
through `registerClipboardCopyAnnotation` from the experimental
`@domternal/core/clipboard` subpath. The nonce is 16
random bytes, remembered for the 32 most recent copies in the same page. Copies
between editors with PasteCleanup on one page keep their editor formatting in
both modes and skip Office list reconstruction. Copies from other pages or
applications, from a separate copy of this package, from editors without
PasteCleanup, or without a secure random source are external. The copy marker
never reaches the editor document. HTML, URL, style and resource checks apply to
every fragment, including own copies. Core accepts one copy annotation per
editor; [Clipboard ownership](#clipboard-ownership) describes a conflict.

Explicit inline `mso-list:lN levelN lfoN` paragraphs with one leading
`mso-list:Ignore` marker can become semantic lists. When the clipboard HTML carries
Word's stylesheet, its `@list lN:levelN` level definition, with a matching
`lfoN` instance override applied over it, and the font of the marker run identify
the list profile. The visible label must be exactly what that definition produces
for the paragraph's level:

| Word level definition | Visible marker | Marker class |
| --- | --- | --- |
| Decimal, level text absent, `%N.` or `%N)` | `1.` to `10000.` with the same punctuation | `decimal` |
| `alpha-lower` or `alpha-upper`, same level text rule | one letter of that case | `lower-alpha` or `upper-alpha` |
| `roman-lower` or `roman-upper`, same level text rule | a canonical numeral up to 3999 of that case | `lower-roman` or `upper-roman` |
| Bullet `\F0B7` in Symbol | `·` or U+F0B7 in a Symbol marker run | `disc` |
| Bullet `o` in Courier New | `o` in a Courier New marker run | `circle` |
| Bullet `\F0A7` in Wingdings | `§` or U+F0A7 in a Wingdings marker run | `square` |
| Bullet `•`, `●`, `◦` or `▪` | the same glyph | `disc`, `disc`, `circle` or `square` |

A glyph alone never selects a Word profile. `o`, `§`, `a.` or `i.` without a
matching definition and marker run font stay literal, and `i.` under an
alphabetic definition is the ninth letter, not a Roman one. Legal and multilevel
numbering, prefixed or custom level text, other number formats, other symbol and
picture bullets, letters past `z`, and malformed or conflicting definitions stay
literal. A paragraph without a level definition, for example when a browser
drops the stylesheet, is read as before: only positive decimal numbers followed
by `.` or `)` and the Unicode bullets `• · ◦ ▪ ●` are admitted. The reader records
only the levels that pasted paragraphs reference, bounds each rule body to 8,192
UTF-16 units, 64 declarations and 64 units of level text, and resolves no other CSS.

Fallback is per item. An unsupported item, or one whose parent level is missing,
stays a literal paragraph with its visible marker: inside the nearest open list
item when the destination can nest lists, otherwise at the list's own level,
which closes the open lists. Deeper items under a literal item have no list
parent and stay literal until the level returns to a supported parent. Each
contiguous group of literal items reports one `office-list-unsupported` located
at its first paragraph. A literal item keeps its source paragraph, so hanging
indentation it carries is also reported as `unsupported-formatting`. Nesting, observed
starts, restarts and gaps retain separate list wrappers. SmartPaste preserves
reconstructed ordered-list starts when pasting into a list. Class-only lists are
not reconstructed. The extension probes the receiving schema's actual list parse
rules for each marker class before removing visible markers, so a destination
that cannot keep one class keeps only those items literal. The standalone HTML
entry has no destination schema and emits semantic list HTML; its caller remains
responsible for destination compatibility.

Both formatting modes retain supported list marker classes. Ordered lists support
`decimal`, `lower-alpha`, `upper-alpha`, `lower-roman` and `upper-roman`; bullet lists
support `disc`, `circle` and `square`. Only these kind-specific `list-style-type`
values and supported HTML `type` attributes are accepted. Core stores an explicit
marker in `listStyleType`; `null` keeps the destination theme's depth-based defaults.
Slice context follows the same restrictions. Task lists do not gain this
attribute. Lists with different explicit markers stay separate during paste and
list editing.

Reconstructed Office lists use an explicit marker class at every depth, and a
change of marker class creates a separate list. The schema probes must confirm
each explicit marker class before Office marker text is removed. Legacy schemas
keep the visible Office markers with `office-list-unsupported`; ordinary semantic
HTML can still paste with `destination-formatting-unconfirmed`. Marker classes do
not promise identical glyphs, punctuation, fonts, spacing or page layout: `a)`
and `a.` both become `lower-alpha`.

Remote images are removed by default, with escaped alt text where available.
Enabling `allowRemoteImages` retains HTTP(S) references: later rendering can then
contact those hosts, and their dimensions/content are outside the local raster
checks. Without explicit image preparation, local files, blob URLs and CID
references are removed. SVG data images are always removed. The default behavior
invokes no upload handler or resolver. Explicit resolver mode uses only the
application adapter supplied in `imageAssets`; it does not call Image's legacy
`uploadHandler` or include a storage/network implementation.

PNG, JPEG, GIF and static WebP data images are bounded by declared dimensions,
frame count, byte length and total pixels. APNG and animated WebP are not accepted.
Container inspection does not decode compressed pixels or certify image integrity.
If `allowDataImages` is false, source data images are removed. Match this setting to
the destination Image extension's `allowBase64` policy.

## Optional local clipboard images

`imageAssets` defaults to `false`. Enable `imageAssets: { mode: 'embedded' }`
alongside `Image.configure({ allowBase64: true })` to prepare image-only clipboard
files as embedded raster images. A paste is image-only when its cleaned content has no text of
its own, by the rule above, so a copied web image, blank paragraphs or a meta element next to a
file prepare the file too, with the one copied image's alt text; the cleaned operation then
reports `untracked` without findings and the prepared files report as their own `applied`
operation. A local `file:` or `blob:` image reference is not such a stand-in: it follows the
bindings below, so `unresolved: 'reject'` rejects it and `'omit'` leaves its alt text, file or
not. Preparation reads captured local files without
uploading, fetching, creating object URLs or adding document placeholders.

With `imageAssets`, PasteCleanup also owns the editor's clipboard HTML
preparation. Core accepts one per editor, and another registration never takes
over; [Clipboard ownership](#clipboard-ownership) describes a conflict.

Mixed HTML requires an explicit `match(context)` callback when image references
need local clipboard files. It returns `ClipboardImageBinding[]` with a
`placementId`, the original `DataTransfer.items` `itemIndex`, and an evidence
declaration (`{ kind: 'host', matcherId }` or `{ kind: 'verified-profile', profileId }`).
String items also occupy indices. The callback receives frozen reference and item
metadata, including `available`, declared MIME type and captured file size/type.
It receives no `File`, live `DataTransfer` or complete source HTML. Raw reference
strings are private matching data and must not enter user-facing notices or logs.

The callback owns association correctness. An evidence label is not a built-in
verification service. No Word/CID, filename, order, dimensions or cardinality
heuristic is supplied. Missing bindings reject the entire paste by default.
`unresolved: 'omit'` explicitly permits dropping unmatched image placements with
a bounded `image-removed` diagnostic and alt-text fallback where available.
Invalid or conflicting bindings still reject. Existing safe HTML images retain
their original positions; unrelated clipboard files are never appended to them.

The actual Image extension must advertise a compatible live destination and allow
embedded images. A custom image node can register its policy with
`registerClipboardImageDestination` from the experimental `@domternal/core/clipboard`
subpath; matching a node name alone is insufficient. With several registrations,
pasted images go to the latest active one. An unavailable latest policy leaves no
destination rather than falling back to an earlier registration.
Prepared replacements have their own explicit image policy. `allowDataImages`
continues to control untrusted data images in source HTML.

| `imageAssets.limits` field | Default | Maximum |
| --- | ---: | ---: |
| `maxFileBytes` | 1 MiB | 5 MiB |
| `maxTotalFileBytes` | 4 MiB | 5 MiB |
| `maxPreparedOutputUnits` | 8 Mi UTF-16 units | 8 Mi UTF-16 units |

Values must be positive safe integers and the per-file allowance cannot exceed
the total. `DEFAULT_CLIPBOARD_ASSET_LIMITS` and `MAX_CLIPBOARD_ASSET_LIMITS` expose
these frozen values. Source HTML retains its separate input ceiling. Generated
markup, escaping and each repeated image URL count toward the output allowance;
repeated placements also share the existing raster-pixel limit. File metadata,
actual bytes, raster headers and current destination policy are rechecked.

`onPasteProgress({ operationId, phase: 'preparing', cancel })` lets applications
present pending work. The default notice includes a localized Cancel action.
Dismissal or Escape only hides the notice; cancellation is explicit. No progress
percentage is invented. File reads are asynchronous, but encoding and serialization
currently run synchronously on the main thread, so cancellation cannot interrupt
those individual synchronous sections. These limits are not browser heap caps.

Changing the document (even editing then undoing), selection, editable state,
owning document or image policy invalidates a pending target. A newer paste
supersedes it. Cancellation or destruction discards late file-read results. There
is no automatic retry at a different location. Prepared rich HTML runs ordinary
paste hooks once on replay. Image-only handling starts in `handlePaste`, so a
higher-priority handler can see its initial empty slice and the prepared replay.
Accepted insertion is isolated from adjacent typing in history.

`onResult` runs once after preparation succeeds or fails; its synchronous callback
is no longer necessarily inside the initial native event. `onPasteResult` waits
for preparation and synchronous insertion to settle. Known pre-insertion rejection
can include `reason`: `cancelled`, `superseded`, `target-changed`,
`unsupported-destination`, `unsupported-content`, `assets-unavailable`, `asset-limit`
or `asset-read-failed`.
An accepted receipt takes precedence over cancellation or an observer throwing
after the document changed. An unknown custom-handler outcome remains `untracked`.

Relative links require an explicitly supplied HTTP(S) `sourceURL`. The receiving
page URL and pasted `<base>` are never used. Fragment links need a destination
anchor mapping and currently retain their text with a `link-removed` diagnostic.
This includes the `#_Toc` links of a Word table of contents.

Links are checked against the destination too. Each sanitized link uses `http:`,
`https:`, `mailto:` or `tel:`, and a constant probe, `<p><a href="...">Probe</a></p>`
parsed by the editor's own schema parser in a detached container, confirms which of
these schemes the editor stores: a scheme counts only when the parsed text carries a
mark with exactly the probe's href, which follows the `Link` extension's `protocols`
and URL policy and also finds a link mark with another name. A link whose scheme the
editor lacks, for example every link when the editor has no `Link` extension or
`StarterKit.configure({ link: false, linkPopover: false })`, keeps its text and formatting and is reported
once with `link-removed`. Links never add `destination-formatting-unconfirmed`. Every
address `safeLink` keeps is also one the core URL policy allows, so the destination
`Link` stores it unchanged. The standalone `/html` entry has no destination and keeps
every sanitized link.

A link or image `title` longer than 512 characters is dropped and reported with
`unsupported-formatting`. `target`, `rel` and `name` are dropped without a diagnostic:
they describe the source page rather than the content, and Word writes a `name`
bookmark for every table of contents entry.

## Explicit persistent image resolver

Use `mode: 'resolver'` when local clipboard images must become application-owned
HTTP(S) resources, including destinations with `Image.allowBase64: false`.
The same explicit placement bindings, raster preflight, input limits, stale-target
checks and one-operation history behavior apply. Choosing this mode authorizes
the configured adapter; it does not enable remote images from source HTML.

The resolver handles explicitly matched clipboard files. When the live destination
forbids embedded images, it also handles supported raster data URLs already present
at their exact HTML positions, unless `allowDataImages: false` forbids that source
input. Inline bytes need no File association and are never sent to `match`.
Unmatched duplicate clipboard files remain unread and are not appended. If the
destination allows embedding, existing source data images keep the normal inline path.

Inline and matched File sources share one preparation budget. `maxFileBytes` also
bounds each decoded inline resource; `maxTotalFileBytes` covers distinct inline
decodes and File reads before content deduplication. Repeated positions consume
pixels and output space separately. Equal MIME and exact bytes share one immutable
Blob and resolver call, while alt text and display geometry stay with each position.
The original HTML and clipboard capture limits remain separate. No remote source
image is fetched. Malformed or unsupported inline rasters use the existing loss
diagnostic and alt-text fallback; operational limits block coordinated insertion.

```ts
import { PasteCleanup } from '@domternal/extension-paste-cleanup';
import type {
  ClipboardResolverAdapter, ClipboardAssetRecoveryReport,
} from '@domternal/extension-paste-cleanup';

declare const assetStore: ClipboardResolverAdapter;
declare const recordAssetRecovery: (report: ClipboardAssetRecoveryReport) => void;

PasteCleanup.configure({
  imageAssets: {
    mode: 'resolver',
    resolver: assetStore,
    sourcePolicy: { allowedOrigins: ['https://images.example.com'] },
    onRecovery: recordAssetRecovery,
    // Add match(context) for explicit references in mixed source HTML.
  },
});
```

`sourcePolicy.allowedOrigins` is a required declaration of exact HTTP(S) origins.
It allows at most 32 entries, 2,048 UTF-16 units per entry and 8,192 in total.
Origins can have a trailing slash but cannot contain paths, credentials, queries,
fragments or wildcards. Normalization handles host casing, default ports and
international domain names. Subdomains and different ports are separate origins.
HTTP requires an explicit entry, for example for local development. Resolver
URLs are limited to 8,192 units each; temporary, relative, credential-bearing,
local-file and executable references are refused before insertion. These checks
do not certify a server's durability or the bytes it later serves.

The adapter contract is explicit:

- `idempotency` declares `none` or `operation-asset-key`. The coordinator never
  retries either kind automatically. Each operation uses a secure random nonce
  for its asset keys; the editor's display operation ID is not a global storage key.
- `resolve(request)` receives an immutable validated raster `blob`, `mimeType`,
  `operationId`, `assetId`, `idempotencyKey`, `signal` and `registerCreated`.
  Distinct content is resolved sequentially. Repeated placements of the same
  prepared content share one resource while retaining their original positions.
- An existing resource returns `{ status: 'resolved', src, ownership: 'existing' }`.
  It never becomes eligible for this operation's cleanup.
- A newly created resource must be registered immediately through
  `registerCreated(handle)`. Its successful result includes the returned opaque
  capability as `resource`, with `ownership: 'created'`. A fabricated token or a
  token from another asset does not establish ownership. Registration can return
  `undefined`; refusal does not prove that the resource does not exist.
- Failure returns `{ status: 'failed', creation, recoveryToken? }`, declaring
  `creation: 'none'`, `'registered'` or `'unknown'`, with an
  actionable `recoveryToken` when the remote outcome is unknown. A thrown or
  rejected promise is treated as unknown creation, not proof of zero side effects.
- `releaseUncommitted(request)` releases only registered resources from a known
  unapplied operation. It returns `{ status: 'released' }` or
  `{ status: 'cleanup-pending', retryToken }`. Each cleanup attempt runs at most
  once; later recovery belongs to
  the application.

Cleanup handles and recovery/retry tokens must be nonempty, at most 1,024 UTF-16
units, and contain no ASCII whitespace/control characters. At most 400 resources
can be registered per operation. A handle already registered to another asset
is refused. Applications must retain their own recovery information when
registration is refused or a token cannot be accepted.

An adapter must stop its creation/finalization work before its resolve promise
settles and must not independently insert or persist document references.
Cancellation is advisory: an aborted fetch or rejected local promise does not
prove that a server stopped writing. The application must provide compensation
that is safe for its storage protocol and an explicit recovery path for uncertain
remote effects. This API is not a distributed storage transaction.

Before application, cancellation immediately ends the pending paste and prevents
later insertion. A resolver that ignores abort may finish later; its registered
resources are cleaned only after that resolver actually settles. Resources whose
resolvers already settled can be cleaned while another remains pending.

Resources enter protected ownership before `onResult` or a replay hook can see
the resolved HTML. An installed accepted receipt permanently retains them for
this operation, including after Undo, editor destruction or a throwing observer.
Without positive acceptance after HTML exposure, the outcome is uncertain and
resources are retained. Public `noop`, `rejected` or missing/expired UI references
alone are not resource-deletion evidence. Trusted host hooks can transform or
persist content; their behavior remains part of the application's contract.
Long-term garbage collection, including abandoned uncertain resources, belongs
to the host application.

Required `onRecovery` receives frozen, bounded resource reports with a monotonic
`revision`, phase, ownership status, counts, recovery identities and private retry
tokens. Notifications are coalesced in microtasks and can arrive after cancellation,
a newer paste or editor destruction. `settled` means the terminal phase currently
has no tracked resolver or cleanup work; it cannot prove that arbitrary external
work stopped. The ordinary terminal `onPasteResult` does not wait indefinitely
for these callbacks. Reports exclude HTML, Blob contents, image URLs and cleanup
handles. Keep their recovery tokens in application recovery state, out of user
notices and general telemetry. Observer failures cannot revoke accepted content
or trigger an automatic retry; notification delivery is not durable storage.

## Resource limits

Defaults are hard ceilings. Callers can lower them with `limits`; invalid or
expanded values throw a `RangeError` in the standalone API. The editor extension
wraps invalid configuration in `ExtensionConfigurationError` and fails setup,
so normal extension error isolation cannot silently disable cleanup.

| Limit | Default |
| --- | ---: |
| Input UTF-16 code units | 2,000,000 |
| Parser allocations and generated output tree nodes | 30,000 |
| Tree depth | 128 |
| Diagnostics | 100 |
| Expanded table cells across the fragment | 20,000 |
| Images | 200 |
| Declared raster pixels across the fragment | 50,000,000 |

Additional fixed bounds protect attributes per tag, attribute-name length,
table spans, individual raster dimensions/pixels, and GIF frames. A lexical work
guard runs before parse5, including conservative checks in comments/raw text.
Generated inherited-style attributes share the input-length ceiling, preventing
a long source value from multiplying across many text or hard-break leaves without
a bound. Every generated mark and typography wrapper consumes the shared node and
depth allowance before it is allocated.
Plain/Markdown input has a conservative markup-token budget before downstream
handlers can expand it. HTML/structure rejection inserts nothing; removed images,
links and unsupported formatting are reported without discarding unrelated text.
Every clipboard flavor, including `text/rtf`, is checked against the input ceiling
before parsing, so one oversized flavor rejects the whole paste with `input-limit`.

Parser allocations count every element, comment and text insertion the HTML
parser makes. The parser inserts text once per run of whitespace or
non-whitespace, so the count grows with words rather than with nodes, and a Word
clipboard stylesheet uses allocations as well (1,027 for a representative 9 KB
stylesheet). A measurement of synthetic documents on one machine, recorded in
the repository under `e2e/paste-performance/results/2026-09-28-large-macos-arm64.md`,
found these largest accepted sizes: about 11,600 words of short Word paragraphs,
10,700 words of a mixed Word document with headings, lists and tables, 9,900
words of heavily fragmented Word runs, 9,300 words in a Word table, 6,400 words
of Word list items and 14,500 words of Google Docs paragraphs. Wrapping every word
in bold, italic and a styled span reaches the output node limit first, at about
3,700 words (4,300 in `adapt`). A larger input is rejected explicitly with `structure-limit` and
nothing is inserted; the HTML is never truncated. These are not guaranteed
capacities: real documents differ in structure and stylesheet size.

## Current verification limits

Synthetic fixtures test deterministic contracts and hostile input. They are not
clipboard captures from a native Office application. Native Word, Google Docs,
LibreOffice and real operating-system clipboard evidence are separate release
requirements. This package has localized loss notices and optional host-owned
feedback and optional image-preparation progress. It has no built-in preview or
paste-choice dialog. Local image association still requires an explicit host
mapping for mixed HTML; these fixtures do not prove native Office association.
Content specifications and capture scenarios for Word for Mac are prepared in the
repository's `e2e/native-office-capture` tooling; no native capture has been made
yet, and Word list profiles, the quiet envelope and the measured limits are not
qualified against native clipboard data.
The current Core color parser does not retain alpha in RGBA text colors or
partially transparent backgrounds. Exact transparency fidelity is not promised.
