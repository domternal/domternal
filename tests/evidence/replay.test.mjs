/**
 * The input manifest, the archive and Git lookups, and replay classification,
 * on synthetic archives and throwaway Git repositories. The real replay needs
 * the durable archive and full history, so it runs locally through
 * `pnpm evidence:replay`, never here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EvidenceArchive, INPUTS_KIND, InputSet, artifactRecord, findInGitHistory, locateRecordedBytes } from './artifacts.mjs';
import { LOST } from './inventory.mjs';
import { sha256 } from './json.mjs';
import { EvidenceCheckError } from './playwright.mjs';
import { CLASSIFICATIONS, buildInputsFromArchive, compareBytes, compareWithPythonBaseline, replayUnit } from './replay.mjs';

const GIT_CONFIG = ['-c', 'user.name=Evidence Test', '-c', 'user.email=evidence@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null'];

function gitRepository(files) {
  const root = mkdtempSync(join(tmpdir(), 'evidence-git-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  const commits = [];
  for (const version of files) {
    for (const [path, text] of Object.entries(version)) {
      mkdirSync(join(root, path, '..'), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    execFileSync('git', [...GIT_CONFIG, 'add', '-A'], { cwd: root });
    execFileSync('git', [...GIT_CONFIG, 'commit', '-q', '-m', `version ${commits.length}`], { cwd: root });
    commits.push(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim());
  }
  return { root, commits };
}

function archiveOf(files) {
  const root = mkdtempSync(join(tmpdir(), 'evidence-archive-'));
  mkdirSync(join(root, 'blobs'));
  const entries = [];
  for (const [originalPath, text] of Object.entries(files)) {
    const data = Buffer.from(text);
    writeFileSync(join(root, 'blobs', sha256(data)), data);
    entries.push({ originalPath, sha256: sha256(data), bytes: data.length, mtime: '2026-09-27T09:00:00.000+02:00', role: 'raw-input', basis: ['test'] });
  }
  writeFileSync(join(root, 'index.json'), JSON.stringify({ kind: 'domternal-evidence-archive-index', version: 1, entries }));
  return root;
}

function manifestFor(files) {
  return { kind: INPUTS_KIND, version: 1, unit: 'synthetic', files };
}

test('artifact records keep the key order the originals wrote', () => {
  assert.deepEqual(Object.keys(artifactRecord('Role', '/private/tmp/x.log', Buffer.from('x'))), ['role', 'localPath', 'bytes', 'sha256']);
});

test('every input read is checked against its recorded size and digest', () => {
  const dir = mkdtempSync(join(tmpdir(), 'evidence-inputs-'));
  try {
    writeFileSync(join(dir, 'good.log'), 'good\n');
    writeFileSync(join(dir, 'tampered.log'), 'tampered\n');
    const good = Buffer.from('good\n');
    const inputs = new InputSet(
      manifestFor([
        { role: 'raw-input', originalPath: '/private/tmp/good.log', bytes: good.length, sha256: sha256(good), source: { kind: 'file', path: join(dir, 'good.log') } },
        { role: 'raw-input', originalPath: '/private/tmp/tampered.log', bytes: good.length, sha256: sha256(good), source: { kind: 'file', path: join(dir, 'tampered.log') } },
        { role: 'raw-input', originalPath: '/private/tmp/gone.log', bytes: good.length, sha256: sha256(good), source: { kind: 'file', path: join(dir, 'gone.log') } },
        { role: 'frozen-source', originalPath: '/repo/lost.d.ts', bytes: 3, sha256: sha256('abc'), source: { kind: 'lost' } },
      ])
    );
    assert.equal(inputs.readText('/private/tmp/good.log'), 'good\n');
    assert.throws(() => inputs.read('/private/tmp/tampered.log'), (error) => error.check === 'Input digest mismatch');
    assert.throws(() => inputs.read('/private/tmp/gone.log'), (error) => error.check === 'Input source file missing');
    assert.throws(() => inputs.read('/private/tmp/unlisted.log'), (error) => error.check === 'Input missing from inputs.json');
    assert.equal(inputs.readOrLost('/repo/lost.d.ts'), LOST);
    assert.throws(() => inputs.read('/repo/lost.d.ts'), (error) => error.check === 'Input bytes were not preserved');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a malformed inputs manifest is refused', () => {
  const valid = { role: 'raw-input', originalPath: '/private/tmp/a', bytes: 1, sha256: sha256('a'), source: { kind: 'lost' } };
  assert.throws(() => new InputSet({ ...manifestFor([]), kind: 'other' }), /Not an evidence inputs manifest/);
  assert.throws(() => new InputSet(manifestFor([valid, valid])), /Duplicate input/);
  assert.throws(() => new InputSet(manifestFor([{ ...valid, originalPath: 'relative' }])), /absolute original path/);
  assert.throws(() => new InputSet(manifestFor([{ ...valid, sha256: 'short' }])), /recorded size and digest/);
  assert.throws(() => new InputSet(manifestFor([{ ...valid, source: { kind: 'guess' } }])), /known source/);
});

test('recorded bytes are found in the archive first, then in Git history, else recorded as lost', () => {
  const archive = archiveOf({ '/private/tmp/a.log': 'archived\n' });
  const { root, commits } = gitRepository([{ 'src/file.ts': 'first\n' }, { 'src/file.ts': 'second\n' }]);
  try {
    const store = new EvidenceArchive(archive);
    assert.deepEqual(locateRecordedBytes({ archive: store, repository: root, relativePath: 'x', digest: sha256('archived\n') }), {
      kind: 'file',
      path: join(archive, 'blobs', sha256('archived\n')),
    });
    assert.deepEqual(locateRecordedBytes({ archive: store, repository: root, relativePath: 'src/file.ts', digest: sha256('first\n') }), {
      kind: 'git',
      repository: root,
      revision: commits[0],
      path: 'src/file.ts',
    });
    assert.deepEqual(locateRecordedBytes({ archive: store, repository: root, relativePath: 'src/file.ts', digest: sha256('never\n') }), { kind: 'lost' });
    assert.equal(findInGitHistory(root, 'no/such/file', sha256('x')), null);
    const inputs = new InputSet(
      manifestFor([{ role: 'r', originalPath: '/repo/src/file.ts', bytes: 6, sha256: sha256('first\n'), source: { kind: 'git', repository: root, revision: commits[0], path: 'src/file.ts' } }])
    );
    assert.equal(inputs.readText('/repo/src/file.ts'), 'first\n');
  } finally {
    rmSync(archive, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test('the archive lists a directory the way a Python glob listed it', () => {
  const archive = archiveOf({ '/tmp/pack/a.tgz': 'a', '/tmp/pack/b.tgz': 'b', '/tmp/pack/c.log': 'c', '/tmp/pack/deep/d.tgz': 'd' });
  try {
    const store = new EvidenceArchive(archive);
    assert.deepEqual(store.entriesIn('/tmp/pack', '.tgz').map((entry) => entry.originalPath).sort(), ['/tmp/pack/a.tgz', '/tmp/pack/b.tgz']);
    assert.throws(() => new EvidenceArchive(join(archive, 'blobs')), /index missing/);
  } finally {
    rmSync(archive, { recursive: true, force: true });
  }
});

const SYNTHETIC_UNIT = {
  STEM: 'synthetic',
  ROOT: '/repo',
  SNAPSHOT: '/private/tmp/snapshot.json',
  REPORT: 'e2e/results/synthetic.json',
  MARKDOWN: 'e2e/results/synthetic.md',
  requiredInputs: () => ({
    files: [{ role: 'raw-input', originalPath: '/private/tmp/run.log' }],
    directories: [],
    repositoryFiles: [],
    storedOutputs: [],
  }),
};

test('building replay inputs fails when a recorded input is not archived', () => {
  const archive = archiveOf({ '/private/tmp/snapshot.json': '{"gitHead": "x", "inventory": []}' });
  try {
    assert.throws(
      () => buildInputsFromArchive(SYNTHETIC_UNIT, { archive: new EvidenceArchive(archive), repository: null }),
      (error) => error.check === 'Input missing from the evidence archive' && error.message.includes('/private/tmp/run.log')
    );
  } finally {
    rmSync(archive, { recursive: true, force: true });
  }
});

test('replay takes verifiedAt from the committed report or refuses to run', () => {
  const { root } = gitRepository([{ 'e2e/results/synthetic.json': '{"kind": "synthetic"}\n', 'e2e/results/synthetic.md': '# x\n' }]);
  const out = join(root, 'replay-out');
  try {
    assert.throws(
      () => replayUnit(SYNTHETIC_UNIT, { archiveDir: join(root, 'no-archive'), repository: root, outDir: out }),
      (error) => error.check === 'Replay needs verifiedAt from the committed report'
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * A unit whose port writes exactly the committed files, replayed against an
 * archive whose Python baseline outputs are `baseline`.
 */
