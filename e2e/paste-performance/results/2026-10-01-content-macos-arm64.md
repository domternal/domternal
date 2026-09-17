# Content loading and HTML output against 1.2.0, 2026-10-01

Applications without PasteCleanup paid more than in the published 1.2.0 for loading
JSON content and for HTML output. Measured in Chromium, Firefox and WebKit before
the changes of this report, `setContent` with JSON took 36 to 203 percent longer by
document and engine, `generateHTML` up to 49 percent, the initial load with JSON
content up to 22 percent in Chromium, and `getHTML` 12 to 18 percent for heading-dense
documents and 6 to 15 percent for styled content. Profiles named the causes; two
commits remove most of the cost with byte-identical outputs and unchanged diagnostics.
`getHTML` of articles is now at or below 1.2.0, their initial load within 1 percent of
it, and `generateHTML` of the 40 and 160 section articles within 8 percent;
`setContent` with JSON, and the initial load of the heading and styled documents,
still cost more, as listed below.

- Timing JSON SHA256: `ae2c1ad44d85ab8f764d550f4fd47bffcb7d2b7d9da4b27c6fd6bd81b18b4a0c`
- Equivalence JSON SHA256: `2161ae72f8b92b9b166f2581f7be146c9016b9a9f449e9c7efef819256a2eaab`

## Method and environment

The [content performance harness](../../content-performance/README.md) bundles one
page once per variant, every variant against the workspace's ProseMirror, linkifyjs
and floating-ui files, so the comparison isolates Domternal's own code:

- **1.2.0**: the registry packages `@domternal/core`, `extension-image` and
  `extension-table` 1.2.0 of `tests/mixed-version/v1.2.0`.
- **Before**: the build of `daa1ce1`, whose packages equal those of `2ebb649`, the
  state the release review measured. This bundle came from an earlier output of the
  harness, and both JSON files first named it by its local path. Its entry now gives
  what that output recorded for it: the commit, the inputs and `dirty: true`, since
  source edits for the changes below had begun in the checkout, though not yet been
  built, when it was bundled. A clean checkout of `daa1ce1`, built and bundled by the
  harness, gives the same bundle, SHA-256
  `086ff635ae4f57dc28514ed8abb725f8f6d64b1b5da09ef6fea652839c5853b4`.
- **After**: the build of the clean commit `c706475`, which holds `edce42c` and
  `24b068b`.

The application is StarterKit with TextStyle, TextColor, Highlight, FontSize,
FontFamily, TextAlign, LineHeight, Image and Table. Eight documents from a 4 section
article (about 4 thousand characters of HTML) to 1,000 styled paragraphs (about 205
thousand) include the release review's heading and styled shapes. Six rounds per
engine, each loading the three variants in fresh contexts in an order that rotates
and reverses by round. A cell gives the 1.2.0 median in ms, then each build's paired
change from 1.2.0 in percent: the median over rounds with the lowest and highest
round in brackets. Initial load is timed per construction, so in Firefox and WebKit,
whose clocks give whole milliseconds here, it moves in whole-millisecond steps.

The run took 12 minutes from 03:33:20 UTC on the Apple M1 Max (10 logical CPUs,
64 GiB, Darwin 25.5.0), Node 24.13.0, Playwright 1.58.2, Chromium 145.0.7632.6,
Firefox 146.0.1 and WebKit 26.0. It started right after a cached `pnpm build`, at a
load average of 14.53, 11.56 and 11.65; the one-minute load before each page was 5.60
to 14.53, median 6.56 (Firefox 5.70 to 7.08, WebKit 5.60 to 7.17). A Pro capacity dry
run in a separate scratch clone and a Chrome renderer of the owner's were the
background load; nothing else ran in the Free checkout.

## What cost more, and what changed

CPU profiles of the before build in Chromium (`Profiler` sampling at 50
microseconds) named these costs:

