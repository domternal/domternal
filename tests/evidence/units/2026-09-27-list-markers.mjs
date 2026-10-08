/**
 * Unit 2026-09-27-list-markers: the Free list-marker browser qualification.
 *
 * A maintained Node port of the preserved Python originals behind
 * `e2e/paste-cleanup-results/2026-09-27-list-markers.json`, kept byte for byte
 * in `historical-tools/2026-09-27-list-markers/`:
 *
 * - `domternal-n12-free-evidence.py` froze the source and build inventory;
 * - `domternal-n12-verify-evidence.py` verified the completed runs against
 *   read-only discovery and rechecked the inventory;
 * - `domternal-n12-assemble-evidence.py` wrote the JSON and the Markdown.
 *
 * Given the same inputs, `verify` returns the verifier's output and `assemble`
 * the assembler's two files, byte for byte. Every authored table below is
 * copied verbatim from those originals and deliberately not imported from the
 * test harness, so a harness change cannot quietly change what the evidence
 * expected; `units.test.mjs` checks that each authored string still occurs in
 * the preserved originals.
 *
 * The run happened on one machine, with raw files under `/private/tmp`. The
 * evidence records those paths, so this unit keeps them as `ROOT` and
 * `SCRATCH` and reads every byte through an `InputSet`, which maps each
 * recorded path to where its bytes live now. Since the declared redaction
 * 2026-10-03-home-paths (see the MANIFEST.json beside the originals), the
 * evidence and these constants name that machine's home folder `$HOME` and
 * its session scratchpad `$SCRATCHPAD`; replay reads the inputs the redaction
 * changed through it (`REDACTION`).
 */
import { artifactRecord } from '../artifacts.mjs';
import { verifySnapshotBytes, verifyStoredSnapshot } from '../inventory.mjs';
import { codePointCompare, indentedBytes, sha256 } from '../json.mjs';
import {
  EvidenceCheckError,
  caseKey,
  compareWithDiscovery,
  discoveryRows,
  ensure,
  flattenReport,
  pythonEqual,
  pythonSearch,
  readLog,
  sameCounts,
  stripAnsi,
  verifyCompletedRun,
} from '../playwright.mjs';

export const STEM = '2026-09-27-list-markers';
export const REPORT = 'e2e/paste-cleanup-results/2026-09-27-list-markers.json';
export const MARKDOWN = 'e2e/paste-cleanup-results/2026-09-27-list-markers.md';
export const HISTORICAL_TOOLS = 'e2e/paste-cleanup-results/historical-tools/2026-09-27-list-markers';

/** The repository and scratch directory as the run recorded them. */
export const ROOT = '$HOME/Documents/Domternal/domternal';
export const SCRATCH = '/private/tmp';
export const PRIOR = 'e2e/paste-cleanup-results/2026-09-27-styled-breaks.json';
export const SNAPSHOT = `${SCRATCH}/domternal-n12-free-frozen-inputs.json`;
export const SNAPSHOT_KIND = 'domternal-free-list-markers-input-snapshot';
const RELEASE_PACK = `${SCRATCH}/domternal-n12-free-release-pack`;

/**
 * Where the one-time Python replay of the block 3 mapping wrote its outputs.
 * They are archived under these paths and serve as the recorded baseline; the
 * originals are not executed again.
 */
const MAPPING_SCRATCH = '$SCRATCHPAD/b3map';
export const PYTHON_BASELINE = {
  scratchRoot: MAPPING_SCRATCH,
  mirrorRoot: `${MAPPING_SCRATCH}/f/n12/domternal`,
  json: `${MAPPING_SCRATCH}/f/n12/domternal/${REPORT}`,
  markdown: `${MAPPING_SCRATCH}/f/n12/domternal/${MARKDOWN}`,
  verifier: `${MAPPING_SCRATCH}/out/n12-verified-browser-data.json`,
};

const tmp = (name) => `${SCRATCH}/${name}`;
const repo = (path) => `${ROOT}/${path}`;

/**
 * The declared redaction of this unit's committed evidence, and the inputs it
 * changed: the two preserved originals the report records and the prior report.
 * Replay reads exactly these through R1, as the committed evidence records them.
 */
export const REDACTION = {
  id: '2026-10-03-home-paths',
  inputs: [tmp('domternal-n12-verify-evidence.py'), tmp('domternal-n12-assemble-evidence.py'), repo(PRIOR)],
};

