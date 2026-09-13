#!/usr/bin/env node
// Release readiness is checked apart from package correctness. Every package,
// the unreleased ones included, stays in every other gate; this one proves the
// list is sound and that the real publish transform refuses exactly the
// packages it holds back.

import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  READINESS_PATH,
  parseReadiness,
  readinessProblems,
} from '../../scripts/release-readiness.mjs';
import { discoverPublishablePackages } from '../package-policy/check.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TRANSFORM = 'prepare-publish-manifest.mjs';

/** Every package directory with a manifest, private ones included. */
export function workspacePackages(directory = join(repoRoot, 'packages')) {
  const packages = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(directory, entry.name, 'package.json');
    if (!existsSync(manifestPath)) continue;
    packages.push({
      directory: join(directory, entry.name),
      name: entry.name,
      manifest: JSON.parse(readFileSync(manifestPath, 'utf8')),
    });
  }
  return packages.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Package scripts other than prepublishOnly that run the publish transform.
 *
 * The guard lives in the transform, so a build or pack step that ran it would
 * refuse an unreleased package where only publishing may be refused, and a
 * lifecycle script that rewrote the manifest outside the publish would ship
 * that rewrite into every CI tarball.
 */
export function transformOutsidePublish(manifests) {
  const problems = [];
  for (const manifest of manifests) {
    for (const [script, command] of Object.entries(manifest.scripts ?? {})) {
      if (script === 'prepublishOnly' || typeof command !== 'string') continue;
      if (!command.includes(TRANSFORM)) continue;
      problems.push(
        `${String(manifest.name)}: the "${script}" script runs ${TRANSFORM}. Only prepublishOnly may, ` +
          'so that building and packing an unreleased package keep working'
      );
    }
  }
  return problems;
}

/**
 * Runs the real transform on a throwaway copy of one package, next to copies
 * of the real scripts and the real list, so nothing in the repository can be
 * rewritten. Returns the exit status, the output and whether the copied
 * manifest kept its bytes.
 */
export function runTransformCopy(entry, root = repoRoot) {
  const mirror = mkdtempSync(join(tmpdir(), 'domternal-release-readiness-'));
  try {
    const scripts = join(mirror, 'scripts');
    mkdirSync(scripts);
    for (const file of readdirSync(join(root, 'scripts'))) {
      if (file.endsWith('.mjs') || file === 'release-readiness.json') {
        copyFileSync(join(root, 'scripts', file), join(scripts, file));
      }
    }
    const directory = join(mirror, 'packages', entry.name);
    mkdirSync(directory, { recursive: true });
    const original = readFileSync(join(entry.directory, 'package.json'));
    copyFileSync(join(entry.directory, 'package.json'), join(directory, 'package.json'));
    // Invoked the way prepublishOnly invokes it: from the package directory,
    // by a relative path. An absolute path through a symlinked temp directory
    // would not match the module URL, and the transform would not run at all.
    const result = spawnSync(process.execPath, [`../../scripts/${TRANSFORM}`], {
      cwd: directory,
      encoding: 'utf8',
    });
    if (result.error) throw result.error;
    return {
      status: result.status,
      output: `${result.stdout}${result.stderr}`,
      unchanged: readFileSync(join(directory, 'package.json')).equals(original),
    };
  } finally {
    rmSync(mirror, { recursive: true, force: true });
  }
}

/**
 * Whether the copy showed the transform treating `entry` as the list says: a
 * held package refused for readiness with its manifest untouched, any other
 * package carried past the guard into the transform's own checks.
 */
export function refusalProblems(entry, held, run) {
  const name = String(entry.manifest.name);
  const output = `Output:\n${run.output.trimEnd()}`;
  if (held.has(entry.manifest.name)) {
    const refused = run.output.includes(`[release-readiness] ${name} `);
    if (run.status === 1 && refused && run.unchanged) return [];
    return [
      `${name} is listed as unreleased, but the publish transform did not refuse it for ` +
        `readiness before touching its manifest (exit ${String(run.status)}, manifest ` +
        `${run.unchanged ? 'unchanged' : 'rewritten'}). ${output}`,
    ];
  }
  if (run.output.includes('[release-readiness]')) {
    return [
      `${name} is not listed as unreleased, but the publish transform refused it for readiness. ${output}`,
    ];
  }
  // Without a dist the copy usually stops at publishBlockers, which is fine
  // here. Silence is not: a transform that never ran proves nothing.
  if (run.output.includes(`[prepare-publish] ${name}`)) return [];
  return [
    `${name}: the publish transform said nothing about it, so the copy does not show that it ` +
      `gets past the readiness guard. ${output}`,
  ];
}

/**
 * README links to the npm page of a package that is held back. Package READMEs
 * ship in their tarballs, so a released package would link to a page npm
 * answers with a 404 until the held package ships; link the source instead.
 */
export function npmLinksToHeldPackages(readmes, held) {
  const problems = [];
  for (const { path, text } of readmes) {
    for (const name of held.keys()) {
      if (text.includes(`npmjs.com/package/${name}`)) {
        problems.push(
          `${path} links to the npm page of ${name}, which is not released yet: link its source directory ` +
            `(https://github.com/domternal/domternal/tree/main/packages/${name.replace('@domternal/', '')}) instead`
        );
      }
    }
  }
  return problems;
}

/** The root README and every package README, as they ship. */
export function shippedReadmes(root = repoRoot) {
  const readmes = [];
  const add = (path) => {
    if (existsSync(join(root, path))) readmes.push({ path, text: readFileSync(join(root, path), 'utf8') });
  };
  add('README.md');
  for (const entry of readdirSync(join(root, 'packages'), { withFileTypes: true })) {
    if (entry.isDirectory()) add(join('packages', entry.name, 'README.md'));
  }
  return readmes;
}

function main() {
  let held;
  try {
    held = parseReadiness(readFileSync(READINESS_PATH, 'utf8'));
  } catch (error) {
    console.error(
      `[release-readiness] FAILED:\n  - scripts/release-readiness.json is missing or invalid: ${
        error instanceof Error ? error.message : String(error)
      }\n    Every publish is refused until it is restored. A release empties "unreleased" and never deletes the file.`
    );
    process.exit(1);
  }

  const packages = workspacePackages();
  const manifests = packages.map(({ manifest }) => manifest);
  const failures = [
    ...readinessProblems(held, manifests),
    ...transformOutsidePublish(manifests),
    ...npmLinksToHeldPackages(shippedReadmes(), held),
  ];

  const publishable = discoverPublishablePackages();
  for (const entry of publishable) {
    failures.push(...refusalProblems(entry, held, runTransformCopy(entry)));
  }

  if (failures.length > 0) {
    console.error('[release-readiness] FAILED:');
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }

  const heldNames = publishable
    .map(({ manifest }) => manifest.name)
    .filter((name) => held.has(name));
  console.log(
    `[release-readiness] OK - ${String(publishable.length - heldNames.length)} packages releasable, ` +
      `${String(heldNames.length)} held back${heldNames.length > 0 ? `: ${heldNames.join(', ')}` : ''}`
  );
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
