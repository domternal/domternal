/**
 * The body of the `test:evidence` gate: invariants of the committed evidence
 * that hold without the raw inputs, so CI can enforce them on every change.
 *
 * - Historical tools: each `historical-tools/<report-stem>/` directory holds
 *   exactly the files its MANIFEST.json lists plus README.md, byte for byte,
 *   and every digest the committed report records for a tool matches the
 *   manifest at the stated JSON pointer. A report that names a Python script
 *   must have it preserved.
 * - Serialization goldens: each committed evidence JSON is exactly what its
 *   writer produces for its own parsed value, so any hand edit, reformat or
 *   lossy rewrite shows up.
 * - Digest goldens: every digest a report records over its own content (the
 *   frozen inventory, the case inventories, the JSON digests in the Markdown)
 *   is recomputed, and the ported unit rederives everything its assembler
 *   derived.
 * - Declared redactions: a version 2 MANIFEST.json declares every file a
 *   redaction changed, with its redacted size, digest and placeholder count,
 *   where the unredacted originals are, and every digest it replaced or
 *   withheld; a placeholder no manifest declares fails (see redaction.mjs).
 * - A 2 MiB ceiling per committed evidence JSON file.
 * - Nothing executes the historical tools or Python: no package script, no
 *   workflow, no test or script, and this tool itself only ever spawns `git`.
 *
 * Every JSON file in the evidence directories must be registered in `REPORTS`,
 * and every historical-tools directory must belong to a registered report, so
 * a new report cannot bypass the gate by not being listed.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inventoryDigest } from './inventory.mjs';
import { getPointer, indentedBytes, parseJson, sha256 } from './json.mjs';
import { caseInventorySha256 } from './playwright.mjs';
import { checkRedactions, declaredFiles, undeclaredPlaceholders } from './redaction.mjs';
import { unitFor } from './units/index.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const EVIDENCE_DIRECTORIES = ['e2e/paste-cleanup-results', 'e2e/paste-performance/results'];
export const JSON_CEILING_BYTES = 2 * 1024 * 1024;
export const MANIFEST_KIND = 'domternal-historical-evidence-tools';
const HISTORICAL = 'historical-tools';
const SHA256 = /^[0-9a-f]{64}$/;

/**
 * Every committed evidence report and what can be checked about it.
 *
 * `serializer` names the writer: `python-ascii` is `json.dumps(indent=2)`,
 * `python-utf8` adds `ensure_ascii=False`, `node` is
 * `JSON.stringify(value, null, 2)`; each is followed by a newline.
 */