| Operation | Cost found | Change |
| --- | --- | --- |
| `setContent` with JSON | The table extension's unsupported span guard (since 1.2.0) walked every node of the new document on each document-replacing transaction, comparing it with the old one: about 41 percent of `setContent` on the heading document, next to prosemirror-tables' own `fixTables` walk, which 1.2.0 has as well | `24b068b`: each node remembers whether its subtree holds a table with an unsupported span; a document that holds none skips the walk, and otherwise the walk runs as before |
| Initial load, `setContent`, `generateHTML` | Every link href was checked by the URL policy twice, once while loading and once while rendering, and `generateHTML` builds a new schema with a new copy of the default schemes on every call, so neither check was remembered there | `edce42c`: one cache of URL checks per Link policy, keyed by the schemes and `allowRelative`, which loading and rendering share |
| Initial load, `setContent`, `generateHTML` | The JSON normalization walk looked up the schema's normalized attributes and allocated closures and result objects for every node and mark | `edce42c`: one map lookup per node and mark, no allocation for types without a normalized attribute |
| `getHTML` of headings | Rendering each heading validated the `levels` option again, copying it, before its cache check | `edce42c`: an unchanged option list is read from the cache first, and a level the list holds returns at once |
| `getHTML` of styled content | The color rewrite looked up the style attribute in every start tag of output that holds any `rgb` | `edce42c`: a tag without `rgb` is passed over |

Every change keeps the result the same function of the input. Before and after were
compared with the harness's equivalence mode on 8 seeds of 250 documents full of edge
values per engine, 6,000 documents in all, 5,583 of them with diagnostics: heading
levels from 0 to 7, decimal strings and objects, unknown list markers, hrefs with
script schemes, credentials, relative forms and non-strings, and CSS values that try
to add declarations. Every output of `normalizeContent`, `generateHTML`, initial
content, `getHTML` plain and styled, `getJSON` and `setContent`, and every diagnostic
and event, was identical. The unit tests of both packages, the link security browser
suites and the table suites passed in all three engines.

## Results

#### Initial load with JSON content

| Document | chromium 1.2.0 ms | before % | after % | firefox 1.2.0 ms | before % | after % | webkit 1.2.0 ms | before % | after % |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| article-s | 1.40 | +14 [+0, +14] | +0 [-7, +7] | 3.00 | +0 [+0, +50] | +0 [+0, +50] | 2.00 | +0 [+0, +0] | +0 [+0, +50] |
| article-m | 3.70 | +22 [+8, +47] | +0 [-12, +53] | 6.00 | +17 [+17, +17] | +0 [+0, +17] | 6.00 | +17 [+17, +33] | +0 [+0, +17] |
| article-l | 10.3 | +21 [+16, +31] | +1 [-4, +10] | 21.0 | +9 [-4, +32] | +0 [-15, +18] | 15.0 | +13 [+13, +36] | +0 [-6, +14] |
| outline-m | 1.40 | +0 [+0, +23] | +7 [+0, +23] | 2.00 | +0 [+0, +50] | +0 [+0, +50] | 2.00 | +0 [+0, +50] | +0 [+0, +50] |
| outline-l | 3.00 | +17 [+6, +26] | +7 [+3, +19] | 5.00 | +20 [+0, +20] | +0 [+0, +20] | 4.00 | +0 [+0, +33] | +0 [+0, +33] |
| headings-only | 4.70 | +17 [+16, +20] | +14 [+0, +17] | 10.0 | -10 [-11, +0] | +0 [-11, +50] | 5.00 | +20 [+20, +20] | +20 [+20, +20] |
| styled-m | 2.80 | +11 [+0, +14] | +7 [+0, +15] | 4.00 | +25 [+0, +25] | +25 [+0, +25] | 4.00 | +0 [+0, +33] | +0 [+0, +33] |
| styled-l | 9.80 | +11 [+6, +21] | +7 [-1, +14] | 20.0 | +15 [-19, +33] | +10 [-22, +56] | 12.0 | +8 [+0, +18] | +0 [+0, +18] |

