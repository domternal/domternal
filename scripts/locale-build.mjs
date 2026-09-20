// Generate locale inputs before compiling and reject stale archives before packing.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { createRepositoryLocalePlan, generateLocales, localeExport, localeFileProblems, localeTypesVersions } from '../tests/i18n/generate-locales.mjs';

const stampName = '.locale-build.json';
const hash = (value) => createHash('sha256').update(value).digest('hex');

function packageContext(directory) {
  const packageDirectory = resolve(directory);
  const root = resolve(packageDirectory, '../..');
  const manifest = JSON.parse(readFileSync(join(packageDirectory, 'package.json'), 'utf8'));
  const owners = JSON.parse(readFileSync(join(root, 'tests/i18n/namespaces.json'), 'utf8'));
  if (!Object.hasOwn(owners, manifest.name)) throw new Error(`${manifest.name} does not own maintained locale messages`);
  if (relative(root, packageDirectory) !== `packages/${manifest.name.split('/')[1]}`) {
    throw new Error('Locale builds must run from their owning package directory');
  }
  return { root, packageDirectory, manifest };
}

/** Called by tsup configs as well as the normal package build command. */
export function localeEntries(owner, directory = process.cwd()) {
  const { root, manifest } = packageContext(directory);
  if (manifest.name !== owner) throw new Error(`Expected locale owner ${owner}, found ${manifest.name}`);
  const { locales } = generateLocales({ root, owner });
  return Object.fromEntries(locales.map(locale => [`locales/${locale}`, `src/locales/${locale}.ts`]));
}

function localeInputs(directory) {
  const { root, packageDirectory, manifest } = packageContext(directory);
  const plan = createRepositoryLocalePlan(root);
  if (plan.errors.length) throw new Error(plan.errors.join('\n'));
  const prefix = `${relative(root, packageDirectory)}/src/locales/`;
  const problems = localeFileProblems(root, plan.outputs).filter(problem => problem.includes(prefix));
  if (problems.length) throw new Error(problems.join('\n'));
  const inputs = {};
  for (const [path, expected] of plan.outputs) {
    if (!path.startsWith(prefix)) continue;
    if (!existsSync(join(root, path)) || readFileSync(join(root, path), 'utf8') !== expected) {
      throw new Error(`Stale generated locale ${path}; run pnpm build`);
    }
    inputs[path] = hash(expected);
  }
  const published = manifest.publishConfig?.exports ?? manifest.exports;
  const actual = Object.fromEntries(Object.entries(published ?? {}).filter(([key]) => key.startsWith('./locales/'))
    .map(([key, value]) => [key, Object.fromEntries(Object.entries(value).filter(([condition]) => condition !== `${manifest.name.split('/')[0]}/source`))]));
  const expected = Object.fromEntries(plan.locales.map(locale => [`./locales/${locale}`, localeExport(locale)]));
  if (!isDeepStrictEqual(actual, expected)) throw new Error(`${manifest.name}: stale locale exports; run pnpm build`);
  inputs.exports = hash(JSON.stringify(expected));
  const expectedTypesVersions = localeTypesVersions(manifest.typesVersions);
  if (!isDeepStrictEqual(manifest.typesVersions, expectedTypesVersions)) {
    throw new Error(`${manifest.name}: stale locale type resolution; run pnpm build`);
  }
  inputs.typesVersions = hash(JSON.stringify(expectedTypesVersions));
  for (const path of ['scripts/locale-build.mjs', 'tests/i18n/generate-locales.mjs', `${relative(root, packageDirectory)}/tsup.config.ts`]) {
    inputs[path] = hash(readFileSync(join(root, path)));
  }
  return { ...plan, manifest, packageDirectory, inputs };
}

