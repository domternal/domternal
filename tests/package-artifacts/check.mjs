#!/usr/bin/env node
// What actually ends up in the tarball.
//
// Everything else in this repository judges the working tree. npm ships a
// tarball, and the two are not the same thing: `files` decides what crosses
// over, and a mistake there is invisible locally and permanent once published.
// It has already happened. 0.15.0 shipped `@domternal/core` with Phosphor icon
// path data and no notice at all: npm carries LICENSE by itself but never
// THIRD-PARTY-LICENSES.md, and nothing failed because nothing looked inside a
// tarball.
//
// The strongest assertion here is the last one. It applies the publish
// transform (scripts/prepare-publish-manifest.mjs) to the PACKED manifest and
// then resolves every exports target against the tarball's own file list. That
// is the check that would have caught the `@domternal/source` condition, which
// four published packages carry today pointing at `./src/index.ts` while
// shipping only `dist`: Node dies with ERR_MODULE_NOT_FOUND, Vite 6 and 7
// report "Failed to resolve entry for package", and Vite 8 falls back to the
// next condition without a word, which is its own kind of trouble. publint and
// attw both pass throughout, because both skip conditions they do not
// recognise.
//
// One thing this gate does NOT claim. `pnpm pack` runs `prepack`, not
// `prepublishOnly`, so the tarball it produces still carries devDependencies
// and the unresolved dev-source condition, while the published one does not.
// The FILE set is identical in both, which is what most of this checks, and the
// manifest difference is handled by running the transform here rather than
// pretending pack and publish are the same command.
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverPublishablePackages } from '../package-policy/check.mjs';
import {
  exportTargets,
  preparePublishManifest,
  publishBlockers,
} from '../../scripts/prepare-publish-manifest.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const policyPath = join(here, 'policy.json');

/** Runs a command, returning stdout, and throws with both streams on failure. */
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  if (result.error !== undefined) throw result.error;
  if (result.status === 0) return result.stdout;
  const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
  throw new Error(`${command} ${args.join(' ')} failed${detail ? `:\n${detail}` : ''}`);
}

/** The policy file, without its comment key. */
export function loadPolicy(path = policyPath) {
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  return new Map(Object.entries(parsed).filter(([name]) => !name.startsWith('$')));
}

/** A policy entry that names no package, or a package that has no entry. */
export function policyGaps(packageNames, policy) {
  const missing = packageNames.filter((name) => !policy.has(name)).sort();
  const stale = [...policy.keys()].filter((name) => !packageNames.includes(name)).sort();
  return [
    ...missing.map(
      (name) => `${name} has no entry in policy.json, so nothing bounds what it publishes`
    ),
    ...stale.map((name) => `policy.json still describes ${name}, which is no longer published`),
  ];
}

/** Compiles a policy entry, refusing a shape that would quietly allow too much. */
export function compilePolicy(name, entry) {
  if (entry === undefined) throw new Error(`${name}: no policy entry`);
  if (!Number.isSafeInteger(entry.maxPackedBytes) || entry.maxPackedBytes <= 0) {
    throw new Error(`${name}: maxPackedBytes must be a positive integer`);
  }
  if (!Array.isArray(entry.requiredFiles) || !Array.isArray(entry.allowedPatterns)) {
    throw new Error(`${name}: requiredFiles and allowedPatterns must both be arrays`);
  }
  if (new Set(entry.requiredFiles).size !== entry.requiredFiles.length) {
    throw new Error(`${name}: requiredFiles contains a duplicate`);
  }
  for (const pattern of entry.allowedPatterns) {
    // Unanchored patterns are the classic way an allowlist stops being one:
    // "dist/" would match anything containing it, including dist/../secrets.
    if (typeof pattern !== 'string' || !pattern.startsWith('^') || !pattern.endsWith('$')) {
      throw new Error(`${name}: allowed pattern must be anchored with ^ and $: ${String(pattern)}`);
    }
  }
  return entry.allowedPatterns.map((pattern) => new RegExp(pattern));
}

/**
 * The tarball's file list, with the archive itself judged first.
 *
 * A tarball is an archive format, not a file list: it can carry symlinks,
 * absolute paths and `..` segments, and an npm install unpacks whatever is
 * there. None of that is possible from this build today, and that is exactly
 * why it is cheap to keep impossible.
 */
export function packedFiles(tarball, cwd) {
  const paths = run('tar', ['-tzf', tarball], cwd).split(/\r?\n/).filter(Boolean);
  const verbose = run('tar', ['-tvzf', tarball], cwd).split(/\r?\n/).filter(Boolean);
  if (verbose.length !== paths.length) {
    throw new Error('the tarball listings disagree with each other');
  }
  const irregular = paths.filter((path, index) => {
    const type = verbose[index]?.[0];
    return path.endsWith('/') ? type !== 'd' : type !== '-';
  });
  if (irregular.length > 0) {
    throw new Error(`tarball carries something other than files and directories: ${irregular.join(', ')}`);
  }
  const outside = paths.filter((path) => !path.startsWith('package/'));
  if (outside.length > 0) throw new Error(`tarball has paths outside package/: ${outside.join(', ')}`);

  const files = [];
  for (const path of paths) {
    if (path.endsWith('/')) continue;
    const relative = path.slice('package/'.length);
    const segments = relative.split('/');
    if (
      relative.startsWith('/') ||
      /^[A-Za-z]:/.test(relative) ||
      relative.includes('\\') ||
      segments.some((segment) => segment === '' || segment === '.' || segment === '..')
    ) {
      throw new Error(`tarball has an unsafe path: ${relative}`);
    }
    files.push(relative);
  }
  if (new Set(files).size !== files.length) throw new Error('tarball has a duplicate path');
  return files.sort();
}

