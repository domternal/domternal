#!/usr/bin/env node
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Every package that owns tests must produce one report; no manual allowlist. */
export function testablePackages(root) {
  const packagesDir = join(root, 'packages');
  if (!existsSync(packagesDir)) return [];
  return readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => {
      const manifestPath = join(packagesDir, entry.name, 'package.json');
      if (!existsSync(manifestPath)) return false;
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      return typeof manifest.scripts?.test === 'string' && manifest.scripts.test.trim() !== '';
    })
    .map(({ name }) => name)
    .sort();
}

export const EXPECTED_COVERAGE_PACKAGES = testablePackages(repoRoot);

function hasLcovReporter(source) {
  return /\breporter\s*:\s*\[[\s\S]*?['"]lcov['"]/.test(source);
}

export function configuredCoveragePackages(root) {
  const packagesDir = join(root, 'packages');
  if (!existsSync(packagesDir)) return [];
  return readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => {
      const config = join(packagesDir, entry.name, 'vitest.config.ts');
      return existsSync(config) && hasLcovReporter(readFileSync(config, 'utf8'));
    })
    .map(({ name }) => name)
    .sort();
}

export function coveragePolicyProblems(root, expected = testablePackages(root)) {
  const actual = configuredCoveragePackages(root);
  const problems = [];
  for (const name of expected) {
    if (!actual.includes(name)) problems.push(`${name}: expected lcov coverage config is missing`);
  }
  for (const name of actual) {
    if (!expected.includes(name))
      problems.push(`${name}: lcov coverage config is not in the policy`);
  }
  return problems;
}

export function coverageReportProblems(root, expected = testablePackages(root)) {
  const problems = coveragePolicyProblems(root, expected);
  const expectedReports = new Set(expected.map((name) => join(name, 'coverage', 'lcov.info')));
  for (const relativePath of expectedReports) {
    const coverageDirectory = join(root, 'packages', dirname(relativePath));
    const path = join(root, 'packages', relativePath);
    const coverageStats = lstatSync(coverageDirectory, { throwIfNoEntry: false });
    const stats = lstatSync(path, { throwIfNoEntry: false });
    if (coverageStats?.isSymbolicLink()) {
      problems.push(`${relativePath}: coverage directory must not be a symbolic link`);
    } else if (!stats) {
      problems.push(`${relativePath}: coverage report was not produced`);
    } else if (stats.isSymbolicLink()) {
      problems.push(`${relativePath}: coverage report must not be a symbolic link`);
    } else {
      if (!stats.isFile() || stats.size === 0) {
        problems.push(`${relativePath}: coverage report is empty or not a regular file`);
      }
    }
  }

  const packagesDir = join(root, 'packages');
  if (existsSync(packagesDir)) {
    for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const relativePath = join(entry.name, 'coverage', 'lcov.info');
      if (existsSync(join(packagesDir, relativePath)) && !expectedReports.has(relativePath)) {
        problems.push(`${relativePath}: unexpected coverage report is outside the policy`);
      }
    }
  }
  return problems;
}

function main() {
  const problems = coverageReportProblems(repoRoot);
  if (problems.length > 0) {
    console.error('[coverage-reports] FAILED:');
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log(
    `[coverage-reports] OK - all ${String(EXPECTED_COVERAGE_PACKAGES.length)} lcov reports are present`
  );
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
