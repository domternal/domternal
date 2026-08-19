#!/usr/bin/env node
// A gate nobody runs is not a gate.
//
// Every check in this repository is a root script plus a step in ci.yml, and
// the two are joined by nothing but memory. Adding the script and forgetting
// the step produces a check that passes locally, is never run on a pull
// request, and reads on the branch as coverage that does not exist. The same
// applies to the package list ci.yml hardcodes for publint and attw: a
// nineteenth package would be validated by nobody, silently.
//
// It is deliberately small, and deliberately early: it reads manifests and one
// YAML file, so it needs nothing built and a forgotten step is reported in
// seconds rather than after a full build.
//
// It reads the workflow as text, which means it has to be careful about what
// text counts. Three ways of not running a step look identical to a naive
// match, and an adversarial review defeated the first version of this gate with
// all three:
//
//   - a step commented out with `#`, which the workflow still contains
//   - a step carrying `if: false`, which GitHub skips
//   - a package name that appears somewhere else entirely. The Codecov `files:`
//     list happens to name eleven of the eighteen packages, so those eleven
//     satisfied "is validated" without appearing in the validation loop at all
//
// So comments are stripped first, a falsey `if:` fails the run outright, and
// the package list is read from the validation step rather than from the file.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverPublishablePackages } from '../package-policy/check.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const workflowPath = join(repoRoot, '.github', 'workflows', 'ci.yml');

// Scripts that are not gates, listed one by one rather than matched by shape.
// An updater rewrites the snapshot its gate compares against, and the
// end-to-end suites need four dev servers and four browsers, so they stay a
// local command by design. `test` and `dev` are covered by `test:coverage` and
// are not checks. The list is pinned by check.test.mjs, because otherwise one
// word added here would silence a gate and every check would still pass.
export const NOT_GATES = new Set([
  'test',
  'test:api-surface:update',
  'test:e2e',
  'test:e2e:matrix',
]);

// Checks that are not `test:`-prefixed and would otherwise be held down by
// nothing. Deleting the e2e typecheck step, or the lint step, used to leave
// this gate perfectly green.
export const REQUIRED_SCRIPTS = ['build', 'lint', 'typecheck', 'typecheck:e2e'];

// Gates that CI runs but that exit 0 there without checking anything, because
// what they read is not in a CI checkout. Both look at `domternal.dev`, a
// nested repository this one excludes: it holds the only `resolve.dedupe` list,
// and it is the only importer that pulls y-prosemirror into the lockfile. Their
// steps still belong in ci.yml, so that they are already in place wherever the
// checkout does exist, but counting them as enforced CI coverage would
// overstate the wall by two. So they are reported apart, and the annotation is
// pinned to each gate's own source: if one stops printing SKIPPED, the note
// describing it fails here rather than outliving the behaviour.
export const SKIPS_IN_CI = new Set(['test:dedupe-reachable', 'test:pm-ranges']);

// The step whose inline loop decides which packages publint and attw see.
const VALIDATION_STEP = 'Validate packages';

/** The `tests/<name>/check.mjs` a script runs, or null when it runs none. */
export function checkFileFor(manifest, name) {
  const script = manifest.scripts?.[name];
  if (typeof script !== 'string') return null;
  const match = /(tests\/[A-Za-z0-9._-]+\/check\.mjs)/.exec(script);
  return match === null ? null : match[1];
}

/**
 * The workflow with comment-only lines removed.
 *
 * A `#` inside a `run:` block is a shell comment, and commenting out
 * `pnpm test:ssr-import` there is exactly the edit this gate has to notice, so
 * those count too. A `#` after code on the same line is left alone: YAML treats
 * it as a comment only when preceded by a space, and nothing here relies on it.
 */
export function stripComments(workflow) {
  return workflow
    .split(/\r?\n/)
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
}

/** Every `test:`-prefixed script that is meant to run in CI, plus the rest of the checks. */
export function gateScripts(manifest) {
  const declared = Object.keys(manifest.scripts ?? {});
  const tests = declared.filter((name) => name.startsWith('test:') && !NOT_GATES.has(name));
  const required = REQUIRED_SCRIPTS.filter((name) => declared.includes(name));
  return [...new Set([...tests, ...required])].sort();
}

/** The gate scripts the workflow never invokes. */
export function unwiredScripts(scripts, workflow) {
  const live = stripComments(workflow);
  // Two invocation forms, because a step may run a script directly or across a
  // filtered set of workspaces: `pnpm build` and
  // `pnpm --filter './packages/*' run build` both do the work. The word
  // boundary on the right is what keeps `test:api-surface` from being satisfied
  // by a step that only runs `test:api-surface:update`.
  return scripts.filter((name) => !new RegExp(`(?:pnpm|run) ${name}(?![\\w:-])`).test(live));
}

