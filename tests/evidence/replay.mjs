/**
 * Replay: run the maintained Node port on the stored inputs of a historical
 * unit and compare its output, byte for byte, with the committed evidence and
 * with the one-time Python replay recorded as the baseline.
 *
 * Replay needs the durable evidence archive (outside Git) and the full Git
 * history of this repository, so it is a local command, never a CI gate. It
 * never rewrites a committed report; everything it writes goes to a fresh
 * output directory.
 *
 * Inputs are located in the order the design fixes: an archive blob, then a
 * Git object anywhere in history, else the file is recorded as lost. Nothing
 * is guessed. `verifiedAt` always comes from the document being reproduced.
 *
 * Classification of one unit:
 *
 * - IDENTICAL: every output equals the committed bytes and every input was
 *   available.
 * - IDENTICAL_AFTER_DECLARED_NORMALIZATION: the outputs are equal, but only
 *   with declared normalizations, such as a root path mapped back before
 *   comparing.
 * - IDENTICAL_WITH_RECORDED_SUPPLEMENT: equal after adding keys copied from the
 *   committed report for a step that was not preserved.
 * - PARTIAL_LOST_INPUTS: the outputs are equal, but some inputs are lost and
 *   could only be checked against their recorded size and digest. This is the
 *   same vocabulary as the Pro evidence tool.
 * - DIFFERS: an output differs; the result carries a JSON-pointer diff.
 *
 * The Python baseline is classified the same way, and a difference from it
 * beyond its declared normalizations fails the replay too.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EvidenceArchive, INPUTS_KIND, InputSet, locateRecordedBytes } from './artifacts.mjs';
import { gitCandidates, gitTrackedPaths, verifyMembershipAgainstGit } from './inventory.mjs';
import { indentedBytes, parseJson, pointerDiff, sha256 } from './json.mjs';
import { EvidenceCheckError, ensure } from './playwright.mjs';

export const CLASSIFICATIONS = [
  'IDENTICAL',
  'IDENTICAL_AFTER_DECLARED_NORMALIZATION',
  'IDENTICAL_WITH_RECORDED_SUPPLEMENT',
  'PARTIAL_LOST_INPUTS',
  'DIFFERS',
];

/** Read a file of this repository as committed at `revision`. */
export function gitShow(repository, revision, path) {
  return execFileSync('git', ['show', `${revision}:${path}`], { cwd: repository, maxBuffer: 1 << 30 });
}

/**
 * An inputs manifest for a unit, every byte located in the archive or in Git.
 * The prior report comes from Git at the frozen head, which the assembler
 * itself required to equal the file it read.
 */
export function buildInputsFromArchive(unit, { archive, repository }) {
  const required = unit.requiredInputs();
  const files = [];
  const seen = new Set();
  const add = (role, originalPath, bytes, digest, source) => {
    ensure(!seen.has(originalPath), 'Duplicate replay input', originalPath);
    seen.add(originalPath);
    files.push({ role, originalPath, bytes, sha256: digest, source });
  };
  const fromArchive = (role, originalPath) => {
    const entry = archive.entry(originalPath);
    ensure(entry, 'Input missing from the evidence archive', originalPath);
    const blob = archive.blobPath(entry.sha256);
    ensure(blob, 'Archive blob missing', originalPath);
    add(role, originalPath, entry.bytes, entry.sha256, { kind: 'file', path: blob });
  };
  for (const { role, originalPath } of [...required.files, ...required.storedOutputs]) fromArchive(role, originalPath);
  for (const { role, directory, suffix } of required.directories) {
    const entries = archive.entriesIn(directory, suffix);
    ensure(entries.length > 0, 'Archived directory has no matching files', `${directory}/*${suffix}`);
    for (const entry of entries) fromArchive(role, entry.originalPath);
  }
  const snapshotEntry = archive.entry(unit.SNAPSHOT);
  ensure(snapshotEntry, 'Snapshot missing from the evidence archive', unit.SNAPSHOT);
  const snapshot = parseJson(new InputSet({ kind: INPUTS_KIND, version: 1, unit: unit.STEM, files }).read(unit.SNAPSHOT));
  for (const { role, path } of required.repositoryFiles) {
    const data = gitShow(repository, snapshot.gitHead, path);
    add(role, `${unit.ROOT}/${path}`, data.length, sha256(data), { kind: 'git', repository, revision: snapshot.gitHead, path });
  }
  for (const row of snapshot.inventory) {
    const originalPath = `${unit.ROOT}/${row.path}`;
    if (seen.has(originalPath)) continue;
    const source = locateRecordedBytes({ archive, repository, relativePath: row.path, digest: row.sha256 });
    add('frozen-source', originalPath, row.bytes, row.sha256, source);
  }
  return { kind: INPUTS_KIND, version: 1, unit: unit.STEM, files };
}

