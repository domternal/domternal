# @domternal/extension-paste-cleanup

Opt-in clipboard HTML cleanup for Domternal. MIT licensed and part of Free.

**Development status:** this is the initial HTML normalization foundation on the
Import feature branch. It is not a released DOCX importer or a claim of complete
Word, Google Docs, or LibreOffice fidelity. Strict inline Office list metadata and
a bounded subset of inherited formatting are supported. Optional local image
preparation supports image-only pastes and explicit application-supplied bindings.
An explicit resolver mode can stage those raster assets in application-owned storage.
Automatic Office image association, stylesheet resolution and the Pro DOCX
workflow remain subsequent work.

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

## Feedback and accepted results

The default nonmodal notice displays warnings, removed-image guidance and blocked
input. It provides accessible status text, a details disclosure and dismissal
without moving focus or adding document content. A clean paste or intentional
formatting adaptation alone stays quiet. Load the normal `@domternal/theme` CSS
for styling. The notice follows editor adoption and is removed on destruction.

Use `feedback: 'application'` with an `onPasteResult` handler to own presentation.
Omitting that handler is a fatal configuration error. English definitions are
exported as `pasteCleanupMessages`; the optional `/locales/de` entry exports
`deMessages` and `deSearchAliases`. Merge the catalog with your other per-editor
i18n messages. Visible notices update when the locale changes.

`onPasteResult` runs once in a microtask for each observed normalization operation,
including plain-text transforms. Its frozen result contains `operationId`,
`source`, `formatting`, `status`, bounded `diagnostics`, `diagnosticsTruncated` and
`references`, without source HTML. `onResult` includes the same operation ID and
formatting policy synchronously. Callback exceptions cannot revoke an accepted
paste or disable cleanup.

| Status | Meaning |
| --- | --- |
| `applied` | A tagged paste transaction changed the installed editor document |
| `rejected` | Cleanup blocked the operation before insertion |
| `noop` | Nothing survived parsing, or an accepted transaction made no document change |
| `untracked` | No accepted receipt was found, for example after a plugin veto or a custom handler |

An empty cleaned slice preserves the selection instead of deleting selected text.
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
- `diagnostics`: stable codes, severity, and an optional UTF-16 source offset.
- `diagnosticsTruncated`: feedback was bounded, without truncating the HTML.

The result is editor input, not a destination-schema validation or a general
HTML publication policy. The receiving editor still controls its nodes, marks,
URL policies, custom renderers, identifiers and comment ownership. Unsupported
custom node attributes and slice contexts are not implicitly trusted.

## Formatting and assets

`preserve` retains supported semantic tags and allowlisted inline typography,
alignment, table spans, dimensions and list starts. Inline bold, italic,
underline, strike, subscript and superscript styles become semantic marks where
the wrapper permits them. It does not reproduce page layout or arbitrary CSS.
Inherited inline font family, size, color, bold and italic resolve through source
wrappers, including descendant bold/italic resets. Relative `em` and `%` font
sizes resolve only when the source provides a known absolute base. Inline text
decoration and highlight retain supported source semantics; a block or cell fill
does not become text highlighting. Stylesheet rules, CSS variables, the browser's
computed styles and arbitrary CSS inheritance are not resolved. The destination
schema determines which retained styles become document attributes.

`adapt` removes external font family, font size, colors, text alignment and line
spacing while retaining structure and emphasis. Set `preserveTextAlignment: true`
to keep source text alignment in this mode. Validated internal slice metadata preserves
existing editor formatting in either mode. A forged `data-pm-slice` marker still
passes through all HTML, URL, style and resource checks.

Explicit inline `mso-list:lN levelN lfoN` paragraphs with one leading
`mso-list:Ignore` marker can become semantic lists. Supported markers are positive
decimal numbers followed by `.` or `)`, and the Unicode bullets `• · ◦ ▪ ●`.
Nesting, observed starts, restarts and gaps retain separate list wrappers.
SmartPaste preserves reconstructed ordered-list starts when pasting into a list.
The extension probes the receiving schema's actual list parse rules before
removing visible markers. Unsupported runs keep their paragraph text and markers
with an `office-list-unsupported` diagnostic. Roman, alphabetic, legal and symbol
font numbering, class-only lists, and stylesheet definitions are not reconstructed.
The standalone HTML entry has no destination schema and emits semantic list HTML;
its caller remains responsible for destination compatibility.

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
files as embedded raster images. Preparation reads captured local files without
uploading, fetching, creating object URLs or adding document placeholders.

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
embedded images. A custom image node can register its policy with Core's
`registerClipboardImageDestination`; matching a node name alone is insufficient.
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
`unsupported-destination`, `assets-unavailable`, `asset-limit` or `asset-read-failed`.
An accepted receipt takes precedence over cancellation or an observer throwing
after the document changed. An unknown custom-handler outcome remains `untracked`.

Relative links require an explicitly supplied HTTP(S) `sourceURL`. The receiving
page URL and pasted `<base>` are never used. Fragment links need a destination
anchor mapping and currently retain their text with a `link-removed` diagnostic.

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
a long source value from multiplying across many text runs without a bound.
Plain/Markdown input has a conservative markup-token budget before downstream
handlers can expand it. HTML/structure rejection inserts nothing; removed images,
links and unsupported formatting are reported without discarding unrelated text.

## Current verification limits

Synthetic fixtures test deterministic contracts and hostile input. They are not
clipboard captures from a native Office application. Native Word, Google Docs,
LibreOffice and real operating-system clipboard evidence are separate release
requirements. This package has localized loss notices and optional host-owned
feedback and optional image-preparation progress. It has no built-in preview or
paste-choice dialog. Local image association still requires an explicit host
mapping for mixed HTML; these fixtures do not prove native Office association.
The current Core color parser does not retain alpha in RGBA text colors or
partially transparent backgrounds. Exact transparency fidelity is not promised.
