# Free styled line breaks: browser qualification

The frozen Free cleanup build passed **1,126 tests with two intentional skips**, across Chromium, Firefox and WebKit and the vanilla, React, Vue and Angular wrappers. The complete matrix contained 1,128 cases: 120 new styled-break cases and 1,008 existing regression cases. There were no failures, retries or flaky outcomes in this final run.

This qualifies the specified synthetic clipboard scenarios through public package builds and real editor wrappers. It is not native Word, Google Docs or LibreOffice clipboard evidence, a layout or performance benchmark, or Pro DOCX converter/worker qualification. The [JSON evidence](2026-09-27-styled-breaks.json) retains every case outcome, the explicit input inventory and SHA256 hashes of local raw artifacts.

## Final run

The run started at `2026-09-27T04:41:39.783Z` and took `606565.027 ms`, approximately 10.1 minutes. Playwright `1.58.2` used one worker, no retries, no shard and no test filter.

| Browser project | Total | Passed | Skipped | New styled-break cases |
| --- | ---: | ---: | ---: | ---: |
| Chromium | 376 | 376 | 0 | 40 |
| Firefox | 376 | 375 | 1 | 40 |
| WebKit | 376 | 375 | 1 | 40 |

The two skipped cases are the existing Chromium-only native editor copy test. Its Chromium execution copies synthetic content within the editor through the operating-system clipboard. All new styled-break cases construct synthetic `ClipboardEvent` objects and assert `isTrusted === false`. Existing image tests whose route is named `native` also use synthetic events.

The recorded launch selected Node `v22.23.2` through `$HOME/.nvm/versions/node/v22.23.2/bin` on `PATH`. That is command provenance, not a Node version measured by the Playwright report. Actual browser version strings were not queried during this matrix; only the browser projects are recorded.

```sh
PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH \
PLAYWRIGHT_JSON_OUTPUT_NAME=/private/tmp/domternal-n10c-free-matrix.json \
pnpm exec playwright test --config e2e/paste-cleanup.config.ts --reporter=list,json \
  > /private/tmp/domternal-n10c-free-matrix.log 2>&1
```

The parent ran this command in the background with a separate progress monitor. No browser or application rerun was performed to assemble this evidence.

## What the new cases prove

For each of the four wrappers and three browser projects, the suite checks four authored scenarios under both preserve and adapt policies:

1. Leading, consecutive and trailing breaks preserve bold, italic, underline, strike, subscript and inherited typography.
2. Break-only content preserves distinct semantic marks without character text.
3. Direct break styles reset bold and italic while retaining an ancestor superscript box.
4. `vertical-align:baseline` on the script owner resets that owner's script mark without changing its sibling.

Two further cases per wrapper/browser check internal serialized clipboard bypass under adapt policy and a visible destination warning for an unsupported script mark on a break-only source. Together these produce 40 cases per browser and 120 cases overall.

The assertions compare the full authored semantic document, require one cleanup result and one paste transaction in the preserve/adapt cases, check exact document and selection restoration through Undo/Redo, and reload serialized HTML. Semantic comparison removes generated block IDs and sorts mark order; the history assertions use complete original snapshots. The fixture uses minimal local CSS rather than the full production theme. This does not certify arbitrary layout or ProseMirror's general clipboard treatment of an unmarked terminal `br`.

## Existing regression coverage

The five preexisting suites and their shared fixture inputs are byte-equal to the captured Git HEAD. The verifier independently reconstructed the complete expected case inventory from the frozen suite declarations before the final report existed.

| Suite | Cases across three browsers |
| --- | ---: |
| Paste cleanup | 195 |
| Paste feedback | 132 |
| Clipboard image preparation | 189 |
| Persistent image resolver | 384 |
| Destination capabilities | 108 |
| Styled breaks, new | 120 |

These existing suites cover their established formatting, lists, security, limits, images, asynchronous receipts, cancellation, recovery and destination behavior. Passing them does not establish support for untested Office sources.

