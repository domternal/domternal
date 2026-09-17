#!/usr/bin/env node
/**
 * Content performance comparison against the published 1.2.0. Bundles page.mjs once with the
 * registry packages of tests/mixed-version/v1.2.0 and once with this checkout's built packages,
 * both against the workspace's ProseMirror, linkifyjs and floating-ui, so the comparison isolates
 * Domternal's own code. Each round loads every variant once in a fresh context, in an order that
 * rotates and reverses by round, so drift in machine load spreads over the variants.
 *
 *   node e2e/content-performance/runner.mjs --out <new dir> [--rounds 6] [--browsers chromium,firefox,webkit]
 *     [--current <label>] [--bundle <label>=<bundle.js of an earlier output>] [--documents a,b]
 *   node e2e/content-performance/runner.mjs --out <new dir> --equivalence <label>,<label> [--bundle ...] [--seeds 8] [--count 250]
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { cpus, loadavg, platform, release, totalmem } from 'node:os';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { earlierBundle } from './provenance.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const { values } = parseArgs({ options: {
  out: { type: 'string' }, rounds: { type: 'string', default: '6' }, browsers: { type: 'string', default: 'chromium,firefox,webkit' },
  current: { type: 'string', default: 'current' }, bundle: { type: 'string', multiple: true, default: [] }, documents: { type: 'string' },
  equivalence: { type: 'string' }, seeds: { type: 'string', default: '8' }, count: { type: 'string', default: '250' },
  batches: { type: 'string', default: '9' }, 'min-batch-ms': { type: 'string', default: '25' },
} });
assert.ok(values.out, 'An output directory is required');
const out = resolve(values.out);
mkdirSync(out, { recursive: false });
const rootRequire = createRequire(join(root, 'package.json'));
const coreRequire = createRequire(join(root, 'packages/core/package.json'));
const { build } = createRequire(coreRequire.resolve('tsup'))('esbuild');
const playwright = rootRequire('@playwright/test');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const published = join(root, 'tests/mixed-version/v1.2.0/node_modules/@domternal');
const BASELINE = 'v1.2.0';

/** The aliases every variant shares: the workspace's ProseMirror through @domternal/pm, linkifyjs and floating-ui. */
function sharedAlias() {
  const alias = {};
  const pmDirectory = join(root, 'packages/pm');
  const pm = JSON.parse(readFileSync(join(pmDirectory, 'package.json'), 'utf8'));
  for (const [subpath, value] of Object.entries(pm.exports)) if (value.import?.default) alias[`@domternal/pm${subpath.slice(1)}`] = join(pmDirectory, value.import.default);
  const pmRequire = createRequire(join(pmDirectory, 'package.json'));
  for (const name of Object.keys(pm.dependencies)) alias[name] = join(dirname(pmRequire.resolve(name)), 'index.js');
  alias.linkifyjs = coreRequire.resolve('linkifyjs').replace(/\.cjs$/, '.mjs');
  alias['@floating-ui/dom'] = join(dirname(coreRequire.resolve('@floating-ui/dom')), 'floating-ui.dom.mjs');
  return alias;
}