export const REPORTS = [
  {
    path: 'e2e/paste-cleanup-results/2026-09-27-styled-breaks.json',
    serializer: 'python-ascii',
    digests: [
      { pointer: '/frozenInputs/inventorySha256', inventory: '/frozenInputs/inventory' },
      { pointer: '/verification/caseInventorySha256', cases: '/cases' },
    ],
    markdown: {
      path: 'e2e/paste-cleanup-results/2026-09-27-styled-breaks.md',
      digests: [
        { label: 'Input inventory SHA256', pointer: '/frozenInputs/inventorySha256' },
        { label: 'Final raw Playwright report SHA256', pointer: '/artifacts/0/sha256' },
        { label: 'Durable JSON SHA256', self: true },
      ],
    },
    historicalTools: 'e2e/paste-cleanup-results/historical-tools/2026-09-27-styled-breaks',
  },
  {
    path: 'e2e/paste-cleanup-results/2026-09-27-list-markers.json',
    serializer: 'python-utf8',
    digests: [
      { pointer: '/frozenInputs/inventorySha256', inventory: '/frozenInputs/inventory' },
      { pointer: '/runs/paste/caseInventorySha256', cases: '/cases', run: 'paste' },
      { pointer: '/runs/legacy/caseInventorySha256', cases: '/cases', run: 'legacy' },
    ],
    markdown: {
      path: 'e2e/paste-cleanup-results/2026-09-27-list-markers.md',
      digests: [
        { label: 'JSON SHA256', self: true },
        { label: 'Frozen inventory SHA256', pointer: '/frozenInputs/inventorySha256' },
        { label: 'Paste case inventory SHA256', pointer: '/runs/paste/caseInventorySha256' },
        { label: 'Legacy case inventory SHA256', pointer: '/runs/legacy/caseInventorySha256' },
      ],
    },
    unit: '2026-09-27-list-markers',
    historicalTools: 'e2e/paste-cleanup-results/historical-tools/2026-09-27-list-markers',
  },
  {
    path: 'e2e/paste-performance/results/2026-09-26-macos-arm64.json',
    serializer: 'node',
    digests: [],
    markdown: { path: 'e2e/paste-performance/results/2026-09-26-macos-arm64.md', digests: [] },
    historicalTools: 'e2e/paste-performance/results/historical-tools/2026-09-26-macos-arm64',
  },
  {
    path: 'e2e/paste-performance/results/2026-09-28-large-macos-arm64.json',
    serializer: 'node',
    digests: [],
    markdown: {
      path: 'e2e/paste-performance/results/2026-09-28-large-macos-arm64.md',
      digests: [{ label: 'JSON SHA256', self: true }],
    },
  },
  {
    path: 'e2e/paste-performance/results/2026-10-01-macos-arm64.json',
    serializer: 'node',
    digests: [],
    markdown: {
      path: 'e2e/paste-performance/results/2026-10-01-macos-arm64.md',
      digests: [{ label: 'Paired JSON SHA256', self: true }],
    },
  },
  {
    path: 'e2e/paste-performance/results/2026-10-01-image-assets-macos-arm64.json',
    serializer: 'node',
    digests: [],
    markdown: {
      path: 'e2e/paste-performance/results/2026-10-01-macos-arm64.md',
      digests: [{ label: 'imageAssets JSON SHA256', self: true }],
    },
  },
  {
    path: 'e2e/paste-performance/results/2026-10-01-content-macos-arm64.json',
    serializer: 'node',
    digests: [],
    markdown: {
      path: 'e2e/paste-performance/results/2026-10-01-content-macos-arm64.md',
      digests: [{ label: 'Timing JSON SHA256', self: true }],
    },
  },
  {
    path: 'e2e/paste-performance/results/2026-10-01-content-equivalence-macos-arm64.json',
    serializer: 'node',
    digests: [],
    markdown: {
      path: 'e2e/paste-performance/results/2026-10-01-content-macos-arm64.md',
      digests: [{ label: 'Equivalence JSON SHA256', self: true }],
    },
  },
];

/** The bytes `serializer` writes for `value`. */
export function serialize(value, serializer) {
  if (serializer === 'python-ascii') return indentedBytes(value, { ensureAscii: true });
  if (serializer === 'python-utf8') return indentedBytes(value, { ensureAscii: false });
  if (serializer === 'node') return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
  throw new Error(`Unknown serializer ${String(serializer)}`);
}

/** Digests recorded in Markdown as "- Label: `hex`". */
export function markdownDigests(text) {
  const found = new Map();
  for (const match of text.matchAll(/^- ([^:\n]+): `([0-9a-f]{64})`$/gm)) {
    if (found.has(match[1])) found.set(match[1], null);
    else found.set(match[1], match[2]);
  }
  return found;
}

function readOptional(root, path) {
  const full = join(root, path);
  return existsSync(full) ? readFileSync(full) : null;
}

