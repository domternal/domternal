/**
 * Checks over Playwright JSON reports and list-reporter logs, ported from the
 * Python verifiers behind the paste evidence.
 *
 * A completed run counts as evidence only when it is exactly the run that was
 * planned: every case the read-only discovery (`--list`) found ran once, passed
 * or was one of the declared skips, under the configuration discovery saw, and
 * the raw log agrees with the JSON. Each failed check throws an
 * `EvidenceCheckError` naming it, so a negative control can prove which check
 * rejected a broken report.
 *
 * The log checks use the original Python patterns verbatim through
 * `pythonRegExp`, which gives them Python's `re` semantics: `\s` and `\d` are
 * Unicode aware, `^`, `$` and `.` only treat `\n` as a line break, and the log is
 * read with universal newlines first.
 */
import { EvidenceJsonError, canonicalBytes, codePointCompare, isJsonNumber, numberValue, pythonReadText, sha256 } from './json.mjs';

export class EvidenceCheckError extends Error {
  constructor(check, detail) {
    super(detail ? `${check}: ${detail}` : check);
    this.name = 'EvidenceCheckError';
    this.check = check;
  }
}

/** Throw an `EvidenceCheckError` for `check` unless `condition` holds. */
export function ensure(condition, check, detail) {
  if (!condition) throw new EvidenceCheckError(check, detail);
}

/** The describe path separator of the list-markers verifier. */
export const DESCRIBE_SEPARATOR = ' \u203a ';

/** The identity of a case: project, file, describe path and title. */
export function caseKey(row) {
  return [row.project, row.file, row.describe, row.title];
}

/** Python tuple ordering over two case keys. */
export function compareCaseKeys(left, right) {
  for (let index = 0; index < left.length; index++) {
    const order = codePointCompare(left[index], right[index]);
    if (order !== 0) return order;
  }
  return left.length - right.length;
}

function sortByKey(rows) {
  return [...rows].sort((left, right) => compareCaseKeys(caseKey(left), caseKey(right)));
}

/**
 * Every test of a report as one row per project, sorted by identity.
 *
 * Suite titles below the file level form the describe path. Two rows with the
 * same identity, or two specs with the same Playwright ID, make the report
 * ambiguous and are refused.
 */
export function flattenReport(report, { separator = DESCRIBE_SEPARATOR } = {}) {
  const rows = [];
  function visit(suite, parents) {
    const names = [...parents, suite.title];
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests) {
        rows.push({
          project: test.projectName,
          file: spec.file,
          describe: names.slice(1).join(separator),
          title: spec.title,
          id: spec.id,
          test,
          ok: spec.ok,
        });
      }
    }
    for (const child of suite.suites ?? []) visit(child, names);
  }
  for (const suite of report.suites) visit(suite, []);
  const keys = new Set(rows.map((row) => JSON.stringify(caseKey(row))));
  ensure(keys.size === rows.length, 'Duplicate project/file/describe/title');
  const ids = new Set(rows.map((row) => row.id));
  ensure(ids.size === rows.length, 'Duplicate Playwright ID');
  return sortByKey(rows);
}

/** SHA-256 over the canonical JSON of the sorted case keys. */
export function caseInventorySha256(rows) {
  return sha256(canonicalBytes(sortByKey(rows).map(caseKey)));
}

/**
 * Python `==` for decoded JSON: numbers by value, objects regardless of key
 * order, a missing value equal to null the way `dict.get` reads it.
 */
export function pythonEqual(left, right) {
  const a = left ?? null;
  const b = right ?? null;
  if (isJsonNumber(a) && isJsonNumber(b)) {
    try {
      return numberValue(a) === numberValue(b);
    } catch (error) {
      if (!(error instanceof EvidenceJsonError)) throw error;
      return pythonEqualBig(a, b);
    }
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    return a.length === b.length && a.every((item, index) => pythonEqual(item, b[index]));
  }
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => Object.hasOwn(b, key) && pythonEqual(a[key], b[key]));
}

function pythonEqualBig(left, right) {
  const big = (value) => (typeof value === 'number' ? (Number.isInteger(value) ? BigInt(value) : null) : value.value ?? null);
  const a = big(left);
  const b = big(right);
  return typeof a === 'bigint' && typeof b === 'bigint' && a === b;
}

/** Exact multiset equality, as `Counter(items) == {...}` compares. */
export function sameCounts(items, expected) {
  const counts = new Map();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  const wanted = Object.entries(expected);
  return counts.size === wanted.length && wanted.every(([key, count]) => counts.get(key) === count);
}

const PYTHON_WHITESPACE = '\\t\\n\\x0b\\x0c\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const PYTHON_WORD = '[\\p{L}\\p{N}_]';