/** Package directories named by the validation step, and only by it. */
export function validatedPackages(workflow) {
  const live = stripComments(workflow);
  const step = live.indexOf(VALIDATION_STEP);
  if (step === -1) return null;
  const found = new Set();
  for (const match of live.slice(step).matchAll(/packages\/[A-Za-z0-9._-]+/g)) found.add(match[0]);
  return [...found].sort();
}

/** Steps GitHub would skip. Nothing here has a legitimate reason to be one. */
export function skippedSteps(workflow) {
  return stripComments(workflow)
    .split(/\r?\n/)
    .filter((line) => /^\s*if:\s*(false|\$\{\{\s*false\s*\}\})\s*$/.test(line))
    .map((line) => line.trim());
}

function main() {
  const manifest = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  const workflow = readFileSync(workflowPath, 'utf8');
  const failures = [];

  for (const name of REQUIRED_SCRIPTS) {
    if (!Object.keys(manifest.scripts ?? {}).includes(name)) {
      failures.push(`this gate requires a "${name}" script, which package.json no longer declares`);
    }
  }

  const scripts = gateScripts(manifest);
  for (const name of unwiredScripts(scripts, workflow)) {
    failures.push(
      `package.json declares "${name}" but .github/workflows/ci.yml never runs it, ` +
        'so it guards nothing on a pull request'
    );
  }

  for (const skipped of skippedSteps(workflow)) {
    failures.push(`ci.yml carries "${skipped}", so that step is wired but never runs`);
  }

  // The skip annotation has to keep describing the gate it names.
  for (const name of SKIPS_IN_CI) {
    if (!Object.keys(manifest.scripts ?? {}).includes(name)) {
      failures.push(`SKIPS_IN_CI names "${name}", which package.json no longer declares`);
      continue;
    }
    const file = checkFileFor(manifest, name);
    if (file === null) {
      failures.push(
        `SKIPS_IN_CI names "${name}", whose script runs no tests/*/check.mjs, ` +
          'so the claim that it skips in CI cannot be checked against anything'
      );
      continue;
    }
    const source = join(repoRoot, file);
    if (!readFileSync(source, 'utf8').includes('SKIPPED')) {
      failures.push(
        `SKIPS_IN_CI names "${name}", but ${file} no longer prints SKIPPED. ` +
          'Either it enforces something in CI now, in which case drop it from ' +
          'SKIPS_IN_CI and let it be counted, or the skip moved and this note is stale.'
      );
    }
  }

  // The other direction: a step invoking a script that no longer exists would
  // fail the build with a confusing pnpm error rather than a useful one.
  const declared = new Set(Object.keys(manifest.scripts ?? {}));
  for (const match of stripComments(workflow).matchAll(/pnpm (test:[A-Za-z0-9:-]+)/g)) {
    if (!declared.has(match[1])) {
      failures.push(`ci.yml runs "pnpm ${match[1]}", which package.json does not declare`);
    }
  }

  const expected = discoverPublishablePackages().map(({ name }) => `packages/${name}`);
  const named = validatedPackages(workflow);
  if (named === null) {
    failures.push(
      `ci.yml has no "${VALIDATION_STEP}" step, so nothing runs publint or attw over the packages`
    );
  } else {
    for (const directory of expected) {
      if (named.includes(directory)) continue;
      failures.push(
        `the "${VALIDATION_STEP}" step never names ${directory}, so publint and attw skip it`
      );
    }
    const onDisk = new Set(
      readdirSync(join(repoRoot, 'packages'), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => `packages/${entry.name}`)
    );
    for (const directory of named) {
      if (expected.includes(directory)) continue;
      failures.push(
        onDisk.has(directory)
          ? `the "${VALIDATION_STEP}" step names ${directory}, which is not published`
          : `the "${VALIDATION_STEP}" step names ${directory}, which does not exist`
      );
    }
  }

  if (failures.length > 0) {
    console.error('[ci-wiring] FAILED:');
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }

  const skipping = scripts.filter((name) => SKIPS_IN_CI.has(name));
  const aside =
    skipping.length > 0 ? ` (plus ${skipping.join(', ')}, wired but self-skipping there)` : '';
  console.log(
    `[ci-wiring] OK - ${String(scripts.length - skipping.length)} checks enforced in CI${aside}, ` +
      `${String(expected.length)} packages validated by publint and attw`
  );
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