async function bundle(label, packagesDirectory) {
  const alias = sharedAlias();
  for (const name of ['core', 'extension-image', 'extension-table']) alias[`@domternal/${name}`] = join(packagesDirectory, name, 'dist/index.js');
  if (label !== BASELINE) alias['@domternal/core/clipboard'] = join(packagesDirectory, 'core/dist/clipboard.js');
  const outfile = join(out, `${label}.js`);
  const result = await build({ entryPoints: [join(here, 'page.mjs')], outfile, bundle: true, format: 'esm', platform: 'browser',
    target: 'es2022', sourcemap: false, metafile: true, alias, logLevel: 'error' });
  return { label, sha256: sha256(readFileSync(outfile)), inputs: Object.keys(result.metafile.inputs).filter(path => /@domternal|packages\//.test(path)).map(path => relative(root, resolve(root, path))) };
}

const variants = [];
if (!values.equivalence || values.equivalence.split(',').includes(BASELINE)) {
  const version = JSON.parse(readFileSync(join(published, 'core/package.json'), 'utf8')).version;
  assert.equal(version, '1.2.0', 'Install the published packages first: pnpm --dir tests/mixed-version/v1.2.0 install --frozen-lockfile --ignore-workspace');
  variants.push(await bundle(BASELINE, published));
}
variants.push({ ...(await bundle(values.current, join(root, 'packages'))),
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  dirty: execFileSync('git', ['status', '--porcelain', '--', 'packages'], { cwd: root, encoding: 'utf8' }).length > 0 });
for (const entry of values.bundle) {
  const [label, path] = entry.split('=');
  assert.ok(label && path && label !== BASELINE && label !== values.current, `Invalid bundle ${entry}`);
  const bytes = readFileSync(resolve(path));
  writeFileSync(join(out, `${label}.js`), bytes);
  // The commit, inputs and tree state the earlier output recorded for it, never a local path.
  variants.push({ label, ...earlierBundle(resolve(path), sha256(bytes)) });
}
// Listed before measuring, so a later run can name these bundles even if this one stops early.
writeFileSync(join(out, 'variants.json'), `${JSON.stringify(variants, null, 2)}\n`);
for (const { label } of variants) writeFileSync(join(out, `${label}.html`), `<!doctype html><meta charset="utf-8"><title>${label}</title><div id="editor"></div><script type="module" src="/${label}.js"></script>`);

const server = createServer((request, response) => {
  const path = join(out, new URL(request.url, 'http://local').pathname);
  if (!/\.(?:html|js)$/.test(path) || !existsSync(path)) { response.writeHead(404).end(); return; }
  response.writeHead(200, { 'content-type': path.endsWith('.js') ? 'text/javascript' : 'text/html', 'cache-control': 'no-store' });
  response.end(readFileSync(path));
});
await new Promise(accept => { server.listen(0, '127.0.0.1', accept); });
const origin = `http://127.0.0.1:${String(server.address().port)}`;
const report = { kind: values.equivalence ? 'domternal-content-equivalence' : 'domternal-content-performance', startedAt: new Date().toISOString(),
  machine: { os: platform(), release: release(), cpu: cpus()[0]?.model, logicalCPUs: cpus().length, totalMemoryBytes: totalmem(),
    node: process.version, playwright: rootRequire('@playwright/test/package.json').version, initialLoadAverage: loadavg() },
  variants, browsers: {}, pages: [] };

async function open(browser, label) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, locale: 'en-US', timezoneId: 'UTC' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(`${origin}/${label}.html`);
  await page.waitForFunction(() => window.contentPerformance !== undefined);
  return { context, page, errors };
}

const documents = values.documents?.split(',') ?? ['article-s', 'article-m', 'article-l', 'outline-m', 'outline-l', 'headings-only', 'styled-m', 'styled-l'];
let different = false;
try {
  for (const name of values.browsers.split(',')) {
    const browser = await playwright[name].launch({ headless: true });
    report.browsers[name] = browser.version();
    if (values.equivalence) {
      const [a, b] = values.equivalence.split(',');
      for (let seed = 1; seed <= Number(values.seeds); seed++) {
        const rows = {};
        for (const label of [a, b]) {
          const { context, page, errors } = await open(browser, label);
          rows[label] = await page.evaluate(args => window.contentPerformance.equivalence(args), { seed, count: Number(values.count) });
          assert.deepEqual(errors, [], `${label} page error`);
          await context.close();
        }
        const differing = rows[a].flatMap((row, index) => (row === rows[b][index] ? [] : [index]));
        if (differing.length > 0) different = true;
        const entry = { browser: name, seed, documents: rows[a].length, differing,
          withDiagnostics: rows[a].filter(row => row.includes('"code"')).length, withAThrow: rows[a].filter(row => row.includes('threw ')).length };
        report.pages.push(entry);
        console.log(JSON.stringify(entry));
      }
    } else {
      const labels = variants.map(variant => variant.label);
      for (let round = 0; round < Number(values.rounds); round++) {
        const order = labels.map((_, i) => labels[(i + round) % labels.length]);
        if (round % 2 === 1) order.reverse();
        for (const label of order) {
          const { context, page, errors } = await open(browser, label);
          const loadBefore = loadavg();
          const started = Date.now();
          const results = await page.evaluate(args => window.contentPerformance.measure(args),
            { documents, batches: Number(values.batches), minBatchMs: Number(values['min-batch-ms']) });
          assert.deepEqual(errors, [], `${label} page error`);
          report.pages.push({ browser: name, round, label, loadBefore, loadAfter: loadavg(), seconds: (Date.now() - started) / 1000, results });
          console.log(JSON.stringify({ browser: name, round, label, seconds: (Date.now() - started) / 1000, load: loadavg()[0] }));
          await context.close();
        }
      }
    }
    await browser.close();
  }
} finally {
  server.close();
}
report.finishedAt = new Date().toISOString();
report.finalLoadAverage = loadavg();
if (!values.equivalence) report.summary = summarize(report);
else report.identical = !different;
writeFileSync(join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ output: out, ...(values.equivalence ? { identical: !different } : {}) }));
if (different) process.exitCode = 1;

/**
 * Per browser, document and operation: each variant's median over rounds of the page medians, the
 * lowest and highest page median, and the paired change against 1.2.0, the median over rounds of
 * (variant / 1.2.0 - 1) within the same round, with its lowest and highest round.
 */
function summarize({ pages, variants }) {
  const median = list => [...list].sort((x, y) => x - y)[Math.floor((list.length - 1) / 2)];
  const rows = [];
  for (const name of Object.keys(report.browsers)) {
    const own = pages.filter(page => page.browser === name);
    for (const doc of documents) {
      for (const op of ['initialLoadJSON', 'setContentJSON', 'getHTML', 'generateHTML']) {
        const row = { browser: name, document: doc, operation: op, htmlLength: own[0].results[doc].htmlLength, variants: {} };
        for (const { label } of variants) {
          const values = own.filter(page => page.label === label).map(page => page.results[doc][op].median);
          const entry = { median: median(values), min: Math.min(...values), max: Math.max(...values) };
          const baseline = variants.some(variant => variant.label === BASELINE) && label !== BASELINE;
          if (baseline) {
            const changes = own.filter(page => page.label === label).map(page => {
              const paired = own.find(other => other.label === BASELINE && other.round === page.round);
              return page.results[doc][op].median / paired.results[doc][op].median - 1;
            });
            entry.changeFrom120 = { median: median(changes), min: Math.min(...changes), max: Math.max(...changes) };
          }
          row.variants[label] = entry;
        }
        const outputs = {};
        for (const { label } of variants) outputs[label] = [...new Set(own.filter(page => page.label === label).map(page => JSON.stringify(page.results[doc].outputs)))];
        row.outputs = outputs;
        rows.push(row);
      }
    }
  }
  return rows;
}
