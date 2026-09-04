# Large paste limits and latency, 2026-09-28

The complete `--large` reference run passed its semantic and protocol checks for
all 43 cases on each of Chromium, Firefox and WebKit: 774 of 774 dispatches, no
failures and no cleanup failures. Every paste either applied every authored token
once and in order, or was rejected with exactly one error and an unchanged
document. **Nothing was truncated silently.** This is one local measurement of
synthetic inputs, not a product-wide capacity or latency bound, and no limit was
changed.

The run used the clean Free commit `54e6966ced0b27cbde9fc1e29733e5f19e69b33a`,
Node 24.13.0 and Playwright 1.58.2 on an Apple M1 Max with 10 logical CPUs and
64 GiB RAM, Darwin 25.5.0 arm64. Headless engines were Chromium 145.0.7632.6,
Firefox 146.0.1 and WebKit 26.0. Initial load averages were 19.74, 18.99 and
21.63; another agent workflow may have been working in the separate Pro
repository, and machine idleness was not certified. The run took 172 seconds,
including the Node sweep. Inputs, protocol and bounds are described in the
[harness README](../README.md#large-documents-and-resource-limits).

- JSON SHA256: `9699b867076028dc6db433d650d455164c98e32f1cebf5735f50e63f7c751be4`

## Where each profile stops

Node sweep over the built public `/html` entry with the default limits
(input 2,000,000 UTF-16 units, 30,000 parser allocations and output nodes, depth
128, 20,000 table cells). Preserve and adapt accept the same maximum except for
heavily formatted runs.

| Profile | Largest accepted | Words | Input units | First bound | D4 target (10,000 words) |
| --- | ---: | ---: | ---: | --- | --- |
| `word-short-paragraphs` | 2,896 paragraphs | 11,584 | 332,175 | parser allocations | accepted |
| `word-fragmented-runs` | 658 paragraphs | 9,870 | 504,638 | parser allocations | rejected at 10,005 words |
| `word-default-lists` | 1,608 items | 6,432 | 816,650 | parser allocations | rejected |
| `word-table` | 1,034 rows | 9,306 | 961,166 | parser allocations | rejected at 10,008 words |
| `word-mixed-document` | 136 sections | 10,744 | 432,447 | parser allocations | accepted |
| `gdocs-document` | 967 paragraphs | 14,505 | 405,959 | parser allocations | accepted |
| `heavily-formatted-runs` | 374 paragraphs (adapt 428) | 3,740 (adapt 4,280) | 293,964 | generated output | rejected |

The first rejected size is always the next block. Every rejection returned empty
HTML with one `structure-limit` error. The accepted maxima produced no warning in
either policy: the routine Word and Google Docs envelope stays quiet. In adapt,
the informational `formatting-adapted` findings fill the 100-finding allowance
and set `diagnosticsTruncated`, and the default notice stays hidden as intended.

## What the parser allocation bound counts

The bound counts parse5 allocation events: every element, comment and text
insertion. parse5 inserts one text chunk per run of whitespace or non-whitespace,
so most events extend an existing text node rather than create one:

| Profile at its maximum | Allocations | Text insertions | Text nodes created | All nodes created | Stylesheet insertions | Output nodes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `word-short-paragraphs` | 29,999 | 21,299 | 2,897 | 11,597 (39 %) | 1,027 | 8,689 |
| `word-fragmented-runs` | 29,991 | 20,109 | 5,923 | 15,805 (53 %) | 1,027 | 20,399 |
| `word-default-lists` | 29,983 | 17,107 | 4,825 | 17,701 (59 %) | 1,027 | 9,649 |
| `word-table` | 29,993 | 16,537 | 3,103 | 16,559 (55 %) | 1,027 | 13,445 |
| `word-mixed-document` | 29,871 | 22,379 | 2,721 | 10,213 (34 %) | 1,027 | 8,025 |
| `gdocs-document` | 29,982 | 28,043 | 967 | 2,906 (10 %) | 0 | 3,870 |

The representative 9 KB Word stylesheet alone costs 1,027 allocations, about
3.4 % of the allowance. Word list items cost the most per word because each item
carries level metadata, a marker run and a spacer. Heavily formatted runs are the
only profile that the generated output tree stops first (29,921 output nodes at
374 paragraphs in preserve).

Counting only created nodes would raise the parser ceiling by a profile-dependent
factor: created nodes are 10 % of the events for Google Docs paragraphs and 34 to
59 % for the Word profiles. The output-tree bound, which already counts real
nodes, would then apply next; fragmented runs reach 20,399 output nodes at their
current maximum. Whether to change the accounting is an owner decision (block 5
step B5-X in the map). This measurement does not change it.

## Browser latency

`syncMs` of five measured single dispatches per case, each in a fresh editor with
the actual Cleanup extension and default feedback. Values are p50 / max in ms;
the first paste of each case is recorded separately in the JSON.

| Profile at its maximum | Policy | Chromium | Firefox | WebKit |
| --- | --- | ---: | ---: | ---: |
| `word-short-paragraphs` | preserve | 75 / 96 | 121 / 151 | 93 / 118 |
| `word-fragmented-runs` | preserve | 144 / 175 | 240 / 269 | 177 / 193 |
| `word-default-lists` | preserve | 152 / 198 | 247 / 260 | 208 / 246 |
| `word-table` | preserve | 174 / 201 | 276 / 329 | 211 / 250 |
| `word-mixed-document` | preserve | 120 / 147 | 192 / 772 | 152 / 184 |
| `gdocs-document` | preserve | 75 / 85 | 118 / 134 | 86 / 101 |
| `heavily-formatted-runs` | preserve | 166 / 188 | 310 / 411 | 240 / 244 |
| `word-table` | adapt | 170 / 199 | 284 / 330 | 210 / 259 |

Rejections are cheaper than acceptance because nothing is inserted: at the first
rejected sizes the p50 ranged from 22 to 56 ms in Chromium, 49 to 118 ms in
Firefox and 24 to 60 ms in WebKit, always with the notice visible.

Firefox showed one tail on `word-mixed-document` in preserve: a first paste of
1,004 ms settled and a measured maximum of 772 ms, against a p50 of 192 ms. The
same case at the D4 target size had a first paste of 571 ms and a maximum of
735 ms. This matches the unexplained Firefox tail already recorded in the paired
evidence; it was kept, not rerun.

## Clipboard flavor ceiling

One case per engine carried a synthetic `text/rtf` flavor of 2,000,001 UTF-16
units next to HTML that alone is accepted (10 short Word paragraphs). Every
engine rejected the whole paste with `input-limit` before parsing, with the
document unchanged. Native Word RTF sizes, especially with embedded images, are
still unmeasured; they need the owner's native captures.

## Limitations

- Synthetic inputs in seven authored profiles, generated deterministically and
  pinned by source hash. They are not native Word or Google Docs clipboard data.
- One machine and one run. Five measured dispatches per case describe this run,
  not a percentile of real use.
- Timings exclude the operating system clipboard, editor construction, painting
  and asynchronous work, as described in the protocol.
- The full local `report.json` equals the committed JSON byte for byte. The raw
  `samples.jsonl` (325,463 bytes, SHA-256
  `8e8237c1248080db9a1ba768fa8cde2ec0a4feefbb588d29b750afe463f05ea9`) stays in local
  scratch and is not a durable dataset; the protocol permits an independent rerun.
