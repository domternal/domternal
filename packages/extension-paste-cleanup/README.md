# @domternal/extension-paste-cleanup

Opt-in clipboard HTML cleanup for Domternal. MIT licensed and part of Free.

**Development status:** unreleased. This package is not a DOCX importer and makes
no claim of complete Word, Google Docs, or LibreOffice fidelity. Its behavior is
verified with synthetic clipboard input and with reviewed native captures on
macOS 26.5.2: Word 16.113.3 for Mac copied in Safari 26.5.2, Chrome 154 and
Firefox 155, and Google Docs web copied in Chrome 153. Google Docs in Safari and
Firefox is not yet captured; Word for Windows, Word on the web, LibreOffice and
Collabora are unqualified. Strict inline Office list metadata, read
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

The package has `@domternal/core` and `@domternal/pm` peer dependencies from the
release that ships it up to, not including, 2.0.0: it needs the
`@domternal/core/clipboard` subpath, which `@domternal/core` 1.2.0 does not have.
It adds no toolbar or UI framework. Register it explicitly in
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
input. It provides a details disclosure and dismissal without moving focus or
adding document content. A polite live region beside the notice, visually hidden
and present before any paste, announces each paste's title, also when two pastes
in a row share it. When Dismiss, Escape or Cancel hides the notice while focus is
in it, or while a pointer press left focus on the page, focus returns to the
editor with its selection. A clean paste or intentional
formatting adaptation alone stays quiet, including when its informational findings
fill the diagnostic allowance. Load the normal `@domternal/theme` CSS
for styling. The notice follows editor adoption and is removed on destruction.

With the theme, the notice stays in view in a long document on a screen at
least `30rem` tall (480 px at the default font size): it sticks to the bottom of
the visible part of the editor, in the page or in an outer scroller, and settles
after the last line once the end of the document is in view. While it sticks, it
covers the lines behind it: a pointer reaches them after scrolling, and when the
keyboard or typing brings the selection behind the notice, PasteCleanup scrolls
on until the selection's line is above it. Showing it does not scroll the page or
take focus, and its place in the DOM, the keyboard order and the accessibility
tree stays the same. In a shorter viewport, such as a phone held sideways or a laptop screen
zoomed to 200 percent, a sticky notice would cover most of the view, so the
notice stays after the document there, as it does in print. While a notice shows
on such a screen, the theme clips the element the view mounts in with
`overflow: clip` instead of `hidden`, since a scroll container would hold a
sticky notice in place; engines without `clip` show the notice after the
document. That rule has the specificity of the theme's own rule for the element,
so an application rule that overrides the theme there, such as one that makes
the element scroll, still applies, and the notice then sticks inside it. An
application that styles the notice itself needs `position: sticky` and no scroll
container between the notice and the scroller.

The routine clipboard envelope is removed without a diagnostic: `head`, `title`,
`meta`, `link`, `base` and `style` elements and Office `xml` islands, with their
content. So is the chrome an editor draws around content its attributes carry: a
task item's checkbox `label` and `input`, whose state is the item's `data-checked`,
and the `display: block` and `width: fit-content` of an aligned image, whose
alignment is its `data-align`, so an own copy of a to-do list or an aligned image
shows no notice. Office paragraph marks (`o:p`), content controls (`w:*`) and smart tags
(`st1:*`) are unwrapped and keep their text. Scripts, frames, embedded objects,
templates, form controls, SVG and MathML still report `unsafe-content-removed`;
VML drawings, Office math, `font` and other unknown elements still report
`unsupported-formatting`. Unknown elements a browser lays out as blocks, such
as definition lists (`dl`, `dt`, `dd`), `section`, `article`, `header`,
`footer`, `figure`, `figcaption`, `fieldset` and `form`, become plain `<div>`
elements without their attributes, so each one's text stays a block of its own,
as it does without PasteCleanup, instead of running into its neighbors' text
(`termdefinition`). Other unknown elements are unwrapped and keep their text.

