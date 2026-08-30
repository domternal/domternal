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


Matrix version: `free-paste-evidence-v1`. Recorded on 2026-09-27 for the
unreleased paste cleanup work. This is an evidence inventory, not a fidelity
score or a release approval. The [package contract](../../packages/extension-paste-cleanup/README.md)
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
| HTML safety and formatting | Shared resource-free normalizer, preserve/adapt policies, supported inline/inherited styles and bounded loss diagnostics. | [Normalizer tests](../../packages/extension-paste-cleanup/src/html/), [browser contracts](../paste-cleanup.browser.ts) | General stylesheet cascade, all Office-specific markup and exact RGBA transparency are not promised. |
| Office-shaped lists | Explicit supported decimal/bullet metadata reconstructs bounded list runs; unsupported patterns retain text with diagnostics. | [List tests](../../packages/extension-paste-cleanup/src/html/officeLists.test.ts), [browser contracts](../paste-cleanup.browser.ts) | Native list profiles, arbitrary legal numbering and every restart form remain unqualified. |
| Destination capabilities | Resource-free probes inspect the actual destination schema. Unrepresentable table structure blocks insertion; supported formatting demands receive bounded diagnostics. | [Capability tests](../../packages/extension-paste-cleanup/src/destinationCapabilities.test.ts), [browser contracts](../paste-destination.browser.ts) | A successful probe is not exact source-style fidelity or support for every custom node. |
| Local embedded images | Explicit host bindings connect rich HTML references to exposed items. Validated inline raster URLs retain their own placements. | [Asset browser contracts](../paste-assets.browser.ts), [resolver browser contracts](../paste-resolver.browser.ts) | No automatic general CID, filename, position or byte-similarity association. No remote source fetching. |
| Persistent images | Host resolver, exact allowed origins, source data-image transport, resource ownership and recovery notifications. | [Resolver contracts](../paste-resolver.browser.ts), [private lifecycle tests](../../packages/extension-paste-cleanup/src/clipboard/resolverLifecycle.test.ts) | Mock adapters do not certify a production storage service or prove that aborted remote work stopped. |
| Receipt, cancellation and history | Accepted-operation receipts, target revalidation, deferred image cancellation, history boundaries and four framework integrations. | [Feedback browser contracts](../paste-feedback.browser.ts), [asset browser contracts](../paste-assets.browser.ts) | No built-in import preview or paste-choice dialog. Host callbacks and feedback are explicit integration seams. |
| Existing comment anchors | Actual Free paste and Pro Comments share real editor parsing, copy/cut rules, image replay and history. | [Cross-repository gate](../../domternal-pro/tests/paste-comments/README.md) | This does not import Word discussions or qualify Yjs document collaboration. |
| Performance | A recorded paired local run covers synchronous synthetic input and default feedback. | [Reference report](../paste-performance/results/2026-09-26-macos-arm64.md) | One machine and fixed inputs only. Observed paired p95 was 4.6 to 22.0 ms; an absolute enabled dispatch reached 799 ms. No universal latency bound. |
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
| Word desktop | macOS to Safari, Chromium and Firefox | None | Pending. Local automation attempts produced no complete native capture; they are not qualification evidence. |
| Word desktop | Windows to Chrome/Edge and Firefox | None | Pending; not exercised by macOS synthetic tests. |
| Word web | Each declared source browser to each supported destination path | None | Pending; separate from desktop Word. |
| Google Docs | Exact capture date, source context, browser and OS | None | Pending, including large-image and slow-copy omissions. |
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

The [manifest](./fixtures/synthetic-v1/manifest.json) pins the exact source and
capture SHA-256 values and an explicitly reviewed output for both policies. The
capture timestamp is an authored deterministic fixture value, not a native event
timestamp. Exact wrapper serialization was reviewed against the public
normalizer; the oracle is never derived from that normalizer during a test.
The fixture is MIT-licensed synthetic content without customer data.

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