// domternal-n12-verify-evidence.py
export const BROWSERS = ['chromium', 'firefox', 'webkit'];
export const FRAMEWORKS = ['vanilla', 'react', 'vue', 'angular'];
export const NEW_TITLES = [
  'preserve keeps reconstructed Office decimals and bullet classes at depth',
  'adapt keeps reconstructed Office decimals and bullet classes at depth',
  'a legacy marker schema retains visible Office labels instead of reconstructing lossy lists',
  'preserve keeps all marker enums, HTML type and CSS precedence',
  'adapt keeps all marker enums, HTML type and CSS precedence',
  'null cycles with actual theme support while explicit decimal remains fixed',
  'partial internal copy preserves marker context through an ordered range replacement',
  'SmartPaste preserves square bullets while replacing a disc list range',
  'Tab creates a fresh nested wrapper with the original explicit marker',
  'Tab retains a conflicting existing nested list and creates its own marker wrapper',
  'Shift-Tab preserves a conflicting explicit marker and the outer remainder ordinal',
  'Shift-Tab preserves explicitly enabled bold for subsequent typing',
  'Shift-Tab preserves explicitly disabled bold for subsequent typing',
  'Backspace removes an empty separator without merging conflicting markers',
  'Delete removes a separator then refuses a direct conflicting-wrapper merge without history',
  'a schema without marker attributes warns but still performs the paste',
  'task checked state and absent marker policy remain independent',
];
export const LEGACY = {
  'nested-lists.spec.ts': 11,
  'list-audit-fixes.spec.ts': 12,
  'notion-list-cursor-context.spec.ts': 6,
  'list-join-on-insert.spec.ts': 1,
};
export const SKIP_TITLE = 'Chromium native clipboard preserves an editor copy through cleanup';
export const SKIP_REASON = 'Native clipboard permissions are exercised in Chromium.';
export const SUITES = ['cleanup', 'feedback', 'assets', 'resolver', 'destination', 'breaks', 'list-markers'].map(
  (name) => `e2e/paste-${name}.browser.ts`
);

/**
 * Inventory membership, from the verifier's independent reconstruction in
 * `verify_snapshot()`. It selects the same files as `selected()` in
 * `domternal-n12-free-evidence.py`.
 */
export const SELECTION_RULES = [
  {
    kind: 'files',
    paths: [
      'e2e/paste-cleanup.config.ts', 'e2e/paste-list-markers.browser.ts',
      'packages/extension-paste-cleanup/README.md', 'e2e/fixtures.ts', 'e2e/fixtures/vite.config.mjs',
      'e2e/list-editing.config.ts', 'e2e/playwright.config.ts', 'e2e/targets.ts',
      'e2e/paste-cleanup-fixture/entry.mjs', 'e2e/paste-cleanup-fixture/index.html',
      'e2e/paste-cleanup-fixture/vite.config.mjs', 'e2e/tsconfig.json',
      'README.md', 'tests/package-artifacts/policy.json', 'packages/extension-paste-cleanup/tsconfig.json',
      'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml',
      ...SUITES,
      ...FRAMEWORKS.flatMap((framework) =>
        ['fixtures.ts', ...Object.keys(LEGACY)].map((name) => `apps/demo-${framework}/e2e/${name}`)
      ),
    ],
  },
  { kind: 'glob', pattern: 'packages/*/package.json' },
  { kind: 'glob', pattern: 'packages/*/dist/**', buildOutput: true },
  ...['core', 'extension-block-controls', 'extension-paste-cleanup'].map((name) => ({
    kind: 'glob',
    pattern: `packages/${name}/src/**`,
  })),
  ...FRAMEWORKS.map((framework) => ({ kind: 'glob', pattern: `apps/demo-${framework}/src/**` })),
  ...FRAMEWORKS.map((framework) => ({ kind: 'direct', dir: `apps/demo-${framework}`, suffixes: ['.json', '.ts', '.html'] })),
];

// domternal-n12-assemble-evidence.py
const RUN_PREFIX = { paste: 'domternal-n12-free-matrix', legacy: 'domternal-n12-list-editing' };
const RUN_CONFIG = { paste: 'e2e/paste-cleanup.config.ts', legacy: 'e2e/list-editing.config.ts' };
const COMMANDED_NODE = {
  path: '$HOME/.nvm/versions/node/v22.23.2/bin/node',
  version: 'v22.23.2',
  provenance: 'Parent-recorded executable selected by PATH; not reported independently by Playwright.',
};
const FOCUS_TRACES = '/private/tmp/domternal-n12-markers-final-traces';
const PREFLIGHT_TRACES = '/private/tmp/domternal-n12-markers-preflight-traces';
export const GATE_NAMES = [
  'bundle-size', 'E2E TypeScript', 'changed E2E ESLint',
  'Core publint strict', 'Core ATTW strict', 'BlockControls publint strict',
  'BlockControls ATTW strict', 'PasteCleanup publint strict', 'PasteCleanup ATTW strict',
];
export const GATE_EXECUTION = 'Observed by the independent verification agent; no build or download.';
const REPORT_ARTIFACTS = [
  ['domternal-n12-free-matrix', 'Final full paste'],
  ['domternal-n12-list-editing', 'Final legacy list'],
  ['domternal-n12-markers-final', 'Final focused marker'],
  ['domternal-n12-markers-preflight', 'Initial focused marker failures'],
];
const PARENT_ARTIFACTS = [
  ['domternal-n12-free-gates.json', 'Parent initial release gate outcomes, including documented failures'],
  ['domternal-n12-free-gates-test-bundle-size.log', 'Initial bundle gate README claim mismatch'],
  ['domternal-n12-free-gates-test-package-artifacts.log', 'Initial packed-size budget failure'],
  ['domternal-n12-free-package-artifacts-final.log', 'Reviewed package-artifact policy rerun'],
  ['domternal-n12-free-build-final.log', 'Parent final full workspace build'],
  ['domternal-n12-free-typecheck-final.log', 'Parent final actual pnpm workspace typecheck'],
  ['domternal-n12-free-workspace-coverage.log', 'Parent full workspace coverage before the final UniqueID correction'],
  ['domternal-n12-free-coverage-reports.log', 'Parent check that all required coverage reports exist'],
];
const INPUT_ARTIFACTS = [
  ['domternal-n12-free-frozen-inputs.json', 'Pre-run source and built-artifact snapshot'],
  ['domternal-n12-paste-list-inventory.json', 'Read-only paste discovery'],
  ['domternal-n12-legacy-list-inventory.json', 'Read-only legacy discovery'],
  ['domternal-n12-verify-evidence.py', 'Independent report and snapshot verifier'],
  ['domternal-n12-assemble-evidence.py', 'Independent evidence assembler'],
];
const PRIOR_ROLE = 'Unchanged historical styled-breaks evidence used for prior case identities';
const PACK_ROLE = 'Locally packed frozen build checked by publint and ATTW';
const PACKAGES = ['core', 'block', 'paste'];
const PREFLIGHT_FAILURES = {
  'vanilla-fixture-mount-class': 51,
  'internal-copy-selection-did-not-exercise-context': 9,
  'unique-id-explicit-typing-marks': 18,
};
const PREFLIGHT_COPY_TITLE = 'partial internal copy preserves marker context through an ordered range replacement';

