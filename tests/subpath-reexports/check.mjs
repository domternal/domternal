#!/usr/bin/env node
/**
 * Proves, through the built files, that a re-export subpath shares state with
 * its package's main entry.
 *
 * `@domternal/core/clipboard` exists so extensions can coordinate paste and
 * copy without the main entry declaring those names. Core builds with
 * `splitting: false`, so a subpath built as an ordinary tsup entry would carry
 * its own copy of every clipboard registry: a registration made through the
 * subpath would land in a WeakMap the Editor never reads, and nothing in the
 * source, the types or a source-mode test run would show it. The subpath is
 * therefore emitted as a re-export of the sibling main bundle, and this gate
 * holds it to that in four ways:
 *
 * 1. Static shape. The ESM file may only contain `export { … } from` the main
 *    ESM file, and the CommonJS file only one `require` of the main CommonJS
 *    file plus getters. A bundled copy, a star re-export, or a CommonJS file
 *    that requires the ESM main (which Node 22 `require(esm)` would load as a
 *    second copy) fails with the offending text.
 * 2. Name agreement. The ESM names, the CommonJS names and the value exports of
 *    both declaration files must be the same set. For an experimental subpath
 *    every declared name must also carry its own `@experimental` tag.
 * 3. Main parity. The main runtime keeps these bindings for the subpath to
 *    re-export without declaring them, so its runtime keys minus its declared
 *    values must be exactly the subpath names, and its declarations must name
 *    none of the subpath's exports. A leaked helper and a re-advertised name
 *    both fail.
 * 4. Behavior, in separate ESM and CommonJS processes that resolve the real
 *    exports map from a temporary consumer: each subpath binding is the main
 *    binding, the Editor's own paste reaches a preparation registered through
 *    the subpath, its copy serialization runs an annotator registered through
 *    the subpath, a second preparation is refused and registration works again
 *    after disposal. A third process loads the ESM main and the CommonJS
 *    subpath side by side and asserts they do NOT share state: mixed formats
 *    are documented as separate, and a `globalThis` join between copies would
 *    be the wrong fix for the duplicate problem, so it must stay visible.
 *
 * `--core <directory>` checks another built copy of the package, which is how
 * the negative control (a naive separate entry) is run.
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

/**
 * Subpaths that must be thin re-exports of their package's main bundle. An
 * `experimental` subpath promises the `@experimental` tag on every name it
 * declares, so the gate also holds its declarations to that.
 */
export const SUBPATHS = [
  { package: '@domternal/core', directory: 'packages/core', subpath: './clipboard', experimental: true },
];

/**
 * Other subpaths a declared package may publish as bundles of their own. A
 * locale entry holds only a frozen message catalog with no runtime import, so
 * it cannot carry a second copy of any registry. Any other new subpath of these
 * packages must be declared above, so it cannot duplicate state unnoticed.
 */
export const OWN_BUNDLE_SUBPATHS = /^\.\/locales\//;

const PROBE_TIMEOUT_MS = 120_000;
const PROBE_FILES = ['probe-body.cjs', 'probe-esm.mjs', 'probe-cjs.cjs', 'probe-mixed.mjs'];
const RESULT_PREFIX = 'SUBPATH_REEXPORT_RESULT ';

/** Drops block comments and whole-line `//` comments, including source map URLs. */
export function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/** A short single line excerpt of offending code for a failure message. */
export function excerpt(code) {
  const line = code.replace(/\s+/g, ' ').trim();
  return line.length > 120 ? `${line.slice(0, 120)}...` : line;
}

/** The target one condition names, read by name so the source condition is never followed. */
export function conditionTarget(entry, condition, leaf = 'default') {
  if (entry === null || typeof entry !== 'object') return null;
  const branch = entry[condition];
  if (typeof branch === 'string') return leaf === 'default' ? branch : null;
  if (branch === null || typeof branch !== 'object') return null;
  const value = branch[leaf];
  return typeof value === 'string' ? value : null;
}

