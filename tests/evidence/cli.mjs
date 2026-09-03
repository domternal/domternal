#!/usr/bin/env node
/**
 * The maintained evidence tool.
 *
 *   node tests/evidence/cli.mjs check
 *     The body of the `test:evidence` gate (see check.mjs). Needs nothing but
 *     the repository.
 *   node tests/evidence/cli.mjs freeze --unit <stem> --out <file> [--root <dir>]
 *     Capture the unit's source and build inventory. Never replaces a file.
 *   node tests/evidence/cli.mjs verify --unit <stem> --inputs <inputs.json> [--live] [--out <file>] [--verified-at <iso>]
 *     Verify completed runs and the inventory. Membership is rebuilt from Git
 *     at the recorded head, or from the live tree with --live (capture time
 *     only). --repository names the checkout; it defaults to this one.
 *   node tests/evidence/cli.mjs assemble --unit <stem> --inputs <inputs.json> --out-dir <dir> [--verified-at <iso>]
 *     Write the report JSON and Markdown. Never replaces a file.
 *   node tests/evidence/cli.mjs replay (--unit <stem> | --all) [--archive <dir>] [--out-dir <dir>] [--python-baseline <dir>]
 *     Reproduce committed evidence from the durable archive (local only; the
 *     archive may also be named by DOMTERNAL_EVIDENCE_ARCHIVE).
 *
 * Every input is read through an inputs.json manifest with recorded sizes and
 * digests; nothing under /private/tmp is read implicitly.
 */
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { InputSet } from './artifacts.mjs';
import { runCheck } from './check.mjs';
import { freezeSnapshot, listCandidates, verifyMembership } from './inventory.mjs';
import { EvidenceJsonError, pythonUtcIsoformat } from './json.mjs';
import { EvidenceCheckError } from './playwright.mjs';
import { gitMembership, gitShow, replayUnit } from './replay.mjs';
import { UNITS, unitFor } from './units/index.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export class UsageError extends Error {}

const COMMANDS = {
  check: {},
  freeze: { unit: { type: 'string' }, out: { type: 'string' }, root: { type: 'string' } },
  verify: {
    unit: { type: 'string' },
    inputs: { type: 'string' },
    live: { type: 'boolean' },
    out: { type: 'string' },
    'verified-at': { type: 'string' },
    repository: { type: 'string' },
  },
  assemble: {
    unit: { type: 'string' },
    inputs: { type: 'string' },
    'out-dir': { type: 'string' },
    'verified-at': { type: 'string' },
    repository: { type: 'string' },
  },
  replay: {
    unit: { type: 'string' },
    all: { type: 'boolean' },
    archive: { type: 'string' },
    'out-dir': { type: 'string' },
    'python-baseline': { type: 'string' },
    repository: { type: 'string' },
  },
};

function unitOf(stem) {
  try {
    return unitFor(stem);
  } catch (error) {
    throw new UsageError(error.message);
  }
}

/** Evidence is written once: an existing target is refused before any work. */
function refuseExisting(paths) {
  for (const path of paths) {
    if (path && existsSync(path)) throw new EvidenceCheckError('Refusing to replace an existing file', path);
  }
}

function required(values, name) {
  if (typeof values[name] !== 'string' || values[name] === '') throw new UsageError(`--${name} is required`);
  return values[name];
}

function membershipFor(unit, values) {
  if (values.live) {
    const root = values.repository ?? repoRoot;
    return (snapshot) => verifyMembership(snapshot, unit.SELECTION_RULES, listCandidates(root, unit.SELECTION_RULES));
  }
  return gitMembership(unit, values.repository ?? repoRoot);
}

function verifiedAt(values) {
  const value = values['verified-at'];
  if (value === undefined) return pythonUtcIsoformat(new Date());
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{6})?\+00:00$/.test(value)) {
    throw new UsageError('--verified-at must be a UTC isoformat timestamp such as 2026-09-27T07:00:32.762050+00:00');
  }
  return value;
}