function gatePaths() {
  const paths = [
    ['Final bundle-size gate', 'domternal-n12-free-bundle-size-release.log'],
    ['Final E2E TypeScript', 'domternal-n12-free-e2e-types-release.log'],
    ['Final changed E2E ESLint', 'domternal-n12-free-e2e-lint-release.log'],
  ];
  for (const name of PACKAGES) {
    for (const tool of ['publint', 'attw', 'release-pack']) paths.push([`Final ${name} ${tool}`, `domternal-n12-${name}-${tool}.log`]);
  }
  return paths;
}

/** Every raw input the verifier and assembler read, by recorded path. */
export function requiredInputs() {
  const files = [
    ...Object.values(RUN_PREFIX).flatMap((prefix) => [`${prefix}.json`, `${prefix}.log`, `${prefix}.done`]),
    'domternal-n12-markers-final.json', 'domternal-n12-markers-final.log', 'domternal-n12-markers-final.done',
    'domternal-n12-markers-preflight.json', 'domternal-n12-markers-preflight.log',
    ...gatePaths().map(([, file]) => file),
    ...PARENT_ARTIFACTS.map(([file]) => file),
    ...INPUT_ARTIFACTS.map(([file]) => file),
  ];
  return {
    files: [...new Set(files)].map((file) => ({ role: 'raw-input', originalPath: tmp(file) })),
    directories: [{ role: 'raw-input', directory: RELEASE_PACK, suffix: '.tgz' }],
    repositoryFiles: [{ role: 'prior-evidence', path: PRIOR }],
    storedOutputs: [{ role: 'stored-verifier-output', originalPath: tmp('domternal-n12-verified-browser-data.json') }],
  };
}

/**
 * `verify_snapshot()`: the frozen inventory, every row rehashed and its
 * membership rebuilt. `membership(snapshot)` rebuilds membership from a tree
 * the caller chooses (the live repository, or Git plus the stored build list
 * in replay) and returns what it could and could not check.
 */
export function verifySnapshot(inputs, { membership }) {
  const snapshot = inputs.readJson(SNAPSHOT);
  verifyStoredSnapshot(snapshot);
  const { lost } = verifySnapshotBytes(snapshot, (path) => inputs.readOrLost(repo(path)));
  return { snapshot, lost, membership: membership(snapshot) };
}

const caseId = (row) => JSON.stringify(caseKey(row));

/** `expected(kind)`: the discovery report and its planned rows, checked against the authored inventory. */
export function expectedCases(inputs, kind) {
  const listing = inputs.readJson(tmp(`domternal-n12-${kind}-list-inventory.json`));
  const rows = discoveryRows(listing);
  const keys = new Set(rows.map(caseId));
  if (kind === 'paste') {
    const prior = inputs.readJson(repo(PRIOR));
    const old = new Set(prior.cases.map(caseId));
    const added = new Set(
      BROWSERS.flatMap((browser) =>
        FRAMEWORKS.flatMap((framework) =>
          NEW_TITLES.map((title) => JSON.stringify([browser, 'paste-list-markers.browser.ts', `${framework}: explicit list markers`, title]))
        )
      )
    );
    ensure(old.size === 1128 && added.size === 204, 'Prior or authored new case count');
    const union = new Set([...old, ...added]);
    const overlap = [...old].some((key) => added.has(key));
    ensure(
      keys.size === union.size && [...union].every((key) => keys.has(key)) && !overlap,
      'Old or authored new case inventory differs'
    );
    ensure(sameCounts(rows.map((row) => row.project), Object.fromEntries(BROWSERS.map((browser) => [browser, 444]))), 'Per-project case count');
  } else {
    ensure(keys.size === 360, 'Legacy case count');
    for (const browser of BROWSERS) {
      for (const framework of FRAMEWORKS) {
        const subset = rows.filter((row) => row.project === `${framework}-${browser}`);
        ensure(subset.length === 30, 'Legacy cases per project', `${framework}-${browser}`);
        ensure(sameCounts(subset.map((row) => row.file.split('/').pop()), LEGACY), 'Legacy suites per project', `${framework}-${browser}`);
        ensure(subset.every((row) => row.file.startsWith(`../apps/demo-${framework}/e2e/`)), 'Legacy suite location', `${framework}-${browser}`);
      }
    }
  }
  return { listing, planned: rows };
}

