/**
 * Fixture tests for the wiring gate.
 *
 * Its whole job is to notice an absence, which is the hardest thing for a check
 * to get right: a matcher slightly too generous reports OK for a gate nobody
 * runs, and nothing downstream ever contradicts it. Every case below is a
 * near-miss, and the four marked as such are the exact inputs that defeated the
 * first version of this file.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NOT_GATES,
  REQUIRED_SCRIPTS,
  gateScripts,
  skippedSteps,
  stripComments,
  unwiredScripts,
  validatedPackages,
} from './check.mjs';

test('the exception list is pinned, so one word cannot silence a gate', () => {
  /* Without this, adding a gate's name to NOT_GATES and deleting its step
     leaves every check in the repository green. */
  assert.deepEqual(
    [...NOT_GATES].sort(),
    ['test', 'test:api-surface:update', 'test:e2e', 'test:e2e:matrix']
  );
  assert.deepEqual(REQUIRED_SCRIPTS, ['build', 'lint', 'typecheck', 'typecheck:e2e']);
});

test('checks that are not test:-prefixed are held down too', () => {
  /* DEFEAT: deleting the e2e typecheck step, or the lint step, used to leave
     this gate perfectly green, because it only looked at `test:` names. */
  const manifest = {
    scripts: {
      build: 'nx build',
      lint: 'eslint .',
      typecheck: 'tsc',
      'typecheck:e2e': 'tsc -p e2e',
      'test:css-vars': 'node x',
      dev: 'vite',
    },
  };
  assert.deepEqual(gateScripts(manifest), [
    'build',
    'lint',
    'test:css-vars',
    'typecheck',
    'typecheck:e2e',
  ]);
  assert.deepEqual(unwiredScripts(gateScripts(manifest), 'run: pnpm lint\n'), [
    'build',
    'test:css-vars',
    'typecheck',
    'typecheck:e2e',
  ]);
});

test('a commented-out step does not count as wired', () => {
  /* DEFEAT: the step is still in the file, so a raw text match found it. A `#`
     inside a `run:` block is a shell comment, and commenting one out there is
     exactly the edit this has to notice. */
  const workflow = ['  - name: SSR', '#        run: pnpm test:ssr-import', '      # run: pnpm lint'].join(
    '\n'
  );
  assert.deepEqual(unwiredScripts(['test:ssr-import', 'lint'], workflow), [
    'test:ssr-import',
    'lint',
  ]);
  assert.equal(stripComments('a\n # b\nc').split('\n').length, 2);
});

test('a step GitHub would skip is reported', () => {
  /* DEFEAT: `if: false` leaves the step in the file and running nothing. */
  assert.deepEqual(skippedSteps('    if: false\n    run: pnpm test:x\n'), ['if: false']);
  assert.deepEqual(skippedSteps('    if: ${{ false }}\n'), ['if: ${{ false }}']);
  assert.deepEqual(skippedSteps("    if: github.event_name == 'push'\n"), []);
});

test('a package named anywhere else does not count as validated', () => {
  /* DEFEAT: the Codecov `files:` list names eleven of the eighteen packages, so
     those eleven satisfied "is validated" while sitting nowhere near the loop
     that runs publint and attw. */
  const workflow = [
    '      - name: Upload coverage',
    '        with:',
    '          files: ./packages/core/coverage/lcov.info',
    '      - name: Validate packages',
    '        run: |',
    '          for pkg in packages/theme packages/pm; do',
    '            cd "$pkg"',
    '          done',
  ].join('\n');
  assert.deepEqual(validatedPackages(workflow), ['packages/pm', 'packages/theme']);
  assert.equal(validatedPackages('      - name: Lint\n        run: pnpm lint\n'), null);
});

test('an updater step does not satisfy the gate that shares its prefix', () => {
  const workflow = 'steps:\n  - run: pnpm test:api-surface:update\n';
  assert.deepEqual(unwiredScripts(['test:api-surface'], workflow), ['test:api-surface']);
  assert.deepEqual(unwiredScripts(['test:api-surface:update'], workflow), []);
});

test('a script named as a prefix of another is not satisfied by it either', () => {
  const workflow = '  - run: pnpm test:package-artifacts\n';
  assert.deepEqual(unwiredScripts(['test:package'], workflow), ['test:package']);
  assert.deepEqual(unwiredScripts(['test:package-artifacts'], workflow), []);
});

test('a wired script is found wherever the step puts it', () => {
  const workflow = [
    '  - name: Gates',
    '    run: |',
    '      pnpm test:css-vars',
    '      pnpm test:bundle-size && pnpm test:externals',
  ].join('\n');
  assert.deepEqual(
    unwiredScripts(['test:css-vars', 'test:bundle-size', 'test:externals'], workflow),
    []
  );
});
