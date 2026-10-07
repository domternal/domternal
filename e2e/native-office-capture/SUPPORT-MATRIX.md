# Free paste evidence and support matrix

> History rewrite context: the original dates, versions, findings and results
> below describe this revision's archived baseline. Where fixture content has
> been translated, the committed artifacts are authored English regression
> variants, not new native Office captures. Original native evidence remains
> unchanged in the owner's private baseline bundle. A variant's `derivation`
> references that baseline's source, capture and manifest hashes; its own hashes
> identify the edited bytes. Word Chrome screenshot alternatives become
> synthetic PNG controls. Historical qualification remains limited to the
> original reviewed paths; no old result is a test of translated bytes. The
> later synthetic variants preserve regression intent and make no fresh native
> qualification claim. Future native admission still needs an actual capture.


Matrix version: `free-paste-evidence-v6`. Recorded on 2026-10-05 for the
unreleased paste cleanup work; it replaces `free-paste-evidence-v5` of the same
day and qualifies Google Docs web on macOS to Google Chrome with twenty-eight
reviewed native fixtures, from the owner's captures of 2026-10-05, and records
the cleanup changes those captures required (see
[Google Docs on macOS to Chrome](#google-docs-on-macos-to-chrome)). Google Docs
in Safari and Firefox, and its large image, slow copy, 50 and 51 image, mixed
and large document scenarios, are a later release and stay pending.
Version 5 replaced `free-paste-evidence-v4` of 2026-10-04,
which qualified Word for Mac to Chrome and to Firefox with nineteen reviewed
native fixtures each, from the owner's captures of 2026-10-04, next to the
nineteen Safari fixtures of `free-paste-evidence-v3`, replaced the ten Safari
list and table fixtures with captures of documents recreated with Word's own
list libraries, and recorded the cleanup changes those captures required, the
declared redactions they carry and the decisions that waited on them. Version 5
records two decisions of the owner of 2026-10-05: Word's hidden text is no
longer pasted but left out with a warning of its own, `hidden-text-removed`,
which the Chrome and Firefox hidden text fixtures now pin, and Chrome's
pictures of the selection no longer name the display they were drawn on, by a
declared clipboard file redaction. Every row other than these four stays
unqualified.
This is an evidence inventory, not a fidelity score or a release approval. The
[package contract](../../packages/extension-paste-cleanup/README.md) defines
current behavior and its limits.

## Evidence levels

| Label | What it establishes | What it does not establish |
| --- | --- | --- |
| Authored synthetic input | Reproducible behavior for fixed, independently described inputs in unit or browser tests. | Native Office clipboard availability or source application fidelity. |
| Stored native claim | A complete bundle claims a trusted event and records operator metadata. Its stored bytes match a reviewed manifest. | Authenticity of saved JSON, source application identity, completeness of OS formats or correct image association. |
| Reviewed native fixture | A separately documented source, copy action, exact application/OS/browser versions, capture and independently checked expected result have been reviewed together. | Other versions, platforms, clipboard managers or remote desktop paths. |

This directory holds **eighty-five reviewed native fixtures for four rows**:
Word 16.113.3 for Mac to Safari 26.5.2, to Chrome 154 and to Firefox 155 on
macOS 26.5.2, and Google Docs web to Chrome 153 on macOS 26.5.2 (see
[Native source matrix](#native-source-matrix)). The offline
validator still returns `qualification: false` and `nativeEvidenceAuthenticated: false` for each,
since saved JSON cannot authenticate its origin; the qualification is this
matrix's reviewed statement, bounded by the limits it lists. Editing a bundle and its manifest can produce matching hashes. Hashes
detect disagreement with a reviewed manifest; they are not signatures or proof of
capture origin. Source detection such as `source: word` is an HTML heuristic that reads the copy's markup, never its text.

## Implemented behavior and its current evidence

The links below point to executable contracts. They do not imply that a test was
rerun every time this matrix is read. Browser inputs are synthetic unless a test
explicitly says otherwise. Chromium's native editor-copy case copies from
Domternal, not from Office.

| Area | Current bounded behavior | Evidence | Remaining qualification or limit |
| --- | --- | --- | --- |
| HTML safety and formatting | Shared resource-free normalizer, preserve/adapt policies, supported inline/inherited styles and bounded loss diagnostics. Routine clipboard envelope elements, Office wrappers and Office private, neutral or destination-owned declarations are removed without a warning, including the computed declarations Safari writes on every element it copies; a text color equal to Safari's copied caret color is Word's automatic color in a Word copy, and from another source the page's default color only when neutral, so a colored web container keeps its color. | [Normalizer tests](../../packages/extension-paste-cleanup/src/html/), [Safari Word tests](../../packages/extension-paste-cleanup/src/html/safariWord.test.ts), [browser contracts](../paste-cleanup.browser.ts), [feedback contracts](../paste-feedback.browser.ts), [native fixture regressions](../paste-native-fixtures.browser.ts) | General stylesheet cascade, all Office-specific markup and exact RGBA transparency are not promised. Native Word for Mac envelopes stay quiet in Safari, Chrome and Firefox, and Google Docs envelopes in Chrome (reviewed fixtures): Docs' default spacing, written 1.38 on every block and 1.2 in table cells, and its default black on every run are the document's own. Word's hidden text, an element both CSS and Word hide (`display: none` with `mso-hide: all`, in its style or a simple class rule of the copy's stylesheet), is left out with `hidden-text-removed`; either declaration alone, Word's web hidden text (`mso-hide: screen`) and other sources' hidden elements keep their text with `unsupported-formatting`. Word's raw HTML in Chrome and Firefox keeps its formatting in class rules, which cleanup does not resolve: `preserve` keeps what Word writes inline. |
| Own copies and ProseMirror slices | A `data-pm-slice` marker is structural context. Only a same-page PasteCleanup copy marker keeps editor formatting; nested or duplicate markers are removed. | [Slice origin tests](../../packages/extension-paste-cleanup/src/html/sliceOrigin.test.ts), [own copy tests](../../packages/extension-paste-cleanup/src/PasteCleanup.ownCopy.test.ts), [list marker contracts](../paste-list-markers.browser.ts) | Copies across tabs, applications or separate package instances are external by design. |
| Office-shaped lists | Explicit inline list metadata reconstructs bounded lists. Word level definitions from the clipboard stylesheet, a level font named per script among them, and the marker run font identify default bullets (disc, circle, square) and decimal, alphabetic and Roman numbering; without definitions only decimal numbers and Unicode bullets are admitted. A marker's label is read without the spacer runs Word pads it with, so a right aligned level, as the third level of Word's numbering library, keeps its list. A selection that starts in a nested item opens the levels above it from their definitions, each with one empty item; a level skipped later in a run stays literal. An unsupported item stays a literal paragraph while the rest of its run is reconstructed; a picture bullet stays its marker, never an image. | [List tests](../../packages/extension-paste-cleanup/src/html/officeLists.test.ts), [level definition tests](../../packages/extension-paste-cleanup/src/html/officeListStyles.test.ts), [Safari Word list tests](../../packages/extension-paste-cleanup/src/html/safariWordLists.test.ts), [list marker contracts](../paste-list-markers.browser.ts), [native fixture regressions](../paste-native-fixtures.browser.ts) | Native list profiles are qualified for Word for Mac in Safari, Chrome and Firefox, from a document whose lists come from Word's own libraries; named list definitions from templates are covered by unit tests of the earlier Safari captures. Legal multilevel numbering below its first level, prefixed or custom level text, picture and symbol bullets other than the Word defaults, and letters past z stay literal; `1)` and `a)` keep their marker class, not their parenthesis. |
| Destination capabilities | Resource-free probes inspect the actual destination schema. Unrepresentable table structure blocks insertion; supported formatting demands receive bounded diagnostics. | [Capability tests](../../packages/extension-paste-cleanup/src/destinationCapabilities.test.ts), [browser contracts](../paste-destination.browser.ts) | A successful probe is not exact source-style fidelity or support for every custom node. |
| Local embedded images | Explicit host bindings connect rich HTML references to exposed items. Validated inline raster URLs retain their own placements, as Google Docs writes every image; one the destination cannot hold, a data URL its Image refuses or any image without Image, is removed with `image-removed`, its alt text in its place. A clipboard image file is the paste only when the content has no text of its own and, for a Word or Excel copy, places an image: Chrome's picture of a Word selection is never inserted, read or bound. | [Asset browser contracts](../paste-assets.browser.ts), [resolver browser contracts](../paste-resolver.browser.ts), [image file contracts](../paste-image-files.browser.ts), [native fixture regressions](../paste-native-fixtures.browser.ts) | No automatic general CID, filename, position or byte-similarity association. No remote source fetching. Word's `file:` image URLs in Chrome and Firefox and `blob:` URLs in Safari are never fetched or bound. |
| Persistent images | Host resolver, exact allowed origins, source data-image transport, resource ownership and recovery notifications. | [Resolver contracts](../paste-resolver.browser.ts), [private lifecycle tests](../../packages/extension-paste-cleanup/src/clipboard/resolverLifecycle.test.ts) | Mock adapters do not certify a production storage service or prove that aborted remote work stopped. |
| Receipt, cancellation and history | Accepted-operation receipts, target revalidation, deferred image cancellation, history boundaries and four framework integrations. | [Feedback browser contracts](../paste-feedback.browser.ts), [asset browser contracts](../paste-assets.browser.ts) | No built-in import preview or paste-choice dialog. Host callbacks and feedback are explicit integration seams. |
| Existing comment anchors | Actual Free paste and Pro Comments share real editor parsing, copy/cut rules, image replay and history. | Cross-repository gate in the Domternal Pro repository (`tests/paste-comments`), which is not public | This does not import Word discussions or qualify Yjs document collaboration. |
| Performance | Recorded paired local runs cover synchronous synthetic input and default feedback, with and without `imageAssets`. | [Reference report](../paste-performance/results/2026-10-01-macos-arm64.md), [earlier report](../paste-performance/results/2026-09-26-macos-arm64.md) | One machine and fixed inputs only. Observed paired p95 was 4.0 to 31.0 ms, 6.0 to 31.0 ms with `imageAssets`. Known limit: in Firefox, the engine's cycle collector can run inside a paste and add several hundred milliseconds to it (up to 873 ms observed, about 0.7 percent of enabled dispatches at 100 ms or more); the routes without PasteCleanup show it too, but less often, since cleanup allocates more per paste: enabled dispatches reached 100 ms 1.8 times as often as those without PasteCleanup, and 9 times as often with `imageAssets`. No universal latency bound. |
| Large pastes | Seven synthetic profiles swept to their largest accepted size; every larger input is rejected explicitly with nothing inserted, never truncated. | [Large paste report](../paste-performance/results/2026-09-28-large-macos-arm64.md) | Synthetic profiles on one machine. The parser allocation bound stops most Word profiles below the D4 target of 10,000 words. A Word RTF flavor of any size does not reject a paste: PasteCleanup never reads it. Chrome and Firefox expose one of 38,484 to 57,215 bytes, 0.91 to 1.10 times the HTML, with every captured Word copy, and every one of them pasted. |
| Offline capture integrity | Versioned complete bundle schema, bounded artifacts, checksums, provenance claims, declared redactions and replay through public Free `/html`: exact HTML for version 1 manifests, a reviewed semantic oracle for the version 2 manifests of claimed native fixtures. | [Offline tests](./offline.test.mjs), [redaction tests](./redaction.test.mjs), [synthetic manifest](./fixtures/synthetic-v1/manifest.json) | No native acquisition, resource matching or automatic qualification. A redaction's original is never read, and no hash of one is recorded. |

## Native source matrix

Application, operating system and browser versions are the ones recorded with
each capture, not inferred from installed software. The
[capture scenarios](./README.md#initial-scenarios-and-source-matrix) include
image cases that no row has qualified yet. OD-01 decides which rows the first
release advertises: the macOS rows below; every other source is unqualified.

| Source | Platform and path | Reviewed native fixtures | Status |
| --- | --- | --- | --- |
| Word desktop | Microsoft Word 16.113.3 (16.113.26092714) for Mac to Safari 26.5.2 (21624.2.5.11.8), macOS 26.5.2 (25F84) | Nineteen: `fixtures/word-*-safari`, every `word-*` [scenario](./content/word-mac-v1.json) except `word-large-document`, `word-headings-styles` as its three selections; the ten list and table fixtures from the 2026-10-04 recapture | **Qualified** for the text, heading, inline formatting, alignment, spacing, indentation, hidden text, empty paragraph, list and table scenarios, with the limits below. The large document and `domternal-own-copy` are not captured. |
| Word desktop | Microsoft Word 16.113.3 (16.113.26092714) for Mac to Google Chrome 154.0.8037.93, macOS 26.5.2 (25F84) | Nineteen: `fixtures/word-*-chrome`, the same scenarios | **Qualified** for the same scenarios, with the limits below. The large document and `domternal-own-copy` are not captured. |
| Word desktop | Microsoft Word 16.113.3 (16.113.26092714) for Mac to Mozilla Firefox 155.0.1 (BuildID 20260903215306), macOS 26.5.2 (25F84) | Nineteen: `fixtures/word-*-firefox`, the same scenarios | **Qualified** for the same scenarios, with the limits below. The large document and `domternal-own-copy` are not captured. |
| Google Docs | Google Docs web (2026-10-05, personal account, Pages format) to Google Chrome 153.0.8010.47 (Official Build) (arm64) as the operator recorded it, macOS 26.5.2 (25F84) | Twenty-eight: `fixtures/gdocs-*-chrome`, every `gdocs-*` [scenario](./content/google-docs-v1.json) of the basics, lists, tables and images documents except `gdocs-image-limit-50` and `gdocs-image-limit-51` | **Qualified** for the text, heading, inline formatting, link, alignment, spacing, indentation, empty paragraph, list, checklist, table and image scenarios, with the limits below. |
| Google Docs | Google Docs web on macOS to Safari and Firefox; the large image, slow copy, 50 and 51 image, mixed and large document scenarios in every browser | None | Pending, a later release: the [content specification](./content/google-docs-v1.json), generated images and the [runbook](./GOOGLE-DOCS-RUNBOOK.md) are prepared. |
| Word desktop | Windows to Chrome, Edge and Firefox | None | Unqualified; not inferred from the macOS rows. |
| Word web | Each source browser to each destination | None | Unqualified; separate from desktop Word. |
| LibreOffice Writer | Desktop application, exact OS and browser pair | None | Unqualified; not inferred from LibreOfficeKit behavior. |
| Collabora/LibreOfficeKit | Web application and browser | None | Unqualified optional source profile. |

### Word for Mac to Safari

Each fixture holds the owner's capture, the source document it was copied from,
a declared redaction where one was needed, a capture summary and a version 2
manifest whose oracle is authored from the content specification and the
reviewed editor results. `offline.mjs` replays every capture through public
`/html`, and the [native fixture regressions](../paste-native-fixtures.browser.ts)
paste every captured item, in captured order and with each file rebuilt from its
bytes, into the fixture editor in Chromium, Firefox and WebKit, with both
policies, in the paste cleanup browser workflow:
blocks, list kinds, markers, depths and ordinals, the table, row, column and
spans of each cell, marks and text styles, the notice and its codes, and a
contrast check of every pasted run. The check is exhaustive: a block, an empty
paragraph, a mark, a text style value, an alignment, a line spacing or a cell
shading that the content specification does not author for the selection is a
finding, as is one it authors that is missing.

What the captures show and the fixtures pin:

- Safari exposes only `text/html` and `text/plain`: no `text/rtf`, no custom
  formats and no files, so a Word RTF flavor of any size never reaches a Safari
  paste. Its only image, a picture bullet, is a `blob:` URL without a file.
- For content without list paragraphs Safari writes each element's computed
  style inline and drops Word's stylesheet; with any Word list paragraph it keeps
  Word's raw paragraphs and the whole stylesheet with its `@list` definitions,
  which every one of the ten list captures carries. The glyph-only list fallback
  for HTML without definitions therefore stays as it was (PCL-03, OD-53 default);
  no Safari capture needs it.
- Automatic text color arrives as the capture page's text color with an equal
  caret color (white in these captures). Cleanup reads it as the default color,
  so no text is colored the page's color, in either theme. The fixtures hold
  text without a color of its own to 4.5:1 against what it lands on in the light
  and the dark theme; on the highlight and cell shading the copy keeps, the theme
  draws it black or white by that background. A heading style color stays as
  Word set it (`#0F4761`), which measures 1.66:1 on the dark theme's background:
  the replay annotates it, an owner question rather than a failure.
- A Title of several paragraphs, which Word writes with the `MsoTitleCxSp`
  classes, pastes as one level 1 heading per paragraph, like a single Title; no
  capture of this row holds one, so unit tests pin it. A nested `font-size:
  medium` resets the size it inherits, and the first space of a partial
  selection, a span left with one no-break space, pastes as a space in every
  engine.
- The routine envelope pastes without a notice in both policies (D9 holds for
  this row): the Title style becomes a level 1 heading, as in Pro's DOCX import,
  and the spacing of Word's Normal style, which Safari writes on every block, is
  no formatting of its own. The copy names that spacing when it carries Word's
  stylesheet; otherwise Word's defaults, 1.15 and 1.08 (written 107 %), stand for
  it, and an explicit spacing equal to one of them reads as the style's. That
  default is the working default of OD-53 (a quiet envelope), recorded for the
  owner's review: the analysis's alternative kept the preserve notice for every
  Safari paste into an editor without LineHeight. Losses stay reported:
  indentation, the literal list items and their marker fonts.
- Preserve keeps the typography Safari writes inline: the fonts of paragraphs,
  headings and cells, the heading style colors and sizes, B07's font, size and
  color, the highlight, B12's 1.5 spacing and T05's shading. The fixtures pin
  that every kept value is the one Word shows, that B07's named runs and T05's
  shading are kept, and B12's spacing wherever the result can carry it (the
  offline replay; the editor's default schema has no LineHeight and reports it),
  and that no run carries a mark, style or alignment Word does not show. They
  do not pin that a run keeps a font: Word list paragraphs carry theirs only in
  Word's class rules, which cleanup does not resolve, so list items paste in the
  editor's font next to paragraphs and cells that keep Aptos, and Normal text at
  Word's 12 pt arrives as WebKit's `medium`, the editor's default size. Chrome
  and Firefox carry fewer styles, since they pass Word's class rules through
  unresolved (see their row below).
- Word's numbering library writes its third level right aligned and pads the
  label with a spacer of 7 pt no-break spaces that fills the indent before it
  (89 to 92 of them in these captures). The label is read without that spacing,
  so `i.` and `ii.` paste as a lower-roman list at the third level, in the full
  selections and in the partial one.
- Word's Table Grid style writes its single spacing as `line-height: normal` on
  every cell paragraph. That is the initial value, which renders like no line
  height, so it is dropped quietly: the table pastes without a notice in an
  editor without LineHeight and stores no line height in one with it, which the
  table fixture pins in both schemas.
- B07 is pinned in both the editor's default schema and the full one. The
  default schema has no Subscript or Superscript, so the 2 of H2O and of x2
  paste without them, the oracle expects them absent there, and the visible
  notice reports `destination-formatting-unconfirmed` in both policies.

Limits of this row:

- The fixture editor received each capture through a synthetic paste event with
  the captured flavors. A native paste into the editor (the procedure's step 4)
  was not recorded, so styles WebKit would compute in the receiving page are not
  covered; Playwright WebKit 26.0 is not Safari 26.5.2.
- The list and table fixtures are the 2026-10-04 recapture of documents the
  owner recreated after resetting Word's Normal template, so their lists are
  Word's own libraries, whose level fonts are named in `font-family` and whose
  numbering's third level is right aligned. They replace the 2026-10-02 captures
  of a document whose lists were named list definitions from templates (the
  `o` level naming its font per script), which the admitting commit `d01af47`
  keeps in history and the unit tests keep as regression coverage; see the
  [README](./README.md#archived-captures). The recreated tables document ends
  with one empty paragraph after the last table, so the specification's `T15b`
  is gone.
- Header Row is a Word table style option: Safari's HTML has no header cells,
  so the first row pastes as ordinary cells. Cell borders, padding and widths
  follow the destination table.
- Word's empty paragraph, a paragraph mark holding one no-break space, pastes
  as an empty paragraph. Safari leaves hidden text out of the copy, so it never
  pastes; nothing in the copy tells of it, so no notice can name it here.
  `1)` and `a)` paste as decimal and alphabetic lists, without
  the parenthesis.
- The first paragraph of a copy joins the paragraph it is pasted into, the way
  ProseMirror joins an open slice, and takes that paragraph's alignment and line
  spacing, also when it is empty: a copy that starts with a centered or 1.5
  spaced Word paragraph, pasted into a new empty paragraph, starts left aligned
  and without its spacing, with no notice. The blocks after it keep their own,
  and so does a heading, which replaces an empty paragraph whole. The captured
  alignment and spacing selections start with a heading and do not show it.
- A paragraph or heading background written as `background-color`, as web pages
  write it, has no place in the editor and is dropped without a notice; the
  `background` shorthand Word writes for paragraph shading is reported as
  unsupported formatting, and table cell shading is kept. Reporting the
  longhand too would show the notice for many web copies, such as a dark
  container, so it waits for the owner's noise versus loss decision.
- Large selections, own copies and every image scenario are not captured for
  this row.

Decisions that waited on the captures, for this row: D9 (quiet envelope) holds,
with the line spacing default above for the owner's review;
PCL-03 keeps the glyph-only fallback; RTF flavor sizes do not apply, Safari
exposes none; V2-1 and V2-2 (macOS image file shapes) stay unevidenced, Safari
exposed no file in any Word copy, and need Finder, Copy Image and image-only
captures; PCL-04 (Google Docs markers) waits for the Google Docs captures. The
image association and CSS claims stay narrow: no image is associated
automatically, a `blob:` URL is not a file binding, and Safari's computed inline
styles are read as such, without a stylesheet cascade.

### Word for Mac to Chrome and Firefox

The thirty-eight fixtures are built and replayed like the Safari ones, from the
same three documents: the basics document of the Safari fixtures and the
recreated lists and tables documents. Each Chrome capture's image file is
rebuilt from its bytes and pasted with the other flavors. Every Chrome fixture
and its Firefox counterpart share their oracle, and each pastes the same in
Chromium, Firefox and WebKit.

What the captures show and the fixtures pin:

- Chrome and Firefox pass Word's raw clipboard HTML through: Word's whole
  stylesheet with its fonts, styles and the `@list` definitions of every list
  used, which with the head makes up almost all of a copy of 38,454 to 53,920
  characters, conditional comments, downlevel
  revealed `<![if !supportLists]>` markers, `o:p` elements, `mso-*` properties
  and formatting Word keeps in class rules. Both browsers deliver the same HTML
  and the same `text/plain`, except that Chrome ends their lines with CRLF and
  Firefox with LF.
- Both expose `text/rtf` too: 38,484 to 57,215 bytes, 0.91 to 1.10 times the
  HTML, which PasteCleanup never reads. Every paste carries it and applies.
- Chrome adds one `image/png` file, `image.png`: Word's picture of the whole
  selection (451 to 468 pixels wide, 5,716 to 48,656 bytes as committed, with
  its display profile redacted), not an image of the content. It is in every replayed Chrome paste and is never inserted, read,
  offered to a matcher or a reason to refuse the paste, also with image
  preparation and with byte limits no captured file fits. Firefox exposes no
  files. Every captured copy has text of its own; a Word copy without it that
  places no image, such as empty paragraphs, empty cells or a horizontal rule,
  keeps its content by core's file rule as well, for the Image, PasteCleanup and
  the Link paste, which synthetic copies in Chrome's shape pin until such a copy
  is captured.
- Word writes links to its local temporary files under the user's home folder:
  the clipboard file list, theme data and color scheme mapping in the head, and
  a picture bullet as a `file:` image with a `list-style-image` URL. Cleanup
  drops the links with the head and keeps a picture bullet as its marker's alt
  text; nothing is fetched. The fixtures carry these paths redacted (see the
  inventory).
- Class rules are not resolved, so `preserve` keeps the formatting Word writes
  inline: fonts, sizes and colors applied to words, the highlight, alignment,
  line spacing other than the Normal style's, and cell shading. The Normal
  style's Aptos, the heading fonts, sizes and colors and the Title's size live
  in class rules and paste as the editor's own, so a Chrome or Firefox copy keeps
  less typography than Safari's. `adapt` gives the same result in all three.
- Word writes line spacing as a percentage: B12's 1.5 is `line-height:150%`,
  which becomes the ratio 1.5 that a LineHeight destination stores and draws, and
  the Normal style's 115 % on a paragraph or a run is the style's own. The
  alignment fixtures pin B12's drawn 1.5 in the editor's full schema and the
  notice in its default schema without LineHeight.
- Word writes no color for its automatic color in the raw HTML, so that text
  pastes in the editor's own color; T05's explicit black stays, drawn on its
  kept shading. Text without a color of its own holds 4.5:1 in the light and
  the dark theme. Safari's white automatic color was WebKit's computed color in
  the capture page, not Word's.
- Hidden text arrives as a run Word hides (`display:none` with `mso-hide:all`).
  On the owner's decision of 2026-10-05 cleanup leaves it out in both policies,
  as Word shows the document, and the notice names it: "Hidden text from Word
  was not pasted." (`hidden-text-removed`), where it pasted visible with a
  formatting warning before. Only an element both CSS and Word hide is Word's
  hidden text, by its style or a simple class rule, as a hidden character style
  writes it: `display: none` alone, as a web page hides interface parts, and
  Word's web hidden text (`mso-hide: screen`), such as a table of contents' page
  numbers, keep their text with `unsupported-formatting`. A paragraph that held
  nothing else goes with its hidden text when its paragraph mark is hidden too
  and stays empty when the mark shows, a hidden list item leaves one list
  numbered without it, and Chrome's picture of a selection whose hidden text was
  left out is never pasted in its place. The captures hold only a hidden run
  inside a visible paragraph; the other shapes rest on authored HTML in the
  normalizer's tests. Safari leaves the run out of the copy, as above.
- The right aligned third level, Table Grid's single spacing and the empty
  paragraphs behave as in Safari: the lists, tables and routine scenarios paste
  without a notice in both policies (D9 holds for these rows).

Limits of these rows:

- Synthetic paste events with the captured items, in Playwright Chromium
  145.0.7632.6, Firefox 146.0.1 and WebKit 26.0, not Chrome 154 or Firefox 155;
  no native paste into the editor was recorded.
- Header Row arrives as ordinary cells, `1)` and `a)` without the parenthesis,
  and letters past `z`, legal numbering below its first level, dash, check
  mark, arrow and picture bullets stay literal, as in Safari. Word draws the
  check mark and the arrow as the letters `ü` and `Ø` in Wingdings, in all three
  browsers: `preserve` keeps the font, so they show as Word shows them only where
  the reader has Wingdings, and `adapt` shows the letters. A Wingdings marker
  keeps the 7 pt spacer after it in the marker's font, which can draw a stray
  glyph in `preserve` (both deferred with DF-07).
- The first pasted paragraph takes the alignment and line spacing of the
  paragraph it is pasted into, as in Safari.
- Large selections, own copies and every image scenario are not captured for
  these rows; Word's images are local `file:` URLs here and stay unbound.

Decisions that waited on the captures, for these rows: D9 holds after the
list and table fixes above; PCL-03 keeps the glyph-only fallback, which no
captured row needs, since Chrome and Firefox carry Word's stylesheet with every
list; RTF flavor sizes are recorded above and confirm that a large RTF flavor
never rejects a paste (F8 item 4), a size test waits for `word-large-document`;
V2-2 is confirmed for Word copies with text, and refined from synthetic copies
for Word copies without it, while V2-1, those copies and the image-only, mixed
and Copy Image shapes still need captures; OD-01 and OD-53 hold, no capture
proves them wrong.

### Google Docs on macOS to Chrome

The owner authored the `gdocs-v1-basics`, `-lists`, `-tables` and `-images`
documents natively in Google Docs web (personal account, Pages format, the
images document without its 50 and 51 image part), exported each with File >
Download > .docx and copied every scenario of them in Google Chrome 153 on
macOS 26.5.2 on 2026-10-05. Each of the twenty-eight fixtures holds its
capture, the export of its document as its source, a capture summary and a
version 2 manifest whose oracle is authored from the corrected content
specification and the reviewed editor results. They are replayed like the Word
fixtures, offline through public `/html` and in the fixture editor in Chromium,
Firefox and WebKit with both policies, each pinned in the editor's default
schema and in the one with every capability, with contrast measured in the
light and the dark theme. The specification authors Docs' text styles (Arial
11 pt, the headings' sizes and Heading 3's gray), so the check is exhaustive,
as for Word.

What the captures show and the fixtures pin:

- Chrome exposes `text/plain` and `text/html`, and lists Google's own slice,
  image and clip id formats, which the capture does not read. No files, also
  for an image copied alone, which holds `text/html` only.
- Google wraps a copy in a bold of normal weight whose id is a guid made per
  copy: it names neither the account nor the document. Cleanup leaves the
  wrapper out once the copy is read, and the break Chrome ends a copy with after
  it, which the editor's parse ignores, so the cleaned HTML holds neither,
  which the fixtures pin. Every run is a span with
  its whole typography, Arial 11 pt and `#000000` included, which the export
  holds as document defaults, not run formatting. Every run also writes
  `white-space: pre-wrap`, which left an empty text style on each pasted run;
  the block holds it now where a text needs it, so no run carries one and every
  space stays, which the fixtures pin. Runs outside any block, as Docs is
  expected to write a selection inside one paragraph, as it writes an image
  copied alone, are read together as the paragraph the editor gathers them
  into; no capture holds such a text selection, so unit and editor tests pin
  it. Black is Docs' default text color, so no run keeps it and pasted text
  follows the theme, at 4.5:1 in both themes. Docs' heading styles keep their
  sizes and Heading 3 its `#434343`, which reads below 3:1 on the dark theme and
  is annotated, like Word's heading colors. Docs writes 14 pt as
  `13.999999999999998pt`, read as 14 pt.
- Docs writes a block's line spacing as a CSS line height of 1.2 times it: its
  default 1.15 is 1.38 on every paragraph, heading and list item, single, a
  table cell's default, is 1.2, and GB19's 1.5 is `1.7999999999999998`. Cleanup
  reads the spacing back and drops the defaults as the document's own, so the
  routine scenarios paste without a notice in both schemas (D9 holds) and GB19
  stores 1.5, which LineHeight draws; the editor's default schema, without
  LineHeight, reports it. The export holds 1.15 as its document default (a line
  of 276) but single on each cell paragraph (240), as GB19 holds its 1.5, not in
  a table style: Docs gives every cell paragraph it makes single spacing, so
  dropping it follows the D9 default for spacing the source sets by itself, a
  policy, not what the export says; a single spacing an author sets in a cell
  cannot be told from it. A spacing outside the values LineHeight draws, by
  default 1, 1.15, 1.25, 1.5 and 2, such as Docs' 1.3 or the 1.08 of a document
  converted from Word, is stored but neither drawn nor reported (deferred,
  F-26).
- Docs writes each empty paragraph as a `br` between blocks: two for two empty
  paragraphs, one before each table, one between two lists and one for the last
  paragraph after a final table. Each pastes as the empty paragraph it stands
  for, which the export confirms; the specification now names them.
- List markers are written as `list-style-type` on each `li` and nested lists
  directly in their parent lists: PCL-04 is confirmed, and the markers move to
  their lists quietly (OD-53). The `1)`, `A.` and `I.` presets arrive as
  decimal, upper-alpha and upper-roman, the ❖ preset as disc and legal
  numbering as nested decimal lists: the parenthesis, the ❖ and the composed
  `1.1.` label are not in the copy. Twenty-eight upper-alpha items stay one
  list, which the editor labels `AA.` and `AB.` after `Z.`, as CSS does.
- A selection that starts below a list's first level is written with each
  item's `aria-level` and a 36 pt margin for each level above the copy. Its
  items paste at the depths Docs shows them, without an indentation report,
  each level above opening with one empty item of the list's kind, which Docs
  does not show, as a Word selection that starts in a nested item opens the
  levels above it; the checker holds the paste to exactly one such item per
  level.
- A checklist is written as ARIA checkbox items with their checked state, each
  beside a picture of its box. It pastes as a task list, checked as Docs shows
  it, without the pictures. Docs strikes an item through when its box is
  ticked, on the item and every run, as the export writes the line too: the
  line shows the checked state, which the task item holds, so it goes; kept, it
  outlived the state when the item was unchecked in the editor. An editor
  without task lists pastes the checklist as bullets, which keep the line as
  the only sign of the state, and reports `destination-formatting-unconfirmed`,
  which the fixture pins; before, the checked state was lost without a finding.
- Docs draws a script as a span of 0.6em aligned to sub or super: that size is
  the script's own, so the run keeps its 11 pt under the script mark, which
  draws it smaller, as a Word script pastes. This reverses the analysis, which
  kept 6.6 pt: the editor now draws the script at about 12 px where Docs draws
  8.8 px (6.6 pt drew 7.3 px), and a destination without Subscript or
  Superscript no longer gets a baseline digit at 6.6 pt.
- Links carry Docs' link blue `#1155cc` and an underline as the runs' own
  formatting, which the export holds too, so `preserve` keeps both and `adapt`
  the underline; the blue reads 2.54:1 on the dark theme and is annotated.
- The pinned header row arrives as header cells, merged cells as spans and
  light gray 2 as the cell background `#efefef`; borders, padding and widths
  are the destination's. Google copies a selected row as a one row table.
  Docs aligns every cell to the top, where the table draws every cell, so no
  cell stores a vertical alignment, which the fixtures pin; before, every cell
  stored one, which only marked it as aligned.
- Every image is a `data:image/png` URL in the HTML with its alt text and size,
  pixel for pixel the generated image and without metadata; the repeated image
  is the same data URL twice. The editor keeps each as an embedded image,
  quietly, also with image preparation, which reads no file. A paragraph that
  holds only an image no longer pastes an empty paragraph above a block image.
  A destination whose Image refuses data URLs, or that has no Image, removes
  each image with `image-removed`, its alt text in its place, which the fixtures
  pin with every block around it; before, it kept a broken picture or lost the
  image silently. Docs aligns an image by its paragraph: one centered or aligned
  to the end gives the image that alignment, which Image draws, where the
  policy keeps text alignment, and a removed image's alt text stays in the
  aligned paragraph; before, such a paragraph pasted empty above an unaligned
  block image. No capture holds an aligned image, so unit and editor tests pin
  this.

Limits of this row:

- Synthetic paste events with the captured items, in Playwright Chromium
  145.0.7632.6, Firefox 146.0.1 and WebKit 26.0, not Chrome 153; no native paste
  into the editor was recorded. Firefox and WebKit show that the result does not
  depend on the receiving engine, not how Safari or Firefox deliver a Google Docs
  copy, which their own captures will show.
- The first pasted paragraph joins the paragraph it is pasted into and takes its
  alignment and spacing, as for Word, and the first space of a partial selection
  arrives as a no-break space, which stays.
- Not captured: the large image, whose data URL the capture's 2 MiB text limit
  and PasteCleanup's input ceiling of 2,000,000 characters bound, the slow copy,
  the 50 and 51 image limit, the mixed and large documents, and Safari and
  Firefox.

The browser version is the operator's record: the capture page records no user
agent. The Word captures of the day before, on the same macOS, recorded Chrome
154.0.8037.93, a later version, so the owner is asked to confirm the Chrome
install and profile these copies came from (analysis F-23).

Decisions that waited on the captures, for this row: D9 holds after the fixes
above; PCL-04 is confirmed and kept; OD-01 and OD-53 hold, no capture proves
them wrong. V2-1 and V2-2 do not arise: Google Docs exposes no file. Open owner
questions: what Docs labels the items after `Z.`, whether Docs' link look should
yield to the destination's, Heading 3's gray on the dark theme, whether a
checked checklist item should keep Docs' strikethrough, which the default drops
where the editor has task lists, since a line the author drew over a whole
checked item cannot be told from the one Docs draws, whether a script should
keep Docs' 0.6em rather than the script mark's size, and which Chrome install
the copies came from (Chrome 153 recorded here, 154 for Word the day before).

RTF/RTFD image matching, local blob URL retrieval and general source-specific
association profiles are not implemented by this harness. A native capture that
contains these representations documents a gap; it does not enable a production
fallback. Unsupported or missing resources must remain explicit in the expected
outcome. This increment does not retry native automation.

## Versioned fixture inventory

| Fixture | Origin | Expected result | Qualification |
| --- | --- | --- | --- |
| `synthetic-office-evidence-v1` | Independently authored HTML, a Node synthetic event and an arbitrary four-byte File. No Office application or OS clipboard. | Preserve/adapt retain `Alpha` in bold, `Beta` in italic and the image alt text; unresolved `cid:2` is removed with `image-removed`. | False. The file is evidence for byte checks, not a raster or a proved image binding. |
| `synthetic-google-docs-dry-run-v1` | Authored HTML in the Google Docs clipboard shape for `gdocs-mixed-document`, a Node synthetic event and a custom flavor whose bytes the capture omits. No Google Docs session or OS clipboard. | Preserve/adapt keep the heading, marks, link, nested lists, the merged cell and the alt text of the URL image, which is removed with `image-removed`; the list markers written on each `li` move to their lists, and the sized span around the image is routine, as the oracle records. | False. A dry run of the procedure, not a capture of Google Docs. |
| `word-*-safari` (nineteen) | The owner's native Word 16.113.3 for Mac to Safari 26.5.2 captures of the synthetic `word-mac-v1` documents: nine of 2026-10-02 and the ten list and table captures of 2026-10-04. Every source document declares its emptied author properties, every capture its withheld source hash, and `word-unsupported-list-profiles-safari` its replaced home folder path (version 2 manifests). | The blocks of the scenario's selection as the content specification authors them, and per policy the replay's warning codes and the editor's notice and codes, authored from the specification and reviewed against the editor results. | Reviewed: this matrix qualifies the Safari row with them. The tooling still reports `qualification: false`. |
| `gdocs-*-chrome` (twenty-eight) | The owner's native Google Docs web to Chrome 153.0.8010.47 captures of 2026-10-05 from the synthetic `gdocs-v1` basics, lists, tables and images documents, each with its document's export as its source. No redaction: the exports hold no document properties and every capture names its export's hash. | The blocks of the scenario's selection as the corrected content specification authors them, and per policy the replay's warning codes and the editor's notice and codes in the default schema and with every capability. | Reviewed: this matrix qualifies the Google Docs to Chrome row with them. The tooling still reports `qualification: false`. |
| `word-*-chrome` and `word-*-firefox` (nineteen each) | The owner's native Word 16.113.3 for Mac to Chrome 154.0.8037.93 and Firefox 155.0.1 captures of 2026-10-04, from the same documents. Every capture declares Word's replaced local paths, each Chrome capture its picture's cleared display profile, and each capture of the lists or tables document its withheld source hash, whose source declares its emptied author properties; the basics captures name the committed basics document's hash. | As for Safari, with Chrome's picture of the selection in every Chrome paste and pinned as never inserted, read or bound. | Reviewed: this matrix qualifies the Chrome and Firefox rows with them. The tooling still reports `qualification: false`. |

Owner documents and captures were redacted before anything was committed, and
each fixture's manifest declares its redactions; no declaration records a hash
of an original (see [Declared redactions](./README.md#declared-redactions)):

- The basics document held the owner's e-mail address in its author
  properties. On the owner's request of 2026-10-02 they were emptied and the
  original was deleted, so its declaration has the basis `redacted-copy`. Its
  nine Safari captures withhold the source hash they recorded, because an
  unsalted hash of a document that held the address would confirm a guessed
  address. The Chrome and Firefox captures were copied from the redacted
  document and name its committed hash; they withhold nothing.
- The recreated lists and tables documents hold the generic author name Word
  gives a user who set none. Their author properties are emptied too, the owner
  keeps the originals, so their declarations have the basis `original`, and each
  of their thirty captures withholds the source hash it recorded.
- The captures of 2026-10-04 hold Word's links to its local temporary files,
  which name the home folder: three in each Chrome and Firefox copy, five with
  the picture bullet, and one in Safari's picture bullet. At the owner's request
  the account name had been replaced in every local copy before review, and no
  original exists, so these declarations have the basis `redacted-copy`; each
  path is redacted from its scheme or home folder prefix through that name by a
  same-length token, the picture bullet's image source thereby reading as a
  relative reference.
- Chrome's picture of the selection embeds the ICC profile of the display it
  was drawn on, and macOS writes Apple's make and model tag into it, whose
  serial number named that display. On the owner's decision of 2026-10-05 each
  of the nineteen pictures declares a clipboard file redaction: the serial
  number and the manufacture date are zero, the profile is compressed again
  and every other chunk keeps its bytes, so the pictures decode to the same
  pixels, raw and through their profile. Its fingerprint was taken from the
  original picture, which is not retained, so the declarations have the basis
  `original` and say the original is not kept.

- The Google Docs fixtures need no redaction. The exports hold no document
  properties, the guid of Google's wrapper is made per copy, the only address,
  `pisi@example.com`, is at a domain reserved for documentation, which the
  fixture scan now allows, as the repository gate does; it allows no other
  reserved name the gate does, such as `.local`, at which a company's directory
  can hold a real address. The images are the generated ones, embedded as data
  URLs, with no Google address.

No privacy scan finds anything in the committed files, including what the RTF
flavors' hexadecimal groups decode to and the device the pictures' display
profiles, EXIF and XMP name.

The [manifest](./fixtures/synthetic-v1/manifest.json) pins the exact source and
capture SHA-256 values and an explicitly reviewed output for both policies. The
capture timestamp is an authored deterministic fixture value, not a native event
timestamp. Exact wrapper serialization was reviewed against the public
normalizer; the oracle is never derived from that normalizer during a test.
The fixture is MIT-licensed synthetic content without customer data. The Google
Docs dry run manifest pins its oracles the same way; they record the current
cleanup of the authored shape, not a target.

## Admission of future evidence

1. Capture only an independently authored synthetic document through the
   documented manual procedure. Record exact copy range, versions, source hash,
   original assets, license and any omitted formats. Do not edit a native bundle
   to repair missing evidence.
2. Scan the source and capture for personal or hidden data before committing
   them and remove it with `redact.mjs`, which declares the removal; never edit
   by hand. Record expected text, structure, formatting and image ownership
   independently of the cleanup output. Keep unsupported results visible.
3. Prepare the fixture with `prepare-fixture.mjs`, which refuses personal data,
   author each policy's outcome in its version 2 manifest from the content
   specification and the reviewed editor results, and run the offline checks. A
   passing result confirms integrity and its bounded oracle only. File bytes are
   checked but are not replayed as `DataTransfer` items.
4. The native fixture regressions replay every committed version 2 fixture in
   the real editor without further wiring. Add asset association and history
   regressions where a profile needs them. Document the exact verified
   combination and limitations in a new matrix revision. Retain negative and
   missing-data cases.
5. Run the final package and browser release gates on the release commits and
   review user documentation. Native review and joint Free/Pro release approval
   remain separate decisions; this script cannot grant them.