/** The four built files of one exports entry: ESM, CommonJS and their declarations. */
export function entryFiles(entry) {
  return {
    esm: conditionTarget(entry, 'import'),
    cjs: conditionTarget(entry, 'require'),
    esmTypes: conditionTarget(entry, 'import', 'types'),
    cjsTypes: conditionTarget(entry, 'require', 'types'),
  };
}

/**
 * Where the subpath and main files of a manifest live, or the problems that
 * stop the gate from knowing. The subpath files must sit next to the main files,
 * because the emitted re-export names the main file relatively.
 */
export function resolveSubpath(manifest, subpath) {
  const problems = [];
  const exportsMap = manifest.publishConfig?.exports ?? manifest.exports;
  const main = exportsMap?.['.'];
  const entry = exportsMap?.[subpath];
  if (entry === undefined) {
    problems.push(`exports has no "${subpath}"; the subpath is not published`);
    return { problems, main: null, files: null };
  }
  if (main === undefined) {
    problems.push('exports has no "." entry for the subpath to re-export');
    return { problems, main: null, files: null };
  }
  const files = entryFiles(entry);
  const mainFiles = entryFiles(main);
  for (const key of ['esm', 'cjs', 'esmTypes', 'cjsTypes']) {
    if (files[key] === null) problems.push(`exports["${subpath}"] names no ${key} target`);
    if (mainFiles[key] === null) problems.push(`exports["."] names no ${key} target`);
  }
  if (problems.length === 0) {
    for (const key of ['esm', 'cjs']) {
      if (dirname(files[key]) !== dirname(mainFiles[key])) {
        problems.push(`${files[key]} is not next to ${mainFiles[key]}, so it cannot re-export it relatively`);
      }
    }
  }
  return { problems, main: mainFiles, files };
}

/** Subpaths of a declared package that are neither declared here nor allowed their own bundle. */
export function undeclaredSubpaths(manifest, declared) {
  const exportsMap = manifest.publishConfig?.exports ?? manifest.exports ?? {};
  return Object.keys(exportsMap)
    .filter((key) => key !== '.' && !declared.has(key) && !OWN_BUNDLE_SUBPATHS.test(key))
    .sort();
}

function exportedName(part, problems, file) {
  const match = /^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/.exec(part);
  if (match === null) {
    problems.push(`${file}: cannot read the export specifier "${part}"`);
    return null;
  }
  if (match[2] !== undefined && match[2] !== match[1]) {
    problems.push(`${file}: renames ${match[1]} to ${match[2]}, so the subpath name differs from the main binding`);
    return null;
  }
  return match[1];
}

/**
 * The names an ESM subpath file re-exports and the problems with its shape.
 * Only `export { … } from '<main>';` statements are allowed.
 */
