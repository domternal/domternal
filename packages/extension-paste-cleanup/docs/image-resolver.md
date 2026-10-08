# Store clipboard images through an application resolver

Use this reference to implement the explicit persistent-image adapter and its ownership protocol. Start with [clipboard images](https://github.com/domternal/domternal/blob/main/packages/extension-paste-cleanup/docs/images.md) for placement matching, preparation budgets and target invalidation.

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

## Configure the resolver

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

## Allowed source URLs

`sourcePolicy.allowedOrigins` is a required declaration of exact HTTP(S) origins.
It allows at most 32 entries, 2,048 UTF-16 units per entry and 8,192 in total.
Origins can have a trailing slash but cannot contain paths, credentials, queries,
fragments or wildcards. Normalization handles host casing, default ports and
international domain names. Subdomains and different ports are separate origins.
HTTP requires an explicit entry, for example for local development. Resolver
URLs are limited to 8,192 units each; temporary, relative, credential-bearing,
local-file and executable references are refused before insertion. These checks
do not certify a server's durability or the bytes it later serves.

## Adapter methods and resource registration

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

## Cancellation and accepted ownership

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

## Recovery reports

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
