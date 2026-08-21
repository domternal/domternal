import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  configuredCoveragePackages,
  coveragePolicyProblems,
  coverageReportProblems,
  testablePackages,
} from './check.mjs';

function fixture(configured = ['alpha'], reports = ['alpha']) {
  const root = mkdtempSync(join(tmpdir(), 'domternal-coverage-'));
  for (const name of new Set([...configured, ...reports])) {
    mkdirSync(join(root, 'packages', name), { recursive: true });
  }
  for (const name of configured) {
    writeFileSync(
      join(root, 'packages', name, 'vitest.config.ts'),
      "export default { test: { coverage: { reporter: ['text', 'lcov'] } } };\n"
    );
  }
  for (const name of reports) {
    mkdirSync(join(root, 'packages', name, 'coverage'), { recursive: true });
    writeFileSync(join(root, 'packages', name, 'coverage', 'lcov.info'), 'TN:\n');
  }
  return root;
}

test('discovers only configs that request lcov', () => {
  const root = fixture(['alpha'], []);
  try {
    mkdirSync(join(root, 'packages', 'beta'), { recursive: true });
    writeFileSync(
      join(root, 'packages', 'beta', 'vitest.config.ts'),
      "export default { test: { coverage: { reporter: ['text'] } } };\n"
    );
    assert.deepEqual(configuredCoveragePackages(root), ['alpha']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('policy catches removed and unreviewed coverage configs', () => {
  const root = fixture(['alpha', 'gamma'], []);
  try {
    assert.deepEqual(coveragePolicyProblems(root, ['alpha', 'beta']), [
      'beta: expected lcov coverage config is missing',
      'gamma: lcov coverage config is not in the policy',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a newly testable package automatically requires coverage', () => {
  const root = fixture([], []);
  try {
    for (const [name, scripts] of [
      ['alpha', { test: 'vitest run' }],
      ['beta', { build: 'tsup' }],
    ]) {
      mkdirSync(join(root, 'packages', name), { recursive: true });
      writeFileSync(
        join(root, 'packages', name, 'package.json'),
        JSON.stringify({ name, scripts })
      );
    }
    assert.deepEqual(testablePackages(root), ['alpha']);
    assert.deepEqual(coveragePolicyProblems(root), [
      'alpha: expected lcov coverage config is missing',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('reports must be exact, regular and non-empty', () => {
  const root = fixture(['alpha', 'beta'], ['alpha', 'gamma']);
  try {
    const problems = coverageReportProblems(root, ['alpha', 'beta']);
    assert.ok(problems.includes('beta/coverage/lcov.info: coverage report was not produced'));
    assert.ok(
      problems.includes(
        'gamma/coverage/lcov.info: unexpected coverage report is outside the policy'
      )
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a direct lcov report symlink is rejected', () => {
  const root = fixture(['alpha'], []);
  try {
    const coverage = join(root, 'packages', 'alpha', 'coverage');
    mkdirSync(coverage, { recursive: true });
    writeFileSync(join(coverage, 'real-lcov.info'), 'TN:\n');
    symlinkSync('real-lcov.info', join(coverage, 'lcov.info'));

    assert.deepEqual(coverageReportProblems(root, ['alpha']), [
      'alpha/coverage/lcov.info: coverage report must not be a symbolic link',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a symlinked coverage directory is rejected', () => {
  const root = fixture(['alpha'], []);
  try {
    const externalCoverage = join(root, 'external-coverage');
    mkdirSync(externalCoverage);
    writeFileSync(join(externalCoverage, 'lcov.info'), 'TN:\n');
    symlinkSync(externalCoverage, join(root, 'packages', 'alpha', 'coverage'), 'dir');

    assert.deepEqual(coverageReportProblems(root, ['alpha']), [
      'alpha/coverage/lcov.info: coverage directory must not be a symbolic link',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the complete expected set passes', () => {
  const root = fixture(['alpha', 'beta'], ['alpha', 'beta']);
  try {
    assert.deepEqual(coverageReportProblems(root, ['alpha', 'beta']), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
