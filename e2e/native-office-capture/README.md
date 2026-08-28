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

**No native Office capture is included or claimed by this harness.** Automated
tests use synthetic events and generated File objects. A complete bundle always
has `qualification: false`. Its source application and operator metadata remain
self-reported, including when its event was trusted.

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
combination. Record successes, missing data and unsupported combinations.

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