/** Serialization, size, digest and cross-reference checks for one report. */
export function checkReport(root, entry) {
  const problems = [];
  const bytes = readOptional(root, entry.path);
  if (!bytes) return [`${entry.path}: registered evidence report is missing`];
  if (bytes.length > JSON_CEILING_BYTES) {
    problems.push(`${entry.path}: ${bytes.length} bytes exceeds the ${JSON_CEILING_BYTES}-byte evidence JSON ceiling`);
  }
  let report;
  try {
    report = entry.serializer === 'node' ? JSON.parse(bytes.toString('utf8')) : parseJson(bytes);
  } catch (error) {
    return [...problems, `${entry.path}: cannot be parsed exactly (${error.message})`];
  }
  if (!serialize(report, entry.serializer).equals(bytes)) {
    problems.push(`${entry.path}: bytes are not what its ${entry.serializer} writer produces for its own content (hand edit or reformat?)`);
  }
  for (const digest of entry.digests) {
    const recorded = getPointer(report, digest.pointer);
    let computed;
    try {
      if (digest.inventory) computed = inventoryDigest(getPointer(report, digest.inventory));
      else {
        const cases = getPointer(report, digest.cases) ?? [];
        computed = caseInventorySha256(digest.run ? cases.filter((row) => row.run === digest.run) : cases);
      }
    } catch (error) {
      computed = `unavailable (${error.message})`;
    }
    if (recorded !== computed) problems.push(`${entry.path}: ${digest.pointer} is ${String(recorded)}, recomputed ${computed}`);
  }
  if (entry.markdown) {
    const markdown = readOptional(root, entry.markdown.path);
    if (!markdown) problems.push(`${entry.markdown.path}: Markdown report is missing`);
    else {
      const recorded = markdownDigests(markdown.toString('utf8'));
      for (const digest of entry.markdown.digests) {
        const expected = digest.self ? sha256(bytes) : getPointer(report, digest.pointer);
        const value = recorded.get(digest.label);
        if (value !== expected) {
          problems.push(`${entry.markdown.path}: "${digest.label}" is ${String(value)}, expected ${String(expected)}`);
        }
      }
    }
  }
  if (entry.unit) {
    const unit = unitFor(entry.unit);
    const markdownBytes = readOptional(root, unit.MARKDOWN) ?? Buffer.alloc(0);
    const priorBytes = readOptional(root, unit.PRIOR) ?? Buffer.alloc(0);
    for (const problem of unit.rederive(report, { jsonBytes: bytes, markdownBytes, priorBytes })) {
      problems.push(`${entry.path}: ${problem}`);
    }
  }
  return problems;
}

/** The parsed report, or null when it is missing or unreadable (reported elsewhere). */
function parseQuietly(bytes) {
  if (!bytes) return null;
  try {
    return parseJson(bytes);
  } catch {
    return null;
  }
}

function isExecutable(path) {
  return (lstatSync(path).mode & 0o111) !== 0;
}

/** Direct children of `directory` among `files`, and the names of any subdirectories. */
function childrenOf(files, directory) {
  const prefix = `${directory}/`;
  const names = new Set();
  const directories = new Set();
  for (const path of files) {
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    const slash = rest.indexOf('/');
    if (slash === -1) names.add(rest);
    else directories.add(rest.slice(0, slash));
  }
  return { names, directories };
}

/**
 * One historical-tools directory against its MANIFEST.json and its report.
 * `files` is what Git would commit, so an ignored `.DS_Store` does not count
 * but an ignored tool is reported.
 */