function localeArtifacts(packageDirectory, locales) {
  const artifacts = {};
  const expected = new Set();
  const distDirectory = join(packageDirectory, 'dist');
  if (existsSync(distDirectory) && lstatSync(distDirectory).isSymbolicLink()) throw new Error('Locale artifacts must not be symlinks');
  const localeDirectory = join(packageDirectory, 'dist/locales');
  if (existsSync(localeDirectory) && lstatSync(localeDirectory).isSymbolicLink()) throw new Error('Locale artifacts must not be symlinks');
  for (const locale of locales) {
    for (const suffix of ['js', 'cjs', 'd.ts', 'd.cts', 'js.map', 'cjs.map']) {
      const path = `dist/locales/${locale}.${suffix}`;
      const absolute = join(packageDirectory, path);
      if (!existsSync(absolute)) {
        if (suffix.endsWith('.map')) continue;
        throw new Error(`Missing locale artifact ${path}; run pnpm build`);
      }
      if (!lstatSync(absolute).isFile() || lstatSync(absolute).isSymbolicLink()) throw new Error(`Locale artifact must be a regular file: ${path}`);
      expected.add(path);
      artifacts[path] = hash(readFileSync(absolute));
    }
  }
  const directory = join(packageDirectory, 'dist/locales');
  if (existsSync(directory)) for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !expected.has(`dist/locales/${entry.name}`)) {
      throw new Error(`Unexpected locale artifact dist/locales/${entry.name}; run pnpm build`);
    }
  }
  return artifacts;
}

/** The stamp stays outside published dist and is written only after a successful build. */
export function recordLocaleBuild(directory, before) {
  const { inputs, locales, manifest, packageDirectory } = localeInputs(directory);
  if (before && !isDeepStrictEqual(before, inputs)) throw new Error('Locale inputs changed during the build; build again');
  const artifacts = localeArtifacts(packageDirectory, locales);
  const stamp = { version: 1, owner: manifest.name, inputs, artifacts };
  rmSync(join(packageDirectory, stampName), { force: true });
  writeFileSync(join(packageDirectory, stampName), JSON.stringify(stamp, null, 2) + '\n');
}

/** Read-only pack guard, including a manifest prepared for Free publication. */
export function checkLocaleBuild(directory) {
  const { inputs, locales, manifest, packageDirectory } = localeInputs(directory);
  const file = join(packageDirectory, stampName);
  if (!existsSync(file)) throw new Error(`${manifest.name}: missing locale build receipt; run pnpm build`);
  const stamp = JSON.parse(readFileSync(file, 'utf8'));
  if (stamp.version !== 1 || stamp.owner !== manifest.name || !isDeepStrictEqual(stamp.inputs, inputs)) {
    throw new Error(`${manifest.name}: locale inputs changed since the successful build; run pnpm build`);
  }
  if (!isDeepStrictEqual(stamp.artifacts, localeArtifacts(packageDirectory, locales))) {
    throw new Error(`${manifest.name}: built locale artifacts changed; run pnpm build`);
  }
}

export function buildLocales(directory, args = []) {
  if (args.some(arg => arg !== '--')) {
    throw new Error('Locale package builds do not accept compiler overrides. Use pnpm exec tsup for custom builds; custom builds do not create a publish receipt.');
  }
  const { root, manifest, packageDirectory } = packageContext(directory);
  rmSync(join(packageDirectory, stampName), { force: true });
  generateLocales({ root, owner: manifest.name });
  const before = localeInputs(packageDirectory).inputs;
  const result = spawnSync('pnpm', ['exec', 'tsup', '--clean'], {
    cwd: packageDirectory, stdio: 'inherit', env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Locale package build failed (${result.status ?? result.signal})`);
  recordLocaleBuild(packageDirectory, before);
  checkLocaleBuild(packageDirectory);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === '--check') checkLocaleBuild(process.cwd());
    else buildLocales(process.cwd(), process.argv.slice(2));
  } catch (error) {
    console.error(`[locales] ${error.message}`);
    process.exitCode = 1;
  }
}
