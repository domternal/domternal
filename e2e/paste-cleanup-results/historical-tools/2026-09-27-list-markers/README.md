# Historical evidence tools: 2026-09-27 list markers

These are the original Python scripts behind the [list-marker report](../../2026-09-27-list-markers.md). They froze its inputs, verified its runs, assembled its JSON and Markdown, and ran its initial release gates. They are kept byte for byte, so their SHA-256 values match the ones recorded in the [JSON report](../../2026-09-27-list-markers.json) and in [MANIFEST.json](MANIFEST.json).

| File | What it did | Recorded in the report |
| --- | --- | --- |
| `domternal-n12-free-evidence.py` | Froze the 784-file source and build inventory before the final runs | no |
| `domternal-n12-verify-evidence.py` | Verified the completed runs against read-only discovery, and the inventory | `/artifacts/31` |
| `domternal-n12-assemble-evidence.py` | Wrote the committed JSON and Markdown | `/artifacts/32` |
| `domternal-n12-free-gates.py` | Ran the initial release gates | no; its output is `/artifacts/20` |

They are historical records, not maintained tools:

- CI, root scripts and tests never execute them. `pnpm test:evidence` only checks that their bytes still match MANIFEST.json and the report, and it fails if anything in the repository starts running them or Python.
- They contain absolute paths of the machine that produced the report, and they read inputs that existed only in that machine's temporary directory.
- Some of them write files or run gates. Running them against the current tree would fail or overwrite results.

## Provenance

At 09:00:32 the assembler printed a JSON digest that differs from the committed one. The report, its Markdown and the assembler were all changed at 09:02:46 without a recorded rerun, so the committed files are not the output of that recorded run. The preserved assembler is the version the report names. Replayed once in a scratch mirror of its inputs, it wrote the committed JSON byte for byte once the mirror root was mapped back, and the committed Markdown up to the embedded digest of that relocated JSON. MANIFEST.json records the details, and the one frozen input whose bytes were never preserved.

## Replay

Future reports use the maintained Node tool in [`tests/evidence/`](../../../../tests/evidence/), which ports the freezer, the verifier and the assembler. The gates runner is not ported. The tool's replay command compares its output with the committed report on the same stored inputs, read from the evidence archive that is kept outside Git (see `rawInputArchive` in MANIFEST.json):

```bash
pnpm evidence:replay --archive <evidence-archive>/2026-09-27
```

On 2026-09-27 it reproduced the committed JSON, the committed Markdown and the original stored verifier output byte for byte, on Node 22 and 24. The replay is classified PARTIAL_LOST_INPUTS because one dist file is lost and could only be checked against its recorded size and digest. MANIFEST.json holds the full result, including the comparison with the one-time Python replay that is recorded as the baseline. These originals are not executed again.
