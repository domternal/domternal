/**
 * Declared redactions: the value-free rule R1, the version 2 declaration the
 * gate checks, the local history check, the writers' guard, and the replay
 * reading archived inputs through a redaction. Account names here are
 * assembled at run time, so no path in this file names a real account.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { EvidenceArchive, INPUTS_KIND, InputSet } from './artifacts.mjs';
import { check, checkDeclarations, checkHistoricalTools, readDeclarations } from './check.mjs';
import { refusePersonalPaths } from './cli.mjs';
import { sha256 } from './json.mjs';
import {
  applyDeclaredRedaction,
  checkRedactions,
  countPlaceholders,
  declaredFiles,
  historyProblems,
  holdsPersonalPath,
  redactBytes,
  redactPaths,
  RULE,
  undeclaredPlaceholders,
} from './redaction.mjs';
import { buildInputsFromArchive, classifyReplay, compareWithPythonBaseline, compareWithRedaction, declaredRedaction } from './replay.mjs';

const account = ['dev', 'eloper'].join('');
const home = `/Users/${account}`;
const linuxHome = `/home/${account}`;
const scratchpad = `/private/tmp/claude-501/-Users-${account}-Documents-Domternal-domternal/0123abcd-4567-89ab-cdef-0123456789ab/scratchpad`;
const GIT = ['-c', 'user.name=Evidence Test', '-c', 'user.email=evidence@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null'];

test('R1 replaces home folders and session scratchpads by their placeholders, and holds no value', () => {
  assert.equal(redactPaths(`PATH=${home}/.nvm/versions/node/v22/bin:$PATH`), 'PATH=$HOME/.nvm/versions/node/v22/bin:$PATH');
  assert.equal(redactPaths(`ROOT = Path('${home}/Documents/repo')`), "ROOT = Path('$HOME/Documents/repo')");
  assert.equal(redactPaths(`${linuxHome}/work`), '$HOME/work');
  assert.equal(redactPaths(`"path": "${scratchpad}/b3map/out.json"`), '"path": "$SCRATCHPAD/b3map/out.json"');
  assert.equal(redactPaths(`root ${scratchpad}/f mapped back to ${home}/repo`), 'root $SCRATCHPAD/f mapped back to $HOME/repo');
  assert.equal(redactPaths(`file://${home}/a.html`), 'file://$HOME/a.html');
  // A URL path or a longer name is not a home folder.
  for (const text of ['https://site.example/home/page', 'a/Users/b', 'node_modules/.home/x', '/private/tmp/claude-501/x/not-a-session/scratchpad']) {
    assert.equal(redactPaths(text), text);
  }
  const once = redactPaths(`${home} ${scratchpad}`);
  assert.equal(redactPaths(once), once, 'applying the rule twice changes nothing');
  assert.equal(holdsPersonalPath(once), false);
  assert.equal(holdsPersonalPath(home), true);
  assert.deepEqual(RULE.map((step) => step.with), ['$HOME', '$SCRATCHPAD']);
  assert.ok(RULE.every((step) => !step.replaces.includes('/')), 'the declared rule describes, it never records a path');
});

test('placeholders are counted as whole tokens, and bytes R1 leaves alone are returned as they are', () => {
  assert.equal(countPlaceholders('$HOME/a $SCRATCHPAD/b $HOME'), 3);
  assert.equal(countPlaceholders('$HOMEPAGE $SCRATCHPADS $PATH'), 0);
  const plain = Buffer.from('nothing personal\n');
  assert.equal(redactBytes(plain), plain);
  assert.equal(redactBytes(Buffer.from(`${home}/x`)).toString(), '$HOME/x');
});

/** A repository-like root with one historical-tools directory and its report. */
function evidenceRoot({ manifest, files }) {
  const root = mkdtempSync(join(tmpdir(), 'evidence-redaction-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  const directory = 'e2e/results/historical-tools/unit';
  mkdirSync(join(root, directory), { recursive: true });
  writeFileSync(join(root, directory, 'MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { root, directory };
}

const REPORT = 'e2e/results/unit.json';
const reportText = (digest) => `{\n  "command": "PATH=$HOME/bin:$PATH",\n  "artifacts": [\n    {\n      "localPath": "/private/tmp/tool.py",\n      "bytes": 21,\n      "sha256": "${digest}"\n    }\n  ]\n}\n`;
const TOOL = 'e2e/results/historical-tools/unit/tool.py';
const toolText = "ROOT = '$HOME/repo'\n";

function declaration(overrides = {}) {
  const tool = Buffer.from(toolText);
  const report = Buffer.from(reportText(sha256(tool)));
  return {
    id: '2026-10-03-home-paths',
    date: '2026-10-03',
    reason: 'Home folder paths of the producing machine are replaced; digests of the unredacted bytes are withheld.',
    rule: RULE.map((step) => ({ ...step })),
    files: [
      { path: '../../unit.json', occurrences: 1, redactedSha256: sha256(report), redactedBytes: report.length, originalIn: 'abc1234' },
      { path: 'tool.py', occurrences: 1, redactedSha256: sha256(tool), redactedBytes: tool.length, originalIn: 'abc1234' },
    ],
    digestsReplaced: ['../../unit.json#/artifacts/0/sha256', 'MANIFEST.json#/reportSha256'],
    digestsWithheld: ['MANIFEST.json#/pythonOutput/sha256', 'MANIFEST.json#/notes/0'],
    ...overrides,
  };
}

function manifestWith(redaction, extra = {}) {
  const report = Buffer.from(reportText(sha256(Buffer.from(toolText))));
  return {
    kind: 'domternal-historical-evidence-tools',
    version: 2,
    reportSha256: sha256(report),
    pythonOutput: { path: '$SCRATCHPAD/out.json', sha256: 'withheld' },
    notes: ['The committed JSON digest of that run is withheld since the redaction.'],
    redactions: [redaction],
    ...extra,
  };
}

function redactionProblems(redaction, { files = {}, extra = {} } = {}) {
  const manifest = manifestWith(redaction, extra);
  const { root, directory } = evidenceRoot({
    manifest,
    files: { [REPORT]: reportText(sha256(Buffer.from(toolText))), [TOOL]: toolText, ...files },
  });
  try {
    const declarations = [{ directory, manifest }];
    return checkRedactions(root, directory, manifest, declaredFiles(declarations));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const expectRedactionProblem = (redaction, pattern, options) => {
  const problems = redactionProblems(redaction, options);
  assert.ok(problems.some((problem) => pattern.test(problem)), `expected ${pattern} in:\n${problems.join('\n')}`);
};

test('a complete declaration passes', () => {
  assert.deepEqual(redactionProblems(declaration()), []);
});

test('a declaration names each changed file with its redacted size, digest, placeholder count and original commit', () => {
  const files = declaration().files;
  expectRedactionProblem(declaration({ files: [{ ...files[0], redactedSha256: '0'.repeat(64) }, files[1]] }), /is not the redacted file declared/);
  expectRedactionProblem(declaration({ files: [{ ...files[0], redactedBytes: 1 }, files[1]] }), /is not the redacted file declared/);
  expectRedactionProblem(declaration({ files: [{ ...files[0], occurrences: 2 }, files[1]] }), /holds 1 placeholders, redactions\[0\] declares 2/);
  expectRedactionProblem(declaration({ files: [{ ...files[0], originalIn: 'HEAD' }, files[1]] }), /needs the commit that holds its unredacted bytes/);
  expectRedactionProblem(declaration({ files: [{ ...files[0], originalSha256: 'a'.repeat(64) }, files[1]] }), /unknown key originalSha256/);
  expectRedactionProblem(declaration({ files: [{ ...files[0], path: '../../../../../outside.json' }, files[1]] }), /leaves the repository/);
  expectRedactionProblem(declaration({ files: [...files, { ...files[1] }] }), /declared by more than one redaction/);
  const tool = `ROOT = '${home}/repo' and '$HOME/repo'\n`;
  expectRedactionProblem(
    declaration({ files: [files[0], { ...files[1], occurrences: 1, redactedSha256: sha256(tool), redactedBytes: Buffer.byteLength(tool) }] }),
    /still holds a path the redaction replaces/,
    { files: { [TOOL]: tool } }
  );
});

test('the declaration itself is complete: id, date, reason and rule, and nothing else', () => {
  expectRedactionProblem(declaration({ id: 'home paths' }), /needs a unique id/);
  expectRedactionProblem(declaration({ date: 'today' }), /needs a date/);
  expectRedactionProblem(declaration({ reason: ' ' }), /needs a reason/);
  expectRedactionProblem(declaration({ rule: [] }), /needs its rule/);
  expectRedactionProblem(declaration({ rule: [{ replaces: 'the login', with: '<redacted>' }] }), /must replace a described value by \$HOME or \$SCRATCHPAD/);
  expectRedactionProblem(declaration({ originals: [] }), /unknown key originals/);
  const problems = redactionProblems(declaration(), { extra: { redactions: [] } });
  assert.ok(problems.some((problem) => /must declare its redactions/.test(problem)), problems.join('\n'));
});

test('every replaced digest is a redacted file\'s digest, and every withheld one says withheld', () => {
  expectRedactionProblem(declaration({ digestsReplaced: ['../../unit.json#/artifacts/0/localPath'] }), /is not the redacted digest of a declared file/);
  expectRedactionProblem(declaration({ digestsReplaced: ['../../unit.json#/artifacts/7/sha256'] }), /names nothing/);
  expectRedactionProblem(declaration({ digestsReplaced: ['missing.json#/x'] }), /names a missing file/);
  expectRedactionProblem(declaration({ digestsReplaced: ['../../unit.json'] }), /is not <file>#<pointer or label>/);
  expectRedactionProblem(declaration({ digestsWithheld: ['MANIFEST.json#/reportSha256'] }), /must hold "withheld" in place of the digest/);
  expectRedactionProblem(declaration(), /must hold "withheld"/, { extra: { notes: [`The committed JSON is ${'a'.repeat(64)}.`] } });
  expectRedactionProblem(declaration(), /must hold "withheld"/, { extra: { pythonOutput: { sha256: 'withheld since the redaction' } } });
  assert.deepEqual(
    redactionProblems(declaration(), { extra: { notes: [`A lost run printed ${'b'.repeat(64)}; the committed digest is withheld.`] } }),
    [],
    'a sentence may keep other digests once it says which one is withheld'
  );
});

test('a Markdown digest is named by its label', () => {
  const report = Buffer.from(reportText(sha256(Buffer.from(toolText))));
  const markdown = `# Unit\n\n- JSON SHA256: \`${sha256(report)}\`\n`;
  assert.deepEqual(redactionProblems(declaration({ digestsReplaced: ['../../unit.md#JSON SHA256'] }), { files: { 'e2e/results/unit.md': markdown } }), []);
  expectRedactionProblem(declaration({ digestsReplaced: ['../../unit.md#Other SHA256'] }), /names no digest label/, { files: { 'e2e/results/unit.md': markdown } });
});

test('a redaction that changes nothing is refused', () => {
  const manifest = { ...manifestWith(declaration({ files: [], digestsReplaced: [], digestsWithheld: [] })), pythonOutput: undefined, notes: [] };
  const { root, directory } = evidenceRoot({ manifest, files: {} });
  try {
    assert.ok(checkRedactions(root, directory, manifest, new Map()).some((problem) => /change no file/.test(problem)));
    const located = { ...manifest, location: '$HOME/Documents/evidence-archive' };
    assert.deepEqual(checkRedactions(root, directory, located, new Map()), [], 'placeholders in the manifest itself are a change');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a placeholder in an evidence file no manifest declares fails, in a declared file or a version 2 manifest it does not', () => {
  const root = mkdtempSync(join(tmpdir(), 'evidence-undeclared-'));
  try {
    mkdirSync(join(root, 'e2e/results'), { recursive: true });
    writeFileSync(join(root, 'e2e/results/a.json'), '{"path": "$HOME/x"}\n');
    writeFileSync(join(root, 'e2e/results/b.json'), '{"path": "$SCRATCHPAD/x"}\n');
    writeFileSync(join(root, 'e2e/results/c.json'), '{"path": "$HOMEPAGE"}\n');
    const files = ['e2e/results/a.json', 'e2e/results/b.json', 'e2e/results/c.json'];
    const declared = new Map([['e2e/results/a.json', {}]]);
    assert.deepEqual(undeclaredPlaceholders(root, files, declared, new Set()), [
      'e2e/results/b.json: holds $HOME or $SCRATCHPAD, but no MANIFEST.json declares a redaction of it',
    ]);
    assert.deepEqual(undeclaredPlaceholders(root, files, declared, new Set(['e2e/results/b.json'])), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the gate reads version 2 manifests and keeps version 1 rules for the rest', () => {
  const root = mkdtempSync(join(tmpdir(), 'evidence-versions-'));
  try {
    const directory = 'e2e/paste-cleanup-results/historical-tools/x';
    mkdirSync(join(root, directory), { recursive: true });
    writeFileSync(join(root, directory, 'MANIFEST.json'), `${JSON.stringify({ kind: 'domternal-historical-evidence-tools', version: 1, redactions: [] })}\n`);
    const entry = { path: 'e2e/paste-cleanup-results/x.json', historicalTools: directory };
    const problems = checkHistoricalTools(root, entry, [`${directory}/MANIFEST.json`], new Map());
    assert.ok(problems.some((problem) => /only a version 2 manifest can/.test(problem)), problems.join('\n'));
    writeFileSync(join(root, directory, 'MANIFEST.json'), `${JSON.stringify({ kind: 'domternal-historical-evidence-tools', version: 3 })}\n`);
    assert.ok(checkHistoricalTools(root, entry, [], new Map()).some((problem) => /version 1 or 2 manifest/.test(problem)));
    writeFileSync(join(root, directory, 'MANIFEST.json'), `${JSON.stringify({ kind: 'domternal-historical-evidence-tools', version: 2 })}\n`);
    assert.ok(checkHistoricalTools(root, entry, [], new Map()).some((problem) => /must declare its redactions/.test(problem)));
    assert.equal(readDeclarations(root, [entry]).length, 1);
    writeFileSync(join(root, 'e2e/paste-cleanup-results/stray.md'), 'run from $HOME/x\n');
    assert.deepEqual(checkDeclarations(root, [entry], ['e2e/paste-cleanup-results/stray.md']), [
      'e2e/paste-cleanup-results/stray.md: holds $HOME or $SCRATCHPAD, but no MANIFEST.json declares a redaction of it',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the committed evidence passes with its declarations', () => {
  assert.deepEqual(check(), []);
});

/** A throwaway repository holding `original` files at one commit and `redacted` ones in the work tree. */
function historyRepository(original, redacted) {
  const root = mkdtempSync(join(tmpdir(), 'evidence-history-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  for (const [path, text] of Object.entries(original)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  execFileSync('git', [...GIT, 'add', '-A'], { cwd: root });
  execFileSync('git', [...GIT, 'commit', '-q', '-m', 'original'], { cwd: root });
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  for (const [path, text] of Object.entries(redacted)) writeFileSync(join(root, path), text);
  return { root, commit };
}

test('the history check proves the committed files are their originals with only the declared redaction applied', () => {
  const toolOriginal = `ROOT = '${home}/repo'\n`;
  const report = (tool) => `{\n  "command": "PATH=${home}/bin:$PATH",\n  "artifacts": [\n    {\n      "bytes": ${Buffer.byteLength(tool)},\n      "sha256": "${sha256(tool)}"\n    }\n  ]\n}\n`;
  const toolRedacted = redactPaths(toolOriginal);
  const reportRedacted = redactPaths(report(toolRedacted));
  const original = { 'r/report.json': report(toolOriginal), 'r/tool.py': toolOriginal };
  const redacted = { 'r/report.json': reportRedacted, 'r/tool.py': toolRedacted };
  const { root, commit } = historyRepository(original, redacted);
  try {
    const all = new Map(Object.keys(original).map((path) => [path, { file: { originalIn: commit } }]));
    const result = historyProblems(root, all);
    assert.deepEqual(result.problems, []);
    assert.equal(result.compared, 2);
    assert.equal(applyDeclaredRedaction(Buffer.from(original['r/report.json']), [
      { originalSha256: sha256(toolOriginal), redactedSha256: sha256(toolRedacted), originalBytes: Buffer.byteLength(toolOriginal), redactedBytes: Buffer.byteLength(toolRedacted) },
    ]).toString(), reportRedacted);
    writeFileSync(join(root, 'r/tool.py'), `${toolRedacted}# and one more change\n`);
    assert.match(historyProblems(root, all).problems.join('\n'), /r\/tool\.py: the committed bytes are not the original/);
    const gone = new Map([...all].map(([path]) => [path, { file: { originalIn: 'ffffffff' } }]));
    const missing = historyProblems(root, gone);
    assert.deepEqual(missing.problems, [], 'an original Git no longer holds is reported, not failed');
    assert.equal(missing.unavailable.length, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the writers refuse evidence that records a home folder or scratchpad', () => {
  assert.throws(() => refusePersonalPaths(Buffer.from(`{"path": "${home}/x"}`), 'out.json'), /Refusing to write a home folder or scratchpad path/);
  assert.throws(() => refusePersonalPaths(Buffer.from(`${scratchpad}/x`), 'out.md'), /Refusing to write/);
  assert.doesNotThrow(() => refusePersonalPaths(Buffer.from('{"path": "$HOME/x"}'), 'out.json'));
});

function archiveOf(files) {
  const root = mkdtempSync(join(tmpdir(), 'evidence-archive-'));
  mkdirSync(join(root, 'blobs'));
  const entries = [];
  for (const [originalPath, text] of Object.entries(files)) {
    const data = Buffer.from(text);
    writeFileSync(join(root, 'blobs', sha256(data)), data);
    entries.push({ originalPath, sha256: sha256(data), bytes: data.length });
  }
  writeFileSync(join(root, 'index.json'), JSON.stringify({ kind: 'domternal-evidence-archive-index', version: 1, entries }));
  return root;
}

test('the archive finds a file by its recorded path or by that path through the redaction', () => {
  const archive = archiveOf({ [`${home}/repo/a.json`]: 'a', [`${scratchpad}/out/b.json`]: 'b', [`${scratchpad}/pack/c.tgz`]: 'c' });
  try {
    const store = new EvidenceArchive(archive);
    assert.equal(store.entry('$HOME/repo/a.json')?.sha256, sha256('a'));
    assert.equal(store.entry(`${home}/repo/a.json`)?.sha256, sha256('a'));
    assert.equal(store.entry('$SCRATCHPAD/out/b.json')?.sha256, sha256('b'));
    assert.deepEqual(store.entriesIn('$SCRATCHPAD/pack', '.tgz').map((entry) => entry.sha256), [sha256('c')]);
  } finally {
    rmSync(archive, { recursive: true, force: true });
  }
});

test('an input read through the redaction is checked against its redacted size and digest', () => {
  const dir = mkdtempSync(join(tmpdir(), 'evidence-redacted-input-'));
  try {
    const original = `ROOT = '${home}/repo'\n`;
    writeFileSync(join(dir, 'tool.py'), original);
    const redacted = Buffer.from(redactPaths(original));
    const file = { role: 'raw-input', originalPath: '/private/tmp/tool.py', bytes: redacted.length, sha256: sha256(redacted), source: { kind: 'file', path: join(dir, 'tool.py'), redaction: '2026-10-03-home-paths' } };
    const inputs = new InputSet({ kind: INPUTS_KIND, version: 1, unit: 'synthetic', files: [file, { ...file, originalPath: '$HOME/repo/tool.py' }] });
    assert.equal(inputs.readText('/private/tmp/tool.py'), "ROOT = '$HOME/repo'\n");
    assert.equal(inputs.readText('$HOME/repo/tool.py'), "ROOT = '$HOME/repo'\n", 'a placeholder-rooted path is a recorded path');
    const unredacted = new InputSet({ kind: INPUTS_KIND, version: 1, unit: 'synthetic', files: [{ ...file, source: { kind: 'file', path: join(dir, 'tool.py') } }] });
    assert.throws(() => unredacted.read('/private/tmp/tool.py'), (error) => error.check === 'Input digest mismatch');
    assert.throws(() => new InputSet({ kind: INPUTS_KIND, version: 1, unit: 's', files: [{ ...file, originalPath: 'relative/tool.py' }] }), /absolute original path/);
    assert.throws(() => new InputSet({ kind: INPUTS_KIND, version: 1, unit: 's', files: [{ ...file, source: { kind: 'lost', redaction: 'x' } }] }), /invalid redaction/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('replay reads the inputs a redaction changed through it, and names the redaction when it compares', () => {
  const toolOriginal = `ROOT = '${home}/repo'\n`;
  const toolRedacted = redactPaths(toolOriginal);
  const archive = archiveOf({ '/private/tmp/tool.py': toolOriginal, '/private/tmp/run.log': `ran in ${home}\n`, '/private/tmp/snapshot.json': '{"gitHead": "x", "inventory": []}' });
  try {
    const unit = {
      STEM: 'synthetic',
      ROOT: '$HOME/repo',
      SNAPSHOT: '/private/tmp/snapshot.json',
      REDACTION: { id: '2026-10-03-home-paths', inputs: ['/private/tmp/tool.py'] },
      requiredInputs: () => ({
        files: [
          { role: 'raw-input', originalPath: '/private/tmp/tool.py' },
          { role: 'raw-input', originalPath: '/private/tmp/run.log' },
          { role: 'raw-input', originalPath: '/private/tmp/snapshot.json' },
        ],
        directories: [],
        repositoryFiles: [],
        storedOutputs: [],
      }),
    };
    const manifest = buildInputsFromArchive(unit, { archive: new EvidenceArchive(archive), repository: null });
    const tool = manifest.files.find((file) => file.originalPath === '/private/tmp/tool.py');
    assert.equal(tool.sha256, sha256(toolRedacted));
    assert.equal(tool.source.redaction, '2026-10-03-home-paths');
    const log = manifest.files.find((file) => file.originalPath === '/private/tmp/run.log');
    assert.equal(log.sha256, sha256(`ran in ${home}\n`), 'an input the redaction did not change keeps its recorded digest');
    assert.equal(new InputSet(manifest).readText('/private/tmp/tool.py'), toolRedacted);

    const redaction = declaredRedaction(unit, manifest);
    assert.deepEqual(redaction.mapping, [{ originalSha256: sha256(toolOriginal), redactedSha256: sha256(toolRedacted), originalBytes: Buffer.byteLength(toolOriginal), redactedBytes: Buffer.byteLength(toolRedacted) }]);
    const record = (text) => `{\n  "artifacts": [\n    {\n      "bytes": ${Buffer.byteLength(text)},\n      "sha256": "${sha256(text)}"\n    }\n  ],\n  "root": "${home}/repo"\n}\n`;
    const produced = Buffer.from(record(toolRedacted).replace(home, '$HOME'));
    const stored = compareWithRedaction(produced, Buffer.from(record(toolOriginal)), redaction, { json: true });
    assert.equal(stored.result, 'IDENTICAL_AFTER_DECLARED_NORMALIZATION');
    assert.deepEqual(stored.normalizations, ['declared redaction 2026-10-03-home-paths applied']);
    assert.equal(compareWithRedaction(produced, Buffer.from(record('other')), redaction, { json: true }).result, 'DIFFERS');
    const mirror = `${scratchpad}/mirror/repo`;
    const python = Buffer.from(`{"localPath": "${mirror}/a.json", "tool": "${sha256(toolOriginal)}"}\n`);
    const node = Buffer.from(`{"localPath": "$HOME/repo/a.json", "tool": "${sha256(toolRedacted)}"}\n`);
    const baseline = compareWithPythonBaseline({ produced: node, python, mirrorRoot: '$SCRATCHPAD/mirror/repo', recordedRoot: '$HOME/repo', redaction });
    assert.equal(baseline.result, 'IDENTICAL_AFTER_DECLARED_NORMALIZATION');
    assert.equal(baseline.normalizations[0], 'declared redaction 2026-10-03-home-paths applied');
    const markdown = (digest) => Buffer.from(`- JSON SHA256: \`${digest}\`\n`);
    const embedded = compareWithPythonBaseline({ produced: markdown(sha256(node)), python: markdown(sha256(python)), mirrorRoot: '$SCRATCHPAD/mirror/repo', recordedRoot: '$HOME/repo', pythonJson: python, redaction });
    assert.equal(embedded.result, 'IDENTICAL_AFTER_DECLARED_NORMALIZATION');
    assert.ok(embedded.normalizations.every((note) => !/[0-9a-f]{64}/.test(note)), 'no digest of unredacted bytes is named');
  } finally {
    rmSync(archive, { recursive: true, force: true });
  }
});

test('lost inputs keep a replay partial however its outputs compare', () => {
  assert.equal(classifyReplay(['IDENTICAL_AFTER_DECLARED_NORMALIZATION'], 1), 'PARTIAL_LOST_INPUTS');
  assert.equal(classifyReplay(['IDENTICAL_AFTER_DECLARED_NORMALIZATION'], 0), 'IDENTICAL_AFTER_DECLARED_NORMALIZATION');
  assert.equal(classifyReplay(['DIFFERS'], 1), 'DIFFERS');
});
