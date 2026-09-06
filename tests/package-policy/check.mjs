#!/usr/bin/env node
// What must be true of every publishable package before it is published. This
// repository has no release automation.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import semver from 'semver';
import {
  preparePublishManifest,
  publishBlockers,
  versionRange,
} from '../../scripts/prepare-publish-manifest.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const packagesDir = join(repoRoot, 'packages');
const SCOPE = '@domternal/';
const PUBLISH_HOOK = 'node ../../scripts/prepare-publish-manifest.mjs';
const RESTORE_HOOK = 'git checkout package.json';

const WRAPPER_KEYWORDS = new Map([
  ['@domternal/angular', 'angular'],
  ['@domternal/react', 'react'],
  ['@domternal/vue', 'vue'],
  ['@domternal/vanilla', 'vanilla'],
]);
const FRAMEWORK_KEYWORDS = new Set(['angular', 'react', 'vue', 'vue3', 'vanilla']);

// The one package that must declare side effects: it is a stylesheet, and a
// bundler told it is side-effect free is entitled to drop it entirely.
const STYLESHEET_PACKAGE = '@domternal/theme';

/** A source file importing a stylesheet for its effect. */
export const STYLE_IMPORT =
  /(?:^|\n)\s*import\s+(?:[^'"\n]*\s+from\s+)?['"]([^'"]+\.(?:css|scss|sass))['"]/;

/**
 * Every publishable package, discovered rather than listed.
 *
 * It THROWS on a non-private package whose name is outside the scope instead of
 * filtering it out. A filter would drop such a package from every check below
 * and still print OK, which is worse than not checking at all.
 */
export function discoverPublishablePackages(directory = packagesDir) {
  const packages = [];
  const seen = new Set();
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    // packages/ picks up a .DS_Store on macOS, so directory-ness is checked
    // rather than assumed.
    if (!entry.isDirectory()) continue;
    const packageDirectory = join(directory, entry.name);
    const manifestPath = join(packageDirectory, 'package.json');
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (manifest.private === true) continue;
    if (typeof manifest.name !== 'string' || !manifest.name.startsWith(SCOPE)) {
      throw new Error(`${manifestPath}: every publishable package must be named ${SCOPE}*`);
    }
    if (seen.has(manifest.name)) throw new Error(`duplicate publishable package ${manifest.name}`);
    seen.add(manifest.name);
    packages.push({ directory: packageDirectory, name: entry.name, manifest });
  }
  return packages.sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
}

/** Empty while every manifest shares one version, otherwise the buckets it split into. */
export function lockstepViolations(manifests) {
  const buckets = new Map();
  for (const manifest of manifests) {
    const names = buckets.get(manifest.version) ?? [];
    names.push(manifest.name);
    buckets.set(manifest.version, names);
  }
  if (buckets.size <= 1) return [];
  return [...buckets]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([version, names]) => `${version}: ${names.sort().join(', ')}`);
}

/** Public npm metadata that keeps search results precise without mislabeling a wrapper. */
export function publicMetadataFailures(manifest) {
  const failures = [];
  const label = manifest.name;
  const keywords = new Set(manifest.keywords ?? []);

  for (const keyword of ['domternal', 'prosemirror']) {
    if (!keywords.has(keyword)) failures.push(`${label}: keywords is missing "${keyword}"`);
  }

  if (label !== '@domternal/pm' && !keywords.has('rich-text-editor')) {
    failures.push(`${label}: keywords is missing "rich-text-editor"`);
  }

  if (label !== '@domternal/pm' && label !== '@domternal/theme' && !keywords.has('typescript')) {
    failures.push(`${label}: keywords is missing "typescript"`);
  }

  const ownFramework = WRAPPER_KEYWORDS.get(label);
  if (ownFramework !== undefined) {
    if (!keywords.has(ownFramework)) {
      failures.push(`${label}: keywords is missing its own framework, "${ownFramework}"`);
    }
    for (const keyword of FRAMEWORK_KEYWORDS) {
      if (keyword === ownFramework || (ownFramework === 'vue' && keyword === 'vue3')) continue;
      if (keywords.has(keyword)) {
        failures.push(`${label}: keywords includes another wrapper's framework, "${keyword}"`);
      }
    }
  }

  if (
    (label === '@domternal/core' || ownFramework !== undefined || label === '@domternal/theme') &&
    !String(manifest.description).toLowerCase().includes('rich text editor')
  ) {
    failures.push(`${label}: description does not identify it as part of a rich text editor`);
  }

  return failures;
}