/** `verify_run(kind, report, log)`. */
export function verifyRun(inputs, kind) {
  const { listing, planned } = expectedCases(inputs, kind);
  const prefix = RUN_PREFIX[kind];
  const paste = kind === 'paste';
  return verifyCompletedRun(inputs.readJson(tmp(`${prefix}.json`)), {
    listing,
    planned,
    total: paste ? 1332 : 360,
    skips: paste ? 2 : 0,
    isSkipped: (row) => paste && (row.project === 'firefox' || row.project === 'webkit') && row.title === SKIP_TITLE,
    skipReason: SKIP_REASON,
    outputDir: tmp(paste ? 'domternal-n12-free-matrix-traces' : 'domternal-n12-list-editing-traces'),
    log: readLog(inputs.read(tmp(`${prefix}.log`))),
  });
}

/**
 * The verifier's `verify` mode: the document it wrote to
 * `/private/tmp/domternal-n12-verified-browser-data.json`.
 */
export function verifyBrowserEvidence(inputs, { verifiedAt, membership }) {
  const checked = verifySnapshot(inputs, { membership });
  const runs = { paste: verifyRun(inputs, 'paste'), legacy: verifyRun(inputs, 'legacy') };
  const artifacts = [
    [tmp('domternal-n12-free-matrix.json'), 'Final paste browser report'],
    [tmp('domternal-n12-free-matrix.log'), 'Final paste raw log'],
    [tmp('domternal-n12-list-editing.json'), 'Final legacy list browser report'],
    [tmp('domternal-n12-list-editing.log'), 'Final legacy list raw log'],
    [SNAPSHOT, 'Pre-run source and build input snapshot'],
    [tmp('domternal-n12-paste-list-inventory.json'), 'Pre-run paste discovery, no browser execution'],
    [tmp('domternal-n12-legacy-list-inventory.json'), 'Pre-run legacy discovery, no browser execution'],
    [tmp('domternal-n12-verify-evidence.py'), 'Read-only evidence verifier'],
  ].map(([path, role]) => artifactRecord(role, path, inputs.read(path)));
  const document = {
    kind: 'domternal-free-list-markers-browser-verification',
    version: 1,
    verifiedAt,
    runs,
    frozenInputs: checked.snapshot,
    artifacts,
  };
  return { document, bytes: indentedBytes(document, { ensureAscii: false }), lost: checked.lost, membership: checked.membership };
}

/** `verify_preflight()`: the retained initial focused failures, classified. */
export function verifyPreflight(inputs) {
  const report = inputs.readJson(tmp('domternal-n12-markers-preflight.json'));
  const rows = flattenReport(report);
  ensure(rows.length === 204 && pythonEqual(report.errors, []), 'Preflight case count or run error');
  ensure(pythonEqual(report.stats.expected, 126) && pythonEqual(report.stats.unexpected, 78), 'Preflight pass and failure counts');
  ensure(pythonEqual(report.stats.skipped, 0) && pythonEqual(report.stats.flaky, 0), 'Preflight skips or flakes');
  const failures = [];
  for (const row of rows) {
    ensure(row.test.results.length === 1, 'Preflight attempt count', caseKey(row).join(' | '));
    const result = row.test.results[0];
    ensure(pythonEqual(result.retry, 0), 'Preflight retry', caseKey(row).join(' | '));
    if (result.status === 'failed') {
      const message = stripAnsi(result.error.message);
      if (message.includes('element(s) not found')) {
        ensure(row.describe.startsWith('vanilla:'), 'Mount failure outside vanilla', caseKey(row).join(' | '));
        failures.push('vanilla-fixture-mount-class');
      } else if (message.includes('Expected substring: "listStyleType"')) {
        ensure(row.title === PREFLIGHT_COPY_TITLE, 'Selection failure in another case', caseKey(row).join(' | '));
        ensure(message.includes('list-style-type: upper-roman'), 'Selection failure without the marker style', caseKey(row).join(' | '));
        failures.push('internal-copy-selection-did-not-exercise-context');
      } else if (message.includes('Received: null') && row.title.includes('subsequent typing')) {
        failures.push('unique-id-explicit-typing-marks');
      } else {
        throw new EvidenceCheckError('Unclassified preflight failure', caseKey(row).join(' | '));
      }
    } else {
      ensure(result.status === 'passed', 'Preflight result neither passed nor failed', caseKey(row).join(' | '));
    }
  }
  ensure(sameCounts(failures, PREFLIGHT_FAILURES), 'Preflight failure classification');
  const raw = inputs.readText(tmp('domternal-n12-markers-preflight.log'));
  ensure(
    pythonSearch('^\\s*78 failed\\b', raw, { multiline: true }) && pythonSearch('^\\s*126 passed\\b', raw, { multiline: true }),
    'Preflight raw log summary'
  );
  return {
    total: 204,
    passed: 126,
    failed: 78,
    skipped: 0,
    flaky: 0,
    failureGroups: PREFLIGHT_FAILURE_GROUPS,
    traceDirectory: PREFLIGHT_TRACES,
    traceFilesCopiedIntoRepository: false,
  };
}