Routine declarations are also dropped without a diagnostic: Office private
`mso-*` properties other than `mso-hide`, values that render like their absence
(zero margins and indents, `normal` spacing and font variants, `none` borders,
backgrounds and shadows, the `windowtext` default text color, which resets an
inherited color), vertical block spacing, pagination and typesetting controls,
letter spacing within half a point either way, as Word's Title style condenses
its text, the initial values Safari writes on every element it copies (`start`
alignment, `normal` white space, the `medium` font size, which on a nested
element resets the size it inherits to the editor's default, a zero text stroke,
`auto` and `solid` text decoration, a `none` border image), the `normal` line
height Word's Table Grid style writes for single spacing on every cell paragraph
(a verified own copy keeps it, as LineHeight writes it when the host lists it),
and the caret color,
table borders, cell padding and table layout, list indentation on semantic lists,
the level indentation of reconstructed Office list paragraphs, and the style of a
span that only draws the box of the one image it holds (no border, `inline-block`,
`overflow: hidden`, exactly the image's width and height in pixels, no image
margin, padding, `hspace`, `vspace` or border attribute, and no comment, escape or
`!important` in either style), as Google Docs was expected to wrap images; that
shape is checked against authored HTML, and Google Docs' Chrome captures place
each image in its run's own span instead. Nonzero horizontal indentation outside lists
and tables, borders outside tables, background shorthands with more than one
color or an image, a background shorthand that paints a block other than a table
cell, which no block keeps, background images, an image box that crops, pads or
offsets its image, an element a page hides outside a Word source (below), the
`font` shorthand, wider letter spacing, case transforms, small caps and other
unsupported declarations still report `unsupported-formatting`. In `adapt`, which removes typography anyway, an
unsupported font family or size, color, background, line height, letter or word
spacing, case transform or font variant is reported as `formatting-adapted`
instead. A later declaration wins, a reset to the initial value included, so
`background: none` after a background color leaves no background. An inline
element without visible content, such as the empty span Safari ends a partial
copy with, reports nothing, since nothing is lost. Word writes an empty paragraph
as a paragraph mark holding one no-break space; that space is no text of the
document, so the paragraph pastes empty, while a no-break space Word wrote as
text stays.

Word's hidden text (Format > Font > Hidden) is not pasted, as Word does not show
it. Word's raw HTML, which Chrome and Firefox pass through, writes a hidden run
with two declarations: `display: none`, which hides it in a browser, and
`mso-hide: all`, Word's own. A hidden character or paragraph style writes both
into its class rule in the copy's stylesheet. In a Word source an element with
both is removed with its content, whether its style attribute or a class rule
with a simple selector, such as `span.HiddenChar` or `.Hidden`, declares them.
They are read as CSS reads them: `!important` wins, then the style attribute
over a rule, then the more specific and the later rule, and a semicolon in a
string or a comment separates nothing. Either declaration alone is no hidden
text of Word's and keeps its text with `unsupported-formatting`, as other hidden
elements do: `display: none` with `mso-hide: screen` is Word's web hidden text,
such as a table of contents' leaders and page numbers, which Word shows on the
page, and a web page hides interface parts such as menus with `display: none`
alone, also a page that only names Office's properties in its text.
`visibility: hidden`, which keeps its room, is reported the same way in every
source. A paragraph, heading or list item that held nothing else goes with the
hidden text when its paragraph mark is hidden too, its list marker with it, and
stays as an empty paragraph, the empty line Word shows, when its mark is
visible. A hidden list item leaves one list, numbered as if it were not there,
and a table cell or column keeps its place without its content. Each removed
element that held text or an image reports `hidden-text-removed`, a warning the
notice names as "Hidden text from Word was not pasted.", in both policies. Its
images are neither prepared nor reported, and the picture of the selection
Chrome adds, which can show the hidden text, is never pasted in its place.
Safari leaves hidden text out of its copy, which then holds no trace of it, so
nothing is reported there. A style rule with another selector, such as one with
a combinator, is not read.

