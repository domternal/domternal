# Handle clipboard images

Choose embedded images for local raster data, or an [application resolver](https://github.com/domternal/domternal/blob/main/packages/extension-paste-cleanup/docs/image-resolver.md) for persistent resources. Neither mode supplies automatic Office image association.

## Source HTML images

Remote images are removed by default, with escaped alt text where available.
Enabling `allowRemoteImages` retains HTTP(S) references: later rendering can then
contact those hosts, and their dimensions/content are outside the local raster
checks. Without explicit image preparation, local files, blob URLs and CID
references are removed. SVG data images are always removed. The HTML normalizer
itself invokes no upload handler or resolver. With
`imageAssets: false`, an image-only paste can still be handed to the Image extension,
which uses its configured `uploadHandler` or embedded-data path as described in [image-file routing](https://github.com/domternal/domternal/blob/main/packages/extension-paste-cleanup/docs/images.md#image-files-and-cleaned-content).
Explicit resolver mode uses only the application adapter supplied in `imageAssets`;
it does not call Image's `uploadHandler` or include a storage/network implementation.

PNG, JPEG, GIF and static WebP data images are bounded by declared dimensions,
frame count, byte length and total pixels. APNG and animated WebP are not accepted.
Container inspection does not decode compressed pixels or certify image integrity.
If `allowDataImages` is false, source data images are removed. Match this setting to
the destination Image extension's `allowBase64` policy.

The qualified Google Docs Chrome shapes write each image as a `data:image/png` URL with its alt text and size, so
it is kept as an embedded image. In the editor, an image the destination cannot
hold, a data URL that its Image refuses (`allowBase64: false`) or any image when
the destination has no image node, is removed with `image-removed` and its alt
text in its place. This destination check applies to every source.

## Image files and cleaned content

When the cleaned content has no text of its own, the clipboard's image files are the paste.
White space, a no-break space, invisible format characters such as zero-width spaces, and the
alt text cleanup leaves in place of the images it removes do not count as text, so a copied web
image (an `<img>` next to its file), a meta element, blank paragraphs or a `blob:` image with a
file paste the file instead of nothing or the alt text. Core's `pasteHasOwnText` decides, as it
does for the Image extension and the Link paste. Without `imageAssets`, the Image extension
inserts the files; one file keeps the alt text of the one image the content held when it is
not empty, and an empty `alt` leaves the file without one. Such an
operation reports `untracked` without findings in `onPasteResult` and the notice, since nothing
of the cleaned content reached the document, while `onResult` still reports the cleanup as it
ran. A drop's image files win over its content, even content cleanup rejected, such as HTML over
the input limit, since that content is not inserted: the drop reports `untracked` without
findings and no blocked notice. One dropped file keeps the alt text cleanup left in place of the
one image that drop's content held; a later drop of files alone, as an operating system's file
drag carries them, keeps none. Content with text of its own keeps the paste, since Word and
Excel put a picture of the copied selection next to it (Google Docs' copies in Chrome hold no
file; its copies in Safari and Firefox are not captured), and so does a Word or Excel copy
that places no image, such as empty paragraphs or cells, whose file Chrome exposes as that
picture. Text cleanup removed, Word's hidden text, counts as text of the content's own, so the
picture of the selection, which can show that text, is never the paste of such a copy, also
when its hidden content held an image. A rejected paste never reaches
the files. With `allowBase64: false` and no `uploadHandler`, the Image cannot store
files and the cleaned content pastes as it would without them.

## Enable local embedding

```ts
import { Image } from '@domternal/extension-image';
import { PasteCleanup } from '@domternal/extension-paste-cleanup';

// Add these alongside StarterKit in the editor's extensions.
const imageExtensions = [
  Image.configure({ allowBase64: true }),
  PasteCleanup.configure({ imageAssets: { mode: 'embedded' } }),
];
```

Install `@domternal/extension-image` if the editor does not already use it.

`imageAssets` defaults to `false`. Enable `imageAssets: { mode: 'embedded' }`
alongside `Image.configure({ allowBase64: true })` to prepare image-only clipboard
files as embedded raster images. A paste is image-only when its cleaned content has no text of
its own, as described in [image-file routing](#image-files-and-cleaned-content), so a copied web image, blank paragraphs or a meta element next to a
file prepare the file too, with the one copied image's alt text when it is not empty; the
cleaned operation then
reports `untracked` without findings and the prepared files report as their own `applied`
operation. A local `file:` or `blob:` image reference is not such a stand-in: it follows the
bindings below, so `unresolved: 'reject'` rejects it and `'omit'` leaves its alt text, file or
not. Preparation reads captured local files without
uploading, fetching, creating object URLs or adding document placeholders.

With `imageAssets`, PasteCleanup also owns the editor's clipboard HTML
preparation. Core accepts one per editor, and another registration never takes
over; [Clipboard ownership](https://github.com/domternal/domternal/blob/main/packages/extension-paste-cleanup/docs/clipboard-integration.md#clipboard-ownership) describes a conflict.

## Bind mixed HTML to captured files

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
embedded images. A custom image node can register its policy with
`registerClipboardImageDestination` from the experimental `@domternal/core/clipboard`
subpath; matching a node name alone is insufficient. With several registrations,
pasted images go to the latest active one. An unavailable latest policy leaves no
destination rather than falling back to an earlier registration.
Prepared replacements have their own explicit image policy. `allowDataImages`
continues to control untrusted data images in source HTML.

## Preparation budgets

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

The file limits apply to the files a paste uses. Files count in clipboard order:
a file over `maxFileBytes`, one that would take the files before it past
`maxTotalFileBytes`, and every clipboard item after the first 256 are left out
unread, and the paste goes ahead while no binding uses them, so a large unrelated
attachment does not block a text paste. A binding to a left-out item rejects the
paste with `asset-limit`, under `unresolved: 'omit'` too. So does an image-only
paste that holds a left-out image file or more than 256 items, since it pastes
every image file. In `match`, a left-out file has `available: false` with its type
and size, and the items after the first 256 are not listed.

## Progress, cancellation and target changes

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
`unsupported-destination`, `unsupported-content`, `assets-unavailable`, `asset-limit`
or `asset-read-failed`.
An accepted receipt takes precedence over cancellation or an observer throwing
after the document changed. An unknown custom-handler outcome remains `untracked`.
