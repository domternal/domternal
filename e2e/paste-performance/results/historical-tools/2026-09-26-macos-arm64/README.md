# Historical evidence tools: 2026-09-26 paste performance

No original tool survives for the [paste performance reference](../../2026-09-26-macos-arm64.md), so this directory holds only [MANIFEST.json](MANIFEST.json) and this README. They record what was lost and why the summary can still be trusted.

The raw report was written by the committed [runner](../../../runner.mjs). The committed [summary JSON](../../2026-09-26-macos-arm64.json) is an exact projection of that raw report:

- `rawSamples` and every `cases[].rounds` are dropped;
- `artifactHashes` (the size and SHA-256 of `report.json` and `samples.jsonl`) and `conditions` (four authored sentences) are added;
- the keys are reordered as MANIFEST.json lists them.

A read-only comparison on 2026-09-27 rebuilt the committed bytes exactly from the archived raw report that way. That comparison verifies the claim; it is not a preserved or reconstructed projector. The projector script itself and the source of the Markdown were not preserved, and they are not reconstructed.

The raw `report.json` and `samples.jsonl` are kept in the evidence archive outside Git (see `rawInputArchive` in MANIFEST.json). `pnpm test:evidence` covers the summary with a serialization golden: its bytes are exactly what `JSON.stringify(value, null, 2)` writes for its content, and MANIFEST.json pins its SHA-256.

On 2026-10-03, on the owner's request, the home folder in the archive location MANIFEST.json records was replaced by `$HOME`. MANIFEST.json declares that redaction under `redactions`; no recorded digest covers the manifest, so none changed. The unredacted manifest was removed from the repository history on the owner's request on 2026-10-03, so no check reads it: `pnpm test:evidence` holds the declaration with the redacted bytes alone.