/**
 * A JS RegExp with Python `re` semantics for the constructs the verifiers use:
 * `^`, `$`, `.`, `\s`, `\d` and `\b`, with or without `re.M`.
 */
export function pythonRegExp(pattern, { multiline = false, global = false } = {}) {
  let out = '';
  let inClass = false;
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index];
    if (char === '\\') {
      const next = pattern[index + 1];
      index++;
      if (next === 's') out += inClass ? PYTHON_WHITESPACE : `[${PYTHON_WHITESPACE}]`;
      else if (next === 'd') out += '\\p{Nd}';
      else if (next === 'b' && !inClass) out += `(?:(?<=${PYTHON_WORD})(?!${PYTHON_WORD})|(?<!${PYTHON_WORD})(?=${PYTHON_WORD}))`;
      else if (next === undefined) throw new Error(`Pattern ends with a backslash: ${pattern}`);
      else out += `\\${next}`;
      continue;
    }
    if (inClass) {
      if (char === ']') inClass = false;
      out += char;
      continue;
    }
    if (char === '[') {
      inClass = true;
      out += char;
      if (pattern[index + 1] === '^') {
        out += '^';
        index++;
      }
    } else if (char === '^') {
      out += multiline ? '(?<![^\\n])' : '(?<![\\s\\S])';
    } else if (char === '$') {
      out += multiline ? '(?=\\n|(?![\\s\\S]))' : '(?=\\n?(?![\\s\\S]))';
    } else if (char === '.') {
      out += '[^\\n]';
    } else {
      out += char;
    }
  }
  return new RegExp(out, global ? 'gu' : 'u');
}

/** `re.search(pattern, text, flags)` as a boolean. */
export function pythonSearch(pattern, text, options) {
  return pythonRegExp(pattern, options).test(text);
}

/** `re.findall`: whole matches, the only group, or tuples of groups. */
export function pythonFindall(pattern, text, options) {
  const expression = pythonRegExp(pattern, { ...options, global: true });
  const found = [];
  for (const match of text.matchAll(expression)) {
    if (match.length === 1) found.push(match[0]);
    else if (match.length === 2) found.push(match[1] ?? '');
    else found.push(match.slice(1).map((group) => group ?? ''));
  }
  return found;
}

/** `re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', text)`: drop ANSI control sequences. */
export function stripAnsi(text) {
  // The escape character is the point of this pattern.
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
}

/** A raw log as the Python verifiers read it: universal newlines, no ANSI. */
export function readLog(bytes) {
  return stripAnsi(pythonReadText(bytes));
}

/** `datetime.fromisoformat(value.replace('Z', '+00:00'))` succeeds. */
export function isIsoTimestamp(value) {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})?$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

/** A read-only discovery report: no run errors and no executed results. */
export function discoveryRows(listing, options) {
  ensure(Array.isArray(listing.errors) && listing.errors.length === 0, 'Discovery reported errors');
  const rows = flattenReport(listing, options);
  ensure(rows.every((row) => row.test.results.length === 0), 'Inventory unexpectedly ran tests');
  return rows;
}

/** The planned identities and IDs, in order, exactly as discovery found them. */
export function compareWithDiscovery(rows, planned) {
  const describe = (list) => list.map((row) => JSON.stringify([...caseKey(row), row.id]));
  const actual = describe(rows);
  const wanted = describe(planned);
  if (actual.length === wanted.length && actual.every((item, index) => item === wanted[index])) return;
  const actualSet = new Set(actual);
  const wantedSet = new Set(wanted);
  const missing = wanted.filter((item) => !actualSet.has(item)).slice(0, 5);
  const extra = actual.filter((item) => !wantedSet.has(item)).slice(0, 5);
  throw new EvidenceCheckError(
    'Case identities differ from discovery',
    `missing ${JSON.stringify(missing)}, extra ${JSON.stringify(extra)}`
  );
}

const CONFIG_FIELDS = [
  'configFile', 'rootDir', 'forbidOnly', 'fullyParallel', 'globalSetup', 'globalTeardown',
  'globalTimeout', 'grep', 'grepInvert', 'maxFailures', 'quiet', 'shard', 'tags',
  'version', 'workers', 'webServer',
];

/**
 * The run used the configuration discovery saw. The only allowed differences
 * are the declared trace output directory and the worker count Playwright
 * records in each project's metadata.
 */
