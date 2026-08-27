# @domternal/extension-paste-cleanup

Opt-in clipboard HTML cleanup for Domternal. MIT licensed and part of Free.

**Development status:** this is the initial HTML normalization foundation on the
Import feature branch. It is not a released DOCX importer or a claim of complete
Word, Google Docs, or LibreOffice fidelity. Office list reconstruction, stylesheet
resolution, clipboard asset matching and the Pro DOCX workflow are subsequent work.

## Editor integration

```ts
import { PasteCleanup } from '@domternal/extension-paste-cleanup';

const extensions = [
  // Include your usual document nodes, marks and history extension.
  PasteCleanup.configure({
    formatting: 'preserve',
    onResult(result) {
      // Present localized feedback for result.diagnostics in your application.
      // A rejected result inserts nothing and leaves the document unchanged.
      reportPasteDiagnostics(result.diagnostics);
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
Styles inherited from arbitrary wrapper elements and stylesheet rules are not
resolved. The destination schema still determines which retained inline styles
become document attributes.

`adapt` removes external font family, font size, colors, text alignment and line
spacing while retaining structure and emphasis. Set `preserveTextAlignment: true`
to keep source text alignment in this mode. Validated internal slice metadata preserves
existing editor formatting in either mode. A forged `data-pm-slice` marker still
passes through all HTML, URL, style and resource checks.

Remote images are removed by default, with escaped alt text where available.
Enabling `allowRemoteImages` retains HTTP(S) references: later rendering can then
contact those hosts, and their dimensions/content are outside the local raster
checks. Local files, blob URLs, CID references and SVG data images are removed.
No upload handler or external asset resolver is invoked by this package.

PNG, JPEG, GIF and static WebP data images are bounded by declared dimensions,
frame count, byte length and total pixels. APNG and animated WebP are not accepted.
Container inspection does not decode compressed pixels or certify image integrity.
If `allowDataImages` is false, all data images are removed. Match this setting to
the destination Image extension's `allowBase64` policy.

Relative links require an explicitly supplied HTTP(S) `sourceURL`. The receiving
page URL and pasted `<base>` are never used. Fragment links need a destination
anchor mapping and currently retain their text with a `link-removed` diagnostic.

## Resource limits

Defaults are hard ceilings. Callers can lower them with `limits`; invalid or
expanded values throw a `RangeError` during setup or standalone invocation.

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
Plain/Markdown input has a conservative markup-token budget before downstream
handlers can expand it. HTML/structure rejection inserts nothing; removed images,
links and unsupported formatting are reported without discarding unrelated text.

## Current verification limits

Synthetic fixtures test deterministic contracts and hostile input. They are not
clipboard captures from a native Office application. Native Word, Google Docs,
LibreOffice and real operating-system clipboard evidence are separate release
requirements. This package currently exposes diagnostic codes for host-owned
localization; it has no built-in preview, paste-choice dialog or progress UI.
