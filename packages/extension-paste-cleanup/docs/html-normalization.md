# HTML normalization and formatting

Use this reference to choose formatting policy, interpret normalized output and understand destination fallbacks. See also [lists](https://github.com/domternal/domternal/blob/main/packages/extension-paste-cleanup/docs/lists.md), [images](https://github.com/domternal/domternal/blob/main/packages/extension-paste-cleanup/docs/images.md) and [limits and security](https://github.com/domternal/domternal/blob/main/packages/extension-paste-cleanup/docs/limits-and-security.md).

## Standalone API

```ts
import { normalizePasteHTML } from '@domternal/extension-paste-cleanup/html';

const clipboardHTML = '<p><a href="/guide">Read the guide</a></p>';
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
- `source`: an advisory signature, never proof of origin or trust. It is read from the copy's
  markup as the HTML parser reads it: `word` from Office's namespace declarations, `MsoNormal`
  classes, also with a mail client's prefix such as `gmail-MsoNormal`, `mso-*` declarations and
  stylesheet rules, `google-docs` from the wrapper whose id is `docs-internal-guid-` and a GUID's
  hex digits and hyphens, `libreoffice` from a `generator` meta that names LibreOffice or
  OpenOffice, each also inside Office's conditional comments, and Word first. Text never counts,
  nor a title, alt text, link, other attribute or comment that names them, so a page about
  Office HTML is cleaned as `html`. A style attribute counts as written, its CSS comments and
  strings included, and a stylesheet without its comments. Markup the parser drops, such as the
  attributes of a `body` tag, does not count either, and a paste the limits refuse reports what
  its markup named up to where the parse stopped.
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
custom node attributes and slice contexts are not implicitly trusted. The data attributes of Domternal's own inline nodes are kept up to 4,096 characters each:
a mention's id, label and type (`data-mention-type`, the trigger that made it,
so a `#` tag mention stays a tag), an emoji's name and character, and a math
node's source. The standalone entry has no own-copy verifier, so it treats every fragment,
including one with a `data-pm-slice` marker, as external content.

## Preserve formatting

`preserve` retains supported semantic tags and allowlisted inline typography,
alignment, table spans, dimensions and list starts. Inline bold, italic,
underline, strike, subscript and superscript styles become semantic marks where
the wrapper permits them. It does not reproduce page layout or arbitrary CSS.
Inherited inline font family, size, color, bold and italic resolve through source
wrappers, including descendant bold/italic resets. Relative `em` and `%` font
sizes resolve only when the source provides a known absolute base. Inline text
decoration and highlight retain supported source semantics; a block or cell fill
does not become text highlighting. Apart from [Word list level definitions](https://github.com/domternal/domternal/blob/main/packages/extension-paste-cleanup/docs/lists.md#office-list-reconstruction), stylesheet rules, CSS variables, the browser's computed
styles and arbitrary CSS inheritance are not resolved. The destination
schema determines which retained styles become document attributes.

Supported inline marks and effective typography are materialized around both text
and hard breaks, including break-only runs. The original `<br>` remains a void
element; paragraph alignment and line height stay on the paragraph. This also
preserves direct break styles and supported descendant resets without applying
them to following siblings. It does not establish identical line-box geometry in
every browser or destination schema.

## Adapt formatting

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

## Breaks, spaces and table fragments

The standalone normalizer and ordinary document parsing retain a final bare
`<br>`. ProseMirror's clipboard parser treats a final bare `<br>` directly inside
a block as a placeholder and can remove it. Breaks inside retained inline wrappers
are distinct from that case. Cleanup does not override this clipboard rule, so
preserving every unwrapped trailing break during paste is not guaranteed. The
break a browser ends a copy of a page with, `<br class="Apple-interchange-newline">`
after the copied content, as Chrome ends its Google Docs copies, marks where the
selection ended and is no line of it: the editor's paste ignores it, and cleanup leaves it out for every source.

Inline content after a top-level block, including content inside a wrapper that
holds blocks, gets a `<div>` wrapper when it contains a whitespace-only text node
between words. This keeps the space during clipboard parsing. Inline images stay
in the paragraph; block images separate the preceding and following text into
paragraphs without an extra empty paragraph. The wrapper consumes `maxNodes` and
`maxDepth`; exceeding either rejects the fragment with `structure-limit`.
Content before the first block stays as written and can join the paragraph at
the caret.

Table parts that start the pasted HTML without a table around them, such as
bare rows, bare cells, or rows after a caption or column group, are parsed
again as a table's content and put in a table, as a browser and ProseMirror's
own clipboard parse read them. Their cells stay cells instead of running
together, and they paste into a paragraph or cell by cell into a table. In an editor without tables they paste
their texts instead of being refused as a table. The table counts toward
`maxTableCells`, `maxNodes` and `maxDepth`. Content after the parts, such as a
paragraph, stays after the table, instead of being dropped by clipboard parsing.
Table parts after other content are left as the HTML parser reads them.

## Destination checks

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
the editor parses every heading tag there as that block's text, without the
heading's alignment, which no warning reports either. Content before
it in the item, such as text, a line break, an image, a horizontal rule or a
paragraph element, even an empty one, lets it stand, and
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

## Routine clipboard wrappers

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

## Inline CSS and neutral declarations

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
`!important` in either style), as can occur around copied images. Nonzero horizontal indentation outside lists
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

## Hidden Word text

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

## Word and Safari typography

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
Word's Title style becomes a level 1 heading, including when the Title runs over several paragraphs, which Word writes with the
`MsoTitleCxSpFirst`, `MsoTitleCxSpMiddle` and `MsoTitleCxSpLast` classes: each
paragraph is its own level 1 heading. A Subtitle stays a paragraph.

## Google Docs formatting

A copy whose source detection names Google Docs, by the wrapper whose id is
`docs-internal-guid-` and a GUID's hex digits and hyphens, uses the following source-specific normalization rules. Native application and
browser boundaries are recorded in the [support matrix](https://github.com/domternal/domternal/blob/main/e2e/native-office-capture/SUPPORT-MATRIX.md):

- Docs writes a block's line spacing as a CSS line height of 1.2 times the
  spacing Docs shows: its default 1.15 is 1.38 on every paragraph, heading and
  list item, single, a table cell's default, 1.2, and 1.5 `1.7999999999999998`.
  The spacing is read back, as LineHeight stores and draws it, and the defaults
  of text and of table cells are dropped as the document's own, so a routine copy raises no `destination-formatting-unconfirmed` in a destination without
  LineHeight; another spacing, as 1.5, is kept or reported. A spacing outside
  the values the destination's LineHeight draws, by default 1, 1.15, 1.25, 1.5
  and 2, such as Docs' 1.3, is kept in the document without being drawn or
  reported, a limit of this release.
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
  exactly that margin, its items are nested as deep as Docs shows them, each
  level above opening with one empty item of the list's kind, which Docs does
  not show, as for a Word selection, and the margin goes.
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
- Docs writes `white-space: pre-wrap` on every run. A block whose text all uses that value holds it when needed, and a run whose text reads alike without it, with no run of
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

## Same-page copies and slice context

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
editor; [Clipboard ownership](https://github.com/domternal/domternal/blob/main/packages/extension-paste-cleanup/docs/clipboard-integration.md#clipboard-ownership) describes a conflict.

## Source-specific limits

Word HTML from Chrome and Firefox keeps class-based formatting that general cleanup does not resolve. Preserve mode retains supported inline formatting, without reconstructing the Normal and heading styles' fonts, sizes and colors. Safari writes more computed typography inline, although its Word list fonts also remain in class rules.

The first open paragraph joins the destination paragraph and takes its alignment and line spacing, including in an empty paragraph, without a notice. Later blocks and headings keep their own. A paragraph or heading `background-color` has no destination attribute and is dropped without a notice; unsupported `background` shorthand is reported. Core does not retain alpha in RGBA text colors or partially transparent backgrounds.

These rules do not qualify every application or clipboard path. The [support matrix](https://github.com/domternal/domternal/blob/main/e2e/native-office-capture/SUPPORT-MATRIX.md) records tested versions, provenance and remaining source limits.