export function verifyRunConfig(actual, listed, { outputDir }) {
  for (const field of CONFIG_FIELDS) {
    ensure(pythonEqual(actual[field], listed[field]), `Changed configuration: ${field}`);
  }
  ensure(pythonEqual(actual.reporter, [['list'], ['json']]), 'Unexpected runtime reporter configuration');
  const expectedProjects = listed.projects.map((project) => ({
    ...project,
    outputDir,
    metadata: { ...(project.metadata ?? {}), actualWorkers: actual.workers },
  }));
  ensure(pythonEqual(actual.projects, expectedProjects), 'Project/filter/retry/repeat/output configuration changed');
}

/**
 * The list reporter's own account of the run: one "Running N tests" line, one
 * result symbol per case, the pass count, no failures or flakes, and the
 * declared skips. `log` is the text `readLog` returns; stripping it again could
 * remove sequences the single Python pass kept.
 */
export function verifyListLog(log, { total, skips, workers }) {
  const running = pythonFindall(`^Running ${total} tests using ${workers} workers?$`, log, { multiline: true });
  ensure(running.length === 1, 'Raw log run header', `expected one "Running ${total} tests" line, found ${running.length}`);
  const symbols = pythonFindall('^\\s*([\u2713\u2718\u00d7-])\\s+\\d+\\s+.*$', log, { multiline: true });
  const expected = skips ? { '\u2713': total - skips, '-': skips } : { '\u2713': total };
  ensure(sameCounts(symbols, expected), 'Raw result counts', `found ${symbols.length} result lines`);
  ensure(pythonSearch(`^\\s*${total - skips} passed\\b`, log, { multiline: true }), 'Raw log pass summary');
  ensure(!pythonSearch('^\\s*\\d+ (failed|flaky)\\b', log, { multiline: true }), 'Raw log failure or flaky summary');
  if (skips) ensure(pythonSearch(`^\\s*${skips} skipped\\b`, log, { multiline: true }), 'Raw log skip summary');
}

function isNumber(value) {
  return isJsonNumber(value);
}

/**
 * Verify one completed run against its discovery and return the summary the
 * evidence records, with one row per case.
 *
 * `isSkipped(row)` names the declared skips; each must carry exactly the
 * `skipReason` annotation, and no other case may carry any annotation.
 */
export function verifyCompletedRun(report, { listing, planned, total, skips, isSkipped, skipReason, outputDir, log }) {
  ensure(Array.isArray(report.errors) && report.errors.length === 0, 'Run-level error');
  verifyRunConfig(report.config, listing.config, { outputDir });
  const rows = flattenReport(report);
  compareWithDiscovery(rows, planned);
  const cases = [];
  for (const row of rows) {
    const test = row.test;
    const skip = isSkipped(row);
    const status = skip ? 'skipped' : 'passed';
    const where = caseKey(row).join(' | ');
    ensure(row.ok === true && test.expectedStatus === status, 'Unexpected spec outcome', where);
    ensure(test.status === (skip ? 'skipped' : 'expected'), 'Unexpected test outcome', where);
    ensure(test.projectId === test.projectName, 'Project ID differs from project name', where);
    ensure(test.results.length === 1, 'Missing attempt or retry', where);
    const result = test.results[0];
    ensure(result.status === status && pythonEqual(result.retry, 0), 'Result failed or retried', where);
    ensure(!result.error && pythonEqual(Object.hasOwn(result, 'errors') ? result.errors : [], []), 'Result error', where);
    ensure(isNumber(result.duration) && numberValue(result.duration) >= 0, 'Invalid result duration', where);
    const annotations = test.annotations ?? [];
    ensure(annotations.every((item) => item.type === 'skip'), 'Unexpected annotation', where);
    if (skip) {
      ensure(annotations.length === 1 && annotations[0].description === skipReason, 'Unexpected skip reason', where);
    } else {
      ensure(annotations.length === 0, 'Unexpected annotation', where);
    }
    cases.push({
      project: row.project,
      file: row.file,
      describe: row.describe,
      title: row.title,
      status,
      durationMs: result.duration,
      attempts: 1,
    });
  }
  const stats = report.stats;
  for (const [field, value] of [['expected', total - skips], ['skipped', skips], ['unexpected', 0], ['flaky', 0]]) {
    ensure(pythonEqual(stats[field], value), `Unexpected ${field} statistic`);
  }
  ensure(isNumber(stats.duration) && numberValue(stats.duration) > 0, 'Invalid run duration');
  ensure(isIsoTimestamp(stats.startTime), 'Invalid run start time');
  verifyListLog(log, { total, skips, workers: report.config.workers });
  return {
    startTime: stats.startTime,
    durationMs: stats.duration,
    total,
    passed: total - skips,
    skipped: skips,
    failed: 0,
    flaky: 0,
    workers: report.config.workers,
    retries: 0,
    playwrightVersion: report.config.version,
    cases,
    caseInventorySha256: caseInventorySha256(rows),
  };
}