function verifyFocusedRun(inputs, pasteExpected) {
  const focus = inputs.readJson(tmp('domternal-n12-markers-final.json'));
  const focusedRows = flattenReport(focus);
  compareWithDiscovery(focusedRows, pasteExpected.planned.filter((row) => row.file === 'paste-list-markers.browser.ts'));
  const listed = pasteExpected.listing.config;
  const focusExpected = {
    ...listed,
    projects: listed.projects.map((project) => ({
      ...project,
      outputDir: FOCUS_TRACES,
      metadata: { ...(project.metadata ?? {}), actualWorkers: 1 },
    })),
  };
  for (const field of ['workers', 'projects', 'retries', 'repeatEach', 'forbidOnly', 'shard', 'grep', 'grepInvert']) {
    ensure(pythonEqual(focus.config[field], focusExpected[field]), `Focused run configuration: ${field}`);
  }
  ensure(pythonEqual(focus.errors, []) && pythonEqual(focus.stats.expected, 204), 'Focused run errors or count');
  ensure(['unexpected', 'skipped', 'flaky'].every((key) => pythonEqual(focus.stats[key], 0)), 'Focused run failures, skips or flakes');
  for (const row of focusedRows) {
    const test = row.test;
    const where = caseKey(row).join(' | ');
    ensure(row.ok && test.expectedStatus === 'passed' && test.status === 'expected', 'Focused case outcome', where);
    ensure(test.results.length === 1 && test.results[0].status === 'passed' && pythonEqual(test.results[0].retry, 0), 'Focused case attempt', where);
    const errors = test.results[0].errors;
    ensure(!test.results[0].error && !(Array.isArray(errors) ? errors.length : errors), 'Focused case error', where);
  }
  ensure(pythonSearch('^\\s*204 passed\\b', inputs.readText(tmp('domternal-n12-markers-final.log')), { multiline: true }), 'Focused run raw log');
  return focus;
}

function projectsOf(cases) {
  const projects = [...new Set(cases.map((row) => row.project))].sort(codePointCompare);
  return projects.map((project) => ({
    project,
    passed: cases.filter((row) => row.project === project && row.status === 'passed').length,
    skipped: cases.filter((row) => row.project === project && row.status === 'skipped').length,
  }));
}

function suitesOf(cases) {
  const files = [...new Set(cases.map((row) => row.file))].sort(codePointCompare);
  return files.map((file) => ({ file, total: cases.filter((row) => row.file === file).length }));
}

/** The `command` string the assembler recorded for a run. */
export function runCommand(kind) {
  const prefix = RUN_PREFIX[kind];
  return `PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH PLAYWRIGHT_JSON_OUTPUT_NAME=/private/tmp/${prefix}.json pnpm exec playwright test --config ${RUN_CONFIG[kind]} --reporter=list,json --output=/private/tmp/${prefix}-traces > /private/tmp/${prefix}.log 2>&1`;
}

/**
 * The assembler's `main()`: both committed files, as bytes.
 *
 * `gitShow(revision, path)` reads the prior report at the frozen head, which
 * the assembler required to equal the file it used for prior case identities.
 */
export function assembleQualification(inputs, { verifiedAt, membership, gitShow }) {
  const checked = verifySnapshot(inputs, { membership });
  const snapshot = checked.snapshot;
  ensure(snapshot.inventory.length === 784, 'Frozen inventory size');
  ensure(inputs.read(repo(PRIOR)).equals(gitShow(snapshot.gitHead, PRIOR)), 'Prior evidence differs from the frozen Git head');
  const runs = { paste: verifyRun(inputs, 'paste'), legacy: verifyRun(inputs, 'legacy') };
  for (const prefix of [...Object.values(RUN_PREFIX), 'domternal-n12-markers-final']) {
    ensure(inputs.readText(tmp(`${prefix}.done`)).trim() === '0', `${prefix} exit status`);
  }
  const focus = verifyFocusedRun(inputs, expectedCases(inputs, 'paste'));
  const initial = verifyPreflight(inputs);

  const gates = gatePaths();
  ensure(inputs.readText(tmp(gates[0][1])).includes('[bundle-size] OK'), 'Final bundle-size gate log');
  ensure(inputs.readText(tmp(gates[2][1])).trim() === '', 'Final changed E2E ESLint log');
  for (const name of PACKAGES) {
    ensure(inputs.readText(tmp(`domternal-n12-${name}-publint.log`)).includes('All good!'), `Final ${name} publint log`);
    ensure(inputs.readText(tmp(`domternal-n12-${name}-attw.log`)).includes('No problems found'), `Final ${name} attw log`);
  }
  const releaseChecks = GATE_NAMES.map((name) => ({ name, exitCode: 0, execution: GATE_EXECUTION }));

  const record = (path, role) => artifactRecord(role, path, inputs.read(path));
  const artifacts = [
    ...REPORT_ARTIFACTS.flatMap(([prefix, rolePrefix]) => [
      record(tmp(`${prefix}.json`), `${rolePrefix} JSON report`),
      record(tmp(`${prefix}.log`), `${rolePrefix} raw log`),
    ]),
    ...gates.map(([role, file]) => record(tmp(file), role)),
    ...PARENT_ARTIFACTS.map(([file, role]) => record(tmp(file), role)),
    ...INPUT_ARTIFACTS.map(([file, role]) => record(tmp(file), role)),
    record(repo(PRIOR), PRIOR_ROLE),
    ...inputs.listDirectory(RELEASE_PACK, '.tgz').sort(codePointCompare).map((path) => record(path, PACK_ROLE)),
  ];

  for (const [kind, run] of Object.entries(runs)) {
    run.command = runCommand(kind);
    run.commandedNode = { ...COMMANDED_NODE };
    run.projects = projectsOf(run.cases);
    run.suites = suitesOf(run.cases);
  }
  const summaries = Object.fromEntries(
    Object.entries(runs).map(([kind, run]) => [kind, Object.fromEntries(Object.entries(run).filter(([key]) => key !== 'cases'))])
  );
  const document = {
    kind: 'domternal-free-list-markers-qualification',
    version: 1,
    verifiedAt,
    qualification: QUALIFICATION,
    runs: summaries,
    preflight: {
      initialFocusedBrowser: initial,
      releasePolicyCorrections: RELEASE_POLICY_CORRECTIONS,
      finalFocusedBrowser: {
        total: 204,
        passed: 204,
        failed: 0,
        flaky: 0,
        retries: 0,
        startTime: focus.stats.startTime,
        durationMs: focus.stats.duration,
      },
    },
    releaseChecks,
    verification: VERIFICATION,
    frozenInputs: snapshot,
    artifacts,
    cases: Object.entries(runs).flatMap(([kind, run]) => run.cases.map((row) => ({ ...row, run: kind }))),
  };
  const json = indentedBytes(document, { ensureAscii: false });
  const markdown = Buffer.from(
    renderMarkdown({
      jsonSha256: sha256(json),
      inventorySha256: snapshot.inventorySha256,
      pasteCaseInventorySha256: runs.paste.caseInventorySha256,
      legacyCaseInventorySha256: runs.legacy.caseInventorySha256,
      playwrightVersion: runs.paste.playwrightVersion,
    }),
    'utf8'
  );
  return { document, json, markdown, lost: checked.lost, membership: checked.membership };
}