/** Everything wrong with one tarball's file list. */
export function fileFailures(files, entry, patterns) {
  const present = new Set(files);
  const required = new Set(entry.requiredFiles);
  const failures = [];
  const missing = entry.requiredFiles.filter((file) => !present.has(file));
  if (missing.length > 0) failures.push(`missing required files: ${missing.join(', ')}`);
  // No allowlist should ever have to spell this out: a nested node_modules in a
  // tarball is npm's own historical footgun, and every pattern here permits
  // arbitrary directory depth.
  const nested = files.filter((file) => file.split('/').includes('node_modules'));
  if (nested.length > 0) failures.push(`nested node_modules in the tarball: ${nested.join(', ')}`);
  const unexpected = files.filter(
    (file) => !required.has(file) && !patterns.some((pattern) => pattern.test(file))
  );
  if (unexpected.length > 0) {
    failures.push(
      `files nothing allows: ${unexpected.join(', ')}. Fix "files" in the manifest, or widen allowedPatterns if they belong.`
    );
  }
  return failures;
}

/** Everything wrong with the manifest inside the tarball. */
export function manifestFailures(source, packed, files) {
  const failures = [];
  if (packed.name !== source.name) failures.push(`packed name is ${String(packed.name)}`);
  if (packed.version !== source.version) failures.push(`packed version is ${String(packed.version)}`);
  if (packed.license !== 'MIT') failures.push(`packed license is ${String(packed.license)}`);

  // The publish artifact, derived from the pack artifact by the same code the
  // publish hook runs, then judged against what the tarball actually holds.
  const { prepared } = preparePublishManifest(packed);
  failures.push(...publishBlockers(prepared));
  const present = new Set(files);
  for (const target of new Set(exportTargets(prepared.exports ?? {}))) {
    if (!target.startsWith('./')) continue;
    if (!present.has(target.slice(2))) {
      failures.push(
        `published exports point at ${target}, which is not in the tarball. ` +
          'Add it to "files", or stop exporting it.'
      );
    }
  }
  return failures;
}

function main() {
  const update = process.argv.includes('--update');
  const packages = discoverPublishablePackages();
  const policy = loadPolicy();

  const gaps = policyGaps(
    packages.map(({ manifest }) => manifest.name),
    policy
  );
  if (gaps.length > 0) {
    console.error('[package-artifacts] FAILED before packing:');
    for (const gap of gaps) console.error(`  - ${gap}`);
    process.exit(1);
  }

  const temporaryRoot = mkdtempSync(join(tmpdir(), 'domternal-pack-'));
  const failures = [];
  const measured = new Map();

  try {
    for (const { directory, manifest } of packages) {
      const label = manifest.name;
      try {
        const entry = policy.get(label);
        const patterns = compilePolicy(label, entry);
        const destination = join(temporaryRoot, label.replace('/', '-'));
        mkdirSync(destination);
        run('pnpm', ['pack', '--pack-destination', destination], directory);
        const tarballs = readdirSync(destination).filter((file) => file.endsWith('.tgz'));
        if (tarballs.length !== 1) {
          throw new Error(`expected one tarball, found ${String(tarballs.length)}`);
        }
        const tarball = join(destination, tarballs[0]);
        const bytes = statSync(tarball).size;
        const files = packedFiles(tarball, directory);
        const packed = JSON.parse(run('tar', ['-xOf', tarball, 'package/package.json'], directory));
        const found = [
          ...fileFailures(files, entry, patterns),
          ...manifestFailures(manifest, packed, files),
        ];
        // The size is reported ALONGSIDE the content failures, never instead of
        // them. A tarball that grew because something polluted dist reads as a
        // budget problem, the obvious response is --update, and the real fault
        // would then be baked into the budget and only surface afterwards. So a
        // measurement is kept for --update only when nothing else was wrong.
        if (bytes > entry.maxPackedBytes) {
          found.push(
            `packed size ${String(bytes)} exceeds the budget of ${String(entry.maxPackedBytes)}`
          );
        }
        if (found.length === 0) measured.set(label, bytes);
        if (found.length > 0) throw new Error(found.join('; '));
        console.log(
          `ok   ${label}: ${String(bytes)} / ${String(entry.maxPackedBytes)} bytes, ${String(files.length)} files`
        );
      } catch (error) {
        failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }

  if (update) {
    const parsed = JSON.parse(readFileSync(policyPath, 'utf8'));
    for (const [name, bytes] of measured) {
      // A tenth of headroom, rounded up to a readable number.
      parsed[name].maxPackedBytes = Math.ceil((bytes * 1.1) / 1000) * 1000;
    }
    writeFileSync(policyPath, `${JSON.stringify(parsed, null, 2)}\n`);
    console.log(
      `\n[package-artifacts] refreshed ${String(measured.size)} budgets from the measured sizes` +
        (measured.size === packages.length
          ? ''
          : '; the packages that failed above kept their old budget')
    );
  }

  if (failures.length > 0) {
    console.error('\n[package-artifacts] FAILED:');
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }

  console.log(`\n[package-artifacts] OK - ${String(packages.length)} tarballs match policy`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
