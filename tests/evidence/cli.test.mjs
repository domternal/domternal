/**
 * The command line, run in process: argument handling, refusal to replace
 * evidence, and the input manifest failures every command shares.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UsageError, run } from './cli.mjs';
import { INPUTS_KIND } from './artifacts.mjs';
import { sha256 } from './json.mjs';
import { EvidenceCheckError } from './playwright.mjs';
import { SNAPSHOT, STEM } from './units/2026-09-27-list-markers.mjs';

const ignore = () => undefined;
const quiet = { log: ignore, error: ignore };

function scratch() {
  return mkdtempSync(join(tmpdir(), 'evidence-cli-'));
}

function inputsFile(dir, files, unit = STEM) {
  const path = join(dir, 'inputs.json');
  writeFileSync(path, `${JSON.stringify({ kind: INPUTS_KIND, version: 1, unit, files }, null, 2)}\n`);
  return path;
}

const usage = (error) => error instanceof UsageError;
const check = (name) => (error) => error instanceof EvidenceCheckError && error.check === name;

test('commands, units and options are validated', () => {
  assert.throws(() => run([], quiet), usage);
  assert.throws(() => run(['publish'], quiet), usage);
  assert.throws(() => run(['verify', '--unit', 'no-such-unit', '--inputs', 'x'], quiet), (error) => usage(error) && error.message.includes(STEM));
  assert.throws(() => run(['check', '--force'], quiet), usage);
  assert.throws(() => run(['verify', '--unit', STEM], quiet), (error) => usage(error) && /--inputs/.test(error.message));
});

test('replay needs an archive and exactly one of --unit or --all', () => {
  const saved = process.env.DOMTERNAL_EVIDENCE_ARCHIVE;
  delete process.env.DOMTERNAL_EVIDENCE_ARCHIVE;
  try {
    assert.throws(() => run(['replay', '--all'], quiet), (error) => usage(error) && /--archive/.test(error.message));
    assert.throws(() => run(['replay', '--all', '--unit', STEM, '--archive', '/nowhere'], quiet), usage);
    assert.throws(() => run(['replay', '--archive', '/nowhere'], quiet), usage);
  } finally {
    if (saved !== undefined) process.env.DOMTERNAL_EVIDENCE_ARCHIVE = saved;
  }
});

test('an input missing from inputs.json fails instead of falling back to the file system', () => {
  const dir = scratch();
  try {
    const inputs = inputsFile(dir, []);
    assert.throws(() => run(['verify', '--unit', STEM, '--inputs', inputs], quiet), check('Input missing from inputs.json'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an input whose bytes differ from its recorded digest fails', () => {
  const dir = scratch();
  try {
    writeFileSync(join(dir, 'snapshot.json'), '{"inventory": []}\n');
    const recorded = Buffer.from('{"inventory": [1]}\n');
    const inputs = inputsFile(dir, [
      { role: 'raw-input', originalPath: SNAPSHOT, bytes: recorded.length, sha256: sha256(recorded), source: { kind: 'file', path: join(dir, 'snapshot.json') } },
    ]);
    assert.throws(() => run(['verify', '--unit', STEM, '--inputs', inputs], quiet), check('Input digest mismatch'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('inputs prepared for another unit are refused', () => {
  const dir = scratch();
  try {
    const inputs = inputsFile(dir, [], 'another-unit');
    assert.throws(() => run(['assemble', '--unit', STEM, '--inputs', inputs, '--out-dir', dir], quiet), usage);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('assemble, verify and freeze never replace an existing file', () => {
  const dir = scratch();
  try {
    const inputs = inputsFile(dir, []);
    writeFileSync(join(dir, '2026-09-27-list-markers.md'), 'committed\n');
    assert.throws(() => run(['assemble', '--unit', STEM, '--inputs', inputs, '--out-dir', dir], quiet), check('Refusing to replace an existing file'));
    assert.equal(readFileSync(join(dir, '2026-09-27-list-markers.md'), 'utf8'), 'committed\n');
    writeFileSync(join(dir, 'verified.json'), 'kept\n');
    assert.throws(() => run(['verify', '--unit', STEM, '--inputs', inputs, '--out', join(dir, 'verified.json')], quiet), check('Refusing to replace an existing file'));
    writeFileSync(join(dir, 'snapshot.json'), 'kept\n');
    assert.throws(() => run(['freeze', '--unit', STEM, '--root', dir, '--out', join(dir, 'snapshot.json')], quiet), check('Refusing to replace an existing snapshot'));
    assert.equal(readFileSync(join(dir, 'snapshot.json'), 'utf8'), 'kept\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an explicit verifiedAt must be a Python UTC isoformat timestamp', () => {
  const dir = scratch();
  try {
    const inputs = inputsFile(dir, []);
    assert.throws(() => run(['verify', '--unit', STEM, '--inputs', inputs, '--verified-at', '2026-09-27T07:00:32Z'], quiet), usage);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('check passes on this repository', () => {
  const lines = [];
  assert.equal(run(['check'], { log: (line) => lines.push(line), error: (line) => lines.push(line) }), 0, lines.join('\n'));
  assert.match(lines[0], /^\[evidence\] OK/);
});