/** README package inventory and durable product statements checked against the workspace. */
export function publicReadmeFailures(readme, packages) {
  const failures = [];
  const names = packages.map(({ manifest }) => manifest.name).sort();
  const section = /## Packages\s+([\s\S]*?)\s+## Domternal Pro/.exec(readme)?.[1];
  if (section === undefined) {
    return ['README: Packages section is missing or no longer ends before Domternal Pro'];
  }

  const listed = [...section.matchAll(/\[`(@domternal\/[a-z0-9-]+)`\]/g)].map((match) => match[1]);
  const uniqueListed = [...new Set(listed)].sort();
  const missing = names.filter((name) => !uniqueListed.includes(name));
  const stale = uniqueListed.filter((name) => !names.includes(name));
  const duplicates = uniqueListed.filter(
    (name) => listed.filter((entry) => entry === name).length > 1
  );
  if (missing.length > 0)
    failures.push(`README: current packages not listed: ${missing.join(', ')}`);
  if (stale.length > 0)
    failures.push(`README: listed packages not in the workspace: ${stale.join(', ')}`);
  if (duplicates.length > 0)
    failures.push(`README: packages listed more than once: ${duplicates.join(', ')}`);

  const currentCount = /table above lists all (\d+) current MIT packages/i.exec(readme)?.[1];
  if (currentCount === undefined || Number(currentCount) !== names.length) {
    failures.push(
      `README: current MIT package count is ${currentCount ?? 'missing'}, expected ${String(names.length)}`
    );
  }

  const extensionCount = /extensions across core and (\d+) extension packages/i.exec(readme)?.[1];
  const actualExtensionCount = names.filter((name) =>
    name.startsWith('@domternal/extension-')
  ).length;
  if (extensionCount === undefined || Number(extensionCount) !== actualExtensionCount) {
    failures.push(
      `README: extension package count is ${extensionCount ?? 'missing'}, expected ${String(actualExtensionCount)}`
    );
  }

  for (const [claim, label] of [
    ['70+ extensions', 'extension threshold'],
    ['17,000+ automated test executions', 'automated test threshold'],
    ['150+ CSS custom properties', 'theme token threshold'],
  ]) {
    if (!readme.includes(claim)) failures.push(`README: ${label} no longer states "${claim}"`);
  }

  if (/every package is tree-shakeable/i.test(readme)) {
    failures.push('README: tree-shaking claim includes the complete theme stylesheet');
  }
  if (!readme.includes('JavaScript exports are tree-shakeable')) {
    failures.push('README: tree-shaking statement no longer names JavaScript exports');
  }
  if (!readme.includes('the optional theme ships as one complete CSS stylesheet')) {
    failures.push(
      'README: tree-shaking statement no longer explains the complete theme stylesheet'
    );
  }

  return failures;
}

