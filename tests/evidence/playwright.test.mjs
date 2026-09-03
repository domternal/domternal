/**
 * The completed-run verifier against synthetic Playwright reports.
 *
 * A well-formed synthetic run passes; then each negative control breaks one
 * thing and must be rejected by the check that names it. The first eight are
 * the mutations the styled-breaks report says its verifier rejected
 * (`verification.negativeVerifierChecks`), whose script was not preserved;
 * the rest cover the other ways a run can differ from its plan.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJson } from './json.mjs';
import {
  EvidenceCheckError,
  caseInventorySha256,
  compareCaseKeys,
  discoveryRows,
  flattenReport,
  isIsoTimestamp,
  pythonEqual,
  pythonFindall,
  pythonSearch,
  readLog,
  sameCounts,
  stripAnsi,
  verifyCompletedRun,
} from './playwright.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROJECTS = ['chromium', 'firefox'];
const TITLES = ['one', 'two', 'native clipboard'];
const OUTPUT = '/tmp/synthetic-traces';
const SKIP_REASON = 'Native clipboard permissions are exercised in Chromium.';
const CHECK = '\u2713';

const isSkipped = (row) => row.project === 'firefox' && row.title === 'native clipboard';

function config(forRun) {
  return {
    configFile: '/repo/e2e/synthetic.config.ts',
    rootDir: '/repo/e2e',
    forbidOnly: true,
    fullyParallel: false,
    globalSetup: null,
    globalTeardown: null,
    globalTimeout: 0,
    grep: {},
    grepInvert: null,
    maxFailures: 0,
    quiet: false,
    shard: null,
    tags: [],
    version: '1.58.2',
    workers: 1,
    webServer: null,
    reporter: forRun ? [['list'], ['json']] : [['list']],
    projects: PROJECTS.map((name) => ({
      outputDir: forRun ? OUTPUT : '/repo/test-results',
      repeatEach: 1,
      retries: 0,
      metadata: forRun ? { actualWorkers: 1 } : {},
      id: name,
      name,
      testDir: '/repo/e2e',
      testMatch: ['synthetic.browser.ts'],
    })),
  };
}

function build({ run }) {
  const suites = PROJECTS.map((project) => ({
    title: 'synthetic.browser.ts',
    file: 'synthetic.browser.ts',
    specs: [],
    suites: [
      {
        title: 'vanilla: group',
        file: 'synthetic.browser.ts',
        specs: TITLES.map((title) => {
          const skip = isSkipped({ project, title });
          return {
            title,
            ok: true,
            id: `${project}-${title}`,
            file: 'synthetic.browser.ts',
            tests: [
              {
                annotations: skip ? [{ type: 'skip', description: SKIP_REASON }] : [],
                expectedStatus: skip ? 'skipped' : 'passed',
                projectId: project,
                projectName: project,
                status: run ? (skip ? 'skipped' : 'expected') : 'expected',
                results: run ? [{ status: skip ? 'skipped' : 'passed', retry: 0, duration: skip ? 0 : 12, errors: [] }] : [],
              },
            ],
          };
        }),
      },
    ],
  }));
  const report = { config: config(run), suites, errors: [] };
  if (run) report.stats = { startTime: '2026-09-27T06:42:27.981Z', duration: 1234.5, expected: 5, skipped: 1, unexpected: 0, flaky: 0 };
  return report;
}

function log({ lines } = {}) {
  const results = lines ?? [
    `  ${CHECK}    1 [chromium] \u203a synthetic.browser.ts:3:1 \u203a vanilla: group \u203a one (12ms)`,
    `  ${CHECK}    2 [chromium] \u203a synthetic.browser.ts:4:1 \u203a vanilla: group \u203a two (12ms)`,
    `  ${CHECK}    3 [chromium] \u203a synthetic.browser.ts:5:1 \u203a vanilla: group \u203a native clipboard (12ms)`,
    `  ${CHECK}    4 [firefox] \u203a synthetic.browser.ts:3:1 \u203a vanilla: group \u203a one (12ms)`,
    `  ${CHECK}    5 [firefox] \u203a synthetic.browser.ts:4:1 \u203a vanilla: group \u203a two (12ms)`,
    '  -    6 [firefox] \u203a synthetic.browser.ts:5:1 \u203a vanilla: group \u203a native clipboard',
  ];
  return ['', 'Running 6 tests using 1 worker', '', ...results, '', '  1 skipped', '  5 passed (1.2s)', ''].join('\n');
}

function verify({ report = build({ run: true }), listing = build({ run: false }), text = log() } = {}) {
  return verifyCompletedRun(report, {
    listing,
    planned: discoveryRows(listing),
    total: 6,
    skips: 1,
    isSkipped,
    skipReason: SKIP_REASON,
    outputDir: OUTPUT,
    log: readLog(Buffer.from(text, 'utf8')),
  });
}

function rejects(mutate, check, { text } = {}) {
  const report = build({ run: true });
  const listing = build({ run: false });
  mutate?.(report, listing);
  assert.throws(
    () => verify({ report, listing, text: text ?? log() }),
    (error) => error instanceof EvidenceCheckError && error.check === check,
    `expected the "${check}" check to reject it`
  );
}

const firstResult = (report) => report.suites[0].suites[0].specs[0].tests[0].results[0];
const firstTest = (report) => report.suites[0].suites[0].specs[0].tests[0];

test('a run that is exactly its plan passes and is summarized', () => {
  const summary = verify();
  assert.equal(summary.total, 6);
  assert.equal(summary.passed, 5);
  assert.equal(summary.skipped, 1);
  assert.equal(summary.cases.length, 6);
  assert.deepEqual(summary.cases[0], {
    project: 'chromium',
    file: 'synthetic.browser.ts',
    describe: 'vanilla: group',
    title: 'native clipboard',
    status: 'passed',
    durationMs: 12,
    attempts: 1,
  });
  assert.equal(summary.cases.find((row) => row.project === 'firefox' && row.title === 'native clipboard').status, 'skipped');
  assert.match(summary.caseInventorySha256, /^[0-9a-f]{64}$/);
});

// The eight mutations recorded in styled-breaks.json verification.negativeVerifierChecks.
test('negative control run-error: a run-level error', () => {
  rejects((report) => report.errors.push({ message: 'worker crashed' }), 'Run-level error');
});
test('negative control flaky-stat: a flaky statistic', () => {
  rejects((report) => { report.stats.flaky = 1; }, 'Unexpected flaky statistic');
});
test('negative control retry-policy: a project retries', () => {
  rejects((report) => { report.config.projects[0].retries = 1; }, 'Project/filter/retry/repeat/output configuration changed');
});
test('negative control retried-result: a result that is a retry', () => {
  rejects((report) => { firstResult(report).retry = 1; }, 'Result failed or retried');
});
test('negative control result-error: a result with an error', () => {
  rejects((report) => { firstResult(report).errors = [{ message: 'boom' }]; }, 'Result error');
});
test('an explicit null error list is rejected, as result.get("errors", []) == [] rejected it', () => {
  rejects((report) => { firstResult(report).errors = null; }, 'Result error');
  const passes = build({ run: true });
  delete firstResult(passes).errors;
  assert.equal(verify({ report: passes }).total, 6, 'a result without an errors key still passes');
});
test('negative control changed-case-title: a renamed case', () => {
  rejects((report) => { report.suites[0].suites[0].specs[0].title = 'renamed'; }, 'Case identities differ from discovery');
});
test('negative control missing-attempt: a case without a result', () => {
  rejects((report) => { firstTest(report).results = []; }, 'Missing attempt or retry');
});
test('negative control unexpected-skip: an undeclared skip', () => {
  rejects((report) => {
    const tested = firstTest(report);
    tested.expectedStatus = 'skipped';
    tested.status = 'skipped';
    tested.results[0].status = 'skipped';
  }, 'Unexpected spec outcome');
});

test('a duplicate identity or Playwright ID makes the report ambiguous', () => {
  rejects((report) => {
    const specs = report.suites[0].suites[0].specs;
    specs.push({ ...specs[1], id: 'another-id' });
  }, 'Duplicate project/file/describe/title');
  rejects((report) => { report.suites[0].suites[0].specs[1].id = report.suites[0].suites[0].specs[0].id; }, 'Duplicate Playwright ID');
});

test('a changed project or run configuration is rejected', () => {
  rejects((report) => { report.config.projects[1].testMatch = ['other.browser.ts']; }, 'Project/filter/retry/repeat/output configuration changed');
  rejects((report) => { report.config.projects[0].outputDir = '/tmp/elsewhere'; }, 'Project/filter/retry/repeat/output configuration changed');
  rejects((report) => { report.config.workers = 2; }, 'Changed configuration: workers');
  rejects((report) => { report.config.grep = { source: 'one' }; }, 'Changed configuration: grep');
  rejects((report) => { report.config.reporter = [['list']]; }, 'Unexpected runtime reporter configuration');
});

test('a case missing from or added to discovery is rejected', () => {
  rejects((report, listing) => {
    const specs = listing.suites[0].suites[0].specs;
    specs.push({ ...specs[0], id: 'planned-only', title: 'planned only' });
  }, 'Case identities differ from discovery');
  rejects((report) => {
    const specs = report.suites[1].suites[0].specs;
    specs.push({ ...specs[0], id: 'ran-only', title: 'ran only' });
  }, 'Case identities differ from discovery');
  rejects((report) => { report.suites[0].suites[0].specs[0].id = 'changed-id'; }, 'Case identities differ from discovery');
});

test('a discovery report that ran tests or failed is refused', () => {
  const listing = build({ run: false });
  listing.errors.push({ message: 'syntax error' });
  assert.throws(() => discoveryRows(listing), /Discovery reported errors/);
  const ran = build({ run: false });
  ran.suites[0].suites[0].specs[0].tests[0].results.push({ status: 'passed' });
  assert.throws(() => discoveryRows(ran), /Inventory unexpectedly ran tests/);
});

test('annotations other than the declared skip are rejected', () => {
  rejects((report) => { firstTest(report).annotations = [{ type: 'fixme' }]; }, 'Unexpected annotation');
  rejects((report) => { firstTest(report).annotations = [{ type: 'skip', description: SKIP_REASON }]; }, 'Unexpected annotation');
  rejects((report) => { report.suites[1].suites[0].specs[2].tests[0].annotations[0].description = 'another reason'; }, 'Unexpected skip reason');
  rejects((report) => { report.suites[1].suites[0].specs[2].tests[0].annotations[0].type = 'fixme'; }, 'Unexpected annotation');
});

test('statistics and timing must agree with the plan', () => {
  rejects((report) => { report.stats.expected = 4; }, 'Unexpected expected statistic');
  rejects((report) => { report.stats.unexpected = 1; }, 'Unexpected unexpected statistic');
  rejects((report) => { report.stats.duration = 0; }, 'Invalid run duration');
  rejects((report) => { report.stats.startTime = 'yesterday'; }, 'Invalid run start time');
  rejects((report) => { firstResult(report).duration = -1; }, 'Invalid result duration');
  rejects((report) => { firstTest(report).projectId = 'other'; }, 'Project ID differs from project name');
});

test('the raw log must agree with the JSON report', () => {
  const lines = log().split('\n').filter((line) => line.includes('['));
  rejects(null, 'Raw result counts', { text: log({ lines: lines.slice(1) }) });
  rejects(null, 'Raw result counts', { text: log({ lines: [...lines.slice(1), lines[1].replace(CHECK, '\u2718')] }) });
  rejects(null, 'Raw log run header', { text: log().replace('Running 6 tests using 1 worker', 'Running 7 tests using 1 worker') });
  rejects(null, 'Raw log run header', { text: `${log()}\nRunning 6 tests using 1 worker\n` });
  rejects(null, 'Raw log pass summary', { text: log().replace('5 passed', '4 passed') });
  rejects(null, 'Raw log failure or flaky summary', { text: `${log()}  1 flaky\n` });
  rejects(null, 'Raw log skip summary', { text: log().replace('1 skipped', '') });
});

test('the log is read with universal newlines and without ANSI sequences', () => {
  const colored = log().replace(/\u2713/g, '\u001b[32m\u2713\u001b[39m').replace(/\n/g, '\r\n');
  assert.equal(verify({ text: colored }).passed, 5);
  assert.equal(stripAnsi('\u001b[1mbold\u001b[22m'), 'bold');
});

test('log patterns keep Python re semantics', () => {
  const arabicIndicThree = String.fromCodePoint(0x663);
  assert.ok(pythonSearch('^\\s*\\d passed\\b', `x\n  ${arabicIndicThree} passed`, { multiline: true }), '\\d is Unicode aware');
  assert.ok(pythonSearch('^\\s*1 passed', '\u001c1 passed', { multiline: true }), '\\s includes the file separator characters');
  assert.ok(!pythonSearch('^1 passed', 'a\r1 passed', { multiline: true }), '^ only follows \\n');
  assert.ok(pythonSearch('^a.b$', 'a\rb', { multiline: true }), '. matches \\r and $ only precedes \\n');
  assert.ok(pythonSearch('passed$', 'x passed\n'), 'without re.M, $ also matches before a final newline');
  assert.ok(!pythonSearch('passed\\b', 'passed\u00e9'), '\\b is Unicode aware');
  assert.deepEqual(pythonFindall('(a)(b)?', 'ab a'), [['a', 'b'], ['a', '']]);
  assert.deepEqual(pythonFindall('x', 'xx'), ['x', 'x']);
});

test('rows sort by case key in code point order', () => {
  const astral = String.fromCodePoint(0x1f600);
  const high = String.fromCodePoint(0xffff);
  assert.ok(compareCaseKeys(['a', 'f', '', high], ['a', 'f', '', astral]) < 0);
  const report = build({ run: false });
  report.suites[0].suites[0].specs[0].title = astral;
  report.suites[0].suites[0].specs[1].title = high;
  const titles = flattenReport(report).filter((row) => row.project === 'chromium').map((row) => row.title);
  assert.deepEqual(titles, ['native clipboard', high, astral]);
});

test('helpers compare the way Python does', () => {
  assert.ok(pythonEqual({ a: 1, b: [1, { c: null }] }, { b: [1, { c: undefined }], a: 1 }));
  assert.ok(!pythonEqual([1, 2], [2, 1]));
  assert.ok(pythonEqual(parseJson('20.0'), 20));
  assert.ok(sameCounts(['a', 'b', 'a'], { a: 2, b: 1 }));
  assert.ok(!sameCounts(['a', 'b', 'a'], { a: 2 }));
  assert.ok(!sameCounts(['a'], { a: 1, b: 0 }), 'Counter == dict is exact, as the originals compared');
  assert.ok(isIsoTimestamp('2026-09-27T06:42:27.981Z'));
  assert.ok(!isIsoTimestamp('2026-09-27 06:42'));
});

test('case inventory digests recompute the committed values', () => {
  const markers = parseJson(readFileSync(join(repoRoot, 'e2e/paste-cleanup-results/2026-09-27-list-markers.json')));
  for (const kind of ['paste', 'legacy']) {
    assert.equal(caseInventorySha256(markers.cases.filter((row) => row.run === kind)), markers.runs[kind].caseInventorySha256, kind);
  }
  const breaks = parseJson(readFileSync(join(repoRoot, 'e2e/paste-cleanup-results/2026-09-27-styled-breaks.json')));
  assert.equal(caseInventorySha256(breaks.cases), breaks.verification.caseInventorySha256);
  assert.equal(caseInventorySha256(breaks.cases), '6fc2b5233b443f656020f951bf536c690a4c1f190cc82204a9f957f850c72c44');
  assert.equal(markers.runs.paste.caseInventorySha256, 'f6e0a2cfaacc5a46870aeca3a789fec4477ec53d6a14d2ed3ffc9ab38dcce70e');
  assert.equal(markers.runs.legacy.caseInventorySha256, '54ada46008598eecb9a2a640bbcb004fc884d4172603dfb24153900c8cb5d851');
});