export function parseEsmReexport(text, expectedSource, file = 'ESM subpath') {
  const problems = [];
  const names = [];
  const statements = stripComments(text).split(';').map((statement) => statement.trim()).filter(Boolean);
  if (statements.length === 0) problems.push(`${file}: re-exports nothing`);
  const foreign = [];
  for (const statement of statements) {
    const match = /^export\s*\{([^}]*)\}\s*from\s*(['"])([^'"]+)\2$/.exec(statement);
    if (match === null) {
      foreign.push(statement);
      continue;
    }
    if (match[3] !== expectedSource) {
      problems.push(`${file}: re-exports ${match[3]}, expected ${expectedSource}`);
    }
    for (const raw of match[1].split(',')) {
      const part = raw.trim();
      if (part === '') continue;
      const name = exportedName(part, problems, file);
      if (name !== null) names.push(name);
    }
  }
  if (foreign.length > 0) {
    problems.push(`${file}: only named re-exports of ${expectedSource} are allowed, found ${String(foreign.length)} ` +
      `other statement${foreign.length === 1 ? '' : 's'}, the first: ${excerpt(foreign[0])}`);
  }
  return { names: names.sort(), problems };
}

const IDENTIFIER = '[A-Za-z_$][\\w$]*';
const CJS_STATEMENTS = [
  { kind: 'strict', pattern: /^(['"])use strict\1\s*;?/ },
  { kind: 'esModule', pattern: /^Object\.defineProperty\(\s*exports\s*,\s*(['"])__esModule\1\s*,\s*\{\s*value\s*:\s*true\s*\}\s*\)\s*;?/ },
  { kind: 'require', pattern: new RegExp(`^(?:var|let|const)\\s+(${IDENTIFIER})\\s*=\\s*require\\(\\s*(['"])([^'"]+)\\2\\s*\\)\\s*;?`) },
  {
    kind: 'getter',
    pattern: new RegExp(
      `^Object\\.defineProperty\\(\\s*exports\\s*,\\s*(['"])(${IDENTIFIER})\\1\\s*,\\s*\\{\\s*enumerable\\s*:\\s*true\\s*,\\s*` +
        `get\\s*:\\s*function\\s*\\(\\s*\\)\\s*\\{\\s*return\\s+(${IDENTIFIER})\\.(${IDENTIFIER})\\s*;?\\s*\\}\\s*\\}\\s*\\)\\s*;?`
    ),
  },
  { kind: 'assign', pattern: new RegExp(`^exports\\.(${IDENTIFIER})\\s*=\\s*(${IDENTIFIER})\\.(${IDENTIFIER})\\s*;?`) },
];

/**
 * The names a CommonJS subpath file re-exports and the problems with its shape.
 * Allowed: the strict directive, the `__esModule` marker, exactly one
 * `require` of the main CommonJS file, and getters or assignments that read
 * the same name from that binding.
 */
export function parseCjsReexport(text, expectedSource, file = 'CommonJS subpath') {
  const problems = [];
  const names = [];
  const reads = [];
  const requires = [];
  let rest = stripComments(text).trim();
  while (rest.length > 0) {
    let matched = false;
    for (const { kind, pattern } of CJS_STATEMENTS) {
      const match = pattern.exec(rest);
      if (match === null) continue;
      matched = true;
      rest = rest.slice(match[0].length).trim();
      if (kind === 'require') requires.push({ binding: match[1], source: match[3] });
      else if (kind === 'getter') reads.push({ name: match[2], binding: match[3], property: match[4] });
      else if (kind === 'assign') reads.push({ name: match[1], binding: match[2], property: match[3] });
      break;
    }
    if (!matched) {
      problems.push(`${file}: only one require of ${expectedSource} and re-export getters are allowed, found: ${excerpt(rest)}`);
      break;
    }
  }
  if (requires.length !== 1) problems.push(`${file}: expected exactly one require, found ${String(requires.length)}`);
  for (const { source } of requires) {
    if (source !== expectedSource) problems.push(`${file}: requires ${source}, expected ${expectedSource}`);
  }
  const binding = requires[0]?.binding;
  for (const read of reads) {
    if (read.binding !== binding) problems.push(`${file}: ${read.name} reads ${read.binding}, not the required main bundle`);
    else if (read.property !== read.name) problems.push(`${file}: exports ${read.name} from ${read.property}`);
    else names.push(read.name);
  }
  if (reads.length === 0) problems.push(`${file}: re-exports nothing`);
  return { names: names.sort(), problems };
}

/** Value and type names a bundled declaration file exports. */
export function declarationExports(text) {
  const code = stripComments(text);
  const values = new Set();
  const types = new Set();
  for (const block of code.matchAll(/(?:^|\n)\s*export\s*(type\s+)?\{([^}]*)\}(?:\s*from\s*['"][^'"]+['"])?\s*;?/g)) {
    for (const raw of block[2].split(',')) {
      const part = raw.trim();
      if (part === '') continue;
      const isType = Boolean(block[1]) || /^type\s/.test(part);
      const specifier = part.replace(/^type\s+/, '');
      const alias = /^\S+\s+as\s+(\S+)$/.exec(specifier);
      (isType ? types : values).add(alias === null ? specifier : alias[1]);
    }
  }
  for (const match of code.matchAll(/(?:^|\n)\s*export\s+declare\s+(?:abstract\s+)?(?:const|let|var|function|class|enum)\s+([A-Za-z_$][\w$]*)/g)) {
    values.add(match[1]);
  }
  for (const match of code.matchAll(/(?:^|\n)\s*export\s+(?:declare\s+)?(?:interface|type)\s+([A-Za-z_$][\w$]*)/g)) {
    types.add(match[1]);
  }
  const stars = [...code.matchAll(/(?:^|\n)\s*export\s*\*/g)].length;
  return { values, types, stars };
}

/**
 * Exported names of a bundled declaration file whose own declaration has no
 * `@experimental` JSDoc tag. Editors show the tag from the declaration itself,
 * so a tag on the file or on a sibling does not reach the name. A name with no
 * local declaration is reported too, because nothing there can carry the tag.
 */
export function missingExperimentalTags(text, names) {
  const missing = [];
  for (const name of names) {
    const declaration = new RegExp(
      `(?:^|\\n)[ \\t]*(?:export\\s+)?(?:declare\\s+)?(?:abstract\\s+)?(?:interface|type|function|class|const|let|var|enum)\\s+${name}\\b`
    ).exec(text);
    const before = declaration === null ? '' : text.slice(0, declaration.index).trimEnd();
    const doc = before.endsWith('*/') ? before.slice(before.lastIndexOf('/**')) : '';
    if (!/@experimental\b/.test(doc)) missing.push(name);
  }
  return missing.sort();
}

const sorted = (values) => [...values].sort();
const same = (left, right) => JSON.stringify(sorted(left)) === JSON.stringify(sorted(right));

/** Problems when the name sets of the four subpath files disagree. */
export function nameAgreement({ esm, cjs, dts, dcts }, label) {
  const problems = [];
  const sets = { 'ESM file': esm, 'CommonJS file': cjs, 'ESM declarations': dts, 'CommonJS declarations': dcts };
  for (const [name, values] of Object.entries(sets)) {
    if (!same(values, esm)) {
      problems.push(`${label}: the ${name} exports ${sorted(values).join(', ') || 'nothing'}, the ESM file ${sorted(esm).join(', ') || 'nothing'}`);
    }
  }
  return problems;
}

/**
 * Problems when the main entry's hidden runtime bindings are not exactly the
 * subpath's names, or when its declarations name anything the subpath exports.
 */
export function mainParity({ runtimeKeys, mainDeclarations, subpathDeclarations, subpathNames }, label) {
  const problems = [];
  const declaredValues = mainDeclarations.values;
  const hidden = runtimeKeys.filter((key) => !declaredValues.has(key));
  if (!same(hidden, subpathNames)) {
    const extra = sorted(hidden.filter((key) => !subpathNames.includes(key)));
    const missing = sorted(subpathNames.filter((key) => !hidden.includes(key)));
    if (extra.length > 0) problems.push(`${label}: the main runtime exports undeclared names that no subpath re-exports: ${extra.join(', ')}`);
    if (missing.length > 0) problems.push(`${label}: subpath names missing from the main runtime or declared on it: ${missing.join(', ')}`);
  }
  const declaredMissing = sorted([...declaredValues].filter((name) => !runtimeKeys.includes(name)));
  if (declaredMissing.length > 0) problems.push(`${label}: the main declarations name values the runtime lacks: ${declaredMissing.join(', ')}`);
  const subpathExports = [...subpathDeclarations.values, ...subpathDeclarations.types];
  const leaked = sorted(subpathExports.filter((name) => declaredValues.has(name) || mainDeclarations.types.has(name)));
  if (leaked.length > 0) problems.push(`${label}: the main declarations also export ${leaked.join(', ')}`);
  return problems;
}

/** The single result line a probe prints, or null when it printed none. */
export function parseProbeOutput(stdout) {
  const line = String(stdout).split('\n').find((candidate) => candidate.startsWith(RESULT_PREFIX));
  if (line === undefined) return null;
  try {
    return JSON.parse(line.slice(RESULT_PREFIX.length));
  } catch {
    return null;
  }
}

/** The package directory to check, so the negative control can point at another built copy. */
export function parseCoreArgument(argv, fallback) {
  const index = argv.indexOf('--core');
  if (index === -1) return fallback;
  const value = argv[index + 1];
  if (value === undefined) throw new Error('--core needs a package directory');
  return resolve(value);
}

/**
 * A throwaway consumer whose node_modules resolve the package and jsdom through
 * real exports maps. The probes are copied in, so their bare specifiers resolve
 * from here and not from the repository's own node_modules.
 */
function createConsumer(packageName, packageDirectory) {
  const consumer = mkdtempSync(join(tmpdir(), 'domternal-subpath-'));
  for (const file of PROBE_FILES) copyFileSync(join(here, file), join(consumer, file));
  const scope = join(consumer, 'node_modules', ...packageName.split('/').slice(0, -1));
  mkdirSync(scope, { recursive: true });
  symlinkSync(packageDirectory, join(consumer, 'node_modules', packageName), 'dir');
  const coreRequire = createRequire(join(repoRoot, 'packages', 'core', 'package.json'));
  const jsdom = dirname(realpathSync(coreRequire.resolve('jsdom/package.json')));
  symlinkSync(jsdom, join(consumer, 'node_modules', 'jsdom'), 'dir');
  return consumer;
}

function runProbe(script, consumer, packageName, subpath) {
  // The source condition would resolve TypeScript instead of the built files under test.
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  const child = spawnSync(process.execPath, [join(consumer, script), packageName, `${packageName}${subpath.slice(1)}`], {
    cwd: consumer,
    env,
    encoding: 'utf8',
    timeout: PROBE_TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { result: parseProbeOutput(child.stdout), output: `${child.stdout ?? ''}${child.stderr ?? ''}`, status: child.status, signal: child.signal };
}

function readText(file, problems) {
  if (!existsSync(file)) {
    problems.push(`${relative(repoRoot, file)} does not exist; run pnpm build first`);
    return null;
  }
  return readFileSync(file, 'utf8');
}

function checkSubpath(declared, packageDirectory, log) {
  const problems = [];
  const label = `${declared.package}${declared.subpath.slice(1)}`;
  const manifest = JSON.parse(readFileSync(join(packageDirectory, 'package.json'), 'utf8'));
  const undeclared = undeclaredSubpaths(manifest, new Set(SUBPATHS.filter((item) => item.package === declared.package).map((item) => item.subpath)));
  for (const key of undeclared) {
    problems.push(`${declared.package}: exports["${key}"] is neither a declared re-export subpath nor a locale entry, so nothing proves it shares state`);
  }
  const { problems: resolveProblems, main, files } = resolveSubpath(manifest, declared.subpath);
  problems.push(...resolveProblems.map((problem) => `${declared.package}: ${problem}`));
  if (files === null || resolveProblems.length > 0) return problems;

  const at = (target) => join(packageDirectory, target);
  const texts = {
    esm: readText(at(files.esm), problems),
    cjs: readText(at(files.cjs), problems),
    dts: readText(at(files.esmTypes), problems),
    dcts: readText(at(files.cjsTypes), problems),
    mainDts: readText(at(main.esmTypes), problems),
    mainDcts: readText(at(main.cjsTypes), problems),
  };
  if (Object.values(texts).some((text) => text === null)) return problems;

  const esm = parseEsmReexport(texts.esm, `./${basename(main.esm)}`, files.esm);
  const cjs = parseCjsReexport(texts.cjs, `./${basename(main.cjs)}`, files.cjs);
  problems.push(...esm.problems, ...cjs.problems);
  const dts = declarationExports(texts.dts);
  const dcts = declarationExports(texts.dcts);
  problems.push(...nameAgreement({ esm: esm.names, cjs: cjs.names, dts: dts.values, dcts: dcts.values }, label));
  for (const [name, declarations, text] of [[files.esmTypes, dts, texts.dts], [files.cjsTypes, dcts, texts.dcts]]) {
    if (declarations.stars > 0) problems.push(`${name}: a star re-export hides which names the subpath declares`);
    const untagged = declared.experimental ? missingExperimentalTags(text, [...declarations.values, ...declarations.types]) : [];
    if (untagged.length > 0) problems.push(`${name}: the experimental subpath declares ${untagged.join(', ')} without an @experimental tag`);
  }
  log(`${problems.length === 0 ? 'ok  ' : 'FAIL'} ${label}: static re-export shape of ${files.esm} and ${files.cjs}`);

  const consumer = createConsumer(declared.package, packageDirectory);
  try {
    const mixed = runProbe('probe-mixed.mjs', consumer, declared.package, declared.subpath);
    for (const [kind, script, mainDeclarations, subpathDeclarations] of [
      ['ESM', 'probe-esm.mjs', declarationExports(texts.mainDts), dts],
      ['CommonJS', 'probe-cjs.cjs', declarationExports(texts.mainDcts), dcts],
    ]) {
      const { result, output, status, signal } = runProbe(script, consumer, declared.package, declared.subpath);
      if (result === null) {
        problems.push(`${label} (${kind}): the probe printed no result (exit ${String(status)}${signal ? ` ${signal}` : ''}):\n${output.trim()}`);
        continue;
      }
      const parity = mainParity({
        runtimeKeys: result.mainKeys,
        mainDeclarations,
        subpathDeclarations,
        subpathNames: esm.names,
      }, `${label} (${kind})`);
      log(`${parity.length === 0 ? 'ok  ' : 'FAIL'} ${label} (${kind}): the main entry carries the subpath bindings without declaring them`);
      problems.push(...parity);
      if (!same(result.subpathKeys, esm.names)) {
        problems.push(`${label} (${kind}): the loaded subpath exports ${sorted(result.subpathKeys).join(', ')}`);
      }
      for (const check of result.checks) {
        log(`${check.ok ? 'ok  ' : 'FAIL'} ${label} (${kind}): ${check.name}${check.ok ? '' : ` (${check.detail})`}`);
        if (!check.ok) problems.push(`${label} (${kind}): ${check.name} (${check.detail})`);
      }
    }
    if (mixed.result === null) {
      problems.push(`${label} (mixed): the probe printed no result (exit ${String(mixed.status)}):\n${mixed.output.trim()}`);
    } else {
      for (const check of mixed.result.checks) {
        log(`${check.ok ? 'ok  ' : 'FAIL'} ${label} (ESM main with CommonJS subpath): ${check.name}${check.ok ? '' : ` (${check.detail})`}`);
        if (!check.ok) problems.push(`${label} (mixed): ${check.name} (${check.detail})`);
      }
    }
  } finally {
    rmSync(consumer, { recursive: true, force: true });
  }
  return problems;
}

function main() {
  const argv = process.argv.slice(2);
  const problems = [];
  for (const declared of SUBPATHS) {
    const directory = declared.package === '@domternal/core'
      ? parseCoreArgument(argv, join(repoRoot, declared.directory))
      : join(repoRoot, declared.directory);
    problems.push(...checkSubpath(declared, directory, (line) => console.log(line)));
  }
  if (problems.length > 0) {
    console.error('\n[subpath-reexports] FAILED:');
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error('\nA re-export subpath must stay a thin re-export of its main bundle. A second bundled');
    console.error('copy keeps its own registries, so registrations made through it never reach the Editor.');
    process.exit(1);
  }
  console.log(`\n[subpath-reexports] OK - ${String(SUBPATHS.length)} subpath shares its main bundle's state in ESM and in CommonJS; mixed formats stay separate`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