/** Run one command; returns the process exit code. */
export function run(argv, { log = console.log, error = console.error } = {}) {
  const [command, ...rest] = argv;
  if (!command || !Object.hasOwn(COMMANDS, command)) {
    throw new UsageError(`Usage: cli.mjs <${Object.keys(COMMANDS).join('|')}> [options]`);
  }
  let values;
  try {
    ({ values } = parseArgs({ args: rest, options: COMMANDS[command], strict: true, allowPositionals: false }));
  } catch (error) {
    throw new UsageError(error.message);
  }
  if (command === 'check') return runCheck(repoRoot, { log, error });

  if (command === 'freeze') {
    const unit = unitOf(required(values, 'unit'));
    const result = freezeSnapshot({
      root: values.root ?? repoRoot,
      unit: { selectionRules: unit.SELECTION_RULES, snapshotKind: unit.SNAPSHOT_KIND, selectionText: unit.SELECTION_TEXT },
      out: resolve(required(values, 'out')),
    });
    log(JSON.stringify(result, null, 2));
    return 0;
  }

  if (command === 'verify') {
    const unit = unitOf(required(values, 'unit'));
    const inputs = InputSet.load(required(values, 'inputs'));
    if (inputs.unit !== unit.STEM) throw new UsageError(`inputs.json is for unit ${String(inputs.unit)}, not ${unit.STEM}`);
    const out = values.out ? resolve(values.out) : null;
    refuseExisting([out]);
    const result = unit.verifyBrowserEvidence(inputs, { verifiedAt: verifiedAt(values), membership: membershipFor(unit, values) });
    if (out) writeFileSync(out, result.bytes, { flag: 'wx' });
    log(JSON.stringify({ verified: true, unit: unit.STEM, lostInputs: result.lost, membership: result.membership }, null, 2));
    return 0;
  }

  if (command === 'assemble') {
    const unit = unitOf(required(values, 'unit'));
    const inputs = InputSet.load(required(values, 'inputs'));
    if (inputs.unit !== unit.STEM) throw new UsageError(`inputs.json is for unit ${String(inputs.unit)}, not ${unit.STEM}`);
    const outDir = resolve(required(values, 'out-dir'));
    const jsonPath = join(outDir, basename(unit.REPORT));
    const markdownPath = join(outDir, basename(unit.MARKDOWN));
    refuseExisting([jsonPath, markdownPath]);
    const repository = values.repository ?? repoRoot;
    const result = unit.assembleQualification(inputs, {
      verifiedAt: verifiedAt(values),
      membership: membershipFor(unit, values),
      gitShow: (revision, path) => gitShow(repository, revision, path),
    });
    writeFileSync(jsonPath, result.json, { flag: 'wx' });
    writeFileSync(markdownPath, result.markdown, { flag: 'wx' });
    log(JSON.stringify({ assembled: true, json: jsonPath, markdown: markdownPath, lostInputs: result.lost }, null, 2));
    return 0;
  }

  const archiveDir = values.archive ?? process.env.DOMTERNAL_EVIDENCE_ARCHIVE;
  if (!archiveDir) throw new UsageError('replay needs --archive <dir> or DOMTERNAL_EVIDENCE_ARCHIVE');
  if (Boolean(values.all) === Boolean(values.unit)) throw new UsageError('replay needs exactly one of --unit <stem> or --all');
  const units = values.all ? [...UNITS.values()] : [unitOf(values.unit)];
  const base = values['out-dir'] ? resolve(values['out-dir']) : mkdtempSync(join(tmpdir(), 'domternal-evidence-replay-'));
  let failed = false;
  for (const unit of units) {
    try {
      const result = replayUnit(unit, {
        archiveDir: resolve(archiveDir),
        repository: values.repository ?? repoRoot,
        outDir: join(base, unit.STEM),
        pythonBaselineDir: values['python-baseline'] ?? null,
      });
      log(`[evidence] ${unit.STEM}: ${result.classification}`);
      for (const limitation of result.limitations) log(`  limitation: ${limitation}`);
      for (const comparison of result.comparisons) log(`  ${comparison.output} vs ${comparison.reference}: ${comparison.result}`);
      log(`  Python baseline: ${result.pythonBaseline.classification}`);
    } catch (error) {
      if (!(error instanceof EvidenceCheckError)) throw error;
      failed = true;
      log(`[evidence] ${unit.STEM}: ${error.message}`);
    }
  }
  log(`[evidence] replay output: ${base}`);
  return failed ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    process.exitCode = run(process.argv.slice(2));
  } catch (error) {
    if (error instanceof UsageError || error instanceof EvidenceCheckError || error instanceof EvidenceJsonError) {
      console.error(`[evidence] ${error.message}`);
      process.exitCode = error instanceof UsageError ? 2 : 1;
    } else {
      throw error;
    }
  }
}
