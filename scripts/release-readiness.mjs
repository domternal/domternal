// Whether a package may be published yet, which is a separate question from
// whether it is correct. Every package is built, packed and checked by the same
// gates; the ones listed in release-readiness.json are still refused by the
// publish path, before their manifest is rewritten.
//
// prepare-publish-manifest.mjs imports this module, and other repositories load
// that one by URL, so nothing here touches the filesystem until it is called.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The committed list. It sits outside every package's `files`, so it never ships. */
export const READINESS_PATH = fileURLToPath(new URL('./release-readiness.json', import.meta.url));

const READINESS_LABEL = 'scripts/release-readiness.json';
const TOP_LEVEL_KEYS = new Set(['$comment', 'unreleased']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The held packages in `text`, by name, with the reason each one waits.
 *
 * Anything unexpected throws instead of being read leniently: a shape that
 * parsed as "nothing held" would publish exactly the package the list exists to
 * hold back.
 */
export function parseReadiness(text) {
  const parsed = JSON.parse(text);
  if (!isPlainObject(parsed)) throw new Error('the list must be a JSON object');
  for (const key of Object.keys(parsed)) {
    if (!TOP_LEVEL_KEYS.has(key)) {
      throw new Error(`unknown key "${key}"; only "$comment" and "unreleased" are read`);
    }
  }
  if (parsed.$comment !== undefined && typeof parsed.$comment !== 'string') {
    throw new Error('"$comment" must be a string');
  }
  if (!isPlainObject(parsed.unreleased)) {
    throw new Error(
      '"unreleased" must be an object of package names and reasons. A release empties it; it never removes it'
    );
  }
  const held = new Map();
  for (const [name, reason] of Object.entries(parsed.unreleased)) {
    if (name.trim() === '') throw new Error('"unreleased" has an entry with an empty package name');
    if (typeof reason !== 'string' || reason.trim() === '') {
      throw new Error(`"${name}" needs a non-empty reason, which is what a refused publish prints`);
    }
    held.set(name, reason);
  }
  return held;
}

/** Why `name` must not be published yet, or null when nothing holds it back. */
export function releaseRefusal(name, held) {
  if (!held.has(name)) return null;
  return `${name} is not releasable yet: ${String(held.get(name))}`;
}

/**
 * What is wrong with the list itself, judged against every manifest in the
 * workspace. Private ones are included on purpose, so an entry naming one can
 * be told apart from an entry naming nothing.
 */
export function readinessProblems(held, manifests) {
  const problems = [];
  for (const name of held.keys()) {
    const matches = manifests.filter((manifest) => manifest.name === name);
    if (matches.length === 0) {
      problems.push(
        `${name} is listed as unreleased, but no package in this workspace has that name. ` +
          `Remove the stale entry from ${READINESS_LABEL}.`
      );
    } else if (matches.some((manifest) => manifest.private === true)) {
      problems.push(
        `${name} is listed as unreleased and is also marked "private": true. A private package ` +
          'drops out of package-policy, package-artifacts, ssr-import, api-surface, bundle-size and ' +
          'the CI package validation. Remove "private"; the list already holds it back.'
      );
    }
  }
  return problems;
}

/**
 * The lines a refused publish of `name` prints, or null when it may go ahead.
 *
 * A list that is missing or unreadable refuses every package. Failing open
 * here would turn a deleted file into a release of everything it held.
 */
export function publishRefusal(name, path = READINESS_PATH) {
  const label = path === READINESS_PATH ? READINESS_LABEL : path;
  let held;
  try {
    held = parseReadiness(readFileSync(path, 'utf8'));
  } catch (error) {
    return [
      `[release-readiness] ${String(name)} was not published: ${label} is missing or invalid ` +
        `(${error instanceof Error ? error.message : String(error)}).`,
      'Every publish is refused until it is restored. A release empties "unreleased" and never ' +
        'deletes the file. Nothing was written.',
    ];
  }
  const refusal = releaseRefusal(name, held);
  if (refusal === null) return null;
  return [
    `[release-readiness] ${refusal}`,
    `Remove its entry from ${label} in the release pull request. Nothing was written.`,
  ];
}

/** Exits the publish with status 1, before anything is written, unless `name` is releasable. */
export function refuseUnlessReleasable(name, path = READINESS_PATH) {
  const refusal = publishRefusal(name, path);
  if (refusal === null) return;
  for (const line of refusal) console.error(line);
  process.exit(1);
}