#### setContent with JSON

| Document | chromium 1.2.0 ms | before % | after % | firefox 1.2.0 ms | before % | after % | webkit 1.2.0 ms | before % | after % |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| article-s | 0.036 | +85 [+85, +96] | +62 [+57, +78] | 0.059 | +72 [+61, +108] | +40 [+33, +70] | 0.019 | +203 [+191, +216] | +86 [+79, +91] |
| article-m | 0.448 | +89 [+78, +96] | +90 [+58, +109] | 0.620 | +92 [+50, +126] | +65 [+32, +108] | 0.227 | +182 [+172, +197] | +82 [+80, +98] |
| article-l | 2.64 | +88 [+84, +96] | +49 [+46, +50] | 3.06 | +85 [+70, +96] | +72 [+48, +107] | 1.16 | +183 [+176, +189] | +67 [+66, +86] |
| outline-m | 0.389 | +66 [+56, +69] | +37 [+33, +46] | 0.310 | +55 [+33, +96] | +66 [+59, +106] | 0.129 | +139 [+135, +157] | +84 [+74, +93] |
| outline-l | 3.54 | +78 [+76, +81] | +17 [+16, +18] | 1.46 | +85 [+64, +102] | +67 [+49, +114] | 1.04 | +199 [+178, +199] | +78 [+67, +81] |
| headings-only | 9.23 | +78 [+78, +80] | +9 [+9, +12] | 3.44 | +86 [+80, +95] | +69 [+48, +103] | 2.69 | +197 [+197, +206] | +70 [+67, +73] |
| styled-m | 0.756 | +36 [+30, +42] | +16 [+16, +22] | 0.614 | +37 [+23, +57] | +36 [+11, +77] | 0.210 | +100 [+95, +117] | +58 [+44, +59] |
| styled-l | 5.26 | +51 [+46, +59] | +11 [+5, +15] | 3.57 | +52 [+41, +77] | +41 [+14, +75] | 1.50 | +138 [+133, +157] | +54 [+51, +71] |

#### getHTML

| Document | chromium 1.2.0 ms | before % | after % | firefox 1.2.0 ms | before % | after % | webkit 1.2.0 ms | before % | after % |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| article-s | 0.063 | -1 [-2, +3] | -5 [-6, -3] | 0.123 | -11 [-14, -8] | -14 [-17, -12] | 0.109 | -3 [-5, +1] | -3 [-10, -3] |
| article-m | 0.843 | +2 [-4, +7] | -2 [-11, +1] | 1.60 | -10 [-20, -3] | -13 [-21, -7] | 1.54 | -1 [-5, +1] | -8 [-10, -1] |
| article-l | 3.47 | +4 [-4, +17] | -3 [-7, +8] | 6.80 | -2 [-11, +5] | -3 [-11, +13] | 6.00 | +0 [-2, +3] | -2 [-6, +7] |
| outline-m | 0.256 | +15 [+6, +19] | +0 [-2, +5] | 0.460 | +6 [+0, +9] | +0 [+0, +17] | 0.420 | +7 [+0, +14] | +5 [-6, +7] |
| outline-l | 1.03 | +13 [+5, +21] | +5 [+1, +11] | 1.88 | +4 [+0, +17] | +0 [-7, +13] | 1.69 | +12 [+11, +19] | +6 [+2, +10] |
| headings-only | 1.70 | +18 [+15, +21] | +5 [+4, +14] | 3.22 | +13 [+7, +17] | +4 [+0, +13] | 2.92 | +12 [+6, +18] | +3 [-5, +8] |
| styled-m | 1.39 | +13 [+8, +21] | +8 [+4, +13] | 2.46 | +6 [-2, +13] | +4 [+2, +11] | 2.15 | +10 [+3, +15] | +3 [-3, +11] |
| styled-l | 7.30 | +15 [+10, +23] | +11 [+9, +13] | 12.5 | +12 [+4, +24] | +11 [+0, +20] | 10.7 | +6 [+0, +10] | +3 [+0, +10] |