/**
 * Checks that need only the committed files: every value the assembler derived
 * from the cases, the snapshot and the JSON bytes, and every authored block.
 * Returns problems rather than throwing, for the CI gate.
 */
export function rederive(report, { jsonBytes, markdownBytes, priorBytes }) {
  const problems = [];
  const expectEqual = (actual, expected, what) => {
    if (!pythonEqual(actual, expected)) problems.push(`${what} does not match what the assembler derives`);
  };
  for (const kind of ['paste', 'legacy']) {
    const cases = report.cases.filter((row) => row.run === kind);
    const run = report.runs[kind];
    expectEqual(run.command, runCommand(kind), `runs.${kind}.command`);
    expectEqual(run.projects, projectsOf(cases), `runs.${kind}.projects`);
    expectEqual(run.suites, suitesOf(cases), `runs.${kind}.suites`);
    expectEqual(run.total, cases.length, `runs.${kind}.total`);
    expectEqual(run.passed, cases.filter((row) => row.status === 'passed').length, `runs.${kind}.passed`);
    expectEqual(run.skipped, cases.filter((row) => row.status === 'skipped').length, `runs.${kind}.skipped`);
  }
  expectEqual(report.qualification, QUALIFICATION, 'qualification');
  expectEqual(report.verification, VERIFICATION, 'verification');
  expectEqual(report.preflight.releasePolicyCorrections, RELEASE_POLICY_CORRECTIONS, 'preflight.releasePolicyCorrections');
  expectEqual(report.preflight.initialFocusedBrowser.failureGroups, PREFLIGHT_FAILURE_GROUPS, 'preflight.initialFocusedBrowser.failureGroups');
  expectEqual(report.releaseChecks, GATE_NAMES.map((name) => ({ name, exitCode: 0, execution: GATE_EXECUTION })), 'releaseChecks');
  expectEqual(report.frozenInputs.selection, SELECTION_TEXT, 'frozenInputs.selection');
  const prior = report.artifacts.find((artifact) => artifact.role === PRIOR_ROLE);
  if (!prior || prior.localPath !== repo(PRIOR) || prior.bytes !== priorBytes.length || prior.sha256 !== sha256(priorBytes)) {
    problems.push(`the prior evidence record does not match the committed ${PRIOR}`);
  }
  const markdown = renderMarkdown({
    jsonSha256: sha256(jsonBytes),
    inventorySha256: report.frozenInputs.inventorySha256,
    pasteCaseInventorySha256: report.runs.paste.caseInventorySha256,
    legacyCaseInventorySha256: report.runs.legacy.caseInventorySha256,
    playwrightVersion: report.runs.paste.playwrightVersion,
  });
  if (!Buffer.from(markdown, 'utf8').equals(markdownBytes)) {
    problems.push(`${MARKDOWN} is not what the assembler writes for the committed JSON`);
  }
  return problems;
}

const collectStrings = (value) => {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(collectStrings);
  return [];
};

/**
 * Every string this unit copies from the preserved originals, paired with the
 * original it comes from, so a test can prove each still occurs there
 * verbatim. Strings the originals build with f-strings are listed by their
 * literal parts.
 */
