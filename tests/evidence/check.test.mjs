/**
 * The `test:evidence` gate: the repository passes, and a fixture copy of the
 * committed evidence fails with a specific problem for every kind of break the
 * gate exists to catch.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  JSON_CEILING_BYTES,
  REPORTS,
  check,
  checkHistoricalTools,
  guardCode,
  guardPackageScripts,
  guardWorkflow,
  markdownDigests,
  serialize,
} from './check.mjs';
import { indentedBytes, parseJson } from './json.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Code the guard must reject, assembled at run time: written out literally,
 * this test file would itself look like it spawns Python.
 */
const code = (...parts) => parts.join('');
const MARKERS = 'e2e/paste-cleanup-results/2026-09-27-list-markers.json';
const BREAKS = 'e2e/paste-cleanup-results/2026-09-27-styled-breaks.json';
const MARKER_TOOLS = 'e2e/paste-cleanup-results/historical-tools/2026-09-27-list-markers';
const BREAK_TOOLS = 'e2e/paste-cleanup-results/historical-tools/2026-09-27-styled-breaks';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'evidence-check-'));
  for (const directory of ['e2e/paste-cleanup-results', 'e2e/paste-performance/results']) {
    cpSync(join(repoRoot, directory), join(root, directory), { recursive: true });
  }
  writeFileSync(join(root, 'package.json'), `${JSON.stringify({ scripts: { 'test:evidence': 'node --test tests/evidence/*.test.mjs && node tests/evidence/cli.mjs check' } }, null, 2)}\n`);
  mkdirSync(join(root, '.github/workflows'), { recursive: true });
  writeFileSync(join(root, '.github/workflows/ci.yml'), 'jobs:\n  test:\n    steps:\n      - run: pnpm test:evidence\n');
  return root;
}

