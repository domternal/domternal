#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { cpus, platform, arch, release, totalmem, tmpdir, loadavg } from 'node:os';
import { readFile, writeFile, appendFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { FIXTURES } from './fixtures.mjs';
import { PROTOCOL, SMOKE, statistics, summarize } from './sampler.mjs';
import { D4_TARGET_WORDS, generateLarge, LARGE_PROFILES, LARGE_PROTOCOL, LARGE_SMOKE } from './large.mjs';
import { loadNormalizer, sweepAll } from './limits.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const require = createRequire(join(root, 'package.json'));
const { values } = parseArgs({ options: {
  out: { type: 'string' }, smoke: { type: 'boolean' }, headed: { type: 'boolean' }, browser: { type: 'string' }, 'reference-id': { type: 'string' },
  large: { type: 'boolean' }, 'image-assets': { type: 'boolean' },
} });
assert.ok([22, 24].includes(Number(process.versions.node.split('.')[0])), 'This protocol records supported Node 22 or 24 runs');
const browsers = values.browser ? [values.browser] : PROTOCOL.browsers;
assert.ok(browsers.every(name => PROTOCOL.browsers.includes(name)), 'Unknown browser');
assert.ok(values.smoke || browsers.length === 3, 'Partial browser runs require --smoke');
assert.ok(values.smoke || /^[a-z0-9][a-z0-9._-]{0,63}$/u.test(values['reference-id'] ?? ''), 'A full run requires --reference-id with a nonpersonal machine label');
assert.ok(!values.large || !values['image-assets'], 'The imageAssets variant belongs to the paired protocol');
const protocol = values.large ? { ...LARGE_PROTOCOL, ...(values.smoke ? LARGE_SMOKE : {}) }
  : { ...PROTOCOL, ...(values.smoke ? SMOKE : {}), imageAssets: values['image-assets'] === true };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const packageRequire = createRequire(join(root, 'packages/core/package.json'));
const toolRequire = createRequire(packageRequire.resolve('tsup'));
const { build } = toolRequire('esbuild');
const playwright = require('@playwright/test');
const output = values.out ? resolve(values.out) : await mkdtemp(join(tmpdir(), 'domternal-paste-performance-'));
if (values.out) await mkdir(output, { recursive: false });
const rawPath = join(output, 'samples.jsonl');
await writeFile(rawPath, '', { flag: 'wx' });
let scratch;
let bundleWork;
const abort = new AbortController();
const cancel = () => abort.abort(new Error('Operator cancelled the measurement'));
process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
let server;
let browserServer;
let browser;
let context;
let completed = 0;
let active;
const started = Date.now();
let expected = values.large ? 0 : browsers.length * FIXTURES.length * protocol.formatting.length * protocol.rounds * (1 + protocol.warmupBlocks + protocol.measuredBlocks);
const report = {
  kind: values.large ? 'domternal-paste-large' : 'domternal-paste-performance', protocol: protocol.id, mode: values.smoke ? 'smoke-nonqualifying' : 'reference-machine',
  performanceClaim: false, nativeClipboardCaptured: false, sourceFixtures: 'synthetic',
  referenceId: values['reference-id'] ?? null, configuration: protocol, browsers: [], cases: [], failures: [], cleanupFailures: [],
  startedAt: new Date(started).toISOString(), headless: !values.headed,
  timing: values.large ? {
    primary: 'syncMs of each measured single synthetic paste through Cleanup in a fresh editor',
    secondary: 'settledMs: dispatch through one fixed microtask continuation, including receipt and default feedback DOM updates',
    firstPaste: 'the first dispatch of each case is recorded separately and excluded from the measured statistics',
    baseline: 'none; large cases have no paired disabled route',
    separation: 'one animation frame opportunity outside timing before every operation',
    excludes: 'OS clipboard, editor construction and destruction, validation, getJSON, hashing, startup, next paint',
  } : { primary: 'individual ABBA on-raw minus off-raw synchronous dispatch latency (syncMs)',
    control: 'individual ACCA on-raw minus off-normalized synchronous dispatch latency (syncMs)',
    secondary: 'both comparisons repeated for settledMs: dispatch through one fixed microtask continuation',
    includes: 'syncMs includes dispatch only; settledMs additionally includes receipt and default feedback DOM updates',
    theme: 'existing public domternal-theme.css, with layout or paint excluded unless dispatch itself forces them',
    separation: 'one animation frame opportunity outside timing before every operation',
    excludes: 'OS clipboard, editor construction/reset, validation, hashing, startup, next paint, asynchronous assets' },
  machine: { os: platform(), release: release(), arch: arch(), cpu: cpus()[0]?.model ?? 'unknown',
    logicalCPUs: cpus().length, totalMemoryBytes: totalmem(), initialLoadAverage: loadavg(), node: process.version,
    playwright: require('@playwright/test/package.json').version },
  repository: undefined,
  fixtures: values.large ? LARGE_PROFILES.map(profile => ({ id: profile, unit: generateLarge(profile, 1).unit,
    wordsPerUnit: generateLarge(profile, 1).words, sha256At100: sha256(generateLarge(profile, 100).html) }))
    : FIXTURES.map(fixture => ({ id: fixture.id, utf8Bytes: fixture.utf8Bytes, utf16Units: fixture.utf16Units,
      groups: fixture.groups, sha256: sha256(fixture.html), expected: fixture.expected })),
  sourceHashes: {}, bundleSha256: null, rawSamples: 'samples.jsonl',
};

async function log(value) {
  const line = JSON.stringify(value);
  if (Buffer.byteLength(line) > 65_536) throw new Error('Artifact row limit exceeded');
  await appendFile(rawPath, `${line}\n`);
}
function checked(promise, timeoutMs = protocol.blockTimeoutMs) {
  return new Promise((accept, reject) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer); abort.signal.removeEventListener('abort', onAbort);
      if (error) reject(error); else accept(value);
    };
    const onAbort = () => finish(abort.signal.reason);
    const timer = setTimeout(() => finish(new Error('Measurement stage deadline exceeded')), timeoutMs);
    abort.signal.addEventListener('abort', onAbort, { once: true });
    promise.then(value => finish(undefined, value), error => finish(error));
    if (abort.signal.aborted) onAbort();
  });
}
async function cleanup(name, action, timeoutMs = 10_000) {
  let timer;
  try {
    await Promise.race([Promise.resolve().then(action), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Cleanup deadline exceeded')), timeoutMs);
    })]);
  } catch (error) { report.cleanupFailures.push({ stage: name, message: String(error?.message ?? error).slice(0, 512) }); }
  finally { clearTimeout(timer); }
}
const pendingAcquisitions = new Set();
async function acquire(name, promise, dispose) {
  try { return await checked(promise); }
  catch (error) {
    // Acquisition may finish after cancellation. Its result still has an owner.
    const release = promise.then(value => cleanup(`abandoned-${name}`, () => dispose(value)), () => undefined);
    pendingAcquisitions.add(release);
    void release.then(() => pendingAcquisitions.delete(release), () => pendingAcquisitions.delete(release));
    throw error;
  }
}
async function disposeBrowserServer(owned) {
  await cleanup('browser-server', () => owned.close());
  if (owned.process().exitCode === null) await cleanup('browser-process', () => owned.kill());
}
async function closeBrowser() {
  if (context) { const owned = context; context = undefined; await cleanup('context', () => owned.close()); }
  if (browser) { const owned = browser; browser = undefined; await cleanup('browser-connection', () => owned.close()); }
  if (browserServer) {
    const owned = browserServer; browserServer = undefined;
    await disposeBrowserServer(owned);
  }
}