export function authoredStrings() {
  const token = '\u0000';
  const markdownParts = renderMarkdown({
    jsonSha256: token,
    inventorySha256: token,
    pasteCaseInventorySha256: token,
    legacyCaseInventorySha256: token,
    playwrightVersion: token,
  })
    .split('\n')
    .flatMap((line) => line.split(token))
    .filter(Boolean);
  const verifier = [...NEW_TITLES, ...Object.keys(LEGACY), SKIP_TITLE, SKIP_REASON, ...SELECTION_RULES[0].paths.slice(0, 18)];
  const assembler = [
    ...GATE_NAMES,
    GATE_EXECUTION,
    PRIOR_ROLE,
    PACK_ROLE,
    PREFLIGHT_COPY_TITLE,
    FOCUS_TRACES,
    PREFLIGHT_TRACES,
    ...Object.keys(PREFLIGHT_FAILURES),
    ...collectStrings(COMMANDED_NODE),
    ...gatePaths().slice(0, 3).flat(),
    ...REPORT_ARTIFACTS.flat(),
    ...PARENT_ARTIFACTS.flat(),
    ...INPUT_ARTIFACTS.flat(),
    ...collectStrings(QUALIFICATION),
    ...collectStrings(RELEASE_POLICY_CORRECTIONS),
    ...collectStrings(VERIFICATION),
    ...collectStrings(PREFLIGHT_FAILURE_GROUPS),
    ...markdownParts,
  ];
  return [
    ...verifier.map((text) => ['domternal-n12-verify-evidence.py', text]),
    ...assembler.map((text) => ['domternal-n12-assemble-evidence.py', text]),
    ...collectStrings(SELECTION_TEXT).map((text) => ['domternal-n12-free-evidence.py', text]),
  ];
}

/** The Markdown the assembler wrote, from its f-string template. */
export function renderMarkdown({ jsonSha256, inventorySha256, pasteCaseInventorySha256, legacyCaseInventorySha256, playwrightVersion }) {
  return [
    "# Free list-marker qualification",
    "",
    "The final frozen build passed 1,690 of 1,692 browser cases. The two intentional skips are the preexisting Firefox and WebKit OS-clipboard permission controls. The final paste matrix covers 1,332 cases, including 204 new list-marker cases; a separate matrix covers 360 legacy list-editing cases. All four wrappers run in Chromium, Firefox and WebKit with zero retries, failures or flaky results.",
    "",
    "The new cases cover explicit decimal/alpha/Roman and disc/circle/square markers, null versus explicit defaults with the production theme, Office-style reconstruction, legacy schema fallback, internal partial copy, marker-conflicting paste and list commands, explicit typing marks, task-state separation and exact history restoration. Manually authored caret checks include 20/19 after paste, 8/15 after Tab, 10 after Shift-Tab and 9/10 before/after typing. Generated IDs are excluded only from canonical semantic document comparisons; history comparisons retain the complete snapshots.",
    "",
    `These are synthetic documents and clipboard events. This is not a native Word, Google Docs or LibreOffice capture, a visual-fidelity claim, a performance result or Pro import-worker evidence. The existing Chromium OS-clipboard case copies synthetic editor content. Browser version strings were not collected by this suite. Node v22.23.2 is the parent-recorded command runtime; Playwright reports version ${playwrightVersion}.`,
    "",
    "## Initial failures and corrections",
    "",
    "The initial focused run completed all 204 cases: 126 passed and 78 failed. Fifty-one failures came from the vanilla fixture's missing `dm-editor` mount class. Nine failures exposed a fixture selection that copied the actual ordered-list wrapper with `data-pm-slice=\"3 3 []\"`, rather than exercising marker attributes in the internal slice context. The corrected seed contains one `SOURCEA` item and selects its text range 0 through 7. The assertion still requires `listStyleType` and `upper-roman` in that context; it was not relaxed to a CSS-only check. Eighteen failures exposed a production issue: UniqueID ID-only appended steps cleared explicit stored typing marks, including an explicitly empty set. The fixture/assertion corrections and narrow UniqueID fix are included in the frozen final build. The focused rerun passed all 204 cases before the full qualification. Raw failed reports and trace locations remain recorded; traces are not copied into this repository.",
    "",
    "## Verification and release checks",
    "",
    "Independent verification checked exact case identities, one attempt per case, configured retries and projects, raw log counts, process exit statuses, both expected skip reasons and all 784 selected source/build hashes. Inventory membership includes package source and built files, framework demos, test fixtures, lockfiles, README claims, package artifact policy and cleanup TypeScript config. This is an explicit inventory, not a full dependency or OS snapshot.",
    "",
    "The final frozen tarballs of Core, BlockControls and PasteCleanup pass installed publint and ATTW strict checks. Final bundle-size, E2E TypeScript and scoped changed-file ESLint checks also pass without rebuilding. The archive checks are local and publish nothing. The earlier stale Core README size claims were corrected to the measured 64/145 KiB scale. A separate tarball audit justified the reviewed PasteCleanup packed-size ceiling of 845000 bytes for an actual 767675 byte archive, with the fixed additional-locale allowance unchanged. Final demo builds still report nonfatal bundle/chunk-size warnings. Broader parent-run unit/build/release results remain separately logged and are not inferred from this browser matrix.",
    "",
    "[Detailed evidence](./2026-09-27-list-markers.json) records every case, selected input hash, report/raw-log digest and local artifact path.",
    "",
    `- JSON SHA256: \`${jsonSha256}\``,
    `- Frozen inventory SHA256: \`${inventorySha256}\``,
    `- Paste case inventory SHA256: \`${pasteCaseInventorySha256}\``,
    `- Legacy case inventory SHA256: \`${legacyCaseInventorySha256}\``,
    "",
  ].join('\n');
}

// Authored blocks of domternal-n12-assemble-evidence.py and domternal-n12-free-evidence.py, verbatim.