function replayWithBaseline(baseline) {
  const report = '{"verifiedAt": "2026-09-27T07:00:32.762050+00:00"}\n';
  const markdown = '# Synthetic\n';
  const verified = '{"verifiedAt": "2026-09-27T06:59:00.000000+00:00"}\n';
  const { root, commits } = gitRepository([{ 'e2e/results/synthetic.json': report, 'e2e/results/synthetic.md': markdown }]);
  const scratch = '/private/tmp/scratch';
  const archive = archiveOf({
    '/private/tmp/snapshot.json': `{"gitHead": "${commits[0]}", "inventory": []}\n`,
    '/private/tmp/run.log': 'ok\n',
    '/private/tmp/verified.json': verified,
    [`${scratch}/mirror/repo/e2e/results/synthetic.json`]: baseline.json ?? report,
    [`${scratch}/mirror/repo/e2e/results/synthetic.md`]: baseline.markdown ?? markdown,
    [`${scratch}/out/verified.json`]: baseline.verifier ?? verified,
  });
  const unit = {
    ...SYNTHETIC_UNIT,
    requiredInputs: () => ({
      ...SYNTHETIC_UNIT.requiredInputs(),
      files: [{ role: 'raw-input', originalPath: '/private/tmp/run.log' }, { role: 'raw-input', originalPath: '/private/tmp/snapshot.json' }],
      storedOutputs: [{ role: 'stored-verifier-output', originalPath: '/private/tmp/verified.json' }],
    }),
    PYTHON_BASELINE: {
      scratchRoot: scratch,
      mirrorRoot: `${scratch}/mirror/repo`,
      json: `${scratch}/mirror/repo/e2e/results/synthetic.json`,
      markdown: `${scratch}/mirror/repo/e2e/results/synthetic.md`,
      verifier: `${scratch}/out/verified.json`,
    },
    verifyBrowserEvidence: () => ({ bytes: Buffer.from(verified), lost: [] }),
    assembleQualification: () => ({ json: Buffer.from(report), markdown: Buffer.from(markdown), lost: [], membership: {} }),
  };
  try {
    return replayUnit(unit, { archiveDir: archive, repository: root, outDir: join(root, 'replay-out') });
  } finally {
    rmSync(archive, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
}

test('replay fails when the port differs from the recorded Python baseline', () => {
  const result = replayWithBaseline({});
  assert.equal(result.classification, 'IDENTICAL');
  assert.equal(result.pythonBaseline.classification, 'IDENTICAL');
  for (const baseline of [{ json: '{"verifiedAt": "other"}\n' }, { markdown: '# Other\n' }, { verifier: '{}\n' }]) {
    assert.throws(
      () => replayWithBaseline(baseline),
      (error) => error.check === 'Replay differs from the recorded Python baseline',
      `a baseline differing in ${Object.keys(baseline)[0]} must fail the replay`
    );
  }
});

test('replay never writes into an existing output directory', () => {
  const { root } = gitRepository([{ 'e2e/results/synthetic.json': '{"verifiedAt": "2026-09-27T07:00:32.762050+00:00"}\n', 'e2e/results/synthetic.md': '# x\n' }]);
  try {
    mkdirSync(join(root, 'replay-out'));
    assert.throws(
      () => replayUnit(SYNTHETIC_UNIT, { archiveDir: join(root, 'no-archive'), repository: root, outDir: join(root, 'replay-out') }),
      (error) => error.check === 'Replay output directory already exists'
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('byte comparison classifies and explains differences', () => {
  assert.deepEqual(compareBytes(Buffer.from('a'), Buffer.from('a')), { result: 'IDENTICAL' });
  const differs = compareBytes(Buffer.from('{"a": 1}\n'), Buffer.from('{"a": 2}\n'), { json: true });
  assert.equal(differs.result, 'DIFFERS');
  assert.deepEqual(differs.diff.map((op) => `${op.op} ${op.path}`), ['replace /a']);
  assert.deepEqual(CLASSIFICATIONS.at(-1), 'DIFFERS');
});

test('the Python baseline is compared only after its declared normalizations', () => {
  const recordedRoot = '/Users/me/repo';
  const mirrorRoot = '/private/tmp/scratch/mirror/repo';
  const node = Buffer.from(`{"localPath": "${recordedRoot}/a.json"}\n`);
  const python = Buffer.from(`{"localPath": "${mirrorRoot}/a.json"}\n`);
  const mapped = compareWithPythonBaseline({ produced: node, python, mirrorRoot, recordedRoot });
  assert.equal(mapped.result, 'IDENTICAL_AFTER_DECLARED_NORMALIZATION');
  assert.equal(mapped.normalizations.length, 1);
  const markdown = (digest) => Buffer.from(`- JSON SHA256: \`${digest}\`\n`);
  const digestMapped = compareWithPythonBaseline({ produced: markdown(sha256(node)), python: markdown(sha256(python)), mirrorRoot, recordedRoot, pythonJson: python });
  assert.equal(digestMapped.result, 'IDENTICAL_AFTER_DECLARED_NORMALIZATION');
  assert.match(digestMapped.normalizations[0], /recomputed after root mapping/);
  assert.equal(compareWithPythonBaseline({ produced: node, python: node, mirrorRoot, recordedRoot }).result, 'IDENTICAL');
  assert.equal(compareWithPythonBaseline({ produced: Buffer.from('other'), python, mirrorRoot, recordedRoot }).result, 'DIFFERS');
  assert.ok(new EvidenceCheckError('x') instanceof Error);
});