/** Run the Node limit sweep, then pick the sizes the browsers measure for each profile and policy. */
function selectLargeCases() {
  active = { stage: 'limit-sweep' };
  const tools = loadNormalizer();
  report.limits = tools.limits;
  report.d4TargetWords = D4_TARGET_WORDS;
  report.sweep = sweepAll(tools, result => {
    console.log(JSON.stringify({ sweep: result.profile, formatting: result.formatting, maxAccepted: result.maxAccepted.size,
      firstRejected: result.firstRejected.size, bound: result.firstRejected.bound }));
  });
  const cases = [];
  for (const result of report.sweep) {
    const picks = [['max-accepted', result.maxAccepted], ['first-rejected', result.firstRejected]];
    if (result.d4Target.status !== undefined) picks.unshift(['d4-target', result.d4Target]);
    for (const [label, record] of picks) {
      if (record.status === 'cleaned' && record.tokensVerified !== true) throw new Error('The sweep accepted output without every authored token');
      cases.push({ profile: result.profile, formatting: result.formatting, label, size: record.size, words: record.words,
        expected: record.status === 'cleaned' ? { status: 'cleaned' } : { status: 'rejected', code: record.code } });
    }
  }
  const rtf = protocol.rtfFlavor;
  // PasteCleanup never reads RTF, so a flavor past the ceiling leaves the accepted HTML as it is.
  cases.push({ profile: rtf.profile, formatting: rtf.formatting, label: 'rtf-flavor-unread', size: rtf.size,
    words: generateLarge(rtf.profile, rtf.size).words, rtfUnits: rtf.units, expected: { status: 'cleaned' } });
  return cases;
}

