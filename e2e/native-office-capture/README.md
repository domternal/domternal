# Native Office clipboard evidence capture

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


This is local research tooling, not the PasteCleanup extension or an Office
source matcher. It captures the representations exposed by one browser paste
event. It does not control Office applications, infer image bindings, upload
data, request clipboard permissions or call `navigator.clipboard.read()`.

The harness itself captures nothing automatically: its automated tests use
synthetic events and generated File objects, and a complete bundle always has
`qualification: false`, with its source application and operator metadata
self-reported, including when its event was trusted. The native captures in
[`fixtures`](./fixtures) were made by the owner with this page and reviewed; the
[support matrix](./SUPPORT-MATRIX.md) states what they qualify.

## Start locally

No package build or new dependency is required. From the repository root:

```sh
node e2e/native-office-capture/server.mjs
```

Open `http://127.0.0.1:5896` in the exact browser being qualified. The loopback
server serves only the page and its modules/styles; it has no upload handler. Browser modules and
Web Crypto require a suitable origin, so opening the HTML as a `file:` URL is not
the supported launch method. After loading, the tool makes no network requests.
The page's CSP denies connections, images, frames, objects and form submission.
Do not run an Office capture while native clipboard E2E tests are running.

## Capture procedure

1. Author a synthetic source document with known test images, no customer data
   and no personal information. Keep the document and original images locally.
   Compute its SHA-256, for example with `shasum -a 256 fixture.docx`. Record the
   exported source document hash for a web editor and state its export method.
2. Enter exact OS, application and browser versions/builds, fixture ID/hash,
   scenario, copy action and selected range. For Google Docs, also record capture
   date and its web application context because no stable public build may be
   available. Confirm that the source is synthetic.
3. Enable the capture area. Copy from the source application using the documented
   action, return to the page and paste into that area using the OS command.
   The handler prevents insertion and snapshots strings, raw item indices and
   File references synchronously. It never renders copied HTML.
4. Review the metadata summary. Use **Download capture JSON** explicitly to save
   the bundle. Downloads contain source strings, original file names, image or
   other file bytes and hashes. Source formats can contain local paths or other
   hidden information, which is why a synthetic document is required. Inspect
   the local bundle before sharing or committing it. No download is automatic.
5. Keep independent expected image placements with the fixture. Compare captured
   bytes or a separately verified decoded image with that expectation. Fixture
   verification is not permission to match production images by position,
   count, filename, dimensions, similar text or appearance.

Cancel or the 15 second binary extraction deadline produces an incomplete
diagnostic-only bundle. Late reads/digests cannot change it. A new capture may
retry, subject to the outstanding-work cap below. Clear drops the page's result,
invalidates active extraction and revokes download URLs. The page retains no
localStorage, IndexedDB or server copy. Browser internals and downloaded files
have their own lifetime; clearing the page does not erase a downloaded file.

## Initial scenarios and source matrix