## Preflight results and corrections

The source implementation began with an intentional fail-first run: all seven authored regression tests failed against the previous behavior. The first implementation run then passed 115 tests and failed one assertion about a final bare `br`. The retained characterization now distinguishes the stages explicitly: normalization and `createDocument` preserve both the styled break and the final bare break, while the existing ProseMirror clipboard parser treats the final bare break as a placeholder and produces one break. No production clipboard parser change was made. The final targeted suite passed all 160 tests in five files. These source-unit preflights are separate from the browser runs below.

The initial focused browser run contained 96 cases: 72 passed and 24 failed. Every failure came from the same authored expectation across four wrappers, two policies and three browsers: it incorrectly expected a descendant `vertical-align:baseline` to remove the ancestor superscript box. The expectation was corrected to retain the ancestor. A separate same-owner baseline case added 24 tests, producing the final 120-case new suite. The initial raw log and traces remain local at `/private/tmp/domternal-n10c-free-breaks-browser.log` and `/private/tmp/domternal-n10c-free-breaks-first-traces`; traces are not copied into the repository.

The first package TypeScript check reported three `TS2322` errors in a test helper that used `Record<string, unknown>` for mark attributes. The helper now uses the public `JSONMark` and `JSONAttribute` types. The final package and E2E type/lint checks were reported with exit zero and have empty recorded logs. The earlier `domternal-n10c-e2e-lint-final.log` predates the final browser expectation changes. The additional `domternal-n10c-corrected-tests-lint.log` is the final changed-test ESLint check after those expectations, the same-owner baseline cases and the JSONMark/JSONAttribute helper corrections; it also has a reported exit zero and an empty log. These preflight failures are separate from the successful final browser matrix.

| Final supporting gate | Recorded result |
| --- | --- |
| Final targeted styled-break unit suite | 160 passed in five files |
| Cleanup package unit suite | 1,253 passed in 36 files |
| Coverage | Statements 93.76%, branches 90.92%, functions 97.92%, lines 98.8% |
| Cleanup build | CJS, ESM and DTS success |
| Public API surface | 33 tests passed; 29 snapshot entries and 10 locale entries matched |
| SSR imports | 74 module loads across 39 entries succeeded |
| Package and E2E types/lint | Parent reported exit zero; recorded final logs are empty |
| Final corrected-test ESLint | Reported exit zero after all test corrections; recorded log is empty |

## Frozen inputs and verification

An explicit snapshot was captured while the matrix was running under the parent's source/build freeze, then checked against disk after completion. Its **321 files** include cleanup source, all 211 existing public package dist files, package manifests and lockfile, the six browser suites, shared fixtures/configuration and the eight changed files. This is an explicit repository/build inventory, not a reconstructed Vite dependency graph. Vendor dependency bytes, browser binaries and generated optimizer caches are not included; the lockfile records dependency resolution.

The verifier checked exact unique project/file/describe/title identities, all statuses, one attempt per test, no result or run errors, both precise skip reasons, configuration, raw log counts, unchanged existing suites and all selected file hashes. Eight altered-report controls were rejected, including an unknown case title, a retry, a run/result error and an unexpected skip.

- Input inventory SHA256: `e19330c5d5415250b1eb0109c8357ecd6c94b3ea7ed79ea272efb2e107cbb43c`
- Final raw Playwright report SHA256: `ad1142febd57b6ad7206e85cc2c974c3717ed175adba4eafd204c4513419ee41`
- Durable JSON SHA256: `3f600be7d9a79b931da19a528b1a3f64d478516c587efcd147f5eca080e300f5`

Raw logs, the full Playwright report, traces and verifier scripts are local scratch artifacts. Their paths and relevant hashes are recorded in the JSON; the durable evidence contains bounded case metadata and hashes, not trace archives or copied source HTML.
