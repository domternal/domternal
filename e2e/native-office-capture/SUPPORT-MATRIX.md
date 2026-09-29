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


Matrix version: `free-paste-evidence-v3`. Recorded on 2026-10-03 for the
unreleased paste cleanup work; it replaces `free-paste-evidence-v2` of 2026-09-28,
which added the quiet routine envelope, same-page own copy recognition, Word list
profiles from level definitions, per-item list fallback, the large paste
measurement and the prepared Word for Mac and Google Docs capture scenarios.
Version 3 qualifies the first native row, Word for Mac to Safari, with nineteen
reviewed native fixtures of the owner's captures of 2026-10-02, and records the
cleanup changes those captures required, the declared redactions they carry and
the decisions that waited on them. Every other row stays pending or unqualified.
This is an evidence inventory, not a fidelity score or a release approval. The
[package contract](../../packages/extension-paste-cleanup/README.md) defines
current behavior and its limits.

## Evidence levels

| Label | What it establishes | What it does not establish |
| --- | --- | --- |
| Authored synthetic input | Reproducible behavior for fixed, independently described inputs in unit or browser tests. | Native Office clipboard availability or source application fidelity. |
| Stored native claim | A complete bundle claims a trusted event and records operator metadata. Its stored bytes match a reviewed manifest. | Authenticity of saved JSON, source application identity, completeness of OS formats or correct image association. |
| Reviewed native fixture | A separately documented source, copy action, exact application/OS/browser versions, capture and independently checked expected result have been reviewed together. | Other versions, platforms, clipboard managers or remote desktop paths. |