Safari copies the computed style of each top-level element it copies. In a Word
copy a text color equal to the caret color it copies with it is Word's automatic
color, whatever it computes to, and pastes as the editor's own color, as
`windowtext` does; a color Word applied comes without one and stays. From another
source a caret-equal color is the page's default text color only when it is a
neutral gray, black or white (channels at most 16 apart), so a container the page
colored, such as a red warning, keeps its color. So does a light color a dark
page gives its text: in `preserve` it pastes as that color and can read poorly in
a light editor (a light blue about 1.8:1 on white), while `adapt` removes text
colors. A
background shorthand that paints one color, as Word writes a highlight
(`background: yellow`) or cell shading, is read as that background color. A line
height becomes the ratio of the font size a LineHeight destination renders,
rounded to two places: a percentage, as Word's raw HTML in Chrome and Firefox
writes 150 %, or a plain number by itself, and a length in pixels or points as a
ratio of the element's own font size, as Safari writes it. In a Word paste the
spacing of Word's Normal style is no formatting of its own, on a paragraph or a
run: the copy names it when it carries Word's stylesheet, as Chrome's and
Firefox's copies always and Safari's copies with lists do, and otherwise Word's
defaults 1.15 and 1.08 (written 107 %) stand for it. A copy cannot tell a
paragraph that keeps its style's spacing from one set to the same value, so
that value reads as the style's. A space WebKit converted to a
no-break space in a `span.Apple-converted-space` pastes as a space in every
engine, as ProseMirror's paste does in WebKit only, and so does a span left with
nothing but one no-break space, as cleanup leaves the first space of a partial
Word selection, which ProseMirror's paste turns into a space in Chromium only.
Word's Title style becomes a level 1 heading, as Pro's DOCX import reads it, also
when the Title runs over several paragraphs, which Word writes with the
`MsoTitleCxSpFirst`, `MsoTitleCxSpMiddle` and `MsoTitleCxSpLast` classes: each
paragraph is its own level 1 heading. A Subtitle stays a paragraph.

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
ran. A drop's image files win over its content, even content cleanup rejected, such as HTML over
the input limit, since that content is not inserted: the drop reports `untracked` without
findings and no blocked notice. One dropped file keeps the alt text cleanup left in place of the
one image that drop's content held; a later drop of files alone, as an operating system's file
drag carries them, keeps none. Content with text of its own keeps the paste, since Word and
Excel put a picture of the copied selection next to it, and so does a Word or Excel copy
that places no image, such as empty paragraphs or cells, whose file Chrome exposes as that
picture. Text cleanup removed, Word's hidden text, counts as text of the content's own, so the
picture of the selection, which can show that text, is never the paste of such a copy, also
when its hidden content held an image. A rejected paste never reaches
the files. With `allowBase64: false` and no `uploadHandler`, the Image cannot store
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

The receipt references are experimental and may change in a minor release:
`getPasteAffectedReferences`, `PasteAffectedReferences`, `PasteAffectedRange` and
the `references` field of `PasteOperationResult` carry `@experimental`.

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

Both entries support ESM and CommonJS. The main entry carries its own copy of the
normalizer and re-exports `normalizePasteHTML` and `DEFAULT_PASTE_HTML_LIMITS` from
it, so code that loads the extension imports them from the main entry; importing
the `/html` entry as well loads the normalizer a second time, with its own function
and object identities. The `/html` entry needs no browser DOM,
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
custom node attributes and slice contexts are not implicitly trusted. The data
attributes of Domternal's own inline nodes are kept up to 4,096 characters each:
a mention's id, label and type (`data-mention-type`, the trigger that made it,
so a `#` tag mention stays a tag), an emoji's name and character, and a math
node's source. The
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
preserving every unwrapped trailing break during paste is not guaranteed. The
break Chrome and Safari end a copy with, `<br class="Apple-interchange-newline">`
after the copied content, marks where the selection ended and is no line of it:
the editor's paste ignores it, and cleanup leaves it out, for every source.