export const QUALIFICATION = {
  scope: 'Built Free Core, BlockControls and PasteCleanup with real vanilla, React, Vue and Angular wrappers in Chromium, Firefox and WebKit.',
  newMarkerCases: 204,
  existingPasteRegressionCases: 1128,
  legacyListEditingCases: 360,
  nativeOfficeCapture: false,
  newClipboardCasesUseSyntheticClipboardEvents: true,
  claims: [
    'Explicit ordered and bullet marker semantics survive preserve/adapt cleanup and HTML reload.',
    'Office-style list reconstruction retains admitted decimal and bullet classes or preserves visible markers when the destination schema cannot represent them.',
    'Marker-conflicting list operations preserve boundaries, authored document JSON, caret positions and exact document/selection Undo and Redo snapshots.',
    'Default-null markers keep theme depth styling; explicit markers remain fixed. Task checked state remains independent.',
    'The final build passes the unchanged discovered legacy list case set in all four wrappers and three browsers.',
  ],
  limitations: [
    'No Word, Google Docs or LibreOffice clipboard capture or native Office fidelity claim.',
    'The one preexisting Chromium OS-clipboard case copies synthetic editor content; Firefox and WebKit intentionally skip that case.',
    'Browser versions were not queried by this matrix; engine names come from the Playwright projects.',
    'No performance or Pro DOCX converter/worker qualification is established by these browser results.',
    'The list-marker query enables the production theme. Other shared fixture modes retain their existing styling.',
    'Canonical document assertions remove generated IDs and sort mark order; Undo/Redo compares complete operation snapshots.',
    'The frozen inventory is an explicit source/build selection, not a complete dependency graph or operating-system snapshot.',
  ],
};

export const RELEASE_POLICY_CORRECTIONS = {
  bundleClaims: 'The initial bundle-size gate rejected stale Core README size claims. The updated reproducible claims are about 64 KiB own code and 145 KiB total; the final actual gate reports 65141 and 148198 gzip bytes.',
  artifactBudget: 'PasteCleanup packed size 767675 exceeded the old 730000 ceiling. Independent tarball and source-map audit found only expected production files and no new dependency or test/planning leak. The reviewed ceiling is 845000 with the existing 8000 additional-locale allowance; the final package artifact check passed.',
  buildWarnings: 'Final demo builds retained Angular initial-bundle and Vite large-chunk warnings; build/typecheck exited successfully. No zero-warning claim is made.',
};

export const VERIFICATION = {
  snapshotTiming: 'Parent froze source and builds before the final focused and complete matrices; independently rechecked after completion.',
  checks: [
    'Exact unique project/file/describe/title identities and matching Playwright IDs against read-only discovery.',
    'Previous 1128 paste identities preserved, plus 204 independently named new marker cases and 360 legacy list cases.',
    'Exactly one attempt per case, no retries, unexpected results, flaky results, result errors or run errors.',
    'Exactly the two declared native clipboard skips, no new skip or fixme annotations.',
    'Unchanged project/filter/repeat/retry configuration and declared trace-only output directory overrides.',
    'All 784 source/build input hashes and independently reconstructed membership.',
    'Raw log counts and final process exit statuses agree with each completed JSON report.',
    'Initial 78 failures retained and separated into 51 mount-fixture, 9 selection-fixture and 18 production failures.',
  ],
};

export const PREFLIGHT_FAILURE_GROUPS = [
  {
    cases: 51,
    kind: 'fixture',
    reason: 'The vanilla mount lacked the dm-editor class required by the newly enabled production theme and test selector. The fixture now declares the same class explicitly.',
  },
  {
    cases: 9,
    kind: 'fixture-selection',
    reason: 'The initial selection copied the actual ordered-list wrapper with data-pm-slice="3 3 []", so it did not exercise marker attributes in the internal slice context. The corrected fixture contains one SOURCEA item and selects its text range 0 through 7. The assertion still requires listStyleType and upper-roman in the serialized slice context; it was not relaxed to a CSS-only check.',
  },
  {
    cases: 18,
    kind: 'production',
    reason: 'UniqueID ID-only appended steps cleared explicit stored typing marks after list lift. The fix restores the prior explicit marks, including an empty set, after those steps.',
  },
];

export const SELECTION_TEXT = {
  rules: [
    'All source files in the Core, BlockControls and PasteCleanup packages.',
    'All existing files under packages/*/dist, since the fixture constructs public aliases from every package manifest.',
    'Every packages/*/package.json plus root lock/workspace manifests and framework app manifests.',
    'The seven configured paste browser suites, shared test fixture, Vite configs, fixture entry/HTML and E2E TypeScript config.',
    'The explicitly listed browser configuration, spec and fixture entry files.',
    'The focused list-editing config, shared target/matrix config, four demo source trees and direct app files, plus each selected legacy spec and fixture.',
  ],
  limitations: [
    'This is an explicit repository and built-artifact snapshot, not an esbuild or Vite dependency graph.',
    'Vendor dependency bytes and generated Vite optimizer caches are not included; the lockfile records dependency resolution.',
    'Browser binaries, OS state, mutable logs and trace/report artifacts are recorded separately, not frozen as source inputs.',
  ],
  changedFiles: [
    'e2e/paste-cleanup.config.ts',
    'e2e/paste-list-markers.browser.ts',
    'e2e/paste-cleanup-fixture/entry.mjs',
    'packages/extension-paste-cleanup/README.md',
  ],
};