export function checkHistoricalTools(root, entry, files = listRepositoryFiles(root), allDeclared = declaredFiles(readDeclarations(root, REPORTS))) {
  const problems = [];
  const directory = entry.historicalTools;
  const full = join(root, directory);
  if (!existsSync(full)) return [`${directory}: historical-tools directory is missing`];
  const say = (message) => problems.push(`${directory}: ${message}`);
  const manifestBytes = readOptional(root, `${directory}/MANIFEST.json`);
  if (!manifestBytes) return [`${directory}: MANIFEST.json is missing`];
  if (manifestBytes.length > JSON_CEILING_BYTES) say('MANIFEST.json exceeds the evidence JSON ceiling');
  let manifest;
  try {
    manifest = parseJson(manifestBytes);
  } catch (error) {
    return [`${directory}: MANIFEST.json cannot be parsed (${error.message})`];
  }
  if (manifest.kind !== MANIFEST_KIND || ![1, 2].includes(manifest.version)) say(`MANIFEST.json is not a ${MANIFEST_KIND} version 1 or 2 manifest`);
  if (manifest.version === 1 && Object.hasOwn(manifest, 'redactions')) say('MANIFEST.json declares redactions, which only a version 2 manifest can');
  if (manifest.version === 2) problems.push(...checkRedactions(root, directory, manifest, allDeclared));
  if (manifest.executedByCI !== false) say('MANIFEST.json must record executedByCI: false');
  const reportPath = typeof manifest.report === 'string' ? posix.normalize(posix.join(directory, manifest.report)) : null;
  if (reportPath !== entry.path) say(`MANIFEST.json report ${String(manifest.report)} does not resolve to ${entry.path}`);
  const reportBytes = readOptional(root, entry.path);
  if (reportBytes && manifest.reportSha256 !== sha256(reportBytes)) {
    say(`MANIFEST.json reportSha256 ${String(manifest.reportSha256)} does not match ${entry.path} (${sha256(reportBytes)})`);
  }
  if (entry.markdown && typeof manifest.markdown !== 'string') say('MANIFEST.json must name the Markdown report');
  else if (entry.markdown) {
    const markdownPath = posix.normalize(posix.join(directory, manifest.markdown));
    const markdownBytes = readOptional(root, markdownPath);
    if (markdownPath !== entry.markdown.path) say(`MANIFEST.json markdown does not resolve to ${entry.markdown.path}`);
    else if (!markdownBytes || manifest.markdownSha256 !== sha256(markdownBytes)) say('MANIFEST.json markdownSha256 does not match the Markdown report');
  }
  const tools = Array.isArray(manifest.tools) ? manifest.tools : [];
  if (!Array.isArray(manifest.tools)) say('MANIFEST.json has no tools list');
  const listed = new Set(['MANIFEST.json', 'README.md']);
  const report = parseQuietly(reportBytes);
  for (const tool of tools) {
    if (typeof tool.file !== 'string' || tool.file.includes('/') || tool.file.startsWith('.') || listed.has(tool.file)) {
      say(`MANIFEST.json lists an invalid tool file ${JSON.stringify(tool.file)}`);
      continue;
    }
    listed.add(tool.file);
    const path = join(full, tool.file);
    if (!existsSync(path)) {
      say(`${tool.file} is listed in MANIFEST.json but missing`);
      continue;
    }
    const data = readFileSync(path);
    if (data.length !== tool.bytes || sha256(data) !== tool.sha256) {
      say(`${tool.file} is not byte-identical to MANIFEST.json (${data.length} bytes, sha256 ${sha256(data)})`);
    }
    if (isExecutable(path)) say(`${tool.file} is executable; historical tools are kept at mode 0644`);
    if (tool.recordedInReport !== null && typeof tool.recordedInReport !== 'string') {
      say(`${tool.file} needs recordedInReport: a JSON pointer or null`);
    } else if (tool.recordedInReport !== null && report) {
      const record = getPointer(report, tool.recordedInReport);
      if (!record || record.localPath !== tool.originalPath || record.bytes !== tool.bytes || record.sha256 !== tool.sha256) {
        say(`${tool.file} does not match the record at ${entry.path}#${String(tool.recordedInReport)}`);
      }
    }
  }
  const { names, directories } = childrenOf(files, directory);
  for (const name of directories) say(`${name}/ must not exist; the directory holds only listed files`);
  for (const name of names) {
    if (!listed.has(name)) say(`${name} is not listed in MANIFEST.json`);
    else if (!lstatSync(join(full, name)).isFile()) say(`${name} must be a regular file`);
  }
  for (const name of listed) {
    if (existsSync(join(full, name)) && !names.has(name)) say(`${name} is ignored by Git, so it would not be committed`);
  }
  const readme = readOptional(root, `${directory}/README.md`);
  if (!readme || readme.toString('utf8').trim() === '') say('README.md is missing or empty');
  for (const [name, data] of [['README.md', readme], ['MANIFEST.json', manifestBytes]]) {
    if (data?.toString('utf8').includes('\u2014')) say(`${name} contains an em dash`);
  }
  for (const lost of manifest.lostInputs ?? []) {
    if (typeof lost.path !== 'string' || !Number.isSafeInteger(lost.bytes) || !SHA256.test(lost.sha256 ?? '')) {
      say(`MANIFEST.json lostInputs entry ${JSON.stringify(lost.path)} needs path, bytes and sha256`);
    }
  }
  if (!SHA256.test(manifest.rawInputArchive?.sha256 ?? '')) say('MANIFEST.json rawInputArchive needs the archive sha256');
  if (report) {
    const preserved = new Map(tools.map((tool) => [tool.originalPath, tool]));
    for (const artifact of report.artifacts ?? []) {
      if (typeof artifact.localPath !== 'string' || !artifact.localPath.endsWith('.py')) continue;
      const tool = preserved.get(artifact.localPath);
      if (!tool || tool.sha256 !== artifact.sha256) say(`the report records ${artifact.localPath} but it is not preserved here`);
    }
  }
  return problems;
}

/** The parsed version 2 historical-tools manifests, by directory. */
export function readDeclarations(root, reports = REPORTS) {
  const declarations = [];
  for (const entry of reports) {
    if (!entry.historicalTools) continue;
    const manifest = parseQuietly(readOptional(root, `${entry.historicalTools}/MANIFEST.json`));
    if (manifest?.version === 2) declarations.push({ directory: entry.historicalTools, manifest });
  }
  return declarations;
}