/** Membership rebuilt from Git at the snapshot's head plus its recorded status. */
export function gitMembership(unit, repository) {
  return (snapshot) =>
    verifyMembershipAgainstGit(snapshot, unit.SELECTION_RULES, gitCandidates(gitTrackedPaths(repository, snapshot.gitHead), snapshot.gitStatus));
}

/** Compare produced bytes with a reference, with a pointer diff for JSON. */
export function compareBytes(produced, reference, { json = false } = {}) {
  if (produced.equals(reference)) return { result: 'IDENTICAL' };
  const outcome = { result: 'DIFFERS', producedSha256: sha256(produced), referenceSha256: sha256(reference) };
  if (json) {
    try {
      outcome.diff = pointerDiff(parseJson(reference), parseJson(produced), 20);
    } catch (error) {
      outcome.diff = [{ op: 'unparseable', message: error.message }];
    }
  }
  return outcome;
}

/**
 * Compare with the Python replay output after its declared normalizations:
 * the scratch mirror root mapped back to the recorded root, and the JSON digest
 * the Markdown embeds recomputed after that mapping.
 */
export function compareWithPythonBaseline({ produced, python, mirrorRoot, recordedRoot, pythonJson }) {
  let mapped = Buffer.from(python.toString('utf8').split(mirrorRoot).join(recordedRoot), 'utf8');
  const normalizations = [];
  if (!mapped.equals(python)) normalizations.push(`scratch mirror root ${mirrorRoot} mapped back to ${recordedRoot}`);
  if (pythonJson) {
    const before = sha256(pythonJson);
    const after = sha256(Buffer.from(pythonJson.toString('utf8').split(mirrorRoot).join(recordedRoot), 'utf8'));
    if (before !== after && mapped.includes(before)) {
      mapped = Buffer.from(mapped.toString('utf8').split(before).join(after), 'utf8');
      normalizations.push(`embedded JSON digest ${before} recomputed after root mapping as ${after}`);
    }
  }
  const comparison = compareBytes(produced, mapped);
  if (comparison.result === 'IDENTICAL' && normalizations.length) comparison.result = 'IDENTICAL_AFTER_DECLARED_NORMALIZATION';
  return { ...comparison, normalizations };
}

/** The unit's classification: the worst comparison, and equal outputs with lost inputs are partial. */
export function classifyReplay(results, lostCount) {
  const classification = worst(results);
  return classification === 'IDENTICAL' && lostCount > 0 ? 'PARTIAL_LOST_INPUTS' : classification;
}

function worst(results) {
  let index = 0;
  for (const result of results) index = Math.max(index, CLASSIFICATIONS.indexOf(result));
  return CLASSIFICATIONS[index];
}

function writeOnce(path, data) {
  writeFileSync(path, data, { flag: 'wx' });
}

/**
 * Replay one unit. Returns the result document; writes the inputs manifest,
 * every produced file and the result into `outDir`, which must be new.
 */
