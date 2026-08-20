#!/usr/bin/env node
// The manifest a package publishes is not the manifest it develops with, and
// this is the single place that turns one into the other.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The dev-source condition. It resolves to TypeScript that only exists in this
// repository: `files` ships `dist`, so publishing the condition points a
// consumer at a file that is not in the tarball.
const SOURCE_CONDITION = '@domternal/source';

/**
 * The compatibility floor a published package declares: `>=MAJOR.MINOR.0`.
 *
 * A prerelease is refused rather than reduced to its release part, because the
 * reduction would be silently wrong: semver ranges exclude prereleases, so a
 * coordinated `1.0.0-rc.1` of this workspace would publish a core declaring
 * `@domternal/pm >=1.0.0`, which `1.0.0-rc.1` does not satisfy, and installing
 * the rc would fail with ETARGET until a stable 1.0.0 existed. Nothing here has
 * ever shipped a prerelease; the day one is wanted, this is the decision to
 * make deliberately rather than to inherit from a regex.
 */
export function versionFloor(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (match === null) {
    throw new Error(
      `version "${version}" is not a plain MAJOR.MINOR.PATCH. ` +
        'A prerelease needs a floor decided by hand: no prerelease satisfies a >=X.Y.0 range.'
    );
  }
  return `>=${match[1]}.${match[2]}.0`;
}

/** Strips the dev-source condition wherever it appears in an exports map. */
function stripSourceCondition(value) {
  if (Array.isArray(value)) return value.map(stripSourceCondition);
  if (value === null || typeof value !== 'object') return value;
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === SOURCE_CONDITION) continue;
    result[key] = stripSourceCondition(entry);
  }
  return result;
}

/** Every `workspace:`-prefixed specifier left in the manifest, with its path. */
function workspaceSpecifiers(value, path = 'package.json') {
  if (typeof value === 'string') return value.startsWith('workspace:') ? [`${path}: ${value}`] : [];
  if (value === null || typeof value !== 'object') return [];
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => workspaceSpecifiers(entry, `${path}[${String(index)}]`));
  }
  return Object.entries(value).flatMap(([key, entry]) =>
    workspaceSpecifiers(entry, `${path}.${key}`)
  );
}

/** Every string an exports map resolves to, at any depth and under any condition. */
export function exportTargets(value) {
  if (typeof value === 'string') return [value];
  if (value === null || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(exportTargets);
  return Object.values(value).flatMap(exportTargets);
}

/**
 * The publish-time manifest for `manifest`. Pure: it returns a new object and
 * reports what it did, so the caller decides whether to write and the tests can
 * assert on the result without a filesystem.
 */
export function preparePublishManifest(manifest) {
  const changes = [];
  const prepared = { ...manifest };

  if (prepared.devDependencies !== undefined) {
    delete prepared.devDependencies;
    changes.push('dropped devDependencies');
  }

  if (prepared.dependencies !== undefined) {
    const floor = versionFloor(prepared.version);
    const rewritten = {};
    const named = [];
    for (const [name, specifier] of Object.entries(prepared.dependencies)) {
      if (specifier === 'workspace:*') {
        rewritten[name] = floor;
        named.push(name);
      } else {
        rewritten[name] = specifier;
      }
    }
    if (named.length > 0) {
      prepared.dependencies = rewritten;
      changes.push(`pinned ${named.join(', ')} to ${floor}`);
    }
  }

  if (prepared.exports !== undefined) {
    const stripped = stripSourceCondition(prepared.exports);
    if (JSON.stringify(stripped) !== JSON.stringify(prepared.exports)) {
      prepared.exports = stripped;
      changes.push(`removed the ${SOURCE_CONDITION} condition`);
    }
  }

  return { prepared, changes };
}

/**
 * What must be true of a manifest about to be published. Returns the reasons it
 * is not, so the caller can print all of them rather than the first.
 *
 * `directory` is optional: with it, every exports target is resolved on disk and
 * against `files`, which is the check that would have caught the dev-source
 * condition before it reached npm. Without it, only the manifest is judged.
 */
export function publishBlockers(manifest, directory) {
  const blockers = workspaceSpecifiers(manifest).map(
    (found) => `${found} would publish the workspace protocol, which no consumer can resolve`
  );

  if (typeof manifest.version !== 'string') {
    blockers.push('package.json has no version');
    return blockers;
  }

  if (directory === undefined) return blockers;

  const files = Array.isArray(manifest.files) ? manifest.files : [];
  // The exports map is where a consumer's resolver looks first, but the legacy
  // fields are still read by older bundlers and by anything that has not
  // implemented exports, so a dangling one of those fails just as hard.
  const legacy = ['main', 'module', 'types', 'typings', 'browser', 'bin'].flatMap((field) => {
    const value = manifest[field];
    if (typeof value === 'string') return [value];
    if (value !== null && typeof value === 'object') {
      return Object.values(value).filter((entry) => typeof entry === 'string');
    }
    return [];
  });
  for (const target of new Set([...exportTargets(manifest.exports ?? {}), ...legacy])) {
    if (!target.startsWith('./')) continue;
    const relative = target.slice(2);
    if (!existsSync(join(directory, relative))) {
      blockers.push(`the manifest points at ${target}, which does not exist`);
      continue;
    }
    // `files` decides what npm puts in the tarball. A target outside it exists
    // here and is missing there, which is the failure that reaches a consumer
    // and no local check can see.
    const shipped = files.some(
      (entry) => relative === entry || relative.startsWith(`${entry.replace(/\/$/, '')}/`)
    );
    if (!shipped) {
      blockers.push(`the manifest points at ${target}, which "files" does not ship`);
    }
  }

  return blockers;
}

function main() {
  const directory = resolve(process.argv[2] ?? process.cwd());
  const manifestPath = join(directory, 'package.json');
  const original = readFileSync(manifestPath, 'utf8');
  const { prepared, changes } = preparePublishManifest(JSON.parse(original));

  const blockers = publishBlockers(prepared, directory);
  if (blockers.length > 0) {
    console.error(`[prepare-publish] ${prepared.name ?? manifestPath} must not be published:`);
    for (const blocker of blockers) console.error(`  ${blocker}`);
    console.error('\nFix the manifest and publish again. Nothing was written.');
    process.exit(1);
  }

  const serialised = `${JSON.stringify(prepared, null, 2)}\n`;
  if (serialised !== original) writeFileSync(manifestPath, serialised);
  const summary = changes.length > 0 ? changes.join('; ') : 'nothing to change';
  console.log(`[prepare-publish] ${prepared.name ?? manifestPath}: ${summary}`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