async function measureLarge(name, origin, resources, cases) {
  for (const entry of cases) {
    const caseReport = { browser: name, ...entry, complete: false };
    report.cases.push(caseReport);
    active = { browser: name, profile: entry.profile, formatting: entry.formatting, label: entry.label, size: entry.size, stage: 'prepare' };
    const measured = [];
    try {
      context = await acquire('context', browser.newContext({ viewport: protocol.viewport, deviceScaleFactor: protocol.deviceScaleFactor, locale: 'en-US', timezoneId: 'UTC', serviceWorkers: 'block' }), value => value.close());
      const violations = [];
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin === origin && resources.has(url.pathname) && url.search === '') return route.continue();
        violations.push('Unexpected resource request'); return route.abort();
      });
      const page = await context.newPage();
      page.on('pageerror', () => violations.push('Browser page error'));
      await checked(page.goto(origin));
      await checked(page.waitForFunction(() => window.__pastePerformance?.ready === true));
      const preparation = await checked(page.evaluate(({ profile, size, formatting, expected, rtfUnits }) =>
        window.__pastePerformance.prepareLarge(profile, size, formatting, expected, rtfUnits), entry));
      const source = generateLarge(entry.profile, entry.size);
      if (preparation.htmlSha256 !== sha256(source.html) || preparation.utf16Units !== source.utf16Units) throw new Error('The page generated a different large fixture');
      caseReport.preparation = { htmlSha256: preparation.htmlSha256, utf16Units: preparation.utf16Units, utf8Bytes: source.utf8Bytes,
        tokens: preparation.tokens, environment: preparation.environment };
      for (let index = 0; index <= protocol.measuredDispatches; index++) {
        active = { ...active, stage: index === 0 ? 'first-paste' : 'measured', index };
        const sample = await checked(page.evaluate(index => window.__pastePerformance.single(index), index));
        if (violations.length) throw new Error(violations[0]);
        await log({ ...active, sample });
        if (index === 0) caseReport.firstPaste = sample;
        else measured.push(sample);
        completed++;
      }
      const last = measured.at(-1);
      caseReport.summary = { syncMs: statistics(measured.map(sample => sample.syncMs)), settledMs: statistics(measured.map(sample => sample.settledMs)) };
      caseReport.outcome = { status: last.status, noticeVisible: last.noticeVisible, severities: last.severities,
        diagnostics: last.diagnostics, semantic: last.semantic };
      caseReport.complete = measured.length === protocol.measuredDispatches;
    } catch (error) {
      const failure = { ...active, message: String(error?.message ?? error).slice(0, 1024) };
      report.failures.push(failure); console.error(JSON.stringify({ failure })); await log({ failure });
      if (abort.signal.aborted) throw error;
    } finally {
      if (context) { const owned = context; context = undefined; await cleanup('context', () => owned.close()); }
    }
  }
  await closeBrowser();
}

