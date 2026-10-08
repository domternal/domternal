# Paste limits, links and security boundaries

Use this reference to set resource ceilings and understand where the destination editor or application remains responsible. The normalizer produces editor input; it is not a general HTML publication policy.

## Configurable HTML limits

Defaults are hard ceilings. Callers can lower them with `limits`; invalid or
expanded values throw a `RangeError` in the standalone API. The editor extension
wraps invalid configuration in `ExtensionConfigurationError` and fails setup,
so normal extension error isolation cannot silently disable cleanup.

| `limits` field | Counts | Default |
| --- | --- | ---: |
| `maxInputLength` | Input UTF-16 code units | 2,000,000 |
| `maxNodes` | Parser allocations and generated output tree nodes | 30,000 |
| `maxDepth` | Tree depth | 128 |
| `maxDiagnostics` | Retained diagnostics | 100 |
| `maxTableCells` | Expanded table cells across the fragment | 20,000 |
| `maxImages` | Images | 200 |
| `maxImagePixels` | Declared raster pixels across the fragment | 50,000,000 |

## Structural and generated-output bounds

Additional fixed bounds protect attributes per tag, attribute-name length,
table spans, individual raster dimensions/pixels, and GIF frames. A `colspan` or
`rowspan` reads as a browser and the Table extension read it, the whole number it
starts with and 1 when it is missing, invalid or zero, and only a span above
1,000 rejects the paste with `structure-limit`. A lexical work
guard runs before parse5, including conservative checks in comments/raw text.
Generated inherited-style attributes share the input-length ceiling, preventing
a long source value from multiplying across many text or hard-break leaves without
a bound. Every generated mark and typography wrapper consumes the shared node and
depth allowance before it is allocated.
HTML/structure rejection inserts nothing; removed images, links and unsupported
formatting are reported without discarding unrelated text.

## Plain text and clipboard flavors

Plain text and Markdown have a conservative markup-token budget, checked before
the Markdown, link and image handlers can expand them. Outside a code block,
every line break and every `*`, `_`, `~`, `` ` ``, `[`, `]`, `<` and `>` counts as
one token, a Windows line ending as two, and more than `maxNodes` tokens (30,000
by default) reject the paste with `input-limit`. The plain-text flavor of a rich
paste is counted as well, so a log, a CSV or spreadsheet export or another copy
whose plain text runs past about 30,000 lines, or 15,000 with Windows line
endings, is refused even when its HTML alone would fit. In a code block only the
input length ceiling applies.
The clipboard flavors the editor reads, `text/html` and `text/plain` (also as
`Text`), are checked against the input ceiling before parsing, so one oversized
flavor rejects the whole paste with `input-limit`. Flavors PasteCleanup never reads,
such as `text/rtf`, `application/rtf` and `text/uri-list`, are not checked and do
not reject a paste, however large. ProseMirror falls back to `text/uri-list` only
when the clipboard has no plain text, and the text it makes of it then goes through
the plain-text checks.

## Synchronous work and capacity

Parser allocations count every element, comment and text insertion the HTML
parser makes. Office's conditional comments, whose content is parsed again for
the source and for Office lists, share one more allowance of `maxNodes`, and
reading them stops at the first comment the limits refuse.

The allocation count grows with words, inline fragmentation and stylesheet content, so the input ceiling is not a document-size guarantee. Output wrappers can exhaust the node allowance before raw input does. Cleanup runs synchronously; file reads in image preparation are asynchronous, but encoding and serialization run on the main thread. These budgets are not browser heap or latency bounds.

Recorded [large-document measurements](https://github.com/domternal/domternal/blob/main/e2e/paste-performance/results/2026-09-28-large-macos-arm64.md) and [paired browser measurements](https://github.com/domternal/domternal/blob/main/e2e/paste-performance/results/2026-10-01-macos-arm64.md) describe synthetic inputs on one machine. They include engine collection pauses and must not be treated as guaranteed capacities or response times.

## Links and titles

Relative links require an explicitly supplied HTTP(S) `sourceURL`. The receiving
page URL and pasted `<base>` are never used. Fragment links need a destination
anchor mapping and currently retain their text with a `link-removed` diagnostic.
This includes the `#_Toc` links of a Word table of contents.

Links are checked against the destination too. Each sanitized link uses `http:`,
`https:`, `mailto:` or `tel:`, and a constant probe, `<p><a href="...">Probe</a></p>`
parsed by the editor's own schema parser in a detached container, confirms which of
these schemes the editor stores: a scheme counts only when the parsed text carries a
mark with exactly the probe's href, which follows the `Link` extension's `protocols`
and URL policy and also finds a link mark with another name. A link whose scheme the
editor lacks, for example every link when the editor has no `Link` extension or
`StarterKit.configure({ link: false, linkPopover: false })`, keeps its text and formatting and is reported
once with `link-removed`. Links never add `destination-formatting-unconfirmed`. Every
address `safeLink` keeps is also one the core URL policy allows, so the destination
`Link` stores it unchanged. The standalone `/html` entry has no destination and keeps
every sanitized link.

A link or image `title` longer than 512 characters is dropped and reported with
`unsupported-formatting`. `target`, `rel` and `name` are dropped without a diagnostic:
they describe the source page rather than the content, and Word writes a `name`
bookmark for every table of contents entry.

## Trusted Types

The normalizer parses HTML without the DOM, so cleanup itself needs no Trusted
Types policy. To learn what the destination editor supports, PasteCleanup parses a
few constant HTML probes, never clipboard content, with the editor's own parse
rules, and assigns them to `innerHTML` without a policy of its own. On a page that
enforces Trusted Types (`require-trusted-types-for 'script'`), a default policy
that passes these probes leaves PasteCleanup unchanged. Without one, every probe
fails and PasteCleanup fails closed. In Chromium and WebKit, which enforce the
directive, tables are then refused with `destination-table-unsupported` and the
`unsupported-content` reason, links lose their target with `link-removed` and
keep their text, Office lists keep their literal markers with
`office-list-unsupported`, and pasted formatting, headings and lists reach the
document with a `destination-formatting-unconfirmed` warning, so the notice asks
the user to review the paste. Nothing unsafe is inserted.

## Network and trust boundaries

Cleanup never fetches a remote image, local URL or relative link. Enabling remote image references permits later editor rendering to contact those hosts. Explicit image resolvers and the Image extension's existing upload handler are application-owned network boundaries; see [clipboard image routing](https://github.com/domternal/domternal/blob/main/packages/extension-paste-cleanup/docs/images.md).

Source signatures and `data-pm-slice` are not trust signals. Own copies still pass HTML, URL, style and resource checks. Custom node attributes, renderers, identifiers and comment ownership remain the application's responsibility. Source HTML is not stored in diagnostics or editor storage.
