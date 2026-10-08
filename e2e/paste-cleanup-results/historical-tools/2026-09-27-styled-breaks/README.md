# Historical evidence tools: 2026-09-27 styled breaks

These are the original Python scripts that verified the [styled-break report](../../2026-09-27-styled-breaks.md). They are kept byte for byte apart from one declared redaction (see [Redaction](#redaction)), so their SHA-256 values match the ones recorded in the [JSON report](../../2026-09-27-styled-breaks.json) and in [MANIFEST.json](MANIFEST.json).

| File | What it did | Recorded in the report |
| --- | --- | --- |
| `domternal-n10c-free-evidence.py` | Froze and rechecked the 321-file source and build inventory | `/artifacts/12` |
| `domternal-n10c-free-cases.py` | Authored the expected 1,128-case inventory before the run finished | `/artifacts/13` |
| `domternal-n10c-free-verify.py` | Verified the completed run and wrote the base of the committed JSON | `/artifacts/14` |

They are historical records, not maintained tools:

- CI, root scripts and tests never execute them. `pnpm test:evidence` only checks that their bytes still match MANIFEST.json and the report, and it fails if anything in the repository starts running them or Python.
- They contain absolute paths of the machine that produced the report, written `$HOME` and `$SCRATCHPAD` since the redaction, and they read inputs that existed only in that machine's temporary directory.
- The verifier writes a file. Running it against the current tree would fail or overwrite results.

## What was not preserved

The committed JSON is the verifier's output plus fourteen changes that no preserved script makes: seven more artifact records, one reworded artifact role, the initial implementation runs, a changed-test lint record with a reworded E2E lint note, one limitation, one verification check and the list of negative verifier controls. The step that added them, the script behind those negative controls and the source of the Markdown were not preserved. MANIFEST.json lists every change by JSON pointer, and records that the archived verifier output plus exactly those changes gives the committed bytes. They are recorded, not reconstructed. The bytes of 22 dist files were never preserved either; MANIFEST.json lists them with their recorded digests.

## Redaction

On 2026-10-03, on the owner's request, the absolute home folder and session scratchpad paths of the machine that produced the report were replaced by `$HOME` and `$SCRATCHPAD` in these originals, in the JSON and Markdown reports and in MANIFEST.json. The rule names no value, so it reads the same on every machine. MANIFEST.json declares it under `redactions`: every file it changed with its redacted size, digest and placeholder count, where the unredacted originals are (`originals`), every digest it replaced with the digest of the redacted bytes, and every digest it withheld. No digest of unredacted bytes that what is committed could rebuild is recorded, because it would confirm a guessed account name, while digests of raw archived inputs that nothing committed reproduces, such as Playwright reports and logs, stay as recorded; that is why the digest of the stored verifier output, which the committed JSON reproduces with fourteen changes, now reads `withheld`. The originals were removed from the repository history on the owner's request on 2026-10-03, so no check reads them: `pnpm test:evidence` holds the declaration with the redacted bytes alone. While the originals were in the history, `node tests/evidence/cli.mjs check --history` compared each declared file with its original and found each to be that original with only this redaction applied. With the originals gone it could only report them missing, so it was retired, and CI no longer checks out the whole history for it.

## Coverage

This report is not ported to Node. The maintained tool in [`tests/evidence/`](../../../../tests/evidence/) ports the later list-marker unit. `pnpm test:evidence` covers this report with a serialization golden (its bytes are exactly what `json.dumps(indent=2)` writes for its content) and digest goldens: the frozen inventory digest, the case inventory digest over the committed cases, and the three digests the Markdown quotes.
