# Historical evidence tools: 2026-09-27 list markers

These are the original Python scripts behind the [list-marker report](../../2026-09-27-list-markers.md). They froze its inputs, verified its runs, assembled its JSON and Markdown, and ran its initial release gates. They are kept byte for byte apart from one declared redaction (see [Redaction](#redaction)), so their SHA-256 values match the ones recorded in the [JSON report](../../2026-09-27-list-markers.json) and in [MANIFEST.json](MANIFEST.json).

| File | What it did | Recorded in the report |
| --- | --- | --- |
| `domternal-n12-free-evidence.py` | Froze the 784-file source and build inventory before the final runs | no |
| `domternal-n12-verify-evidence.py` | Verified the completed runs against read-only discovery, and the inventory | `/artifacts/31` |
| `domternal-n12-assemble-evidence.py` | Wrote the committed JSON and Markdown | `/artifacts/32` |
| `domternal-n12-free-gates.py` | Ran the initial release gates | no; its output is `/artifacts/20` |

They are historical records, not maintained tools:

- CI, root scripts and tests never execute them. `pnpm test:evidence` only checks that their bytes still match MANIFEST.json and the report, and it fails if anything in the repository starts running them or Python.
- They contain absolute paths of the machine that produced the report, written `$HOME` and `$SCRATCHPAD` since the redaction, and they read inputs that existed only in that machine's temporary directory.
- Some of them write files or run gates. Running them against the current tree would fail or overwrite results.

## Provenance

At 09:00:32 the assembler printed a JSON digest that differs from the committed one. The report, its Markdown and the assembler were all changed at 09:02:46 without a recorded rerun, so the committed files are not the output of that recorded run. The preserved assembler is the version the report names. Replayed once in a scratch mirror of its inputs, it wrote the committed JSON byte for byte once the mirror root was mapped back, and the committed Markdown up to the embedded digest of that relocated JSON. MANIFEST.json records the details, and the one frozen input whose bytes were never preserved.

## Redaction

On 2026-10-03, on the owner's request, the absolute home folder and session scratchpad paths of the machine that produced the report were replaced by `$HOME` and `$SCRATCHPAD` in these originals, in the JSON and Markdown reports and in MANIFEST.json. The rule names no value, so it reads the same on every machine. MANIFEST.json declares it under `redactions`: every file it changed with its redacted size, digest and placeholder count, where the unredacted originals are (`originals`), every digest it replaced with the digest of the redacted bytes, and every digest it withheld. No digest of unredacted bytes that what is committed could rebuild is recorded, because it would confirm a guessed account name, while digests of raw archived inputs that nothing committed reproduces, such as Playwright reports and logs, stay as recorded; that is why the Python baseline outputs and the earlier JSON digest now read `withheld`. The originals were removed from the repository history on the owner's request on 2026-10-03, so no check reads them: `pnpm test:evidence` holds the declaration with the redacted bytes alone. While the originals were in the history, `node tests/evidence/cli.mjs check --history` compared each declared file with its original and found each to be that original with only this redaction applied. With the originals gone it could only report them missing, so it was retired, and CI no longer checks out the whole history for it.

## Replay

Future reports use the maintained Node tool in [`tests/evidence/`](../../../../tests/evidence/), which ports the freezer, the verifier and the assembler. The gates runner is not ported. The tool's replay command compares its output with the committed report on the same stored inputs, read from the evidence archive that is kept outside Git (see `rawInputArchive` in MANIFEST.json):

```bash
pnpm evidence:replay --archive <evidence-archive>/2026-09-27
```

On 2026-09-27, before the redaction, it reproduced the committed JSON, the committed Markdown and the original stored verifier output byte for byte, on Node 22 and 24. Since the redaction the tool is built to read the inputs the redaction changed through it and to compare the archived outputs of the originals after it, so the same result is expected to read IDENTICAL_AFTER_DECLARED_NORMALIZATION and to name the redaction. `tests/evidence/replay.test.mjs` proves that path on synthetic archives; it has not been run against the evidence archive since the redaction. The replay is classified PARTIAL_LOST_INPUTS because one dist file is lost and could only be checked against its recorded size and digest. MANIFEST.json holds the full result, including the comparison with the one-time Python replay that is recorded as the baseline. These originals are not executed again.