const monitor = setInterval(() => {
  const progress = { progress: true, active, completed, expected, failed: report.failures.length, elapsedSeconds: Math.round((Date.now() - started) / 1000) };
  console.log(JSON.stringify(progress));
}, 120_000);
const deadline = setTimeout(() => abort.abort(new Error('Overall measurement deadline exceeded')), protocol.runTimeoutMs);
try {
  scratch = await mkdtemp(join(tmpdir(), 'domternal-paste-performance-bundle-'));
  report.repository = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    dirty: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).length > 0,
    lockSha256: sha256(await readFile(join(root, 'pnpm-lock.yaml'))) };
  const alias = {};
  for (const name of ['core', 'vanilla', 'extension-table', 'extension-block-controls', 'extension-image', 'extension-paste-cleanup', 'pm']) {
    const directory = join(root, 'packages', name);
    const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
    for (const [subpath, value] of Object.entries(manifest.exports)) {
      const target = value.import?.default;
      if (target) alias[manifest.name + (subpath === '.' ? '' : subpath.slice(1))] = join(directory, target);
    }
  }
  const pmRequire = createRequire(join(root, 'packages/pm/package.json'));
  const pmManifest = JSON.parse(await readFile(join(root, 'packages/pm/package.json'), 'utf8'));
  for (const name of Object.keys(pmManifest.dependencies)) alias[name] = join(dirname(pmRequire.resolve(name)), 'index.js');
  const captured = new Map();
  const bundlePath = join(scratch, 'entry.js');
  bundleWork = build({ absWorkingDir: root, entryPoints: [join(here, 'entry.mjs')], outfile: bundlePath, bundle: true,
    format: 'esm', platform: 'browser', target: 'es2022', sourcemap: false, metafile: true, alias, logLevel: 'silent',
    plugins: [{ name: 'capture-actual-inputs', setup(builder) {
      builder.onLoad({ filter: /\.(?:mjs|cjs|js|json)$/ }, async ({ path }) => {
        const bytes = await readFile(path);
        captured.set(path, sha256(bytes));
        return { contents: bytes.toString('utf8'), loader: path.endsWith('.json') ? 'json' : 'js' };
      });
    } }],
  });
  const bundle = await checked(bundleWork, 60_000);
  for (const path of Object.keys(bundle.metafile.inputs)) assert.ok(captured.has(resolve(root, path)), 'An esbuild input escaped the source hash inventory');
  const source = await readFile(bundlePath);
  assert.ok(source.length <= 16 * 1024 * 1024, 'Fixture bundle exceeds the harness envelope');
  report.bundleSha256 = sha256(source);
  report.sourceHashes = Object.fromEntries([...captured].map(([path, hash]) => [relative(root, path), hash]).sort(([left], [right]) => left.localeCompare(right)));
  for (const file of ['runner.mjs', 'README.md', 'fixtures.test.mjs', 'sampler.test.mjs', 'limits.mjs', 'large.test.mjs']) report.sourceHashes[relative(root, join(here, file))] = sha256(await readFile(join(here, file)));
  if (values.large) {
    // The Node sweep reads the CommonJS build of the same /html entry the browser bundle uses.
    const sweepEntry = join(root, 'packages/extension-paste-cleanup/dist/html/index.cjs');
    report.sourceHashes[relative(root, sweepEntry)] = sha256(await readFile(sweepEntry));
  }
  await writeFile(join(output, 'fixture.bundle.js'), source, { flag: 'wx' });
  await writeFile(join(output, 'bundle-metafile.json'), `${JSON.stringify(bundle.metafile, null, 2)}\n`, { flag: 'wx' });
  const themePath = join(root, 'packages/theme/dist/domternal-theme.css');
  const theme = await readFile(themePath);
  assert.ok(theme.length > 0 && theme.length <= 2 * 1024 * 1024, 'Theme exceeds the harness envelope');
  report.sourceHashes[relative(root, themePath)] = sha256(theme);
  await writeFile(join(output, 'domternal-theme.css'), theme, { flag: 'wx' });
  const html = '<!doctype html><html lang="en"><meta charset="utf-8"><title>Local paste performance fixture</title>'
    + '<link rel="stylesheet" href="/domternal-theme.css"><style>body{margin:24px}#editor{width:960px}.ProseMirror{min-height:120px}</style>'
    + '<div id="editor"></div><script type="module" src="/entry.js"></script></html>';
  report.htmlSha256 = sha256(html);
  await writeFile(join(output, 'fixture.html'), html, { flag: 'wx' });
  const resources = new Map([['/', ['text/html', Buffer.from(html)]], ['/entry.js', ['text/javascript', source]],
    ['/domternal-theme.css', ['text/css', theme]], ['/favicon.ico', ['image/x-icon', Buffer.alloc(0)]]]);
  server = createServer((request, response) => {
    const resource = resources.get(request.url);
    if (request.method !== 'GET' || !resource) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'Content-Type': resource[0], 'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src data:; base-uri 'none'" });
    response.end(resource[1]);
  });
  await checked(new Promise((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept); }));
  const origin = `http://127.0.0.1:${String(server.address().port)}`;
  const largeCases = values.large ? selectLargeCases() : [];
  if (values.large) expected = browsers.length * largeCases.length * (1 + protocol.measuredDispatches);
  for (const name of browsers) {
    active = { browser: name, stage: 'launch' };
    browserServer = await acquire('browser-server', playwright[name].launchServer({ headless: !values.headed, timeout: 30_000 }), disposeBrowserServer);
    browser = await acquire('browser-connection', playwright[name].connect(browserServer.wsEndpoint(), { timeout: 30_000 }), value => value.close());
    report.browsers.push({ name, version: browser.version() });
    if (values.large) { await measureLarge(name, origin, resources, largeCases); continue; }
    for (const fixture of FIXTURES) for (const formatting of protocol.formatting) {
      const measured = [];
      const caseReport = { browser: name, fixture: fixture.id, formatting, rounds: [], complete: false };
      report.cases.push(caseReport);
      for (let round = 0; round < protocol.rounds; round++) {
        active = { browser: name, fixture: fixture.id, formatting, round, stage: 'prepare' };
        try {
          context = await acquire('context', browser.newContext({ viewport: protocol.viewport, deviceScaleFactor: protocol.deviceScaleFactor, locale: 'en-US', timezoneId: 'UTC', serviceWorkers: 'block' }), value => value.close());
          const violations = [];
          await context.route('**/*', route => {
            const url = new URL(route.request().url());
            if (url.origin === origin && resources.has(url.pathname) && url.search === '') return route.continue();
            violations.push('Unexpected resource request'); return route.abort();
          });
          const page = await context.newPage();
          page.on('pageerror', () => violations.push('Browser page error'));
          await checked(page.goto(origin));
          await checked(page.waitForFunction(() => window.__pastePerformance?.ready === true));
          const preparation = await checked(page.evaluate(({ id, formatting, imageAssets }) => window.__pastePerformance.prepare(id, formatting, imageAssets),
            { id: fixture.id, formatting, imageAssets: protocol.imageAssets }));
          caseReport.rounds.push({ round, preparation });
          for (const phase of ['first-paste', 'warmup', 'measured']) {
            const count = phase === 'first-paste' ? 1 : phase === 'warmup' ? protocol.warmupBlocks : protocol.measuredBlocks;
            for (let index = 0; index < count; index++) {
              active = { browser: name, fixture: fixture.id, formatting, round, phase, index };
              const block = await checked(page.evaluate(index => window.__pastePerformance.block(index), index));
              if (violations.length) throw new Error(violations[0]);
              await log({ ...active, block });
              if (phase === 'measured') measured.push(block);
              completed++;
            }
          }
        } catch (error) {
          const failure = { ...active, message: String(error?.message ?? error).slice(0, 1024) };
          report.failures.push(failure); console.error(JSON.stringify({ failure })); await log({ failure });
          if (abort.signal.aborted) throw error;
        } finally {
          if (context) { const owned = context; context = undefined; await cleanup('context', () => owned.close()); }
        }
      }
      caseReport.complete = measured.length === protocol.rounds * protocol.measuredBlocks;
      if (measured.length) {
        caseReport.summary = summarize(measured);
        caseReport.observedPairedP95Under50ms = caseReport.summary.raw.syncMs.pairedOverheadMs.p95 < 50;
      }
    }
    await closeBrowser();
  }
  for (const [path, hash] of Object.entries(report.sourceHashes)) assert.equal(sha256(await readFile(join(root, path))), hash, 'A measured source changed during the run');
} catch (error) {
  const failure = { ...active, message: String(error?.message ?? error).slice(0, 1024) };
  report.failures.push(failure); console.error(JSON.stringify({ failure }));
} finally {
  clearInterval(monitor); clearTimeout(deadline);
  await closeBrowser();
  await cleanup('pending-acquisitions', () => Promise.allSettled([...pendingAcquisitions]), 40_000);
  if (server) await cleanup('loopback-server', () => { server.closeAllConnections(); return new Promise((accept, reject) => server.close(error => error ? reject(error) : accept())); });
  if (bundleWork) await cleanup('bundler-settlement', () => bundleWork.catch(() => undefined), 60_000);
  if (scratch) await cleanup('scratch-bundle', () => rm(scratch, { recursive: true, force: true }));
  process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel);
  report.completed = completed; report.expected = expected; report.elapsedSeconds = (Date.now() - started) / 1000;
  report.complete = completed === expected && report.failures.length === 0 && report.cleanupFailures.length === 0;
  const json = JSON.stringify(report, null, 2);
  assert.ok(Buffer.byteLength(json) <= 64 * 1024 * 1024, 'Final report exceeds the harness envelope');
  await writeFile(join(output, 'report.json'), `${json}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ complete: report.complete, mode: report.mode, completed, expected, output }));
  if (!report.complete) process.exitCode = 1;
}