Inline content that follows a block at the top of the pasted HTML, or inside an
inline element there that holds blocks, such as a wrapper a source puts around them, is
wrapped in a `<div>` when a space between its words is a text node of white
space only. ProseMirror's clipboard parser reads such a text node there as the
space between two blocks and drops it, so a partly selected last paragraph
written as bare spans, the shape expected from Google Docs and checked against
authored HTML (Google Docs' Chrome captures write it as a whole paragraph), would
paste `GB09 bold ita` as `GB09 boldita`.
In the `<div>` the parser puts the run in a paragraph, where the space stays. An
image in the run stays in that paragraph when the editor's images are inline;
when they are blocks, as by default, the image goes between the paragraph of the
words before it and a new one for the words after it, with no empty paragraph.
The `<div>` counts toward `maxNodes` and `maxDepth` like every generated wrapper,
so content that fits the limits only without it is rejected with `structure-limit`.
Inline content before the first block is left as written and still joins the
paragraph at the caret. Without PasteCleanup, ProseMirror's parse still drops
that space.

Table parts that start the pasted HTML without a table around them, such as
bare rows, bare cells, or rows after a caption or column group, are parsed
again as a table's content and put in a table, as a browser and ProseMirror's
own clipboard parse read them. Their cells stay cells instead of running
together, and they paste the table they paste without PasteCleanup, into a
paragraph or cell by cell into a table. In an editor without tables they paste
their texts, as they do without PasteCleanup, instead of being refused as a table. The table counts toward
`maxTableCells`, `maxNodes` and `maxDepth`. Content after the parts, such as a
paragraph, stays after the table, where ProseMirror's parse alone drops it.
Table parts after other content are left as the HTML parser reads them.

The editor integration checks requested built-in destination capabilities using
small constant probes against the actual schema parser. It checks semantic marks,
requested heading levels, retained text styles, paragraph alignment/line spacing,
lists, task lists with their checked state and table structure. Missing or
unconfirmed formatting support produces a `destination-formatting-unconfirmed`
warning. A task list, such as an own copy of a to-do list or a Google Docs
checklist, asks for task lists: an editor without them parses it as a bullet
list, which loses each item's checked state, so it is reported. A pasted
heading whose level the editor cannot represent stays a heading: it moves to the
nearest supported level of equal or lower importance, otherwise to the deepest
supported level, so a
heading is never promoted while a deeper level exists and the outline keeps its
order. With the default levels 1 to 4, `h5` and `h6` become `h4`; with levels 2
and 3, `h1` becomes `h2`. A moved heading keeps its alignment and the other
attributes a heading of its new level keeps, and each one is reported with a
`destination-heading-level-adapted` warning at its source offset. It becomes a
paragraph, with `destination-formatting-unconfirmed`, only when the editor
confirms no heading level at all, for example without a heading node. A heading
where the editor cannot place one, at the start of a list or task item, in a
details summary or in a preformatted block, keeps its tag and has no warning:
the editor parses every heading tag there as that block's text. Text or a
paragraph element before it in the item, even an empty one, lets it stand, and
so does an editor whose schema lacks that block or lets it start with a
heading, which PasteCleanup asks the editor's schema. Table
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
for the paragraph's level. It is read without the spacing around it: Word right
aligns a level, as the third level of its numbering library, by padding the label
with a spacer run of 7 pt no-break spaces that fills the indent before it. The
label may hold at most 64 characters other than that spacing, and the marker at
most 2,048 UTF-16 units of text with it: Word writes about one no-break space per
point of the label's position, so about 1,600 at the widest indent it allows
(22 inches):

| Word level definition | Visible marker | Marker class |
| --- | --- | --- |
| Decimal, level text absent, `%N.` or `%N)` | `1.` to `10000.` with the same punctuation | `decimal` |
| `alpha-lower` or `alpha-upper`, same level text rule | one letter of that case | `lower-alpha` or `upper-alpha` |
| `roman-lower` or `roman-upper`, same level text rule | a canonical numeral up to 3999 of that case | `lower-roman` or `upper-roman` |
| Bullet `\F0B7` in Symbol | `·` or U+F0B7 in a Symbol marker run | `disc` |
| Bullet `o` in Courier New, as `font-family` or, without one, the ASCII font Word names per script | `o` in a Courier New marker run | `circle` |
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
only the levels that pasted paragraphs reference and the levels above them, bounds
each rule body to 8,192 UTF-16 units, 64 declarations and 64 units of level text,
and resolves no other CSS.

A selection that starts in a nested item has no parent levels. They open from
their level definitions with one empty item each, so the item keeps its depth and
marker; an ordered level starts one before the number of its next item in the
run, which then continues it. Without a supported definition for every missing
level the item stays literal. An item more than one level below the previous one
later in a run stays literal too, with its visible marker and
`office-list-unsupported`: an empty item would show a marker Word does not.

Fallback is per item. An unsupported item, or one whose missing parent levels
have no supported definition, stays a literal paragraph with its visible marker:
inside the nearest open list item when the destination can nest lists, otherwise
at the list's own level, which closes the open lists. Deeper items under a
literal item have no list parent and stay literal until the level returns to a
supported parent. A picture bullet, which Word writes as an image inside the
marker, is the marker's decoration and never an image of the paste: a literal
item keeps its alt text as the visible marker, and it is neither removed with
`image-removed` nor offered to image preparation. Each
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
values and supported HTML `type` attributes are accepted. A `list-style-type`
declared on list items moves to their list when every direct item agrees, an item
without one counting as its list's marker. Items that disagree, declare a marker
their list kind cannot hold, have an HTML `type` of their own without a marker, or
carry a style that CSS may read otherwise than a split on semicolons (a comment, an
escape, `!important`, or a string or bracket holding a semicolon), and lists that
hold elements other than items and nested lists, keep the markers on the items,
which still report `unsupported-formatting`. This covers the
shape Google Docs writes, the marker on each item and a nested list directly in
its parent list, which its Chrome captures confirm. Core stores an explicit
marker in `listStyleType`; `null` keeps the destination theme's depth-based defaults.
Slice context follows the same restrictions. Task lists do not gain this
attribute. Lists with different explicit markers stay separate during paste and
list editing. A pasted list with an explicit marker, such as one whose item markers
moved to it or a reconstructed Office list, also stays separate from a destination
list without one: pasting it inside such a list splits that list around it, and in
a numbered list the items after the paste number from 1 again.

A list whose content starts with a nested list, before any item, as a partial
Google Docs selection that starts in a nested item is expected to write it, gets a
new first item that holds the nested list. ProseMirror's parse moves a nested list
written after an item into that item, but one written first closes the outer list
there, and the items after it would paste as a separate list, a bulleted one even
when the outer list was numbered. This shape is checked against authored HTML; a
task list that starts with a list is left as written. Google Docs' Chrome
captures write such a selection otherwise, as the next section describes.

A list item whose content starts with a nested list, such as that new first item,
an item after a paragraph, a later item or one in a details body, gets an empty
paragraph first, the label a Domternal list or task item starts with. ProseMirror's
parse cannot open such an item on its nested list: it closed the item empty, and the
nested list and the later items pasted as lists of their own, bulleted even when the
list was numbered. With the label the nested list stays in its item under an empty
label, with or without SmartPaste, and also over the whole document. The items on
the open start of HTML with a `data-pm-slice` marker, as many levels down as the
marker's open start counts, are left as written: a copy that starts in a nested item
cut their labels, and the marker's open depths count the levels without them, so a
copy that starts two or more levels deep still joins its first line to the paragraph
at the caret, as without PasteCleanup. Domternal's own copies paste as written. Into a
paragraph with text, ProseMirror's own paste still puts the nested list in a list of
its own before the other items, which keep the outer list's kind, and over the whole
document it can drop a quote around the list. Without PasteCleanup such an item
still pastes as an empty item and separate lists.

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

### Google Docs copies

A copy whose source detection names Google Docs, by the wrapper whose id begins
`docs-internal-guid-`, is read in the shapes Google Docs web writes to the
clipboard in Chrome, which reviewed native captures show:

- Docs writes a block's line spacing as a CSS line height of 1.2 times the
  spacing Docs shows: its default 1.15 is 1.38 on every paragraph, heading and
  list item, single, a table cell's default, 1.2, and 1.5 `1.7999999999999998`.
  The spacing is read back, as LineHeight stores and draws it, and the defaults
  of text and of table cells are dropped as the document's own, so a routine copy
  raises no `destination-formatting-unconfirmed` in a destination without
  LineHeight; another spacing, as 1.5, is kept or reported.
- Black on every run is Docs' default text color, which its export names no run
  with, so no run keeps it and pasted text follows the editor's theme. Every
  other color stays, Heading 3's gray and the link blue among them.
- Each line break Docs writes between blocks, for an empty paragraph, before a
  table, between two lists or after a final table, becomes the empty paragraph it
  stands for, where the editor would make one paragraph of two lines of two of
  them. A break inside a paragraph or beside inline content stays a line break.
- A paragraph that holds only images becomes a division, so an editor whose
  images are blocks no longer closes an empty paragraph above each image. Docs
  aligns an image by its paragraph: one centered or aligned to the end gives its
  images that alignment, their `data-align`, which Image draws, where the
  policy keeps text alignment (`preserve`, or `adapt` with
  `preserveTextAlignment`). When every image it held is removed, it stays the
  paragraph it was, its alt text aligned as the image was.
- A selection that starts below a list's first level writes each item's
  `aria-level` and a 36 pt margin for each level above the copy. When every item
  of a list stands the same number of levels below its depth in the copy, with
  exactly that margin, the list is nested as deep as Docs shows it, each level
  above opening with one empty item of the list's kind, and the margin goes.
- A list whose every item is an ARIA checkbox with its checked state, Docs'
  checklist, becomes a task list checked as Docs shows it, without the pictures
  of the boxes Docs draws beside the items. Docs also strikes a checked item
  through, on the item and every run of its text: that line shows the checked
  state, which the task item holds, so it goes, and the text is not left struck
  once the item is unchecked. A line on part of a checked item's text or on an
  unchecked item is the author's and stays. An editor without task lists pastes
  the checklist as bullets, which keep a checked item's line as the only sign of
  its state, and reports `destination-formatting-unconfirmed`, since the
  checked state is lost.
- A size relative to its run on a subscript or superscript, as Docs draws a
  script at 0.6em, is the script mark's own, so the run keeps its size and the
  script is not made smaller twice. This holds for every source.
- A size or line height written with floating point noise, as Docs writes 14 pt
  as `13.999999999999998pt`, is read as the value it stands for, in every source.
- Docs aligns every table cell to the top, which is where the table draws every
  cell, so no pasted cell stores a vertical alignment; a cell aligned to the
  middle or the bottom keeps it. This holds for every source.
- Docs writes `white-space: pre-wrap` on every run. A span left with only that
  style became a text style mark that stores no value on each pasted run. A
  block whose every text stands under one such value now holds it, where a
  text needs it, and a run whose text reads alike without it, with no run of
  spaces, space at its edge, tab or line break, drops it; a span left without
  attributes is unwrapped. Runs outside any block, as Docs writes a selection
  inside one paragraph, are read together as the paragraph the editor gathers
  them into, so a space at the edge of a run between two words needs no white
  space either. Every space stays where it was, and no run carries an empty
  text style, except a run whose space starts or ends such a copy or meets
  other white space, which needs it. This holds for every source.
- The bold of normal weight Docs wraps a copy in has an id Docs makes for each
  copy, which names the source and nothing of the content. Once the copy is read
  the wrapper goes and its content stands in its place, so the cleaned HTML holds
  no id of the copy; a wrapper that declares more than its normal weight stays,
  without the id. The break Chrome ends the copy with after the wrapper goes too.

Docs writes every image as a `data:image/png` URL with its alt text and size, so
it is kept as an embedded image. In the editor, an image the destination cannot
hold, a data URL that its Image refuses (`allowBase64: false`) or any image when
the destination has no image node, is removed with `image-removed` and its alt
text in its place, from every source; before, it kept a broken picture or was
lost without a finding.

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

The file limits apply to the files a paste uses. Files count in clipboard order:
a file over `maxFileBytes`, one that would take the files before it past
`maxTotalFileBytes`, and every clipboard item after the first 256 are left out
unread, and the paste goes ahead while no binding uses them, so a large unrelated
attachment does not block a text paste. A binding to a left-out item rejects the
paste with `asset-limit`, under `unresolved: 'omit'` too. So does an image-only
paste that holds a left-out image file or more than 256 items, since it pastes
every image file. In `match`, a left-out file has `available: false` with its type
and size, and the items after the first 256 are not listed.

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

The resolver ownership protocol is experimental and may change in a minor release:
`ClipboardResolvedImageAssetOptions`, `ClipboardResolverAdapter` and its request,
result, release, diagnostic and recovery types, `ClipboardCreatedResource` and
`ClipboardAssetRecoveryReport` carry `@experimental`. The diagnostic code and
recovery reason lists are open, as is `PasteSource`: keep a default branch when
you switch on them.

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
table spans, individual raster dimensions/pixels, and GIF frames. A `colspan` or
`rowspan` reads as a browser and the Table extension read it, the whole number it
starts with and 1 when it is missing, invalid or zero, and only a span above
1,000 rejects the paste with `structure-limit`. A lexical work
guard runs before parse5, including conservative checks in comments/raw text.
Generated inherited-style attributes share the input-length ceiling, preventing
a long source value from multiplying across many text or hard-break leaves without
a bound. Every generated mark and typography wrapper consumes the shared node and
depth allowance before it is allocated.
HTML/structure rejection inserts nothing; removed images, links and unsupported
formatting are reported without discarding unrelated text.

Plain text and Markdown have a conservative markup-token budget, checked before
the Markdown, link and image handlers can expand them. Outside a code block,
every line break and every `*`, `_`, `~`, `` ` ``, `[`, `]`, `<` and `>` counts as
one token, a Windows line ending as two, and more than `maxNodes` tokens (30,000
by default) reject the paste with `input-limit`. The plain-text flavor of a rich
paste is counted as well, so a log, a CSV or spreadsheet export or another copy
whose plain text runs past about 30,000 lines, or 15,000 with Windows line
endings, is refused even when its HTML alone would fit. In a code block only the
input length ceiling applies.
The clipboard flavors the editor reads, `text/html` and `text/plain` (also as
`Text`), are checked against the input ceiling before parsing, so one oversized
flavor rejects the whole paste with `input-limit`. Flavors PasteCleanup never reads,
such as `text/rtf`, `application/rtf` and `text/uri-list`, are not checked and do
not reject a paste, however large. ProseMirror falls back to `text/uri-list` only
when the clipboard has no plain text, and the text it makes of it then goes through
the plain-text checks.

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

Cleanup runs synchronously inside the paste event. A paired measurement of
synthetic 20 KiB rich, Word and Office list pastes on one machine, recorded under
`e2e/paste-performance/results/2026-10-01-macos-arm64.md`, found a 95th percentile
of 4 to 9 ms added per paste in Chromium and WebKit and 11 to 31 ms in Firefox.
With `imageAssets` the median grows by about 2 to 9 ms, because the asset
coordinator currently normalizes a paste without images twice. Firefox can also run
its cycle collector, which frees unreachable DOM objects, synchronously inside a
paste; that paste then takes several hundred milliseconds longer (up to 873 ms in
that measurement, with about 0.7 percent of pastes taking 100 ms or more). Pastes
without PasteCleanup stall the same way, but less often: a cleaned paste allocates
more, and in that measurement a paste took 100 ms or more 1.8 times as often with
PasteCleanup, and 9 times as often with `imageAssets`. The collection is the
engine's work, and a page cannot postpone it. These figures are measurements, not
latency bounds.

## Trusted Types

The normalizer parses HTML without the DOM, so cleanup itself needs no Trusted
Types policy. To learn what the destination editor supports, PasteCleanup parses a
few constant HTML probes, never clipboard content, with the editor's own parse
rules, and assigns them to `innerHTML` without a policy of its own. On a page that
enforces Trusted Types (`require-trusted-types-for 'script'`), a default policy
that passes these probes leaves PasteCleanup unchanged. Without one, every probe
fails and PasteCleanup fails closed. In Chromium and WebKit, which enforce the
directive, tables are then refused with `destination-table-unsupported` and the
`unsupported-content` reason, links lose their target with `link-removed` and
keep their text, Office lists keep their literal markers with
`office-list-unsupported`, and pasted formatting, headings and lists reach the
document with a `destination-formatting-unconfirmed` warning, so the notice asks
the user to review the paste. Nothing unsafe is inserted.

## Current verification limits

Synthetic fixtures test deterministic contracts and hostile input. They are not
clipboard captures from a native Office application. Native Word, Google Docs,
LibreOffice and real operating-system clipboard evidence are separate release
requirements. This package has localized loss notices and optional host-owned
feedback and optional image-preparation progress. It has no built-in preview or
paste-choice dialog. Local image association still requires an explicit host
mapping for mixed HTML; these fixtures do not prove native Office association.
The repository's `e2e/native-office-capture` tooling holds reviewed native
captures for four paths, Word 16.113.3 for Mac to Safari 26.5.2, to Chrome 154
and to Firefox 155, and Google Docs web to Chrome 153: their routine envelope,
text and inline formatting, alignment, spacing, indentation, hidden text, empty
paragraph, list and table scenarios, and for Google Docs its links, checklists
and data images, replayed in the real editor in three engines, qualify those
paths with the limits their support matrix lists. They are synthetic events with the
captured items, not native pastes into the editor. Chrome and Firefox deliver
Word's raw HTML, whose class rules cleanup does not resolve, so `preserve` keeps
the formatting Word writes inline: fonts, sizes and colors applied to words, the
highlight, alignment, line spacing other than the Normal style's and cell
shading, without the Normal and heading styles' fonts, sizes and colors. Safari
writes computed styles inline, so the same copy keeps more typography there,
though its list paragraphs carry their fonts only in Word's class rules too, so
list items paste in the editor's font. Word for Mac exposes its pictures as
local `file:` URLs in Chrome and Firefox and page-local `blob:` URLs in Safari;
neither is fetched or bound, and a picture bullet stays its marker. Chrome adds
one `image/png` file, Word's picture of the whole selection, which is never
inserted when the content has text of its own or, as a Word copy, places no
image; Firefox and Safari expose no files. Chrome and Firefox also expose
`text/rtf`, which PasteCleanup never reads. Hidden Word text never pastes: in
Chrome and Firefox it is left out with `hidden-text-removed`, which the notice
names, and Safari leaves it out of the copy without a trace a notice could name.
The first paragraph of a copy joins the paragraph it is pasted into, as
ProseMirror joins an open slice, and takes that paragraph's alignment and line
spacing, also when it is empty, without a notice; the blocks after it and a
heading keep their own. A
`background-color` on a paragraph or heading has no place in the editor and is
dropped without a notice, while the `background` shorthand Word writes for
paragraph shading is reported. Large selections, own copies, images and every
other source path are not qualified against native clipboard data.
The current Core color parser does not retain alpha in RGBA text colors or
partially transparent backgrounds. Exact transparency fidelity is not promised.