Use the same independently authored scenarios on each exact source/OS/browser
combination. Record successes, missing data and unsupported combinations. The
text, list and table scenarios for Word for Mac are described in
[Word for Mac capture preparation](#word-for-mac-capture-preparation), and the
Google Docs scenarios, including images, in
[Google Docs capture preparation](#google-docs-capture-preparation).

| Scenario | Required source evidence |
| --- | --- |
| `mixed-one-image` | Text before and after one embedded PNG or JPEG. |
| `mixed-two-images` | Two different images with identical dimensions, separated by text. |
| `repeated-image` | One image placed twice, with different alt text or display geometry. |
| `same-name-different-images` | Different source bytes from two files with the same basename. |
| `table-images` | Images in distinct table cells, including text in the cells. |
| `image-only` | Copy the image object alone, separately from mixed selection. |
| `chart-or-shape` | Native chart, drawing, WordArt or grouped object; no assumed raster support. |
| `partial-selection` | A range containing some image placements and excluding others. |
| `missing-or-unavailable-image` | Linked or unavailable source resource; preserve the failure evidence. |
| `google-docs-image-limit` | Separate 50-image and 51-image selections and any slow-copy omission. |

Start with Word on macOS to Safari to observe its explicit resource URL path,
then Word on Windows to Chrome/Edge and Firefox, Google Docs to each intended
browser, and desktop LibreOffice Writer to each intended browser. Treat Word
web and LibreOfficeKit/Collabora as distinct sources. Repeat copies and record
the exact versions. Do not generalize a successful capture to other platforms,
browser releases, clipboard managers or remote-desktop transports.

First qualify paths where the browser exposes the actual resource at its HTML
location, such as a validated data URL. A blob URL is an explicit reference but
is not a durable document URL and is not a DataTransfer File binding. This
harness intentionally does not fetch blob, file or remote URLs. A later bounded
local blob adapter would need its own capture and lifetime evidence.

## Word for Mac capture preparation

Status: **captured for Safari, Chrome and Firefox.** The owner made the captures
with Microsoft Word 16.113.3 (16.113.26092714) on macOS 26.5.2 (25F84): in Safari
26.5.2 (21624.2.5.11.8) on 2026-10-02, and in Google Chrome 154.0.8037.93 and
Mozilla Firefox 155.0.1 on 2026-10-04, when the list and table scenarios were
also captured again in Safari from recreated documents. Each covers every
`word-*` scenario except the large document, `word-headings-styles` as its three
selections. They are the reviewed fixtures `fixtures/<scenario>-<browser>`; the
large document and `domternal-own-copy` are pending. The owner or a named tester
creates the documents and performs every copy and paste. Native Word is not automated:
earlier automation attempts timed out, and a scripted copy would not be the user
path this evidence is meant to show.

- [`content/word-mac-v1.json`](./content/word-mac-v1.json) is the machine-readable
  content specification, prepared for Word 16.111 (build 16.111.26071325) on
  macOS and captured with Word 16.113.3, as its `captures` record. It defines four
  documents block by block (exact text starting with a block identifier, Word
  style or button to use, expected structure, marks and list markers) and the
  scenarios with their selection and expected notice outcome. Corrections after
  the first captures carry a `correction` that says what changed and why. The
  text is synthetic Croatian and English without personal data.
- [`content/large-source.mjs`](./content/large-source.mjs) generates the large
  source: 128 sections, 10,000 words, headings, paragraphs, nested lists and
  tables, every block starting with a consecutive `G00001` token.
- [`semantics.mjs`](./semantics.mjs) compares a saved editor result, HTML from
  the offline replay or a capture bundle, whose HTML it replays like the offline
  verifier, with a scenario: block order by identifier, block types, heading
  levels, list kind, marker, depth and ordinal, the table, row, column and spans
  of each cell, alignment, text, marks, links and text styles, image removal and
  the diagnostic outcome of the chosen policy, including text styles that `adapt`
  must remove. For a specification that authors its documents' `textStyle`, as
  the Word one does, the comparison is exhaustive: a block, an empty paragraph, a
  mark, a text style value, an alignment, a line spacing or a cell shading the
  specification does not author is a problem, and a kept text style must be the
  one Word shows. A result without the attribute, such as the default schema
  without LineHeight, has no spacing to compare; the notice reports it. A stored
  line height must be a plain ratio, the only form LineHeight renders: a
  percentage or a length stays in the document without changing the spacing, so
  it is a problem. HTML white space reads as the editor parses it, one space
  for each run of it, so a source line Word wraps inside an item's text does not
  separate the item from its marker. Given the
  destination's profile (its mark types and textStyle attributes, which the
  browser regression reads from the live schema), a mark or text style the
  destination cannot hold is expected absent rather than missing, and one that
  is there anyway is a problem. A capture replayed offline has no destination,
  so warnings only a destination reports are not required of it, and an editor
  result whose blocks carry the line height attribute comes from a destination
  with LineHeight, which stores the spacing a scenario authors, so a warning the
  scenario requires of a destination without it is not required there. It never compares exact HTML and never qualifies. `--dry-run <content.json>` checks a synthetic
  result built from the specification for every scenario and both policies, and
  `--print <content.json>` lists the texts an operator enters.
- [`prepare-fixture.mjs`](./prepare-fixture.mjs) checks a downloaded bundle's
  integrity and any declared redaction and writes a review skeleton: a version 2
  `manifest.json` whose `expected` is `null`, or, with `--specification` and
  `--scenario`, holds the blocks that scenario authors and empty outcomes, which
  `offline.mjs` refuses until a reviewer authors both outcomes, and
  `capture-summary.json` with the operator metadata, every text flavor's length
  and the location of each redaction.
- [`redact.mjs`](./redact.mjs) removes personal data from a bundle or a source
  document before anything is committed and writes the declaration a manifest
  carries; see [Declared redactions](#declared-redactions).

### Documents to create

Create each document in Word for Mac exactly as its blocks describe, save it as
`.docx`, and compute its hash with `shasum -a 256`. Keep the files locally and
review them for hidden data (author, comments, tracked changes, paths) before any
commit. Do not upload them to a conversion service.

| Document | Content |
| --- | --- |
| `word-mac-v1-basics.docx` | Title and headings, Croatian letters, typographic quotes, a nonbreaking space, inline marks, font, color and highlight, alignment, line spacing, indents, hidden text, empty paragraphs |
| `word-mac-v1-lists.docx` | Default bullets and numbering at three levels, continue, restart and start at 5, mixed nesting, `1)`, `a)`, `A.` and `I.` numbering, 28 alphabetic items, unsupported profiles (dash, check mark, arrow, picture bullets, legal numbering) |
| `word-mac-v1-tables.docx` | A 3x3 table with a header row, shading and merged cells, a borderless table, a list inside a cell |
| `word-mac-v1-large.docx` | Run `node e2e/native-office-capture/content/large-source.mjs > /private/tmp/large-v1.html`, open that file in Word for Mac, save it as a Word document and copy only from the saved `.docx` |

Google Docs has its own specification, below: never upload the Word `.docx`,
because that would capture a third-party conversion. LibreOffice later: open the
Word-saved `.docx` locally and save it as `.odt`.

### Matrix for the first captures

Word for Mac to Safari, Chrome and Firefox (record the exact versions at capture
time), for every `word-*` scenario and the `domternal-own-copy` scenario, with
both preserve and adapt. All three are captured, except the large document and
the own copy. A selection that a scenario names as a separate one, such as
`word-headings-styles-b06`, has a scenario of its own. Its capture may record that
scenario, as the Chrome and Firefox captures do, or the one `capturedAs` names, as
the Safari captures do. Windows, Word on the web and
LibreOffice stay unqualified and Google Docs pending in the
[support matrix](./SUPPORT-MATRIX.md).

### Admitting a browser

The Chrome and Firefox captures were admitted the way the Safari ones were;
nothing in the tooling is specific to a browser:

1. Capture each scenario as [Per capture](#per-capture) describes, into
   `fixtures/<scenario>-<browser>/`. A capture of a document that is committed
   as it is, such as the basics document of the Safari fixtures, names its hash
   and needs no source redaction. One that names the hash of a document whose
   properties had to be emptied declares the source redaction with
   `redact.mjs package` and withholds the hash it names with
   `redact.mjs capture ... --withhold-fixture-hash`.
2. Expect Word's local paths. Chrome and Firefox carry Word's raw clipboard
   HTML, which links Word's temporary files under the user's home folder in its
   head (the clipboard file list, theme data and color scheme mapping) and writes
   a picture bullet as a `file:` image with a `list-style-image` URL; Safari
   keeps only the latter. `prepare-fixture.mjs` refuses what its scan finds;
   remove it with `redact.mjs capture`, naming the home folder prefix through the
   account name with the `file:` scheme and its slashes and without it, so each
   link becomes one token and a picture bullet's image source a relative
   reference. The scan also reads image metadata in the document and in
   clipboard files, people and custom document properties, text written with
   HTML, percent or CSS escapes, and what an RTF flavor's hexadecimal groups
   decode to. `redact.mjs` cannot edit an image inside a document or a clipboard
   file's pixels: when one holds personal data, capture again from a document
   whose pictures carry none. The one clipboard file it edits is a PNG whose
   display profile names its display unit, as Chrome's picture of the
   selection does: `redact.mjs file` clears the serial number and manufacture
   date there (see [Declared redactions](#declared-redactions)).
3. Prepare with `--specification` and `--scenario`, then run
   `pnpm exec playwright test --config e2e/paste-cleanup.config.ts paste-native-fixtures.browser.ts`.
   It fails for a fixture whose outcomes are not authored yet: review that
   fixture's editor results with the fixture editor and the checker of step 5,
   then author both outcomes.
4. Run `offline.mjs` on each directory and the regression spec again, add the
   row to the support matrix with the recorded versions and limits, and commit.

What Chrome and Firefox expose besides Word's HTML is part of the evidence:
both expose `text/rtf` (38,484 to 57,215 bytes in these captures, about the size
of the HTML), which PasteCleanup never reads, and Chrome exposes one `image/png`
file, Word's picture of the whole selection, which the regression pastes with
the other items and which is never inserted, read or bound. The capture summary
records each flavor's length, and the bundle the file's bytes and hash.

### Archived captures

The first Safari captures of the ten list and table scenarios, of 2026-10-02,
were admitted in commit `d01af47` and replaced on 2026-10-04 by captures of the
same scenarios from recreated documents, under the same fixture identifiers. The
first lists document defined its lists as named list definitions from
templates rather than Word's own libraries, so it showed no right aligned
numbering level, and the first tables document ended with two empty paragraphs
after the last table. Those captures stay in Git history; the unit tests in
`packages/extension-paste-cleanup/src/html/safariWordLists.test.ts` keep their
shape as regression coverage.

### Per capture

1. Start `node e2e/native-office-capture/server.mjs`, open
   `http://127.0.0.1:5896` in the browser being captured and fill the metadata.
   Use the fixture directory name as the fixture identifier, for example
   `word-default-bullets-safari`, and the source document's hash.
2. Only for large selections: before pasting, open the page's developer console
   and run this snippet. It records only flavor names and lengths, because the
   bundle refuses any flavor above 2 MiB:
   `document.addEventListener('paste', e => console.table([...e.clipboardData.types].map(t => [t, e.clipboardData.getData(t).length])), { capture: true, once: true })`
3. Copy in Word with the scenario's selection, paste once into the capture area
   and download the bundle.
4. Paste the same Word selection natively into the fixture editor. After
   `pnpm build`, start it from the repository root with
   `node apps/demo-react/node_modules/vite/bin/vite.js --config e2e/paste-cleanup-fixture/vite.config.mjs`,
   open `http://127.0.0.1:5895/?framework=vanilla&formatting=preserve&list-markers=1`
   (then `formatting=adapt`), paste, record whether the notice is visible and run
   `copy(JSON.stringify({ results: __pasteCleanup.results, doc: __pasteCleanup.editor.getJSON() }))`
   in the console. Save the result as `editor-preserve.json` or `editor-adapt.json`.
5. Check it against the specification:
   `node e2e/native-office-capture/semantics.mjs e2e/native-office-capture/content/word-mac-v1.json word-default-bullets editor-preserve.json preserve`.
   Problems are findings to record, not a reason to edit the capture.
6. Put `source.docx` and `capture.json` into
   `e2e/native-office-capture/fixtures/<scenario>-<browser>/`. Scan both for
   personal data (unzip the document; read every text flavor); remove what you
   find with `redact.mjs` as [Declared redactions](#declared-redactions)
   describes, never by hand. Then run
   `node e2e/native-office-capture/prepare-fixture.mjs <that directory> --id <scenario>-<browser> --source source.docx --specification e2e/native-office-capture/content/word-mac-v1.json --scenario <scenario>`,
   adding `--redactions redactions.json` when there are declarations.
7. Review before committing: confirm the source contains no personal or hidden
   data, check that `expected.blocks` is what the content specification authors
   for the selection, author the outcome of each policy (`expected.preserve` and
   `expected.adapt`: the status, the source, the sorted warning and error codes
   of the offline replay, and the notice and codes of the fixture editor with
   its default schema, or with every capability where the content needs it, or a
   list with one entry per schema to pin the fixture in both) from
   the specification and the reviewed editor results, never by copying
   normalizer output; when a block authors hidden text, add
   `expected.hiddenText`: `copied` when the capture holds it, which then
   pastes, or `omitted` when the browser left it out of the copy, as Safari
   does; delete `redactions.json` once the manifest holds it, and
   run `node e2e/native-office-capture/offline.mjs` on the directory. Keep
   unsupported and missing results as they are: a difference from the
   specification is a finding, not a reason to edit the oracle.

```sh
node --test e2e/native-office-capture/preparation.test.mjs
```

These checks cover the specifications' consistency, the pinned large source and
generated images, the semantic checker on authored editor results, on HTML from
the public normalizer and on the synthetic dry run of every scenario, the Google
Docs dry run fixture, and the refusal of an unreviewed skeleton. They use
authored inputs, not captures.

### Declared redactions

A capture or a source document can hold personal data that the synthetic text
does not: Word writes the author's account in the document properties and, for
a picture bullet, a local temporary path under the user's home folder into the
clipboard HTML. Such data is removed before anything is committed, with
[`redact.mjs`](./redact.mjs), and the removal is declared in the manifest, so
what changed stays checkable without keeping anything that identifies a person.

```sh
# A capture: each occurrence of the text becomes the token "redacted", padded with hyphens to the same length.
node e2e/native-office-capture/redact.mjs capture original.json capture.json --replace '<text>' --reason '<why>' --declarations redactions.json
# A Word document: the named elements of a part are emptied; every other part keeps its content.
node e2e/native-office-capture/redact.mjs package original.docx source.docx --clear docProps/core.xml=dc:creator,cp:lastModifiedBy --reason '<why>' --declarations redactions.json
# The capture of a redacted document: the source hash its operator recorded becomes the 64-character token.
node e2e/native-office-capture/redact.mjs capture original.json capture.json --withhold-fixture-hash --reason '<why>' --declarations redactions.json
# A PNG clipboard file: its display profile's serial number and manufacture date become zero; its pixels stay.
node e2e/native-office-capture/redact.mjs file capture.json capture.json --item <index> --reason '<why>' --declarations redactions.json
```

- A replaced text is printable ASCII of at least eight characters; extend a
  shorter one with its surroundings, for example an account name with the
  home folder path before it, so no local path remains. Its byte length, the flavor's
  length and the bundle's totals do not change, and the tool refuses a text
  that also appears outside the text flavors.
- No declaration records a hash of an original, and a capture whose source
  document was redacted withholds the source hash its operator recorded: an
  unsalted hash of a file that held a name or an address confirms a guess of
  that name or address, offline and in moments. A source redaction and a
  withheld source hash therefore always come together, and the tie between the
  capture and its document is the declaration, the fixture identifier and the
  content the oracle checks.
- A PNG clipboard file, such as Chrome's picture of a Word selection, carries
  the ICC profile of the display it was drawn on, and macOS writes Apple's make
  and model tag (`mmod`) into it: the display's manufacturer, model, serial
  number and manufacture date. The serial number names the unit. `redact.mjs
  file` zeroes the serial number and the manufacture date, computes the
  profile ID again when the profile has one, compresses the profile again and
  keeps every other chunk byte for byte, so the pixels and how they are drawn
  do not change. The bundle's record of the file (its bytes, hash and length),
  its item's size and the file total follow, and the capture's own declaration,
  when it has one, names the new bundle. Run it after `redact.mjs capture`, or
  before it: the capture's fingerprint leaves the records of declared clipboard
  files out, since their own declarations hold them.
- Each declaration records the redacted SHA-256, whether the original is
  retained, the reason, the replaced locations, withheld fields, cleared
  elements or cleared profile fields (never the removed values) and
  fingerprints of everything the redaction left unchanged: the capture with
  its replacements, withheld fields and redacted clipboard files' records
  masked, every part of the package with its cleared elements emptied, and the
  picture with its profile decompressed and the cleared fields and the profile
  ID zeroed.
- The fingerprints are taken from the original. When the original no longer
  exists, run the same command on the redacted copy with `--redacted-copy`: the
  declaration then has the basis `redacted-copy`, and its fingerprints hold the
  redacted copy from then on without proving what the original held. A package
  whose elements are already empty keeps its bytes and hash.
- `offline.mjs` verifies a version 2 manifest against its declarations: the
  bundle's source claim must equal the committed source hash, or be withheld
  exactly when the source declares its redaction; the committed files must match
  their redacted hashes and fingerprints; every replacement and withheld field
  must hold its token; every cleared profile field must be zero, in the one
  profile a declared PNG clipboard file holds before its image data, and its
  profile ID zero or the profile's own; and the token `redacted`, in any letter case, may appear
  nowhere else in the bundle. An undeclared redaction, a declaration that records
  an original hash or any change outside the declared locations is refused with
  `evidence-schema`, `evidence-provenance` or `evidence-redaction`. It reports
  each redaction with `originalVerified: false`, since no original is ever read.

## Google Docs capture preparation

Status: **prepared, not captured.** Google Docs on macOS to Chrome, Safari and
Firefox is captured by the owner or a named tester with the
[Google Docs runbook](./GOOGLE-DOCS-RUNBOOK.md); nothing here qualifies a source
profile.

- [`content/google-docs-v1.json`](./content/google-docs-v1.json) mirrors the Word
  specification where Google Docs supports it. Seven documents
  (`gdocs-v1-basics`, `-lists`, `-tables`, `-images`, `-large-image`, `-mixed`
  and `-large`) are defined block by block with the Google Docs command for
  each, and 34 `gdocs-*` scenarios give the selection, the expected editor
  result in preserve and in adapt, the machine-checked outcome of each policy
  and, for images, what to record from the capture. They cover headings, a
  plain paragraph, Croatian text, bold, italic and underline, links, lists and
  nested lists with Google's markers, tables with merged cells, images by URL, a
  large image, the slow copy, the 50 image limit and partial selections.
- [`content/google-docs-images.mjs`](./content/google-docs-images.mjs) writes the
  57 PNG images the documents insert, outside the repository: solid colors of
  known sizes, a 5.8 MB noise image of 1600 x 1200 pixels and 51 small images for
  the limit. The bytes do not depend on the zlib version and are pinned by tests.
  The noise image exceeds the capture's 5 MiB file and 2 MiB text flavor limits
  and has a document of its own, whose `.docx` export, the fixture source of each
  of its captures, stays below the 16 MiB source limit of `prepare-fixture.mjs`
  and `offline.mjs`.
- The fixture editor allows no remote images, so an image that Google Docs serves
  by URL is expected to be removed with `image-removed`, its alt text staying in
  its place. Its default schema has no LineHeight, so preserve is expected to
  report the line spacing Google Docs writes on every paragraph as
  `destination-formatting-unconfirmed`, which shows the notice; adapt removes it.
- Google Docs may write a `br` between blocks, after a table or for an empty
  paragraph. The editor makes one paragraph of line breaks from each run of
  them: until its specification authors its documents' `textStyle`, which makes
  the comparison exhaustive as for Word, the checker ignores empty blocks a
  scenario does not name and compares no text style it does not name, and
  reports two empty paragraphs that arrive as one in `gdocs-empty-paragraphs`.
  Admitting the Google Docs captures includes authoring both from them.
- The specification assumes the list shape Google Docs is expected to write:
  each marker as `list-style-type` on its `li`, and a nested list placed
  directly in its parent list. The checker reads that nesting. Cleanup moves a
  marker that every direct item of a list declares to the list, so the authored
  shape pastes with its markers. That rule is checked against authored HTML
  only; the captures confirm or correct the shape.

Check that the checker can express every scenario under both policies:

```sh
node e2e/native-office-capture/semantics.mjs --dry-run e2e/native-office-capture/content/google-docs-v1.json
```

[`fixtures/google-docs-dry-run-v1`](./fixtures/google-docs-dry-run-v1) runs the
procedure once without Google Docs: authored HTML in the Google Docs shape for
`gdocs-mixed-document`, a capture bundle from a Node synthetic event and a
manifest with reviewed preserve and adapt oracles. The offline verifier accepts
it, and the checker replays its bundle:

```sh
node e2e/native-office-capture/offline.mjs e2e/native-office-capture/fixtures/google-docs-dry-run-v1
node e2e/native-office-capture/semantics.mjs e2e/native-office-capture/content/google-docs-v1.json gdocs-mixed-document e2e/native-office-capture/fixtures/google-docs-dry-run-v1/capture.json preserve
```

The last command reports no problems: the list markers of `GM04`, `GM05` and
`GM06` arrive on their lists. It is an authored approximation of the Google
Docs clipboard, not a capture.

## Bundle contract and limits

`capturePaste(event, operator, { signal?, limits? })` returns a frozen bundle.
Limits can only be lowered to positive safe integers. The extraction module
uses browser APIs and can also be tested on the repository's Node 22 runtime.

- `schemaVersion: 1`, `harnessVersion`, ISO capture time and exact operator input.
- `status: complete | incomplete`, `qualification: false` without exception.
- `provenance.eventKind`: `native-event`, `synthetic-event` or `unverified-event`.
  `nativeClipboardCaptured` is true only for a brand-checked genuine browser
  ClipboardEvent whose intrinsic trust value is true and whose extraction
  completed. Node mocks always remain synthetic. This proves event transport,
  not which application authored it or whether all OS formats were exposed.
- Scope is explicitly `allowlisted-formats-and-exposed-files`. All observed
  format names and raw item indices/kind/type are retained on success. Payload
  strings are limited to `text/html`, `text/plain`, `text/rtf`, `application/rtf`,
  `text/uri-list` and legacy `Text`, only when present in the observed type list.
  `omittedFormats` lists all other types; their bytes are deliberately not read.
- Every exposed File has name/type/size/lastModified metadata, original item
  index, exact base64 bytes and SHA-256. No matching, normalization, image
  decoding or deduplication is performed. Repeated indices remain distinct.
  Item MIME and File MIME are recorded separately even when they disagree;
  such discrepancies are evidence for later qualification, not extraction errors.
- Inaccessible files, getter/read errors, size mismatches, cancellation and
  exceeded limits produce `payload: null` plus a static diagnostic. No partial
  payload is presented as complete evidence. Exception messages are excluded.

| Hard ceiling | Value |
| --- | --- |
| Original items / observed formats | 64 / 32 |
| Each operator, filename or type string | 512 UTF-16 units |
| Each text format / all text | 2 MiB / 4 MiB UTF-8 |
| Each file / all file items | 5 MiB / 10 MiB |
| Combined captured text and declared file bytes | 12 MiB |
| JSON output | 24 MiB UTF-8 |
| Binary extraction duration | 15 seconds |
| Outstanding native read/hash jobs across cancelled retries | 2 jobs, 10 MiB of declared file bytes |

Before binary reading, a conservative output preflight reserves six bytes per
source UTF-16 unit, exact base64 expansion and bounded metadata/JSON overhead.
It may reject an input whose eventual compact JSON would fit. Rejection is
explicit; evidence is never silently truncated. Final JSON size is checked too.
Base64 encoding uses bounded chunks, not a second full-size binary string. File
read output must be a nonshared ArrayBuffer of exactly the captured size.

The input, base64 strings, serialization and download Blob can coexist. The
limits bound these representations, not exact engine heap usage or GC timing.
Cancelled native `arrayBuffer()` and `crypto.subtle.digest()` calls cannot be
forcibly interrupted. Their reservations remain until actual settlement, and
the harness discards late output. If both jobs hang, further binary captures
report `read-capacity`; text-only capture remains possible. The page keeps one
active capture, one displayed result and short-lived download URLs.

## Evidence behind the qualification boundary

- [Clipboard HTML processing](https://www.w3.org/TR/clipboard-apis/#process-an-html-paste-event)
  describes `cid:N` as an index in the full `DataTransfer.items` list and still
  marks this multipart mechanism at risk. It does not establish implementation.
- [DataTransferItem](https://html.spec.whatwg.org/multipage/dnd.html#the-datatransferitem-interface)
  exposes kind/type and a File getter, without a general Content-ID attribute.
- [Microsoft RTF 1.9.1, Pictures](https://officeprotocoldoc.z19.web.core.windows.net/files/Archive_References/%5BMSFT-RTF%5D.pdf#page=148)
  defines picture bytes, `blipuid` and `bliptag`. Those identifiers alone do not
  prove a join to an HTML image or a browser File item.
- [WebKit clipboard improvements](https://webkit.org/blog/8170/clipboard-api-improvements/)
  documents blob URL references. The current
  [WebContentReaderCocoa source](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/editing/cocoa/WebContentReaderCocoa.mm)
  also has SDK-gated data URL branches for WebArchive/image handling; RTF/RTFD
  still uses a blob map. Source on `main` does not prove shipped Safari behavior.
- [Google Docs copy help](https://support.google.com/docs/answer/161768?co=GENIE.Platform%3DDesktop&hl=en)
  documents HTML image copying and the 50-image/slow-copy limitation, without
  promising a File-item identity or durable URL.
- LibreOffice's
  [clipboard exporter](https://github.com/LibreOffice/core/blob/master/sw/source/uibase/dochdl/swdtflvr.cxx)
  enables `EmbedImages` specifically for LibreOfficeKit. The desktop
  [HTML writer](https://github.com/LibreOffice/core/blob/master/sw/source/filter/html/wrthtml.cxx)
  has a temporary base URL path. These source paths need distinct captures.

Sources inspected on 2026-09-24. The existing Pro feasibility manifest explicitly
contains synthetic OOXML, and the existing native clipboard E2E tests copy from
Domternal. Neither is a native Office qualification fixture.

## Automated extraction checks

```sh
node --test e2e/native-office-capture/capture.test.mjs
pnpm exec eslint e2e/native-office-capture/*.mjs
pnpm exec playwright test --config e2e/native-office-capture/browser.config.mjs
```

The tests exercise extraction, indices, source snapshots, limits, File branding,
cross-realm ArrayBuffers, read errors, cancellation, deadlines, late settlement,
JSON/base64/hash correctness and source-level page restrictions. They do not
drive a native application or prove native browser trust. Separate browser tests
exercise the actual page in Chromium, Firefox and WebKit using explicitly
synthetic paste events, inert source HTML, manual downloads, cancellation
and late completion. They do not constitute native Office captures.

## Offline evidence validation and replay

The versioned [support matrix](./SUPPORT-MATRIX.md) separates implemented behavior,
synthetic checks and the still-pending native Office evidence. The included
`fixtures/synthetic-v1` bundle is authored synthetic data, not an Office capture.

With Node 22 and the existing public Free HTML build available:

```sh
node e2e/native-office-capture/offline.mjs e2e/native-office-capture/fixtures/synthetic-v1
node --test e2e/native-office-capture/capture.test.mjs e2e/native-office-capture/offline.test.mjs e2e/native-office-capture/redaction.test.mjs
pnpm exec eslint e2e/native-office-capture/offline.mjs e2e/native-office-capture/offline.test.mjs e2e/native-office-capture/redact.mjs e2e/native-office-capture/redaction.test.mjs
```

`offline.mjs` only reads the explicitly selected fixture directory. Its manifest
names one source artifact and one complete capture JSON, with exact SHA-256
values, origin, fixture ID, license and preserve/adapt oracles. A version 1
manifest, such as the synthetic fixtures', holds exact HTML oracles. A version 2
manifest, for claimed native fixtures only, adds the declared redactions and
holds a semantic oracle instead: the blocks the content specification authors
for the selection, and for each policy the status, the source and the sorted
warning and error codes, which the replay must match exactly, with the block
model of [`semantics.mjs`](./semantics.mjs) rather than exact HTML, whether the
copy holds the hidden text a block authors (`hiddenText`, which the browser
decides and the oracle states exactly when a block authors one), plus the
notice and codes the fixture editor regression checks, as one outcome or a list
with one outcome per editor schema; the regression runs once per entry. A Word package source is
read as a bounded ZIP only when a redaction is declared for it. Relative
artifact paths reject traversal, absolute paths and symlinks escaping that root.
Symlinks resolving within the selected root are allowed. The tool is local
repository tooling, not a filesystem sandbox against concurrent directory changes.
Payload filenames and image URLs are never opened as filesystem paths.

Validation checks the producer's versioned shape and limits, format inventory,
full item indices, exact text/file totals, canonical base64, decoded file hashes
and agreement with source provenance claims. Incomplete or truncated bundles
are refused. Before JSON parsing, a lexical guard bounds nesting to 12 and
container, string and primitive tokens to 8,192, and rejects duplicate object
keys; JSON.parse still validates syntax. Manifest/source/capture reads are
bounded to 128 KiB, 16 MiB and 24 MiB respectively before their buffers are
allocated. The capture's own lower limits remain in force. Resource ceilings
bound representations and work, not exact JavaScript heap usage or GC timing.

Replay loads the built public `@domternal/extension-paste-cleanup/html` entry,
normalizes only the captured HTML with remote images disabled and data images
enabled, and compares exact output, source signature and diagnostic codes with
the reviewed manifest. Each expected output is limited to 32,768 UTF-16 units
and 100 diagnostic codes. The source artifact is hashed, not parsed or executed.
File bytes are validated and discarded; no Files, browser events, editor
transactions, match callbacks or resolver calls are created. This is not a
mixed-image replay or an operating-system clipboard test.

The command prints a frozen-data report without source HTML, binary contents,
filenames or URLs. It writes no artifacts and performs no network requests.
Refusals use fixed `evidence-*` codes without raw exception details. The library
helpers expose a private HTML handle; `disposeCaptureEvidence` drops it, and
`verifyCaptureFixture` disposes it automatically. Owned read/decoded byte buffers
are zeroed on release. Immutable source strings and caller-owned inputs are not
claimed to be erased from engine memory.

Every committed version 2 fixture is also replayed into the real fixture editor
by [`paste-native-fixtures.browser.ts`](../paste-native-fixtures.browser.ts), which
the paste cleanup browser workflow runs in Chromium, Firefox and WebKit. The
paste carries every captured item in captured order, each file rebuilt from its
bytes with its name, type and modification time, so Chrome's picture of a Word
selection reaches the editor as it did the capture page:

```sh
pnpm exec playwright test --config e2e/paste-cleanup.config.ts paste-native-fixtures.browser.ts
```

All reports remain `qualification: false`, `nativeEvidenceAuthenticated: false`
and `sourceApplicationVerified: false`. A `claimed-native` manifest can validate
a consistent stored native-event claim, but saved JSON cannot authenticate its
origin. A manually edited bundle plus updated hashes is still unqualified.
No fixture is promoted automatically and this command does not modify the
support matrix or authorize publication.
