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


Matrix version: `free-paste-evidence-v2`. Recorded on 2026-09-28 for the
unreleased paste cleanup work; it replaces `free-paste-evidence-v1` of 2026-09-27.
Version 2 adds the quiet routine envelope, same-page own copy recognition, Word
list profiles from level definitions, per-item list fallback, the large paste
measurement and the prepared Word for Mac capture scenarios. The prepared Google Docs scenarios and
their synthetic dry run fixture were added on 2026-10-01 without changing any evidence level. This is
an evidence inventory, not a fidelity score or a release approval. The [package contract](../../packages/extension-paste-cleanup/README.md)
defines current behavior and its limits.

## Evidence levels

| Label | What it establishes | What it does not establish |
| --- | --- | --- |
| Authored synthetic input | Reproducible behavior for fixed, independently described inputs in unit or browser tests. | Native Office clipboard availability or source application fidelity. |
| Stored native claim | A complete bundle claims a trusted event and records operator metadata. Its stored bytes match a reviewed manifest. | Authenticity of saved JSON, source application identity, completeness of OS formats or correct image association. |
| Reviewed native fixture | A separately documented source, copy action, exact application/OS/browser versions, capture and independently checked expected result have been reviewed together. | Other versions, platforms, clipboard managers or remote desktop paths. |

There are currently **no reviewed native Office fixtures in this directory**.
The offline validator always returns `qualification: false` and
`nativeEvidenceAuthenticated: false`, including for a consistent stored native
claim. Editing a bundle and its manifest can produce matching hashes. Hashes
detect disagreement with a reviewed manifest; they are not signatures or proof of
capture origin. Source detection such as `source: word` is an HTML heuristic.

## Implemented behavior and its current evidence

The links below point to executable contracts. They do not imply that a test was
rerun every time this matrix is read. Browser inputs are synthetic unless a test
explicitly says otherwise. Chromium's native editor-copy case copies from
Domternal, not from Office.

| Area | Current bounded behavior | Evidence | Remaining qualification or limit |
| --- | --- | --- | --- |
| HTML safety and formatting | Shared resource-free normalizer, preserve/adapt policies, supported inline/inherited styles and bounded loss diagnostics. Routine clipboard envelope elements, Office wrappers and Office private, neutral or destination-owned declarations are removed without a warning. | [Normalizer tests](../../packages/extension-paste-cleanup/src/html/), [browser contracts](../paste-cleanup.browser.ts), [feedback contracts](../paste-feedback.browser.ts) | General stylesheet cascade, all Office-specific markup and exact RGBA transparency are not promised. Whether native Word and Google Docs envelopes stay quiet needs the native captures. |
| Own copies and ProseMirror slices | A `data-pm-slice` marker is structural context. Only a same-page PasteCleanup copy marker keeps editor formatting; nested or duplicate markers are removed. | [Slice origin tests](../../packages/extension-paste-cleanup/src/html/sliceOrigin.test.ts), [own copy tests](../../packages/extension-paste-cleanup/src/PasteCleanup.ownCopy.test.ts), [list marker contracts](../paste-list-markers.browser.ts) | Copies across tabs, applications or separate package instances are external by design. |
| Office-shaped lists | Explicit inline list metadata reconstructs bounded lists. Word level definitions from the clipboard stylesheet and the marker run font identify default bullets (disc, circle, square) and decimal, alphabetic and Roman numbering; without definitions only decimal numbers and Unicode bullets are admitted. An unsupported item stays a literal paragraph while the rest of its run is reconstructed. | [List tests](../../packages/extension-paste-cleanup/src/html/officeLists.test.ts), [level definition tests](../../packages/extension-paste-cleanup/src/html/officeListStyles.test.ts), [list marker contracts](../paste-list-markers.browser.ts) | Native list profiles are unqualified until captured. Legal and multilevel numbering, prefixed or custom level text, picture and symbol bullets other than the Word defaults, and letters past z stay literal. |
| Destination capabilities | Resource-free probes inspect the actual destination schema. Unrepresentable table structure blocks insertion; supported formatting demands receive bounded diagnostics. | [Capability tests](../../packages/extension-paste-cleanup/src/destinationCapabilities.test.ts), [browser contracts](../paste-destination.browser.ts) | A successful probe is not exact source-style fidelity or support for every custom node. |
| Local embedded images | Explicit host bindings connect rich HTML references to exposed items. Validated inline raster URLs retain their own placements. | [Asset browser contracts](../paste-assets.browser.ts), [resolver browser contracts](../paste-resolver.browser.ts) | No automatic general CID, filename, position or byte-similarity association. No remote source fetching. |
| Persistent images | Host resolver, exact allowed origins, source data-image transport, resource ownership and recovery notifications. | [Resolver contracts](../paste-resolver.browser.ts), [private lifecycle tests](../../packages/extension-paste-cleanup/src/clipboard/resolverLifecycle.test.ts) | Mock adapters do not certify a production storage service or prove that aborted remote work stopped. |
| Receipt, cancellation and history | Accepted-operation receipts, target revalidation, deferred image cancellation, history boundaries and four framework integrations. | [Feedback browser contracts](../paste-feedback.browser.ts), [asset browser contracts](../paste-assets.browser.ts) | No built-in import preview or paste-choice dialog. Host callbacks and feedback are explicit integration seams. |
| Existing comment anchors | Actual Free paste and Pro Comments share real editor parsing, copy/cut rules, image replay and history. | Cross-repository gate in the Domternal Pro repository (`tests/paste-comments`), which is not public | This does not import Word discussions or qualify Yjs document collaboration. |
| Performance | Recorded paired local runs cover synchronous synthetic input and default feedback, with and without `imageAssets`. | [Reference report](../paste-performance/results/2026-10-01-macos-arm64.md), [earlier report](../paste-performance/results/2026-09-26-macos-arm64.md) | One machine and fixed inputs only. Observed paired p95 was 4.0 to 31.0 ms, 6.0 to 31.0 ms with `imageAssets`. Known limit: in Firefox, the engine's cycle collector can run inside a paste and add several hundred milliseconds to it (up to 873 ms observed, about 0.7 percent of enabled dispatches at 100 ms or more); the routes without PasteCleanup show it too, but less often, since cleanup allocates more per paste: enabled dispatches reached 100 ms 1.8 times as often as those without PasteCleanup, and 9 times as often with `imageAssets`. No universal latency bound. |
| Large pastes | Seven synthetic profiles swept to their largest accepted size; every larger input is rejected explicitly with nothing inserted, never truncated. | [Large paste report](../paste-performance/results/2026-09-28-large-macos-arm64.md) | Synthetic profiles on one machine. The parser allocation bound stops most Word profiles below the D4 target of 10,000 words. A Word RTF flavor of any size does not reject a paste: PasteCleanup never reads it. |
| Offline capture integrity | Versioned complete bundle schema, bounded artifacts, checksums, provenance claims and exact HTML replay through public Free `/html`. | [Offline tests](./offline.test.mjs), [synthetic manifest](./fixtures/synthetic-v1/manifest.json) | No native acquisition, editor insertion, resource matching or automatic qualification. |