/** Placeholders in evidence files that no version 2 manifest declares. */
export function checkDeclarations(root, reports = REPORTS, files = listRepositoryFiles(root)) {
  const declarations = readDeclarations(root, reports);
  const evidence = files.filter((path) => EVIDENCE_DIRECTORIES.some((directory) => path.startsWith(`${directory}/`)));
  // A version 2 manifest declares the placeholders in its own text, and its README describes them.
  const manifests = new Set(declarations.flatMap(({ directory }) => [`${directory}/MANIFEST.json`, `${directory}/README.md`]));
  return undeclaredPlaceholders(root, evidence, declaredFiles(declarations), manifests);
}

/** Registry against the files: no unregistered report or historical-tools entry. */
export function checkRegistry(root, reports = REPORTS, files = listRepositoryFiles(root)) {
  const problems = [];
  const registered = new Set(reports.map((entry) => entry.path));
  const tools = new Set(reports.map((entry) => entry.historicalTools).filter(Boolean));
  for (const directory of EVIDENCE_DIRECTORIES) {
    for (const name of childrenOf(files, directory).names) {
      const path = `${directory}/${name}`;
      if (name.endsWith('.json') && !registered.has(path)) problems.push(`${path}: evidence JSON is not registered in tests/evidence/check.mjs`);
    }
    const historical = childrenOf(files, `${directory}/${HISTORICAL}`);
    for (const name of [...historical.names, ...historical.directories]) {
      const path = `${directory}/${HISTORICAL}/${name}`;
      if (!tools.has(path)) problems.push(`${path}: historical-tools entry belongs to no registered report`);
    }
  }
  return problems;
}

/**
 * Files the execution guard reads: every file Git tracks or would add,
 * falling back to a walk when the root is not a Git work tree.
 */
export function listRepositoryFiles(root) {
  try {
    return execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      cwd: root,
      maxBuffer: 1 << 28,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString('utf8')
      .split('\0')
      .filter(Boolean);
  } catch {
    const found = [];
    const skip = new Set(['.git', 'node_modules', 'dist', '.nx', 'coverage']);
    const walk = (dir) => {
      for (const item of readdirSync(join(root, dir), { withFileTypes: true })) {
        if (skip.has(item.name)) continue;
        const rel = dir ? `${dir}/${item.name}` : item.name;
        if (item.isDirectory()) walk(rel);
        else if (item.isFile()) found.push(rel);
      }
    };
    walk('');
    return found;
  }
}

