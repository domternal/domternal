# Content performance against 1.2.0

This opt-in harness compares the JSON content entry points and HTML output of this
checkout's built packages with the published 1.2.0, in Chromium, Firefox and WebKit
on one machine. It measures applications without PasteCleanup: StarterKit with
TextStyle, TextColor, Highlight, FontSize, FontFamily, TextAlign, LineHeight, Image
and Table. It is evidence for a report, not a pass or fail check.

## What it measures

`page.mjs` is bundled once per variant: the 1.2.0 registry packages of
`tests/mixed-version/v1.2.0` (`@domternal/core`, `extension-image`, `extension-table`)
and the `dist` builds of this checkout. Every variant uses the workspace's
ProseMirror, linkifyjs and floating-ui files, so a difference comes from Domternal's
own code, not from a dependency version. Each operation runs on every document:

| Operation | Timed call |
| --- | --- |
| `initialLoadJSON` | `new Editor({ element, extensions, content: json })`; destruction is outside the clock |
| `setContentJSON` | `editor.commands.setContent(json)` with the same document loaded |
| `getHTML` | `editor.getHTML()` |
| `generateHTML` | `generateHTML(json, extensions)`, which builds its schema on every call |

| Document | Shape | HTML length |
| --- | --- | ---: |
| `article-s`, `article-m`, `article-l` | 4, 40 and 160 sections: an H2 or H3, three paragraphs with bold, italic and a link, a three item list every other section, a 3 by 3 table and an image every fifth | about 4, 44 and 177 thousand characters |
| `outline-m`, `outline-l` | 100 and 400 sections of an H2, an H3 and a short paragraph | about 15 and 59 thousand |
| `headings-only` | 1,000 pairs of an H2 and an H3, the release review's heading shape | about 36 thousand |
| `styled-m`, `styled-l` | 200 and 1,000 centered paragraphs with a red 18px run and a highlighted run, the release review's styled shape | about 41 and 205 thousand |

A call is timed in batches of at least 25 ms (`--min-batch-ms`), which keeps
Firefox's 1 ms timer resolution out of the result, after two warmup calls; a
page records the median of nine batches (`--batches`). Initial load is timed
per construction, so in Firefox and WebKit, whose clocks give whole milliseconds
here, it moves in steps of a whole millisecond and small changes do not show. Each round loads every variant once, each in a fresh browser
context, in an order that rotates and reverses by round. The summary gives, per
browser, document and operation, each variant's median over rounds with the
lowest and highest page median, and the paired change from 1.2.0: the median over
rounds of the ratio within one round, with its lowest and highest round. Outputs
are compared as digests; a document whose output changed on purpose since 1.2.0,
such as a link without an opener, shows a different digest there.

## Running

Build the packages first and run nothing else in the checkout while measuring.

```sh
pnpm --dir tests/mixed-version/v1.2.0 install --frozen-lockfile --ignore-workspace
node e2e/content-performance/runner.mjs --out /private/tmp/content-performance --rounds 6
```

`--current <label>` names this checkout's build in the report (default `current`).
Every output directory keeps the bundles it measured and lists them in
`variants.json` before measuring, so `--bundle <label>=<path>` adds a bundle of an
earlier output, for example the build before a change, to a later run. The report
names such a bundle by the commit, inputs and working tree state its output
recorded for it, never by its path, and the runner refuses a bundle that the
`variants.json` or `report.json` beside it does not list with the same SHA-256. `--equivalence <label>,<label>` instead compares every output and
diagnostic of the JSON entry points (`normalizeContent`, `generateHTML` with
`onDiagnostic`, initial content with `onContentDiagnostic`, `getHTML` plain and
styled, `getJSON` and `setContent`) for seeded documents full of edge values: heading
levels, list markers, hrefs and CSS values valid and not. It exits with status 1 when
any differs. Both modes write `report.json` with the machine, load averages before
and after each page, browser versions and bundle hashes. `provenance.test.mjs`
checks how a bundle of an earlier output is named:
`node --test e2e/content-performance/provenance.test.mjs`.

## Results

- [2026-10-01, macOS arm64](../paste-performance/results/2026-10-01-content-macos-arm64.md):
  1.2.0 against the builds before and after the content performance changes.