/** Public Context7 facts that must describe the same product as the README and npm. */
export function publicContext7Failures(config, packages) {
  const failures = [];
  const description = String(config.description ?? '');
  const rules = Array.isArray(config.rules) ? config.rules.map(String) : [];
  const joinedRules = rules.join('\n');

  for (const fact of ['Framework-agnostic', 'Angular', 'React', 'Vue', 'Vanilla', 'MIT licensed']) {
    if (!description.includes(fact)) {
      failures.push(`context7.json: description is missing "${fact}"`);
    }
  }

  const packageClaim = `Domternal Free is the current set of ${String(packages.length)} MIT-licensed`;
  if (!joinedRules.includes(packageClaim)) {
    failures.push(`context7.json: package inventory no longer states "${packageClaim}"`);
  }
  for (const fact of [
    'Domternal Pro is a separate commercially licensed suite',
    'private source repository',
    'requires no Domternal-operated editor cloud',
    'https://domternal.dev/free-vs-pro/',
    'https://domternal.dev/license-explained/',
  ]) {
    if (!joinedRules.includes(fact)) failures.push(`context7.json: rules are missing "${fact}"`);
  }
  if (joinedRules.includes('the bundler strips the rest')) {
    failures.push(
      'context7.json: tree-shaking claim is broader than the JavaScript export boundary'
    );
  }

  return failures;
}

/** Every source file under `directory`, so a stylesheet import cannot hide in a subfolder. */
export function sourceFiles(directory) {
  const found = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(entry.name)) found.push(full);
    }
  };
  if (existsSync(directory) && statSync(directory).isDirectory()) walk(directory);
  return found;
}

/**
 * The Node floor every package must declare, read from `.nvmrc` rather than
 * written here.
 *
 * The two had drifted: twelve packages said `>=20` while the repository tested
 * only on 22, and six said nothing at all. A floor nobody runs is not support,
 * it is a guess with a version number on it, and the drift was possible only
 * because nothing compared the two files. Node 20 reached end of life in April
 * 2026, so the guess had also stopped being defensible.
 *
 * Deliberately exact rather than "compatible with": if the day comes for the
 * ecosystem's `^22.12.0 || >=24` spelling, that is a decision to make here on
 * purpose, not one to slip past because a range happened to overlap.
 */
export function requiredNodeFloor(nvmrc) {
  const major = /^\s*v?(\d+)/.exec(nvmrc);
  if (major === null)
    throw new Error(`.nvmrc does not name a Node major: ${JSON.stringify(nvmrc)}`);
  return `>=${major[1]}`;
}

/**
 * The version of `dependency` this workspace actually has installed for
 * `directory`, or null when it is not installed there.
 *
 * Resolved through the package's own node_modules rather than the root, because
 * pnpm keeps a separate tree per package and the root would answer for a
 * different copy, or for none.
 */