#### generateHTML

| Document | chromium 1.2.0 ms | before % | after % | firefox 1.2.0 ms | before % | after % | webkit 1.2.0 ms | before % | after % |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| article-s | 0.169 | +49 [+44, +55] | +23 [+17, +39] | 0.320 | +42 [+30, +51] | +13 [+9, +35] | 0.211 | +30 [+25, +37] | +8 [+4, +14] |
| article-m | 1.26 | +38 [+27, +47] | +5 [-1, +17] | 2.15 | +39 [+4, +60] | +2 [-19, +19] | 1.72 | +31 [+29, +43] | +2 [+2, +9] |
| article-l | 5.08 | +29 [+27, +39] | +3 [+0, +13] | 8.50 | +23 [+17, +61] | +0 [-20, +21] | 6.60 | +31 [+21, +33] | +8 [+3, +14] |
| outline-m | 0.517 | +11 [-2, +38] | +0 [-13, +36] | 0.780 | +26 [+17, +31] | +13 [+10, +18] | 0.560 | +17 [+7, +33] | +14 [+3, +23] |
| outline-l | 1.86 | +16 [-0, +24] | +10 [+0, +18] | 3.06 | +7 [-5, +26] | +10 [-13, +24] | 2.00 | +20 [+18, +24] | +11 [+11, +19] |
| headings-only | 3.36 | +15 [+12, +32] | +19 [+14, +42] | 4.50 | +23 [-3, +33] | +10 [-11, +40] | 3.33 | +19 [+16, +24] | +11 [+6, +16] |
| styled-m | 1.93 | +11 [+6, +15] | +9 [+3, +12] | 3.00 | +6 [-12, +15] | -1 [-13, +10] | 2.15 | +11 [+7, +16] | +8 [+3, +12] |
| styled-l | 9.33 | +5 [-6, +22] | +3 [-9, +12] | 14.3 | +10 [-3, +31] | +5 [-14, +30] | 10.0 | +13 [+3, +21] | +10 [+3, +17] |

## What still costs more

- The initial load with JSON content stays slower for the heading and styled
  documents: `headings-only` by 14 percent in Chromium [+0, +17] and 20 percent in
  WebKit, the outlines and styled documents by about 7 percent in Chromium, and
  `styled-m` by 25 percent and `styled-l` by 10 percent in Firefox. Firefox and WebKit
  load these documents in 4 to 20 ms on whole-millisecond clocks, so a millisecond is
  5 to 25 percent there, while the Chromium figures resolve finer; the initial load was
  not profiled further.
- `setContent` with JSON stays slower than in 1.2.0: by 9 to 90 percent in Chromium,
  36 to 72 percent in Firefox and 54 to 86 percent in WebKit. Loading now checks every
  heading level, list marker and link href of the content and reports what it replaces,
  which 1.2.0 never did, and the table guard reads every node of new content once.
  For the large article this is about 1.3 ms more in Chromium (2.64 to 3.93 ms) and
  0.8 ms in WebKit. The checks are the cost of loading every stored document safely;
  a single walk that normalizes and judges tables together is possible later work.
- `generateHTML` stays 10 to 19 percent slower for the heading document, up to 14
  percent for the outlines and 8 to 23 percent for the 4 section article, where the
  schema `generateHTML` builds on every call weighs most; these were not profiled
  further.
- `getHTML` of styled content stays 3 to 11 percent slower: each style value is checked
  before it is written, and the color rewrite reads only start tags.
- A first load of a document checks each distinct href once; the shared cache helps
  repeated loads, renders and `generateHTML` calls of the same hrefs.

## Limitations

- One machine under the background load listed above; the 25 ms batches and the
  rotated, paired rounds limit the influence of load, but do not remove it.
- Synthetic documents, timed as single calls of the public API; framework wrappers,
  painting and collaboration are outside the measurement.
- Firefox and WebKit time an initial load to whole milliseconds.