function problemsAfter(mutate) {
  const root = fixture();
  try {
    mutate(root);
    return check(root, { testFiles: [] });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function expectProblem(mutate, pattern) {
  const problems = problemsAfter(mutate);
  assert.ok(problems.some((problem) => pattern.test(problem)), `expected ${pattern} in:\n${problems.join('\n')}`);
}

const edit = (root, path, change) => writeFileSync(join(root, path), change(readFileSync(join(root, path))));
const reserialize = (root, path, mutate, ensureAscii = false) =>
  edit(root, path, (bytes) => {
    const value = parseJson(bytes);
    mutate(value);
    return indentedBytes(value, { ensureAscii });
  });

test('the committed evidence passes the gate', () => {
  assert.deepEqual(check(repoRoot), []);
});

test('an unchanged fixture copy passes too', () => {
  assert.deepEqual(problemsAfter(() => undefined), []);
});

test('a changed byte in a preserved original fails', () => {
  expectProblem((root) => edit(root, `${MARKER_TOOLS}/domternal-n12-verify-evidence.py`, (bytes) => Buffer.concat([bytes, Buffer.from('\n')])), /not byte-identical/);
});

test('files beside the originals must be exactly the manifest plus README.md', () => {
  expectProblem((root) => writeFileSync(join(root, MARKER_TOOLS, 'notes.txt'), 'extra\n'), /notes\.txt is not listed/);
  expectProblem((root) => unlinkSync(join(root, MARKER_TOOLS, 'domternal-n12-free-gates.py')), /listed in MANIFEST\.json but missing/);
  expectProblem((root) => unlinkSync(join(root, MARKER_TOOLS, 'README.md')), /README\.md is missing/);
  expectProblem((root) => unlinkSync(join(root, MARKER_TOOLS, 'MANIFEST.json')), /MANIFEST\.json is missing/);
  expectProblem((root) => chmodSync(join(root, BREAK_TOOLS, 'domternal-n10c-free-verify.py'), 0o755), /is executable/);
});

test('the directory holds only listed regular files, all of which Git would commit', () => {
  expectProblem((root) => {
    mkdirSync(join(root, MARKER_TOOLS, 'nested'));
    writeFileSync(join(root, MARKER_TOOLS, 'nested/extra.py'), 'print(1)\n');
  }, /nested\/ must not exist/);
  const root = fixture();
  try {
    const files = [
      `${MARKER_TOOLS}/MANIFEST.json`,
      `${MARKER_TOOLS}/domternal-n12-verify-evidence.py`,
      `${MARKER_TOOLS}/domternal-n12-assemble-evidence.py`,
      `${MARKER_TOOLS}/domternal-n12-free-evidence.py`,
      `${MARKER_TOOLS}/domternal-n12-free-gates.py`,
    ];
    const entry = REPORTS.find((report) => report.historicalTools === MARKER_TOOLS);
    assert.deepEqual(checkHistoricalTools(root, entry, files), [`${MARKER_TOOLS}: README.md is ignored by Git, so it would not be committed`]);
    writeFileSync(join(root, MARKER_TOOLS, '.DS_Store'), 'finder\n');
    assert.deepEqual(checkHistoricalTools(root, entry, [...files, `${MARKER_TOOLS}/README.md`]), [], 'an ignored file Git would not commit is not a problem');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('manifest records must agree with the committed report', () => {
  const manifest = `${MARKER_TOOLS}/MANIFEST.json`;
  const change = (mutate) => (root) =>
    edit(root, manifest, (bytes) => {
      const value = JSON.parse(bytes.toString('utf8'));
      mutate(value);
      return `${JSON.stringify(value, null, 2)}\n`;
    });
  expectProblem(change((value) => { value.tools[1].recordedInReport = '/artifacts/30'; }), /does not match the record at/);
  expectProblem(change((value) => { value.reportSha256 = '0'.repeat(64); }), /reportSha256/);
  expectProblem(change((value) => { value.executedByCI = true; }), /executedByCI: false/);
  expectProblem(change((value) => { value.report = '../../2026-09-27-styled-breaks.json'; }), /does not resolve/);
  expectProblem(change((value) => { value.rawInputArchive.sha256 = null; }), /archive sha256/);
  expectProblem(change((value) => { value.lostInputs.push({ path: 'x' }); }), /lostInputs entry/);
  expectProblem(change((value) => { value.notes.push('an aside \u2014 with an em dash'); }), /em dash/);
  expectProblem(change((value) => { delete value.tools[0].recordedInReport; }), /needs recordedInReport/);
  expectProblem(change((value) => { delete value.markdown; }), /must name the Markdown report/);
});

test('a Python script the report records must be preserved', () => {
  expectProblem((root) => {
    const path = `${BREAK_TOOLS}/MANIFEST.json`;
    edit(root, path, (bytes) => {
      const value = JSON.parse(bytes.toString('utf8'));
      value.tools = value.tools.filter((tool) => tool.file !== 'domternal-n10c-free-cases.py');
      return `${JSON.stringify(value, null, 2)}\n`;
    });
    unlinkSync(join(root, BREAK_TOOLS, 'domternal-n10c-free-cases.py'));
  }, /records \/private\/tmp\/domternal-n10c-free-cases\.py but it is not preserved/);
});

test('a reformatted or hand-edited report fails its serialization golden', () => {
  expectProblem((root) => edit(root, BREAKS, (bytes) => Buffer.from(`${JSON.stringify(JSON.parse(bytes.toString('utf8')), null, 4)}\n`)), /not what its python-ascii writer produces/);
  expectProblem((root) => edit(root, MARKERS, (bytes) => Buffer.from(bytes.toString('utf8').replace('"version": 1,', '"version": 1 ,'))), /not what its python-utf8 writer produces/);
});

test('recorded digests are recomputed', () => {
  expectProblem((root) => reserialize(root, MARKERS, (value) => { value.cases[0].title = 'renamed'; }), /\/runs\/paste\/caseInventorySha256/);
  expectProblem((root) => reserialize(root, BREAKS, (value) => { value.frozenInputs.inventory[0].bytes += 1; }, true), /\/frozenInputs\/inventorySha256/);
  expectProblem((root) => reserialize(root, BREAKS, (value) => { value.cases.pop(); }, true), /\/verification\/caseInventorySha256/);
  expectProblem(
    // Whatever the digest is, its first hex digit changes.
    (root) => edit(root, 'e2e/paste-cleanup-results/2026-09-27-styled-breaks.md', (bytes) => Buffer.from(bytes.toString('utf8').replace(/(Durable JSON SHA256: `)([0-9a-f])/, (_, label, digit) => `${label}${digit === '0' ? '1' : '0'}`))),
    /"Durable JSON SHA256"/
  );
});

test('the declared redaction holds: a changed redacted file, a restored path or a removed declaration fails', () => {
  expectProblem((root) => edit(root, `${MARKER_TOOLS}/domternal-n12-free-gates.py`, (bytes) => Buffer.concat([bytes, Buffer.from('# edited\n')])), /is not the redacted file declared/);
  expectProblem((root) => reserialize(root, BREAKS, (value) => { value.runs = { root: `${['', 'Users', 'someone-else'].join('/')}/x` }; }, true), /still holds a path the redaction replaces/);
  expectProblem(
    (root) => edit(root, `${MARKER_TOOLS}/MANIFEST.json`, (bytes) => {
      const value = JSON.parse(bytes.toString('utf8'));
      delete value.redactions;
      return `${JSON.stringify(value, null, 2)}\n`;
    }),
    /must declare its redactions/
  );
  expectProblem(
    (root) => edit(root, `${BREAK_TOOLS}/MANIFEST.json`, (bytes) => {
      const value = JSON.parse(bytes.toString('utf8'));
      value.lost[0].storedVerifierOutput.sha256 = 'a'.repeat(64);
      return `${JSON.stringify(value, null, 2)}\n`;
    }),
    /storedVerifierOutput\/sha256 must hold "withheld"/
  );
  expectProblem((root) => writeFileSync(join(root, 'e2e/paste-performance/results/notes.md'), 'ran in $HOME/work\n'), /notes\.md: holds \$HOME or \$SCRATCHPAD, but no MANIFEST\.json declares/);
});

test('the ported unit rederives what its assembler derived', () => {
  expectProblem((root) => reserialize(root, MARKERS, (value) => { value.runs.legacy.projects[0].passed = 29; }), /runs\.legacy\.projects does not match/);
  expectProblem((root) => reserialize(root, MARKERS, (value) => { value.qualification.claims.pop(); }), /qualification does not match/);
  expectProblem((root) => edit(root, 'e2e/paste-cleanup-results/2026-09-27-list-markers.md', (bytes) => Buffer.concat([bytes, Buffer.from('\n')])), /not what the assembler writes/);
});

test('the gate fails when one of its own test files disappears', () => {
  const root = fixture();
  try {
    const problems = check(root, { testFiles: ['tests/evidence/json.test.mjs'] });
    assert.deepEqual(problems, ['tests/evidence/json.test.mjs: evidence test file is missing, so node --test would pass without it']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('reports and historical-tools directories must be registered', () => {
  expectProblem((root) => writeFileSync(join(root, 'e2e/paste-cleanup-results/2026-10-01-new.json'), '{}\n'), /2026-10-01-new\.json: evidence JSON is not registered/);
  expectProblem((root) => {
    mkdirSync(join(root, 'e2e/paste-cleanup-results/historical-tools/2026-10-01-new'));
    writeFileSync(join(root, 'e2e/paste-cleanup-results/historical-tools/2026-10-01-new/tool.py'), 'print(1)\n');
  }, /historical-tools\/2026-10-01-new: historical-tools entry belongs to no registered report/);
  expectProblem((root) => unlinkSync(join(root, BREAKS)), /registered evidence report is missing/);
});

test('committed evidence JSON has a 2 MiB ceiling', () => {
  const root = fixture();
  try {
    const big = { kind: 'synthetic', padding: 'x'.repeat(JSON_CEILING_BYTES) };
    writeFileSync(join(root, 'e2e/paste-performance/results/big.json'), serialize(big, 'node'));
    const reports = [...REPORTS, { path: 'e2e/paste-performance/results/big.json', serializer: 'node', digests: [] }];
    assert.ok(check(root, { reports, testFiles: [] }).some((problem) => /exceeds the 2097152-byte evidence JSON ceiling/.test(problem)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('nothing may run the historical tools or Python', () => {
  expectProblem((root) => writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { replay: `python3 ${MARKER_TOOLS}/domternal-n12-verify-evidence.py` } })), /script "replay" references historical-tools/);
  expectProblem((root) => writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { gates: 'python3 gates.py' } })), /script "gates" runs Python/);
  expectProblem((root) => writeFileSync(join(root, '.github/workflows/ci.yml'), 'steps:\n  - uses: actions/setup-python@v5\n'), /sets up Python/);
  expectProblem((root) => writeFileSync(join(root, '.github/workflows/ci.yml'), 'steps:\n  - run: python evidence.py\n'), /runs Python/);
  expectProblem((root) => {
    mkdirSync(join(root, 'e2e/tools'), { recursive: true });
    writeFileSync(join(root, 'e2e/tools/replay.mjs'), code('execFileSync', "('python3', ['x.py']);\n"));
  }, /e2e\/tools\/replay\.mjs: spawns Python/);
  expectProblem((root) => {
    mkdirSync(join(root, 'scripts'), { recursive: true });
    writeFileSync(join(root, 'scripts/run.mjs'), `readFileSync('${MARKER_TOOLS}/x.py');\n`);
  }, /scripts\/run\.mjs: references historical-tools/);
  expectProblem((root) => {
    mkdirSync(join(root, 'tests/evidence'), { recursive: true });
    writeFileSync(join(root, 'tests/evidence/extra.mjs'), code('spawnSync', "(process.execPath, ['x']);\n"));
  }, /tests\/evidence\/extra\.mjs: spawnSync\(process\.execPath\) spawns something other than git/);
});

test('the execution guard reads commands, not prose', () => {
  assert.deepEqual(guardPackageScripts('package.json', JSON.stringify({ scripts: { lint: 'eslint tests', note: 'node pythonic.mjs' } })), []);
  assert.deepEqual(guardWorkflow('.github/workflows/ci.yml', 'steps:\n  - run: pnpm test\n'), []);
  assert.deepEqual(guardCode('e2e/a.mjs', code('const match = /x/.exec(text); ', 'execFileSync', "('pnpm', ['build']);")), []);
  assert.deepEqual(guardCode('tests/evidence/a.mjs', code('execFileSync', "('git', ['show']); const m = /x/.exec(s);")), []);
  assert.ok(guardCode('tests/evidence/a.mjs', code('import * as cp from ', "'node:", "child_process';")).length > 0);
  assert.ok(guardCode('tests/evidence/a.mjs', code('import { execFileSync as run } from ', "'node:", "child_process';")).length > 0);
  assert.ok(guardCode('tests/evidence/a.mjs', code('await import', "('./x.py');")).length > 0);
  assert.ok(guardCode('e2e/a.ts', code('child.spawn', "('/usr/bin/python3', []);")).length > 0);
  assert.ok(guardCode('run.sh', 'python3 x.py\n').length > 0);
});

test('Markdown digests are read from labelled lines only', () => {
  const digest = 'a'.repeat(64);
  const found = markdownDigests(`intro \`${digest}\`\n- JSON SHA256: \`${digest}\`\n- Other: \`${'b'.repeat(64)}\`\n`);
  assert.equal(found.get('JSON SHA256'), digest);
  assert.equal(found.size, 2);
  assert.equal(markdownDigests(`- X: \`${digest}\`\n- X: \`${digest}\`\n`).get('X'), null, 'a label quoted twice is ambiguous');
});