This directory holds **nineteen reviewed native fixtures for one row**: Word
16.113.3 for Mac to Safari 26.5.2 on macOS 26.5.2 (see
[Native source matrix](#native-source-matrix)). The offline validator still
returns `qualification: false` and `nativeEvidenceAuthenticated: false` for each,
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
| HTML safety and formatting | Shared resource-free normalizer, preserve/adapt policies, supported inline/inherited styles and bounded loss diagnostics. Routine clipboard envelope elements, Office wrappers and Office private, neutral or destination-owned declarations are removed without a warning, including the computed declarations Safari writes on every element it copies; a text color equal to Safari's copied caret color is Word's automatic color in a Word copy, and from another source the page's default color only when neutral, so a colored web container keeps its color. | [Normalizer tests](../../packages/extension-paste-cleanup/src/html/), [Safari Word tests](../../packages/extension-paste-cleanup/src/html/safariWord.test.ts), [browser contracts](../paste-cleanup.browser.ts), [feedback contracts](../paste-feedback.browser.ts), [native fixture regressions](../paste-native-fixtures.browser.ts) | General stylesheet cascade, all Office-specific markup and exact RGBA transparency are not promised. Native Word for Mac envelopes stay quiet in Safari (reviewed fixtures); in Chrome and Firefox, and for Google Docs, that still needs the captures. |
| Own copies and ProseMirror slices | A `data-pm-slice` marker is structural context. Only a same-page PasteCleanup copy marker keeps editor formatting; nested or duplicate markers are removed. | [Slice origin tests](../../packages/extension-paste-cleanup/src/html/sliceOrigin.test.ts), [own copy tests](../../packages/extension-paste-cleanup/src/PasteCleanup.ownCopy.test.ts), [list marker contracts](../paste-list-markers.browser.ts) | Copies across tabs, applications or separate package instances are external by design. |
| Office-shaped lists | Explicit inline list metadata reconstructs bounded lists. Word level definitions from the clipboard stylesheet, a level font named per script among them, and the marker run font identify default bullets (disc, circle, square) and decimal, alphabetic and Roman numbering; without definitions only decimal numbers and Unicode bullets are admitted. A selection that starts in a nested item opens the levels above it from their definitions, each with one empty item; a level skipped later in a run stays literal. An unsupported item stays a literal paragraph while the rest of its run is reconstructed; a picture bullet stays its marker, never an image. | [List tests](../../packages/extension-paste-cleanup/src/html/officeLists.test.ts), [level definition tests](../../packages/extension-paste-cleanup/src/html/officeListStyles.test.ts), [Safari Word list tests](../../packages/extension-paste-cleanup/src/html/safariWordLists.test.ts), [list marker contracts](../paste-list-markers.browser.ts), [native fixture regressions](../paste-native-fixtures.browser.ts) | Native list profiles are qualified for Word for Mac in Safari only, from a document whose lists are named list definitions with the libraries' level texts and fonts. Legal multilevel numbering below its first level, prefixed or custom level text, picture and symbol bullets other than the Word defaults, and letters past z stay literal; `1)` and `a)` keep their marker class, not their parenthesis. |
| Destination capabilities | Resource-free probes inspect the actual destination schema. Unrepresentable table structure blocks insertion; supported formatting demands receive bounded diagnostics. | [Capability tests](../../packages/extension-paste-cleanup/src/destinationCapabilities.test.ts), [browser contracts](../paste-destination.browser.ts) | A successful probe is not exact source-style fidelity or support for every custom node. |
| Local embedded images | Explicit host bindings connect rich HTML references to exposed items. Validated inline raster URLs retain their own placements. | [Asset browser contracts](../paste-assets.browser.ts), [resolver browser contracts](../paste-resolver.browser.ts) | No automatic general CID, filename, position or byte-similarity association. No remote source fetching. |
| Persistent images | Host resolver, exact allowed origins, source data-image transport, resource ownership and recovery notifications. | [Resolver contracts](../paste-resolver.browser.ts), [private lifecycle tests](../../packages/extension-paste-cleanup/src/clipboard/resolverLifecycle.test.ts) | Mock adapters do not certify a production storage service or prove that aborted remote work stopped. |
| Receipt, cancellation and history | Accepted-operation receipts, target revalidation, deferred image cancellation, history boundaries and four framework integrations. | [Feedback browser contracts](../paste-feedback.browser.ts), [asset browser contracts](../paste-assets.browser.ts) | No built-in import preview or paste-choice dialog. Host callbacks and feedback are explicit integration seams. |
| Existing comment anchors | Actual Free paste and Pro Comments share real editor parsing, copy/cut rules, image replay and history. | Cross-repository gate in the Domternal Pro repository (`tests/paste-comments`), which is not public | This does not import Word discussions or qualify Yjs document collaboration. |
| Performance | Recorded paired local runs cover synchronous synthetic input and default feedback, with and without `imageAssets`. | [Reference report](../paste-performance/results/2026-10-01-macos-arm64.md), [earlier report](../paste-performance/results/2026-09-26-macos-arm64.md) | One machine and fixed inputs only. Observed paired p95 was 4.0 to 31.0 ms, 6.0 to 31.0 ms with `imageAssets`. Known limit: in Firefox, the engine's cycle collector can run inside a paste and add several hundred milliseconds to it (up to 873 ms observed, about 0.7 percent of enabled dispatches at 100 ms or more); the routes without PasteCleanup show it too, but less often, since cleanup allocates more per paste: enabled dispatches reached 100 ms 1.8 times as often as those without PasteCleanup, and 9 times as often with `imageAssets`. No universal latency bound. |
| Large pastes | Seven synthetic profiles swept to their largest accepted size; every larger input is rejected explicitly with nothing inserted, never truncated. | [Large paste report](../paste-performance/results/2026-09-28-large-macos-arm64.md) | Synthetic profiles on one machine. The parser allocation bound stops most Word profiles below the D4 target of 10,000 words. A Word RTF flavor of any size does not reject a paste: PasteCleanup never reads it. |
| Offline capture integrity | Versioned complete bundle schema, bounded artifacts, checksums, provenance claims, declared redactions and replay through public Free `/html`: exact HTML for version 1 manifests, a reviewed semantic oracle for the version 2 manifests of claimed native fixtures. | [Offline tests](./offline.test.mjs), [redaction tests](./redaction.test.mjs), [synthetic manifest](./fixtures/synthetic-v1/manifest.json) | No native acquisition, resource matching or automatic qualification. A redaction's original is never read, and no hash of one is recorded. |

## Native source matrix

Application, operating system and browser versions are the ones recorded with
each capture, not inferred from installed software. The
[capture scenarios](./README.md#initial-scenarios-and-source-matrix) include
image cases that no row has qualified yet. OD-01 decides which rows the first
release advertises: the macOS rows below; every other source is unqualified.

| Source | Platform and path | Reviewed native fixtures | Status |
| --- | --- | --- | --- |
| Word desktop | Microsoft Word 16.113.3 (16.113.26092714) for Mac to Safari 26.5.2 (21624.2.5.11.8), macOS 26.5.2 (25F84) | Nineteen: `fixtures/word-*-safari`, every `word-*` [scenario](./content/word-mac-v1.json) except `word-large-document`, `word-headings-styles` as its three selections | **Qualified** for the text, heading, inline formatting, alignment, spacing, indentation, hidden text, empty paragraph, list and table scenarios, with the limits below. The large document and `domternal-own-copy` are not captured. |
| Word desktop | Word for Mac to Chrome, macOS | None | Pending until captured. |
| Word desktop | Word for Mac to Firefox, macOS | None | Pending until captured. |
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
paste every capture's exact flavors into the fixture editor in Chromium,
Firefox and WebKit, with both policies, in the paste cleanup browser workflow:
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
  Word's 12 pt arrives as WebKit's `medium`, the editor's default size. A copy in
  Chrome or Firefox may carry fewer styles, since cleanup resolves no
  stylesheet; that is for their rows to show.
- B07 is pinned in both the editor's default schema and the full one. The
  default schema has no Subscript or Superscript, so the 2 of H2O and of x2
  paste without them, the oracle expects them absent there, and the visible
  notice reports `destination-formatting-unconfirmed` in both policies.

Limits of this row:

- The fixture editor received each capture through a synthetic paste event with
  the captured flavors. A native paste into the editor (the procedure's step 4)
  was not recorded, so styles WebKit would compute in the receiving page are not
  covered; Playwright WebKit 26.0 is not Safari 26.5.2.
- The lists document defines its lists as named list definitions
  (`mso-list-name` `D3 ...`) rather than through the Home tab libraries its
  blocks name. Their level texts and fonts are the libraries', except that the
  `o` level names its font per script; a library-made document is still to be
  captured.
- Header Row is a Word table style option: Safari's HTML has no header cells,
  so the first row pastes as ordinary cells. Cell borders, padding and widths
  follow the destination table.
- Word's empty paragraph, a paragraph mark holding one no-break space, pastes
  as an empty paragraph. Safari leaves hidden text out of the copy. `1)` and `a)` paste as decimal and alphabetic lists, without
  the parenthesis.
- A copy that is one paragraph, pasted into a paragraph, joins it the way
  ProseMirror joins an open slice: the paragraph keeps its own alignment, so a
  centered Word paragraph pasted into an empty one arrives left aligned, with no
  notice. The captured selections start with a heading and do not show it.
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
| `word-*-safari` (nineteen) | The owner's native Word 16.113.3 for Mac to Safari 26.5.2 captures of 2026-10-02, from the synthetic `word-mac-v1` documents. Every source document declares its emptied author properties, every capture its withheld source hash, and `word-unsupported-list-profiles-safari` its replaced home folder path (version 2 manifests). | The blocks of the scenario's selection as the content specification authors them, and per policy the replay's warning codes and the editor's notice and codes, authored from the specification and reviewed against the editor results. | Reviewed: this matrix qualifies the Safari row with them. The tooling still reports `qualification: false`. |

Owner documents and captures were redacted on the owner's request before
anything was committed: the author e-mail address in each document's properties
and the account name in one picture bullet path. The originals were deleted.
Each declaration holds fingerprints taken from the redacted copy and no hash of
an original, and each capture withholds the hash it recorded of its source
document, which held the address, because an unsalted hash of it would confirm a
guessed address; see [Declared redactions](./README.md#declared-redactions).

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