export function replayUnit(unit, { archiveDir, repository, outDir, pythonBaselineDir = null, revision = 'HEAD' }) {
  const committedJson = gitShow(repository, revision, unit.REPORT);
  const committedMarkdown = gitShow(repository, revision, unit.MARKDOWN);
  const committed = parseJson(committedJson);
  ensure(typeof committed.verifiedAt === 'string' && committed.verifiedAt.length > 0, 'Replay needs verifiedAt from the committed report');
  ensure(!existsSync(outDir), 'Replay output directory already exists', outDir);
  const archive = new EvidenceArchive(archiveDir);
  const manifest = buildInputsFromArchive(unit, { archive, repository });
  mkdirSync(outDir, { recursive: true });
  writeOnce(join(outDir, 'inputs.json'), indentedBytes(manifest, { ensureAscii: false }));
  const inputs = new InputSet(manifest);
  const membership = gitMembership(unit, repository);
  const stem = unit.STEM;

  const storedVerifierPath = unit.requiredInputs().storedOutputs[0].originalPath;
  const storedVerifier = inputs.read(storedVerifierPath);
  const verifier = unit.verifyBrowserEvidence(inputs, { verifiedAt: parseJson(storedVerifier).verifiedAt, membership });
  const assembled = unit.assembleQualification(inputs, {
    verifiedAt: committed.verifiedAt,
    membership,
    gitShow: (rev, path) => gitShow(repository, rev, path),
  });
  writeOnce(join(outDir, `${stem}.json`), assembled.json);
  writeOnce(join(outDir, `${stem}.md`), assembled.markdown);
  writeOnce(join(outDir, `${stem}.verified-browser-data.json`), verifier.bytes);

  const comparisons = [
    { output: `${stem}.json`, reference: `${revision}:${unit.REPORT}`, ...compareBytes(assembled.json, committedJson, { json: true }) },
    { output: `${stem}.md`, reference: `${revision}:${unit.MARKDOWN}`, ...compareBytes(assembled.markdown, committedMarkdown) },
    {
      output: `${stem}.verified-browser-data.json`,
      reference: `${storedVerifierPath} (the original verifier output, archived)`,
      ...compareBytes(verifier.bytes, storedVerifier, { json: true }),
    },
  ];

  const baseline = unit.PYTHON_BASELINE;
  const readBaseline = (path) => {
    if (pythonBaselineDir) return readFileSync(path.replace(baseline.scratchRoot, pythonBaselineDir));
    const entry = archive.entry(path);
    ensure(entry && archive.blobPath(entry.sha256), 'Python baseline output missing from the archive', path);
    return inputsFromBlob(archive, entry);
  };
  const pythonJson = readBaseline(baseline.json);
  const pythonComparisons = [
    {
      output: `${stem}.json`,
      reference: `Python replay ${baseline.json}`,
      ...compareWithPythonBaseline({ produced: assembled.json, python: pythonJson, mirrorRoot: baseline.mirrorRoot, recordedRoot: unit.ROOT }),
    },
    {
      output: `${stem}.md`,
      reference: `Python replay ${baseline.markdown}`,
      ...compareWithPythonBaseline({
        produced: assembled.markdown,
        python: readBaseline(baseline.markdown),
        mirrorRoot: baseline.mirrorRoot,
        recordedRoot: unit.ROOT,
        pythonJson,
      }),
    },
    {
      output: `${stem}.verified-browser-data.json`,
      reference: `Python replay ${baseline.verifier}`,
      ...compareBytes(verifier.bytes, readBaseline(baseline.verifier), { json: true }),
    },
  ];

  const lost = [...new Map([...assembled.lost, ...verifier.lost].map((row) => [row.path, row])).values()];
  const limitations = lost.map(
    (row) => `lost input ${row.path} (${row.bytes} bytes, sha256 ${row.sha256}) checked only against its recorded size and digest; its bytes were never preserved`
  );
  const committedResults = comparisons.map((comparison) => comparison.result);
  const classification = classifyReplay(committedResults, lost.length);
  const pythonClassification = worst(pythonComparisons.map((comparison) => comparison.result));
  const result = {
    kind: 'domternal-evidence-replay',
    version: 1,
    unit: stem,
    classification,
    limitations,
    replayMode: [
      'Every input is addressed by its recorded original path and read through inputs.json from the evidence archive or Git.',
      `verifiedAt is taken from the document being reproduced: ${committed.verifiedAt} for the report.`,
    ],
    lostInputs: lost,
    membership: assembled.membership,
    comparisons,
    pythonBaseline: { classification: pythonClassification, comparisons: pythonComparisons },
    archive: { directory: archiveDir, entries: archive.index.entries.length },
    node: process.version,
  };
  writeOnce(join(outDir, 'replay.json'), indentedBytes(result, { ensureAscii: false }));
  if (classification === 'DIFFERS') {
    throw new EvidenceCheckError('Replay differs from the committed evidence', join(outDir, 'replay.json'));
  }
  if (pythonClassification === 'DIFFERS') {
    throw new EvidenceCheckError('Replay differs from the recorded Python baseline', join(outDir, 'replay.json'));
  }
  return result;
}

function inputsFromBlob(archive, entry) {
  const set = new InputSet({
    kind: INPUTS_KIND,
    version: 1,
    unit: 'python-baseline',
    files: [{ role: 'python-baseline', originalPath: entry.originalPath, bytes: entry.bytes, sha256: entry.sha256, source: { kind: 'file', path: archive.blobPath(entry.sha256) } }],
  });
  return set.read(entry.originalPath);
}
