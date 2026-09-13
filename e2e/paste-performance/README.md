# Local paste overhead qualification

This opt-in harness measures existing public Free builds on a recorded reference
machine. It does not claim native Word clipboard provenance, qualify a converter,
or install dependencies. Synthetic `DataTransfer` and `ClipboardEvent` objects
need no operating-system clipboard permission. Existing functional browser
fixtures are unchanged.

## Scope and timing

The plan's provisional objective is p95 additional cleanup time below 50 ms for
roughly 20 KiB of rich HTML. The primary result is **individual paired on/off
synchronous dispatch latency**, not the difference of two independent percentiles or a percentile of
averaged blocks. Each block runs raw-input `A B B A`, where A enables Cleanup and
B uses exactly the same editor without it. It also runs a separate `A C C A`
control where C pastes the precomputed normalized HTML without Cleanup. Group
precedence alternates by block index. Both paired differences in each group are
retained, including negative values. Block-mean percentiles are secondary only.

Timing starts immediately before synthetic event dispatch. The primary `syncMs`
ends when dispatch returns. A separate secondary `settledMs` ends at one fixed
queued microtask continuation in both routes. After that endpoint, validation
requires Cleanup's terminal receipt and default feedback DOM state to be ready.
If they are not ready, the sample fails; the harness never polls or silently
extends the timing window. Browser smoke must establish that this contract holds
for the measured build. Both endpoints exclude operating-system clipboard latency, editor construction, initial
focus, event construction, validation, document serialization/hashing, module
startup, subsequent painting and asynchronous images. The normalizer-only timing
is a separate series and does not include destination-schema probes.

Each operation creates and destroys its own vanilla wrapper with the same empty
document, selection and History state. There are no host snapshot clones,
framework state mirrors, retained document observers or artificial GC calls.
The actual default nonmodal feedback remains enabled with the existing public
`domternal-theme.css`. Receipt callbacks retain one reference and increment one
counter. Semantic, feedback visibility and stylesheet validation, hashes, and
any layout those checks force happen outside the timed window. One animation
frame opportunity precedes **each operation**, outside both clocks. This avoids
placing the eight operations of a block in one uninterrupted task. No explicit
paint or forced layout is added inside the clocks.

The raw Office baseline can represent a different document because it does not
reconstruct lists or inherited formatting. Its delta is application overhead for
the same input, not isolated parser CPU time. The normalized control must match
the Cleanup document's complete JSON hash in every block. Neither measurement
claims the time until the next visible paint or performance of all four wrappers.

## Frozen synthetic corpus

`fixtures.test.mjs` pins source sizes and SHA-256 hashes. All text tokens have
distinct ordinal suffixes, never timestamps or random identifiers. Inputs contain
no images, source scripts, links or resource URLs.

| Fixture | UTF-8 bytes | Shape and independent expectations |
| --- | ---: | --- |
| rich-20k | 20,628 | Dense rich structure: 54 headings, 216 paragraphs, 54 blockquotes, 54 small two-cell tables; bold/italic/underline/strike and retained typography |
| word-20k | 20,608 | 64 synthetic MsoNormal paragraphs; inherited Calibri/color/size with real bold and italic resets |
| office-lists-20k | 20,929 | 35 explicit list instances with start 7, nested bullet, continuation 8 and restart 2; 140 paragraphs, 70 ordered lists and 35 bullet lists after cleanup |

These deliberately dense fixtures are reproducible source shapes, not a claim
about typical user documents or fidelity across all Word versions. All three run
under preserve and adapt policy. Validation requires unique source text in order,
authored block counts, marks/resets, typography policy, exact Office starts, one
paste history entry and one normalization/terminal callback on the enabled route.
Warning/truncation counts are recorded. Requested destination capability failures
invalidate the measurement. A quick baseline is not allowed to drop content.

## Running

Use Node 22 or 24, installed Playwright browsers, and previously completed package
builds. The runner never rebuilds production packages. It bundles their existing
public ESM exports into an owned scratch directory using the installed esbuild,
then serves fixed assets on an ephemeral loopback port. ProseMirror packages are
resolved through the one `@domternal/pm` installation. The default launches
Chromium, Firefox and WebKit serially with no tracing, video or clipboard access.