export function installedVersion(directory, dependency) {
  // Walked by hand rather than through require.resolve, because a package with
  // a restricted `exports` map does not expose its own package.json, and
  // lowlight is exactly that: resolving it throws ERR_PACKAGE_PATH_NOT_EXPORTED
  // and the peer would read as "not installed" while sitting right there.
  let current = directory;
  for (;;) {
    const manifest = join(current, 'node_modules', ...dependency.split('/'), 'package.json');
    if (existsSync(manifest)) {
      try {
        return JSON.parse(readFileSync(manifest, 'utf8')).version ?? null;
      } catch {
        return null;
      }
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * Peer ranges on packages outside this workspace, judged against what is
 * installed here.
 *
 * These are the ranges nothing was checking: `react >=18`, `katex ^0.16.0 ||
 * ^0.17.0`, the three `@angular/*` at `>=17.1.0`. A range is a promise about
 * versions nobody here runs, so the only thing that can honestly be asserted is
 * the half that is testable: the range must admit the version this repository
 * develops and tests against, and that version must be declared as a
 * devDependency so it is visible rather than incidental. A peer range that
 * excludes the version we test is a promise contradicted by our own CI.
 */
export function peerRangeFailures({ directory, manifest }) {
  const failures = [];
  const label = manifest.name;
  for (const [dependency, range] of Object.entries(manifest.peerDependencies ?? {})) {
    if (dependency.startsWith(SCOPE)) continue;
    const declared = manifest.devDependencies?.[dependency];
    if (declared === undefined) {
      failures.push(
        `${label}: peerDependencies.${dependency} is not in devDependencies, so nothing here ever ` +
          'builds against the peer it promises to support'
      );
      continue;
    }
    const installed = installedVersion(directory, dependency);
    if (installed === null) {
      failures.push(
        `${label}: peerDependencies.${dependency} is declared but not installed, so the range is untested`
      );
      continue;
    }
    if (!semver.satisfies(installed, range, { includePrerelease: true })) {
      failures.push(
        `${label}: peerDependencies.${dependency} is "${range}", which excludes the ${installed} ` +
          'this repository builds and tests against'
      );
    }
  }
  return failures;
}

/** Everything wrong with one package, as sentences a maintainer can act on. */
export function packageFailures({ directory, name, manifest }, names, rootLicense, nodeFloor) {
  const failures = [];
  const label = manifest.name;
  const compatibilityRange = versionRange(manifest.version);

  // The ranges a consumer resolves against. The lower bound stays at the minor
  // floor across patch releases, while the upper bound keeps a future breaking
  // major out: 1.4.17 declares `>=1.4.0 <2.0.0`.
  for (const [dependency, range] of Object.entries(manifest.peerDependencies ?? {})) {
    if (!dependency.startsWith(SCOPE)) continue;
    if (range !== compatibilityRange) {
      failures.push(
        `${label}: peerDependencies.${dependency} is "${range}", expected "${compatibilityRange}" for version ${manifest.version}`
      );
    }
    if (!names.has(dependency)) {
      failures.push(`${label}: peerDependencies.${dependency} is not a package in this workspace`);
    }
  }

  // A runtime dependency on a sibling is always workspace:*, and the publish
  // transform turns it into the compatibility range. Anything else here is
  // either a mistake or the residue of a publish that died before postpublish restored the file.
  for (const [dependency, range] of Object.entries(manifest.dependencies ?? {})) {
    if (!dependency.startsWith(SCOPE)) continue;
    if (range !== 'workspace:*') {
      failures.push(
        `${label}: dependencies.${dependency} is "${range}", expected "workspace:*". ` +
          'A published range here means postpublish did not restore this file: git checkout packages/*/package.json'
      );
    }
    if (!names.has(dependency)) {
      failures.push(`${label}: dependencies.${dependency} is not a package in this workspace`);
    }
  }

  const scripts = manifest.scripts ?? {};
  const expectedPublish =
    typeof scripts.build === 'string' ? `pnpm build && ${PUBLISH_HOOK}` : PUBLISH_HOOK;
  if (scripts.prepublishOnly !== expectedPublish) {
    failures.push(
      `${label}: prepublishOnly must be "${expectedPublish}", got ${JSON.stringify(scripts.prepublishOnly)}`
    );
  }
  if (scripts.postpublish !== RESTORE_HOOK) {
    failures.push(
      `${label}: postpublish must be "${RESTORE_HOOK}", or a failed publish leaves the manifest rewritten`
    );
  }

  // The publish artifact itself, judged by the code that produces it. This is
  // what refuses a dangling exports target or a surviving workspace protocol.
  const { prepared } = preparePublishManifest(manifest);
  for (const blocker of publishBlockers(prepared, directory)) failures.push(`${label}: ${blocker}`);

  if (manifest.license !== 'MIT') {
    failures.push(`${label}: license is ${JSON.stringify(manifest.license)}, expected "MIT"`);
  }
  const licensePath = join(directory, 'LICENSE');
  if (!existsSync(licensePath)) {
    failures.push(`${label}: no LICENSE file, so the tarball ships without one`);
  } else if (readFileSync(licensePath, 'utf8') !== rootLicense) {
    failures.push(`${label}: LICENSE differs from the repository LICENSE; the copies must match`);
  }

  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    failures.push(`${label}: "files" is missing or empty, so npm decides what ships`);
  } else {
    for (const entry of manifest.files) {
      if (existsSync(join(directory, entry))) continue;
      const hint = entry === 'dist' ? ' (run pnpm build first)' : '';
      failures.push(`${label}: "files" lists ${entry}, which does not exist${hint}`);
    }
  }

  if (manifest.repository?.directory !== `packages/${name}`) {
    failures.push(
      `${label}: repository.directory is ${JSON.stringify(manifest.repository?.directory)}, expected "packages/${name}"`
    );
  }
  for (const field of ['description', 'author', 'homepage']) {
    if (typeof manifest[field] !== 'string' || manifest[field].length === 0) {
      failures.push(`${label}: ${field} is missing`);
    }
  }
  if (typeof manifest.bugs?.url !== 'string') failures.push(`${label}: bugs.url is missing`);
  if (!Array.isArray(manifest.keywords) || manifest.keywords.length === 0) {
    failures.push(`${label}: keywords is missing or empty, so npm search cannot place it`);
  }

  if (nodeFloor !== undefined && manifest.engines?.node !== nodeFloor) {
    failures.push(
      `${label}: engines.node is ${JSON.stringify(manifest.engines?.node)}, expected "${nodeFloor}" to match .nvmrc`
    );
  }

  const expectedSideEffects = label === STYLESHEET_PACKAGE;
  if (manifest.sideEffects !== expectedSideEffects) {
    failures.push(
      `${label}: sideEffects is ${JSON.stringify(manifest.sideEffects)}, expected ${String(expectedSideEffects)}`
    );
  }

  // sideEffects: false is a promise, not a formality. It holds only while no
  // source file imports a stylesheet for its effect, because a bundler that
  // believes the promise drops such an import and the consumer loses the styles
  // with nothing in the console. No package does this today; this keeps it so.
  if (manifest.sideEffects === false) {
    for (const file of sourceFiles(join(directory, 'src'))) {
      const match = STYLE_IMPORT.exec(readFileSync(file, 'utf8'));
      if (match === null) continue;
      failures.push(
        `${label}: ${file.slice(repoRoot.length + 1)} imports ${match[1]} while the package ` +
          'declares sideEffects: false, so a bundler may drop the stylesheet'
      );
    }
  }

  return failures;
}

function main() {
  const packages = discoverPublishablePackages();
  const manifests = packages.map(({ manifest }) => manifest);
  const names = new Set(manifests.map((manifest) => manifest.name));
  const rootLicense = readFileSync(join(repoRoot, 'LICENSE'), 'utf8');
  const nodeFloor = requiredNodeFloor(readFileSync(join(repoRoot, '.nvmrc'), 'utf8'));

  const failures = [];
  const rootManifest = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  if (rootManifest.engines?.node !== nodeFloor) {
    failures.push(
      `the repository itself declares engines.node ${JSON.stringify(rootManifest.engines?.node)}, expected "${nodeFloor}"`
    );
  }
  const buckets = lockstepViolations(manifests);
  if (buckets.length > 0) {
    failures.push(
      `packages are not in lockstep:\n    ${buckets.join('\n    ')}\n` +
        '    A release moves every package together. Bring the stragglers to the release version.'
    );
  }
  for (const entry of packages) {
    failures.push(...packageFailures(entry, names, rootLicense, nodeFloor));
    failures.push(...peerRangeFailures(entry));
    failures.push(...publicMetadataFailures(entry.manifest));
  }
  failures.push(
    ...publicReadmeFailures(readFileSync(join(repoRoot, 'README.md'), 'utf8'), packages)
  );
  failures.push(
    ...publicContext7Failures(
      JSON.parse(readFileSync(join(repoRoot, 'context7.json'), 'utf8')),
      packages
    )
  );

  if (failures.length > 0) {
    console.error('[package-policy] FAILED:');
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }

  const version = manifests[0]?.version ?? 'unknown';
  console.log(
    `[package-policy] OK - ${String(packages.length)} packages at ${version}, ranges at ${versionRange(version)}, ` +
      `node ${nodeFloor}, manifests publishable`
  );
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
