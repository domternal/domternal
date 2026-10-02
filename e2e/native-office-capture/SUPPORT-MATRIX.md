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


Matrix version: `free-paste-evidence-v4`. Recorded on 2026-10-04 for the
unreleased paste cleanup work; it replaces `free-paste-evidence-v3` of 2026-10-03,
which qualified the first native row, Word for Mac to Safari, with nineteen
reviewed native fixtures of the owner's captures of 2026-10-02. Version 4
qualifies Word for Mac to Chrome and to Firefox with nineteen reviewed native
fixtures each, from the owner's captures of 2026-10-04, replaces the ten Safari
list and table fixtures with captures of documents recreated with Word's own
list libraries, and records the cleanup changes those captures required, the
declared redactions they carry and the decisions that waited on them. Google
Docs stays pending; every other row stays unqualified.
This is an evidence inventory, not a fidelity score or a release approval. The
[package contract](../../packages/extension-paste-cleanup/README.md) defines
current behavior and its limits.

## Evidence levels

| Label | What it establishes | What it does not establish |
| --- | --- | --- |
| Authored synthetic input | Reproducible behavior for fixed, independently described inputs in unit or browser tests. | Native Office clipboard availability or source application fidelity. |
| Stored native claim | A complete bundle claims a trusted event and records operator metadata. Its stored bytes match a reviewed manifest. | Authenticity of saved JSON, source application identity, completeness of OS formats or correct image association. |
| Reviewed native fixture | A separately documented source, copy action, exact application/OS/browser versions, capture and independently checked expected result have been reviewed together. | Other versions, platforms, clipboard managers or remote desktop paths. |

This directory holds **fifty-seven reviewed native fixtures for three rows**:
Word 16.113.3 for Mac to Safari 26.5.2, to Chrome 154 and to Firefox 155 on
macOS 26.5.2 (see [Native source matrix](#native-source-matrix)). The offline
validator still returns `qualification: false` and `nativeEvidenceAuthenticated: false` for each,
since saved JSON cannot authenticate its origin; the qualification is this
matrix's reviewed statement, bounded by the limits it lists. Editing a bundle and its manifest can produce matching hashes. Hashes
detect disagreement with a reviewed manifest; they are not signatures or proof of
capture origin. Source detection such as `source: word` is an HTML heuristic.

## Implemented behavior and its current evidence

The links below point to executable contracts. They do not imply that a test was
rerun every time this matrix is read. Browser inputs are synthetic unless a test
explicitly says otherwise. Chromium's native editor-copy case copies from
Domternal, not from Office.

| Area | Current bounded behavior | Evidence | Remaining qualification or limit |
| --- | --- | --- | --- |
| HTML safety and formatting | Shared resource-free normalizer, preserve/adapt policies, supported inline/inherited styles and bounded loss diagnostics. Routine clipboard envelope elements, Office wrappers and Office private, neutral or destination-owned declarations are removed without a warning, including the computed declarations Safari writes on every element it copies; a text color equal to Safari's copied caret color is Word's automatic color in a Word copy, and from another source the page's default color only when neutral, so a colored web container keeps its color. | [Normalizer tests](../../packages/extension-paste-cleanup/src/html/), [Safari Word tests](../../packages/extension-paste-cleanup/src/html/safariWord.test.ts), [browser contracts](../paste-cleanup.browser.ts), [feedback contracts](../paste-feedback.browser.ts), [native fixture regressions](../paste-native-fixtures.browser.ts) | General stylesheet cascade, all Office-specific markup and exact RGBA transparency are not promised. Native Word for Mac envelopes stay quiet in Safari, Chrome and Firefox (reviewed fixtures); for Google Docs that still needs the captures. Word's raw HTML in Chrome and Firefox keeps its formatting in class rules, which cleanup does not resolve: `preserve` keeps what Word writes inline. |
| Own copies and ProseMirror slices | A `data-pm-slice` marker is structural context. Only a same-page PasteCleanup copy marker keeps editor formatting; nested or duplicate markers are removed. | [Slice origin tests](../../packages/extension-paste-cleanup/src/html/sliceOrigin.test.ts), [own copy tests](../../packages/extension-paste-cleanup/src/PasteCleanup.ownCopy.test.ts), [list marker contracts](../paste-list-markers.browser.ts) | Copies across tabs, applications or separate package instances are external by design. |
| Office-shaped lists | Explicit inline list metadata reconstructs bounded lists. Word level definitions from the clipboard stylesheet, a level font named per script among them, and the marker run font identify default bullets (disc, circle, square) and decimal, alphabetic and Roman numbering; without definitions only decimal numbers and Unicode bullets are admitted. A marker's label is read without the spacer runs Word pads it with, so a right aligned level, as the third level of Word's numbering library, keeps its list. A selection that starts in a nested item opens the levels above it from their definitions, each with one empty item; a level skipped later in a run stays literal. An unsupported item stays a literal paragraph while the rest of its run is reconstructed; a picture bullet stays its marker, never an image. | [List tests](../../packages/extension-paste-cleanup/src/html/officeLists.test.ts), [level definition tests](../../packages/extension-paste-cleanup/src/html/officeListStyles.test.ts), [Safari Word list tests](../../packages/extension-paste-cleanup/src/html/safariWordLists.test.ts), [list marker contracts](../paste-list-markers.browser.ts), [native fixture regressions](../paste-native-fixtures.browser.ts) | Native list profiles are qualified for Word for Mac in Safari, Chrome and Firefox, from a document whose lists come from Word's own libraries; named list definitions from templates are covered by unit tests of the earlier Safari captures. Legal multilevel numbering below its first level, prefixed or custom level text, picture and symbol bullets other than the Word defaults, and letters past z stay literal; `1)` and `a)` keep their marker class, not their parenthesis. |
| Destination capabilities | Resource-free probes inspect the actual destination schema. Unrepresentable table structure blocks insertion; supported formatting demands receive bounded diagnostics. | [Capability tests](../../packages/extension-paste-cleanup/src/destinationCapabilities.test.ts), [browser contracts](../paste-destination.browser.ts) | A successful probe is not exact source-style fidelity or support for every custom node. |
| Local embedded images | Explicit host bindings connect rich HTML references to exposed items. Validated inline raster URLs retain their own placements. A clipboard image file is the paste only when the content has no text of its own and, for a Word or Excel copy, places an image: Chrome's picture of a Word selection is never inserted, read or bound. | [Asset browser contracts](../paste-assets.browser.ts), [resolver browser contracts](../paste-resolver.browser.ts), [image file contracts](../paste-image-files.browser.ts), [native fixture regressions](../paste-native-fixtures.browser.ts) | No automatic general CID, filename, position or byte-similarity association. No remote source fetching. Word's `file:` image URLs in Chrome and Firefox and `blob:` URLs in Safari are never fetched or bound. |
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
| Google Docs | macOS to Chrome, Safari and Firefox, with the capture date and source context | None | Pending until captured: [content specification](./content/google-docs-v1.json), generated images and the [runbook](./GOOGLE-DOCS-RUNBOOK.md) are prepared. |
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
  as an empty paragraph. Safari leaves hidden text out of the copy. `1)` and `a)` paste as decimal and alphabetic lists, without
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
  It pastes visible with `unsupported-formatting`, as the specification says;
  Safari leaves it out of the copy instead. The notice names that warning as
  formatting that could not be preserved, not as hidden text shown; whether such
  a run should be dropped instead, as Word shows the document, is open.
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