Do not run concurrently with tests, builds, other browsers or CPU-heavy jobs.
Keep machine power settings and display conditions unchanged. Record unusual
thermal/background conditions alongside the report; there is no portable API
that proves the machine was idle. Default headed/headless settings must not be
mixed in one comparison. Current defaults are headless, 1280×800, DPR 1,
en-US locale and UTC timezone. A browser failure, hidden document, unsupported
capability, changed source hash or resource request makes the run incomplete.

```sh
# Pure protocol and corpus checks, without any browser or bundle build:
node --test e2e/paste-performance/fixtures.test.mjs e2e/paste-performance/sampler.test.mjs

# Nonqualifying smoke: one round, one warmup block, two measured blocks:
node e2e/paste-performance/runner.mjs --smoke --out /private/tmp/paste-perf-smoke

# Reference protocol: three fresh-context rounds, twenty warmups and one hundred
# measured blocks per fixture, policy and engine. The output directory must be new.
node e2e/paste-performance/runner.mjs --reference-id local-macos-arm64 --out /private/tmp/paste-perf-reference
```

`--browser chromium` is allowed only with `--smoke`. `--headed` is an explicit
configuration change and is recorded. Every full fixture/policy/engine series has
300 measured blocks and 600 individual pairs per comparison. First-paste blocks
and warmups remain in the raw artifact but do not enter steady-state percentiles.
The preparatory standalone normalization time is reported separately; the
first-paste block is not mislabeled as a cold normalizer invocation.

The full run performs 52,272 dispatch operations including warmups and first-paste
blocks. At 60 Hz, frame separation alone takes at least about 14.5 minutes. Allow
roughly 20 to 40 minutes depending on dispatch, setup and validation cost; this
is an estimate pending smoke evidence. The overall deadline is 45 minutes. The
all-engine smoke performs 576 operations and should usually take about a minute.

Run browser qualification in the background, redirect unfiltered stdout/stderr to
a local log, and keep that log available for monitoring. The runner emits progress
every two minutes and prints each failure immediately. SIGINT/SIGTERM cancels the
run; stage and overall deadlines also invalidate it. Owned contexts, browser
servers/processes, HTTP connections and scratch files have separate cleanup paths.
Any cleanup uncertainty remains in the final report. It never closes user apps.

## Artifacts and interpretation

- `samples.jsonl`: every first-paste, warmup and measured ABBA/ACCA operation,
  raw timings, normalized-control and document hashes, shape/diagnostic counts,
  policy, browser, round, phase and index. No slow sample is discarded.
- `report.json`: protocol/configuration, machine/browser/tool versions, source
  and fixture hashes, dirty checkout status, pooled nearest-rank p50/p95/max,
  separate `syncMs` and `settledMs` individual-pair and block-mean distributions,
  failures and cleanup. The objective field uses `raw.syncMs.pairedOverheadMs.p95`.
- `fixture.bundle.js`, `bundle-metafile.json`, `fixture.html`, and
  `domternal-theme.css`: the exact local code and stylesheet used.
  Hashes cover every input read by esbuild, plus harness/test documentation and the
  lockfile. A final disk comparison rejects changed inputs. This assumes a trusted
  local checkout, not a hostile-filesystem sandbox.

The `observedPairedP95Under50ms` field reports the objective on this environment.
Exceeding 50 ms does not change the exit status. CI may gate protocol integrity and
semantic correctness, but arbitrary CI machine speed is not a release benchmark.
Smoke reports are explicitly nonqualifying. Full reports are measurements, not
automatic product-wide performance claims, security sandbox guarantees or heap
limits. Report both raw-input and normalized-control results with the input shape.

## Large documents and resource limits

The paired protocol above measures overhead on 20 KiB inputs. Large pastes are a
separate question: which bound stops a representative document first, whether
anything is ever silently truncated, and how long an accepted or refused paste
takes. `large.mjs` generates deterministic synthetic documents in seven profiles,
each measured in its own block unit:

| Profile | Unit | Words per unit | Shape |
| --- | --- | ---: | --- |
| `word-short-paragraphs` | paragraph | 4 | `MsoNormal` paragraphs with a language run |
| `word-fragmented-runs` | paragraph | 15 | five bold, italic and styled runs per paragraph |
| `word-default-lists` | list item | 4 | Word default bullets and numbering at levels 1 to 3 |
| `word-table` | table row | 9 | one Word table, three bordered cells per row |
| `word-mixed-document` | section | 79 | heading, paragraphs, fragmented runs, list items and a small table |
| `gdocs-document` | paragraph | 15 | Google Docs paragraphs inside the `docs-internal-guid` wrapper |
| `heavily-formatted-runs` | paragraph | 10 | every word in bold, italic and a styled span |

Word profiles carry a representative Word clipboard envelope of about 9 KB: meta
elements, Office XML islands in conditional comments and a stylesheet with font,
paragraph, page and nine-level `@list` definitions. Real stylesheets vary with the
styles a document uses. The text is English with explicit `čćšžđ` and `ČĆŠŽĐ`
Unicode tokens and typographic quotes; every block carries unique `Q000000x`
ordinal tokens. There are no images, links or resource URLs. `large.test.mjs` pins
the source hashes at 100 units, so a recorded result names exactly reproducible
inputs. Historical measurements retain their original
source hashes and inputs. Translating this generator does not rerun or update
those measurements; new measurements must record the updated source hashes.

`limits.mjs` sweeps the built public `/html` entry in Node. For each profile and
policy it doubles the size until the first rejection, then bisects to the
largest accepted size. Accepted output must contain every token once and in
order; a rejection must return empty HTML with exactly one error. Parser
allocation events are counted independently, the same way the bounded parser
counts them, with the stylesheet share and the text insertions that only extend
an existing text node listed separately. The first bound of a rejection is
attributed from those counts: input length, parser allocations, depth, table
cells, or otherwise generated output (inheritance and list wrappers). The size
that first reaches the D4 target of 10,000 words is evaluated as well. Limits are
measured here, never changed.

```sh
# Generator and sweep helper checks; the last two read the built /html entry:
node --test e2e/paste-performance/large.test.mjs

# Node sweep only, JSON on stdout and progress on stderr:
node e2e/paste-performance/limits.mjs > /private/tmp/paste-limits.json

# Browser single dispatch measurement on top of the sweep:
node e2e/paste-performance/runner.mjs --large --smoke --out /private/tmp/paste-large-smoke
node e2e/paste-performance/runner.mjs --large --reference-id local-macos-arm64 --out /private/tmp/paste-large-reference
```

`--large` first runs the sweep, then measures the D4 target, the largest accepted
and the first rejected size of every profile and policy on each engine. It adds
one case with a synthetic `text/rtf` flavor of 2,000,001 UTF-16 units next to
HTML that alone is accepted. PasteCleanup never reads RTF, so the paste is
accepted: only the flavors the editor reads, HTML and plain text, have a
per-flavor ceiling that rejects the whole paste before parsing. The report of
2026-09-28 predates that rule and records the rejection. Each case runs in a
fresh context: one first paste, then five measured dispatches (one with
`--smoke`), each in a fresh editor through the actual Cleanup extension and
default feedback. There is
no paired baseline. An accepted paste must apply once, keep every token in
order, match the authored counts and leave one history entry; a rejected paste
must leave the document unchanged and report exactly the expected error. The
records keep `syncMs`, `settledMs`, notice visibility, diagnostics by severity,
truncation and the document node count. Bundling, the loopback server, browser
isolation, cancellation, the 45 minute deadline, cleanup and source hashing are
those of the paired protocol.

Recorded large-paste results: [2026-09-28, macOS arm64](./results/2026-09-28-large-macos-arm64.md).
The all-engine `--large` run took about three minutes on that machine.

Recorded local results: [2026-09-26, macOS arm64](./results/2026-09-26-macos-arm64.md).
That report preserves the measured source identity, environment and limitations;
it does not replace qualification on another release target.