const CODE_FILE = /\.(?:mjs|cjs|js|jsx|mts|cts|ts|tsx|sh)$/;
const WORKFLOW_FILE = /^\.github\/workflows\/[^/]+\.ya?ml$/;
const SPAWNERS = 'spawn|spawnSync|exec|execSync|execFile|execFileSync|fork|execa|execaSync';
/** A bare call; `(?<![\w$.])` keeps `RegExp#exec` and other methods out. */
const BARE_SPAWN = new RegExp(`(?<![\\w$.])(${SPAWNERS})\\s*\\(\\s*([^,)]*)`, 'g');
/** Any call, bare or as a method, whose command literal is Python. */
const PYTHON_SPAWN = new RegExp(`\\b(?:${SPAWNERS})\\s*\\(\\s*['"\`]\\s*(?:\\S*\\/)?python`);
const PYTHON_COMMAND = /(?:^|[\s;&|(`'"])(?:\S*\/)?python[0-9.]*(?=$|[\s;&|)`'"])/m;
const OWN_DIRECTORY = 'tests/evidence/';

/** Problems with one package.json: a script that runs Python or a historical tool. */
export function guardPackageScripts(path, text) {
  let scripts;
  try {
    scripts = JSON.parse(text).scripts ?? {};
  } catch {
    return [];
  }
  const problems = [];
  for (const [name, command] of Object.entries(scripts)) {
    if (typeof command !== 'string') continue;
    if (command.includes(HISTORICAL)) problems.push(`${path}: script "${name}" references historical-tools`);
    if (PYTHON_COMMAND.test(command) || /\.py\b/.test(command)) problems.push(`${path}: script "${name}" runs Python`);
  }
  return problems;
}

/** Problems with one workflow: Python set up or run, or a historical tool named. */
export function guardWorkflow(path, text) {
  const problems = [];
  if (text.includes(HISTORICAL)) problems.push(`${path}: references historical-tools`);
  if (/setup-python/.test(text)) problems.push(`${path}: sets up Python`);
  if (PYTHON_COMMAND.test(text)) problems.push(`${path}: runs Python`);
  return problems;
}

/**
 * Problems with one code file. Outside this tool nothing may name the
 * historical tools; nothing anywhere may spawn Python; and this tool's own
 * modules may spawn only `git`, through unaliased imports.
 */
export function guardCode(path, text) {
  const problems = [];
  const own = path.startsWith(OWN_DIRECTORY);
  if (!own && text.includes(HISTORICAL)) problems.push(`${path}: references historical-tools`);
  if (PYTHON_SPAWN.test(text)) problems.push(`${path}: spawns Python`);
  if (own) {
    for (const match of text.matchAll(BARE_SPAWN)) {
      const argument = match[2].trim();
      if (argument !== "'git'") problems.push(`${path}: ${match[1]}(${argument}) spawns something other than git`);
    }
  }
  if (path.endsWith('.sh') && PYTHON_COMMAND.test(text)) problems.push(`${path}: runs Python`);
  if (own) {
    for (const match of text.matchAll(/import\s*([^;]*?)\s*from\s*['"](?:node:)?child_process['"]/g)) {
      if (!/^\{[^}]*\}$/.test(match[1]) || /\bas\b/.test(match[1])) {
        problems.push(`${path}: imports child_process other than by plain named imports`);
      }
    }
    if (/\bimport\s*\(/.test(text) || /\brequire\s*\(/.test(text)) problems.push(`${path}: loads modules dynamically`);
  }
  return problems;
}

/** The execution guard over every package script, workflow and code file. */
export function checkExecutionGuard(root, files = listRepositoryFiles(root)) {
  const problems = [];
  for (const path of files) {
    const isPackage = path === 'package.json' || path.endsWith('/package.json');
    const isWorkflow = WORKFLOW_FILE.test(path);
    const isCode = CODE_FILE.test(path);
    if (!isPackage && !isWorkflow && !isCode) continue;
    const full = join(root, path);
    if (!existsSync(full) || !lstatSync(full).isFile()) continue;
    const text = readFileSync(full, 'utf8');
    if (isPackage) problems.push(...guardPackageScripts(path, text));
    if (isWorkflow) problems.push(...guardWorkflow(path, text));
    if (isCode) problems.push(...guardCode(path, text));
  }
  return problems;
}

/**
 * The gate's own test files. `node --test` passes on a glob that matches
 * nothing, so their presence is checked here, where a missing file fails.
 */
export const TEST_FILES = ['check', 'cli', 'inventory', 'json', 'playwright', 'redaction', 'replay', 'units'].map(
  (name) => `tests/evidence/${name}.test.mjs`
);

/** Every check of the gate. */
export function check(root = repoRoot, { reports = REPORTS, files, testFiles = TEST_FILES } = {}) {
  const listed = files ?? listRepositoryFiles(root);
  const problems = [...checkRegistry(root, reports, listed), ...checkDeclarations(root, reports, listed)];
  const allDeclared = declaredFiles(readDeclarations(root, reports));
  for (const path of testFiles) {
    if (!existsSync(join(root, path))) problems.push(`${path}: evidence test file is missing, so node --test would pass without it`);
  }
  for (const entry of reports) {
    problems.push(...checkReport(root, entry));
    if (entry.historicalTools) problems.push(...checkHistoricalTools(root, entry, listed, allDeclared));
  }
  problems.push(...checkExecutionGuard(root, listed));
  return problems;
}

/** CLI entry: print the result and set the exit code. */
export function runCheck(root = repoRoot, { log = console.log, error = console.error } = {}) {
  const problems = check(root);
  if (problems.length > 0) {
    error('[evidence] FAILED:');
    for (const problem of problems) error(`  - ${problem}`);
    return 1;
  }
  const tools = REPORTS.filter((entry) => entry.historicalTools).length;
  log(`[evidence] OK: ${REPORTS.length} evidence reports and ${tools} historical-tools directories verified; nothing executes them`);
  return 0;
}