## Native source matrix

Every row is pending. Application/browser versions must be recorded with the
actual capture, not inferred from installed software or synthetic source markup.
The [capture scenarios](./README.md#initial-scenarios-and-source-matrix) include
different images of equal size, repeated images, tables, partial selections and
missing resources. Text, lists and styles need independently authored expected
semantics alongside those image cases.

| Source | Intended platform/path | Reviewed native fixture | Current status |
| --- | --- | --- | --- |
| Word desktop | macOS to Safari, Chromium and Firefox | None | Pending. Prepared: [content specification](./content/word-mac-v1.json) and scenarios for Word 16.111 on macOS, to be captured by the owner or a named tester. Local automation attempts produced no complete native capture; they are not qualification evidence. |
| Word desktop | Windows to Chrome/Edge and Firefox | None | Pending; not exercised by macOS synthetic tests. |
| Word web | Each declared source browser to each supported destination path | None | Pending; separate from desktop Word. |
| Google Docs | macOS to Chrome, Safari and Firefox, with the exact capture date and source context | None | Pending, including large-image and slow-copy omissions. Prepared: [content specification](./content/google-docs-v1.json), generated images and the [runbook](./GOOGLE-DOCS-RUNBOOK.md), to be captured by the owner or a named tester. |
| LibreOffice Writer | Desktop application, exact OS/browser pair | None | Pending; not inferred from LibreOfficeKit behavior. |
| Collabora/LibreOfficeKit | Exact web application/browser path, if supported later | None | Unqualified optional source profile. |

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
2. Review the source and capture for personal or hidden data before committing
   them. Record expected text, structure, formatting and image ownership
   independently of the cleanup output. Keep unsupported results visible.
3. Add an explicit fixture manifest and run offline checks. A passing result
   confirms integrity and its bounded HTML oracle only. File bytes are checked
   but are not replayed as `DataTransfer` items.
4. Add the necessary real editor, asset association and history regressions for
   the reviewed source profile. Document the exact verified combination and
   limitations in a new matrix revision. Retain negative and missing-data cases.
5. Run the final package and browser release gates on the release commits and
   review user documentation. Native review and joint Free/Pro release approval
   remain separate decisions; this script cannot grant them.
