#!/usr/bin/env node
// A gate nobody runs is not a gate. Every check in this repository is a root
// script plus a step in ci.yml, and the two are joined by nothing but memory.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { EXPECTED_COVERAGE_PACKAGES } from '../coverage-reports/check.mjs';
import { discoverPublishablePackages } from '../package-policy/check.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const workflowsRoot = join(repoRoot, '.github', 'workflows');
const workflowPath = join(workflowsRoot, 'ci.yml');
const ANGULAR_WORKSPACE_PATH = 'apps/demo-angular/angular.json';

const CI_WORKFLOW = 'ci.yml';
const CODEQL_WORKFLOW = 'codeql.yml';
const DEPENDENCY_REVIEW_WORKFLOW = 'dependency-review.yml';
const DEPENDABOT_CONFIG = 'dependabot.yml';
const CHECKOUT_ACTION = 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1';
const UPLOAD_ARTIFACT_ACTION = 'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a';
const DOWNLOAD_ARTIFACT_ACTION =
  'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c';
const CODECOV_ACTION = 'codecov/codecov-action@fb8b3582c8e4def4969c97caa2f19720cb33a72f';
const CODEQL_ACTION_SHA = 'db488ddef3bf6cb639b32c2e9a7c0a7ea8271d28';
const DEPENDENCY_REVIEW_ACTION =
  'actions/dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294';
const PNPM_SETUP_ACTION = 'pnpm/action-setup@0e279bb959325dab635dd2c09392533439d90093';
const SETUP_NODE_ACTION = 'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020';
const COVERAGE_ARTIFACT_ROOT = '${{ github.workspace }}/packages';
const COVERAGE_REPORT_PATHS = EXPECTED_COVERAGE_PACKAGES.map(
  (name) => `${name}/coverage/lcov.info`
);
const COVERAGE_UPLOAD_PATHS = [...COVERAGE_REPORT_PATHS.map((path) => `packages/${path}`), ''].join(
  '\n'
);
const CODECOV_FILES = COVERAGE_REPORT_PATHS.map((path) => `${COVERAGE_ARTIFACT_ROOT}/${path}`).join(
  ','
);
const COVERAGE_VERIFICATION_SHELL = [
  'set -euo pipefail',
  'for report in \\',
  ...COVERAGE_REPORT_PATHS.map((path, index) => {
    const suffix = index === COVERAGE_REPORT_PATHS.length - 1 ? '; do' : ' \\';
    return `  "$GITHUB_WORKSPACE/packages/${path}"${suffix}`;
  }),
  '  if [ ! -f "$report" ] || [ -L "$report" ] || [ ! -s "$report" ]; then',
  '    echo "Coverage artifact is missing a regular, non-empty report: $report" >&2',
  '    exit 1',
  '  fi',
  'done',
  '',
].join('\n');

const EXPECTED_CI_TRIGGERS = {
  push: { branches: ['main'] },
  pull_request: { branches: ['main'] },
  merge_group: {},
  workflow_dispatch: {},
  schedule: [{ cron: '17 4 * * 1' }],
};

const EXPECTED_CODEQL_WORKFLOW = {
  name: 'CodeQL',
  on: {
    push: { branches: ['main'] },
    pull_request: { branches: ['main'] },
    merge_group: {},
    workflow_dispatch: {},
    schedule: [{ cron: '41 3 * * 4' }],
  },
  concurrency: {
    group: 'codeql-${{ github.workflow }}-${{ github.ref }}',
    'cancel-in-progress': true,
  },
  permissions: { contents: 'read' },
  jobs: {
    analyze: {
      name: 'JavaScript and TypeScript analysis',
      'runs-on': 'ubuntu-24.04',
      'timeout-minutes': 20,
      permissions: {
        contents: 'read',
        'security-events': 'write',
      },
      steps: [
        {
          name: 'Checkout without persisting credentials',
          uses: CHECKOUT_ACTION,
          with: { 'persist-credentials': false },
        },
        {
          name: 'Initialize CodeQL',
          uses: `github/codeql-action/init@${CODEQL_ACTION_SHA}`,
          with: {
            languages: 'javascript-typescript',
            'build-mode': 'none',
          },
        },
        {
          name: 'Analyze',
          uses: `github/codeql-action/analyze@${CODEQL_ACTION_SHA}`,
          with: { category: '/language:javascript-typescript' },
        },
      ],
    },
  },
};

const EXPECTED_CODECOV_JOB = {
  needs: 'build',
  'runs-on': 'ubuntu-24.04',
  'timeout-minutes': 10,
  permissions: {
    contents: 'read',
    'id-token': 'write',
  },
  steps: [
    {
      name: 'Checkout coverage commit metadata',
      uses: CHECKOUT_ACTION,
      with: {
        'fetch-depth': 2,
        'persist-credentials': false,
      },
    },
    {
      name: 'Download coverage reports',
      uses: DOWNLOAD_ARTIFACT_ACTION,
      with: {
        name: 'coverage-reports',
        path: '${{ github.workspace }}/packages',
      },
    },
    {
      name: 'Verify the fixed coverage allowlist',
      shell: 'bash',
      run: COVERAGE_VERIFICATION_SHELL,
    },
    {
      name: 'Upload coverage to Codecov',
      uses: CODECOV_ACTION,
      with: {
        use_oidc:
          "${{ github.event_name != 'pull_request' || !github.event.pull_request.head.repo.fork }}",
        version: 'v11.3.1',
        fail_ci_if_error: true,
        disable_search: true,
        files: CODECOV_FILES,
      },
    },
  ],
};

const EXPECTED_COVERAGE_ARTIFACT_STEP = {
  name: 'Preserve coverage for the isolated upload job',
  uses: UPLOAD_ARTIFACT_ACTION,
  with: {
    name: 'coverage-reports',
    path: COVERAGE_UPLOAD_PATHS,
    'if-no-files-found': 'error',
    'retention-days': 1,
  },
};

const EXPECTED_COVERAGE_TEST_STEP = {
  name: 'Test with coverage',
  run: 'pnpm test:coverage',
};

const EXPECTED_COVERAGE_REPORT_STEP = {
  name: 'Require every coverage report',
  run: 'pnpm test:coverage-reports',
};

const EXPECTED_ACTIONLINT_STEP = {
  name: 'Lint GitHub Actions workflows',
  env: {
    ACTIONLINT_VERSION: '1.7.12',
    ACTIONLINT_SHA256: '8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8',
  },
  run: [
    'set -euo pipefail',
    'archive="$RUNNER_TEMP/actionlint_${ACTIONLINT_VERSION}_linux_amd64.tar.gz"',
    'curl --fail --location --silent --show-error --retry 3 --retry-all-errors \\',
    '  --output "$archive" \\',
    '  "https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/actionlint_${ACTIONLINT_VERSION}_linux_amd64.tar.gz"',
    'echo "$ACTIONLINT_SHA256  $archive" | sha256sum --check --strict',
    'tar --extract --gzip --file "$archive" --directory "$RUNNER_TEMP" actionlint',
    `printf '%s\\n' '{}' > "$RUNNER_TEMP/actionlint.yaml"`,
    '"$RUNNER_TEMP/actionlint" -config-file "$RUNNER_TEMP/actionlint.yaml" -color',
    '',
  ].join('\n'),
};

const EXPECTED_BUILD_CHECKOUT_STEP = {
  name: 'Checkout',
  uses: CHECKOUT_ACTION,
  with: { 'persist-credentials': false },
};

function expectedPnpmSetupStep(version) {
  return {
    name: 'Setup pnpm',
    uses: PNPM_SETUP_ACTION,
    with: { version },
  };
}

const EXPECTED_NODE_SETUP_STEP = {
  name: 'Setup Node.js',
  uses: SETUP_NODE_ACTION,
  with: {
    'node-version-file': '.nvmrc',
    cache: 'pnpm',
    'cache-dependency-path': 'pnpm-lock.yaml',
  },
};

const EXPECTED_INSTALL_STEP = {
  name: 'Install dependencies',
  run: 'pnpm install --frozen-lockfile',
};

const EXPECTED_CI_WIRING_STEP = {
  name: 'Every declared gate runs here',
  shell: 'bash',
  'working-directory': '${{ github.workspace }}',
  run: 'pnpm test:ci-wiring',
};

const FORBIDDEN_GATE_JOB_KEYS = new Set([
  'container',
  'defaults',
  'env',
  'environment',
  'if',
  'needs',
  'services',
  'strategy',
  'uses',
]);

const EXPECTED_DEPENDENCY_REVIEW_WORKFLOW = {
  name: 'Dependency review',
  on: {
    pull_request: { branches: ['main'] },
    merge_group: {},
  },
  concurrency: {
    group: '${{ github.workflow }}-${{ github.ref }}',
    'cancel-in-progress': true,
  },
  permissions: { contents: 'read' },
  jobs: {
    'dependency-review': {
      'runs-on': 'ubuntu-24.04',
      'timeout-minutes': 10,
      steps: [
        {
          name: 'Checkout',
          uses: CHECKOUT_ACTION,
          with: { 'persist-credentials': false },
        },
        {
          name: 'Reject newly introduced vulnerable dependencies',
          uses: DEPENDENCY_REVIEW_ACTION,
          with: { 'fail-on-severity': 'low' },
        },
      ],
    },
  },
};

const EXPECTED_DEPENDABOT_CONFIG = {
  version: 2,
  updates: [
    {
      'package-ecosystem': 'npm',
      directory: '/',
      schedule: {
        interval: 'weekly',
        day: 'monday',
        time: '06:00',
        timezone: 'Europe/Zagreb',
      },
      'open-pull-requests-limit': 0,
      'versioning-strategy': 'increase-if-necessary',
      groups: {
        'production-dependencies': {
          'dependency-type': 'production',
          patterns: ['*'],
          'update-types': ['minor', 'patch'],
        },
        'development-dependencies': {
          'dependency-type': 'development',
          patterns: ['*'],
          'update-types': ['minor', 'patch'],
        },
      },
    },
    {
      'package-ecosystem': 'github-actions',
      directory: '/',
      schedule: {
        interval: 'weekly',
        day: 'monday',
        time: '06:15',
        timezone: 'Europe/Zagreb',
      },
      'open-pull-requests-limit': 0,
      groups: {
        'github-actions': {
          patterns: ['*'],
          'update-types': ['minor', 'patch'],
        },
      },
    },
  ],
};

// Scripts that are not gates, listed one by one rather than matched by shape.
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

// Useful cross-repository diagnostics whose required sibling checkout is not
// present on GitHub-hosted CI. They remain available locally, but invoking one
// in ci.yml would create a green step that enforced nothing.
export const LOCAL_ONLY_SCRIPTS = new Set(['test:dedupe-reachable', 'test:pm-ranges']);

const LOCAL_ONLY_CONTRACTS = {
  'test:dedupe-reachable': {
    full: 'node --test tests/dedupe-reachable/check.test.mjs && node tests/dedupe-reachable/check.mjs',
    unitName: 'test:dedupe-reachable:unit',
    unit: 'node --test tests/dedupe-reachable/check.test.mjs',
  },
  'test:pm-ranges': {
    full: 'node --test tests/pm-ranges/check.test.mjs && node tests/pm-ranges/check.mjs',
    unitName: 'test:pm-ranges:unit',
    unit: 'node --test tests/pm-ranges/check.test.mjs',
  },
};

// The step whose inline loop decides which packages publint and attw see.
const VALIDATION_STEP = 'Validate packages';

const PACKAGE_SCAN_SKIPS = new Set([
  '.angular',
  '.git',
  '.nx',
  '.pnpm-store',
  'coverage',
  'dist',
  'node_modules',
  'vendor',
]);

export function parseWorkflow(workflow) {
  const parsed = YAML.parse(workflow);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError('workflow root must be a mapping');
  }
  if (parsed.jobs === null || typeof parsed.jobs !== 'object' || Array.isArray(parsed.jobs)) {
    throw new TypeError('workflow must declare a jobs mapping');
  }
  return parsed;
}

function parseMapping(document, description) {
  const parsed = YAML.parse(document);
  if (!isRecord(parsed)) throw new TypeError(`${description} root must be a mapping`);
  return parsed;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Native LMDB cache initialization can abort before Angular can fall back. */
export function angularCacheProblems(workspace, path = ANGULAR_WORKSPACE_PATH) {
  return workspace?.cli?.cache?.enabled === false
    ? []
    : [`${path} must explicitly set cli.cache.enabled to false`];
}

function exactStructureProblems(actual, expected, path) {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return [`${path} must be a sequence`];
    const problems = [];
    if (actual.length !== expected.length) {
      problems.push(
        `${path} must contain exactly ${String(expected.length)} entries, found ${String(actual.length)}`
      );
    }
    const sharedLength = Math.min(actual.length, expected.length);
    for (let index = 0; index < sharedLength; index += 1) {
      problems.push(...exactStructureProblems(actual[index], expected[index], `${path}[${index}]`));
    }
    return problems;
  }

  if (isRecord(expected)) {
    if (!isRecord(actual)) return [`${path} must be a mapping`];
    const problems = [];
    const actualKeys = Object.keys(actual);
    const expectedKeys = Object.keys(expected);
    for (const key of expectedKeys) {
      if (!Object.prototype.hasOwnProperty.call(actual, key)) {
        problems.push(`${path} is missing ${JSON.stringify(key)}`);
      }
    }
    for (const key of actualKeys) {
      if (!Object.prototype.hasOwnProperty.call(expected, key)) {
        problems.push(`${path} has unexpected ${JSON.stringify(key)}`);
      }
    }
    for (const key of expectedKeys) {
      if (Object.prototype.hasOwnProperty.call(actual, key)) {
        problems.push(...exactStructureProblems(actual[key], expected[key], `${path}.${key}`));
      }
    }
    return problems;
  }

  return Object.is(actual, expected)
    ? []
    : [`${path} must be ${JSON.stringify(expected)}, found ${JSON.stringify(actual)}`];
}

/** CodeQL's elevated permission is tied to one fully reviewed workflow shape. */
export function codeqlWorkflowProblems(workflow) {
  return exactStructureProblems(parseWorkflow(workflow), EXPECTED_CODEQL_WORKFLOW, CODEQL_WORKFLOW);
}

/** Required CI entry points cannot be deleted or silently narrowed. */
export function ciTriggerProblems(workflow) {
  return exactStructureProblems(
    parseWorkflow(workflow).on,
    EXPECTED_CI_TRIGGERS,
    `${CI_WORKFLOW}.on`
  );
}

/** Dependency review must remain blocking on PR and merge-queue dependency changes. */
export function dependencyReviewWorkflowProblems(workflow) {
  return exactStructureProblems(
    parseWorkflow(workflow),
    EXPECTED_DEPENDENCY_REVIEW_WORKFLOW,
    DEPENDENCY_REVIEW_WORKFLOW
  );
}

/** Keep dependency updates conservative and reviewable. */
export function dependabotConfigProblems(config) {
  return exactStructureProblems(
    parseMapping(config, DEPENDABOT_CONFIG),
    EXPECTED_DEPENDABOT_CONFIG,
    DEPENDABOT_CONFIG
  );
}

function triggerNames(on) {
  if (typeof on === 'string') return [on];
  if (Array.isArray(on)) return on.filter((trigger) => typeof trigger === 'string');
  if (isRecord(on)) return Object.keys(on);
  return [];
}

/** Never execute repository-controlled pull-request code in a privileged target context. */
export function dangerousTriggerProblems(workflow) {
  return triggerNames(parseWorkflow(workflow).on).includes('pull_request_target')
    ? ['workflow uses forbidden pull_request_target trigger']
    : [];
}

function workflowJobEntries(workflow) {
  return Object.entries(parseWorkflow(workflow).jobs).filter(
    ([, job]) => job !== null && typeof job === 'object' && !Array.isArray(job)
  );
}

function workflowJobs(workflow) {
  return workflowJobEntries(workflow).map(([, job]) => job);
}

/** Real GitHub step objects, never matches from comments, names, or `with:` values. */
export function workflowSteps(workflow) {
  return workflowStepEntries(workflow).map(({ step }) => step);
}

function workflowStepEntries(workflow) {
  return workflowJobEntries(workflow).flatMap(([jobId, job]) =>
    Array.isArray(job.steps)
      ? job.steps
          .map((step, index) => ({ jobId, index, step }))
          .filter(({ step }) => isRecord(step))
      : []
  );
}

function liveShell(command) {
  return command
    .split(/\r?\n/)
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
}

function standaloneRootScripts(command) {
  if (typeof command !== 'string') return [];
  const shell = liveShell(command).trim();
  if (shell === '' || /(^|[^<])<<-?\s*/m.test(shell)) return [];
  const commandPattern = /^pnpm\s+(?:(?:--workspace-root|-w)\s+)?(?:run\s+)?([A-Za-z0-9:_-]+)$/;
  const matches = shell.split(/\r?\n/).map((line) => commandPattern.exec(line.trim()));
  return matches.some((match) => match === null) ? [] : matches.map((match) => match[1]);
}

function isExactCiWiringStep(step) {
  return exactStructureProblems(step, EXPECTED_CI_WIRING_STEP, 'ci.yml wiring step').length === 0;
}

function stepHasExecutionOverrides(step) {
  return ['env', 'shell', 'working-directory'].some((key) =>
    Object.prototype.hasOwnProperty.call(step, key)
  );
}

function jobHasExecutionOverrides(job) {
  return [...FORBIDDEN_GATE_JOB_KEYS].some((key) => Object.prototype.hasOwnProperty.call(job, key));
}

/** Root pnpm scripts actually invoked as shell commands by a `run:` step. */
export function scriptInvocations(workflow) {
  const found = new Set();
  const parsed = parseWorkflow(workflow);
  if (
    Object.prototype.hasOwnProperty.call(parsed, 'defaults') ||
    Object.prototype.hasOwnProperty.call(parsed, 'env')
  ) {
    return found;
  }
  for (const [, job] of workflowJobEntries(workflow)) {
    if (jobHasExecutionOverrides(job) || failureCanBeIgnored(job)) continue;
    for (const step of Array.isArray(job.steps) ? job.steps : []) {
      if (!isRecord(step) || typeof step.run !== 'string') continue;
      if (Object.prototype.hasOwnProperty.call(step, 'if') || failureCanBeIgnored(step)) continue;
      if (stepHasExecutionOverrides(step) && !isExactCiWiringStep(step)) continue;
      for (const name of standaloneRootScripts(step.run)) found.add(name);
    }
  }
  return found;
}

/** The job that enforces root gates cannot redefine how or whether they execute. */
export function gateExecutionProblems(workflow, gateNames = []) {
  const parsed = parseWorkflow(workflow);
  const problems = [];
  for (const key of ['defaults', 'env']) {
    if (Object.prototype.hasOwnProperty.call(parsed, key)) {
      problems.push(`ci.yml workflow-level ${key} can alter every gate command`);
    }
  }

  const build = parsed.jobs.build;
  if (!isRecord(build)) return [...problems, 'ci.yml must contain the root gate job "build"'];
  for (const key of FORBIDDEN_GATE_JOB_KEYS) {
    if (Object.prototype.hasOwnProperty.call(build, key)) {
      problems.push(`ci.yml build job must not declare ${key}`);
    }
  }

  const wiringSteps = [];
  const gates = new Set(gateNames);
  for (const [jobId, job] of workflowJobEntries(workflow)) {
    for (const step of Array.isArray(job.steps) ? job.steps : []) {
      if (!isRecord(step)) continue;
      if (step.name === EXPECTED_CI_WIRING_STEP.name) wiringSteps.push({ jobId, step });
      const names = standaloneRootScripts(step.run).filter((name) => gates.has(name));
      if (names.length === 0) continue;
      if (jobId !== 'build') {
        problems.push(`root gate ${names.join(', ')} must execute in the unconditional build job`);
      }
      if (stepHasExecutionOverrides(step) && !isExactCiWiringStep(step)) {
        problems.push(
          `root gate ${names.join(', ')} must not override env, shell or working-directory`
        );
      }
    }
  }

  if (wiringSteps.length !== 1) {
    problems.push(
      `ci.yml must contain exactly one ${JSON.stringify(EXPECTED_CI_WIRING_STEP.name)} step`
    );
  } else {
    const [{ jobId, step }] = wiringSteps;
    if (jobId !== 'build') problems.push('ci.yml wiring step must execute in job "build"');
    problems.push(...exactStructureProblems(step, EXPECTED_CI_WIRING_STEP, 'ci.yml wiring step'));
  }
  return problems;
}

/** Every `test:`-prefixed script that is meant to run in CI, plus the rest of the checks. */
export function gateScripts(manifest) {
  const declared = Object.keys(manifest.scripts ?? {});
  const tests = declared.filter(
    (name) => name.startsWith('test:') && !NOT_GATES.has(name) && !LOCAL_ONLY_SCRIPTS.has(name)
  );
  const required = REQUIRED_SCRIPTS.filter((name) => declared.includes(name));
  return [...new Set([...tests, ...required])].sort();
}

/** The gate scripts the workflow never invokes. */
export function unwiredScripts(scripts, workflow) {
  const invoked = scriptInvocations(workflow);
  return scripts.filter((name) => !invoked.has(name));
}

/** Package directories named by the validation step, and only by it. */
export function validatedPackages(workflow) {
  const step = workflowSteps(workflow).find(({ name }) => name === VALIDATION_STEP);
  if (!step || typeof step.run !== 'string') return null;
  const found = new Set();
  for (const match of liveShell(step.run).matchAll(/packages\/[A-Za-z0-9._-]+/g)) {
    found.add(match[0]);
  }
  return [...found].sort();
}

/** Conditional jobs/steps are not unconditional repository gates. */
export function skippedSteps(workflow) {
  const found = [];
  for (const [jobId, job] of workflowJobEntries(workflow)) {
    if (Object.prototype.hasOwnProperty.call(job, 'if')) {
      found.push(`job ${jobId} if: ${String(job.if)}`);
    }
    for (const step of Array.isArray(job.steps) ? job.steps : []) {
      if (!isRecord(step) || !Object.prototype.hasOwnProperty.call(step, 'if')) continue;
      const name = typeof step.name === 'string' ? step.name : '<unnamed>';
      found.push(`step ${name} if: ${String(step.if)}`);
    }
  }
  return found;
}

function failureCanBeIgnored(value) {
  return (
    Object.prototype.hasOwnProperty.call(value, 'continue-on-error') &&
    value['continue-on-error'] !== false
  );
}

/** A wired gate must still be allowed to fail the workflow. */
export function nonBlockingChecks(workflow) {
  const found = [];
  for (const [jobId, job] of workflowJobEntries(workflow)) {
    if (failureCanBeIgnored(job)) found.push(`job ${jobId}`);
    for (const step of Array.isArray(job.steps) ? job.steps : []) {
      if (isRecord(step) && failureCanBeIgnored(step)) {
        found.push(`step ${typeof step.name === 'string' ? step.name : '<unnamed>'}`);
      }
    }
  }
  return found;
}

/** External actions must use an immutable full commit SHA. */
export function unpinnedActions(workflow) {
  const references = [];
  for (const job of workflowJobs(workflow)) {
    if (typeof job.uses === 'string') references.push(job.uses);
    const containerImage = typeof job.container === 'string' ? job.container : job.container?.image;
    if (typeof containerImage === 'string') references.push(`docker://${containerImage}`);
    if (isRecord(job.services)) {
      for (const service of Object.values(job.services)) {
        if (isRecord(service) && typeof service.image === 'string') {
          references.push(`docker://${service.image}`);
        }
      }
    }
  }
  for (const step of workflowSteps(workflow)) {
    if (typeof step.uses === 'string') references.push(step.uses);
  }
  return references.filter((reference) => {
    if (reference.startsWith('./')) return false;
    if (reference.startsWith('docker://')) {
      return !/@sha256:[0-9a-f]{64}$/.test(reference);
    }
    return !/@[0-9a-fA-F]{40}$/.test(reference);
  });
}

/** Local actions are mutable code and are not recursively audited by this gate. */
export function localActionReferences(workflow) {
  const references = [];
  for (const job of workflowJobs(workflow)) {
    if (typeof job.uses === 'string' && job.uses.startsWith('./')) references.push(job.uses);
  }
  for (const step of workflowSteps(workflow)) {
    if (typeof step.uses === 'string' && step.uses.startsWith('./')) references.push(step.uses);
  }
  return references;
}

/** Checkout credentials are unnecessary in a read-only validation workflow. */
export function checkoutStepsWithPersistedCredentials(workflow) {
  return workflowSteps(workflow)
    .filter(
      ({ uses }) => typeof uses === 'string' && uses.toLowerCase().startsWith('actions/checkout@')
    )
    .filter((step) => step.with?.['persist-credentials'] !== false)
    .map(({ name, uses }) => (typeof name === 'string' ? name : uses));
}

export function unapprovedRunners(workflow) {
  return workflowJobEntries(workflow)
    .filter(([, job]) => job['runs-on'] !== 'ubuntu-24.04')
    .map(([jobId, job]) => `${jobId}: ${JSON.stringify(job['runs-on'])}`);
}

function permissionBlockProblems(
  block,
  scope,
  { allowOidc = false, allowSecurityEvents = false } = {}
) {
  if (block === 'write-all' || block === 'read-all') {
    return [`${scope} uses broad ${JSON.stringify(block)} permissions`];
  }
  if (block === null || typeof block !== 'object' || Array.isArray(block)) {
    return [`${scope} permissions must be a mapping limited to the access this CI uses`];
  }

  const problems = [];
  for (const [permission, access] of Object.entries(block)) {
    if (access === 'none') continue;
    if (permission === 'contents' && access === 'read') continue;
    if (permission === 'id-token' && access === 'write' && allowOidc) continue;
    if (permission === 'security-events' && access === 'write' && allowSecurityEvents) continue;
    problems.push(`${scope} grants unnecessary ${permission}: ${String(access)} permission`);
  }
  return problems;
}

/** Elevated permissions are isolated to the exact reviewed Codecov and CodeQL jobs. */
export function leastPrivilegePermissionProblems(workflow, { workflowName } = {}) {
  const parsed = parseWorkflow(workflow);
  if (!Object.prototype.hasOwnProperty.call(parsed, 'permissions')) {
    return ['workflow has no explicit permissions block'];
  }

  const problems = permissionBlockProblems(parsed.permissions, 'workflow');
  const isExactCodeqlWorkflow =
    workflowName === CODEQL_WORKFLOW &&
    exactStructureProblems(parsed, EXPECTED_CODEQL_WORKFLOW, CODEQL_WORKFLOW).length === 0;
  for (const [jobId, job] of workflowJobEntries(workflow)) {
    if (!Object.prototype.hasOwnProperty.call(job, 'permissions')) continue;
    const isExactCodecovJob =
      workflowName === CI_WORKFLOW &&
      jobId === 'coverage' &&
      exactStructureProblems(job, EXPECTED_CODECOV_JOB, `${CI_WORKFLOW}.jobs.coverage`).length ===
        0;
    problems.push(
      ...permissionBlockProblems(job.permissions, `job ${jobId}`, {
        allowOidc: isExactCodecovJob,
        allowSecurityEvents: isExactCodeqlWorkflow && jobId === 'analyze',
      })
    );
  }
  return problems;
}

/** Keep the checksum-verified actionlint bootstrap from being quietly deleted. */
export function actionlintProblems(workflow) {
  const matches = workflowStepEntries(workflow).filter(
    ({ step }) => step.name === EXPECTED_ACTIONLINT_STEP.name
  );
  if (matches.length !== 1) {
    return [`ci.yml must have exactly one actionlint step, found ${String(matches.length)}`];
  }
  const [{ jobId, step }] = matches;
  const problems = [];
  if (jobId !== 'build') problems.push('ci.yml actionlint step must execute in job "build"');
  problems.push(
    ...exactStructureProblems(step, EXPECTED_ACTIONLINT_STEP, 'ci.yml actionlint step')
  );
  return problems;
}

/** The reviewed checkout, tool versions and frozen install form one exact build prefix. */
export function pnpmSetupProblems(
  manifest,
  workflow,
  nvmrc = readFileSync(join(repoRoot, '.nvmrc'), 'utf8')
) {
  const problems = [];
  const match = /^pnpm@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(manifest.packageManager ?? '');
  if (!match) return ['packageManager must pin one exact pnpm version'];
  if (!/^\d+\.\d+\.\d+\n?$/.test(nvmrc)) {
    problems.push('.nvmrc must contain one exact MAJOR.MINOR.PATCH Node version');
  }

  const entries = workflowStepEntries(workflow);
  const pnpmSetups = entries.filter(
    ({ step }) => typeof step.uses === 'string' && step.uses.startsWith('pnpm/action-setup@')
  );
  if (pnpmSetups.length !== 1) {
    problems.push(
      `ci.yml must have exactly one pnpm/action-setup step, found ${String(pnpmSetups.length)}`
    );
  }
  const nodeSetups = entries.filter(
    ({ step }) => typeof step.uses === 'string' && step.uses.startsWith('actions/setup-node@')
  );
  if (nodeSetups.length !== 1) {
    problems.push(
      `ci.yml must have exactly one actions/setup-node step, found ${String(nodeSetups.length)}`
    );
  }

  const build = parseWorkflow(workflow).jobs.build;
  const buildSteps = isRecord(build) && Array.isArray(build.steps) ? build.steps : [];
  const expectedPrefix = [
    EXPECTED_BUILD_CHECKOUT_STEP,
    EXPECTED_ACTIONLINT_STEP,
    expectedPnpmSetupStep(match[1]),
    EXPECTED_NODE_SETUP_STEP,
    EXPECTED_INSTALL_STEP,
    EXPECTED_CI_WIRING_STEP,
  ];
  problems.push(
    ...exactStructureProblems(
      buildSteps.slice(0, expectedPrefix.length),
      expectedPrefix,
      'ci.yml build bootstrap'
    )
  );
  return problems;
}

/** A nested Corepack pin must not select a different pnpm than the root/CI. */
export function packageManagerConsistencyProblems(rootManifest, nestedManifests) {
  const expected = rootManifest.packageManager;
  return nestedManifests
    .filter(({ manifest }) => manifest.packageManager !== undefined)
    .filter(({ manifest }) => manifest.packageManager !== expected)
    .map(
      ({ path, manifest }) =>
        `${path} pins ${JSON.stringify(manifest.packageManager)}, but the root pins ${JSON.stringify(expected)}`
    );
}

function nestedPackageManifests(directory = repoRoot) {
  const manifests = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        if (PACKAGE_SCAN_SKIPS.has(entry.name) || existsSync(join(path, '.git'))) continue;
        walk(path);
      } else if (entry.isFile() && entry.name === 'package.json' && current !== directory) {
        manifests.push({
          path: relative(directory, path).replaceAll('\\', '/'),
          manifest: JSON.parse(readFileSync(path, 'utf8')),
        });
      }
    }
  };
  walk(directory);
  return manifests;
}

/** Only the fixed lcov allowlist may cross into the OIDC upload job. */
export function coverageArtifactProblems(workflow) {
  const producers = workflowStepEntries(workflow).filter(
    ({ step }) =>
      typeof step.uses === 'string' &&
      step.uses.toLowerCase().startsWith('actions/upload-artifact@') &&
      step.with?.name === 'coverage-reports'
  );
  if (producers.length !== 1) {
    return [
      `ci.yml must have exactly one coverage-reports artifact producer, found ${String(producers.length)}`,
    ];
  }
  const [{ jobId, index, step }] = producers;
  const problems = [];
  if (jobId !== 'build') {
    problems.push('ci.yml coverage artifact producer must execute in job "build"');
  }
  problems.push(
    ...exactStructureProblems(
      step,
      EXPECTED_COVERAGE_ARTIFACT_STEP,
      'ci.yml coverage artifact step'
    )
  );
  const build = parseWorkflow(workflow).jobs.build;
  const buildSteps = isRecord(build) && Array.isArray(build.steps) ? build.steps : [];
  problems.push(
    ...exactStructureProblems(
      buildSteps.slice(index - 2, index),
      [EXPECTED_COVERAGE_TEST_STEP, EXPECTED_COVERAGE_REPORT_STEP],
      'ci.yml coverage producer prerequisites'
    )
  );
  return problems;
}

/** OIDC belongs only to the isolated, pinned Codecov upload job. */
export function codecovProblems(workflow) {
  const parsed = parseWorkflow(workflow);
  const problems = [];
  if (parsed.permissions?.['id-token'] === 'write') {
    problems.push('workflow-level id-token: write exposes OIDC to every job');
  }
  const uploads = [];
  for (const [jobId, job] of workflowJobEntries(workflow)) {
    for (const step of Array.isArray(job.steps) ? job.steps : []) {
      if (
        step !== null &&
        typeof step === 'object' &&
        typeof step.uses === 'string' &&
        step.uses.startsWith('codecov/codecov-action@')
      ) {
        uploads.push({ jobId, job, step });
      }
    }
  }
  if (uploads.length !== 1) {
    problems.push(
      `ci.yml must have exactly one Codecov upload step, found ${String(uploads.length)}`
    );
    return problems;
  }
  const [{ jobId, job, step }] = uploads;
  if (jobId !== 'coverage') {
    problems.push(`Codecov upload must be isolated in ci.yml job "coverage", found ${jobId}`);
  }
  if (job.permissions?.['id-token'] !== 'write') {
    problems.push(`Codecov job ${jobId} has no id-token: write permission`);
  }
  for (const [otherId, otherJob] of workflowJobEntries(workflow)) {
    if (otherId !== jobId && otherJob.permissions?.['id-token'] === 'write') {
      problems.push(`non-Codecov job ${otherId} has id-token: write permission`);
    }
  }
  if (!/^v\d+\.\d+\.\d+$/.test(String(step.with?.version ?? ''))) {
    problems.push('Codecov CLI version must be pinned to an exact vMAJOR.MINOR.PATCH');
  }
  if (!Object.prototype.hasOwnProperty.call(step.with ?? {}, 'use_oidc')) {
    problems.push('Codecov upload does not declare its OIDC policy');
  }
  problems.push(
    ...exactStructureProblems(job, EXPECTED_CODECOV_JOB, `${CI_WORKFLOW}.jobs.coverage`)
  );
  return problems;
}

function expectedPackageValidationShell(packages) {
  return [
    `for pkg in ${packages.join(' ')}; do`,
    '  echo "--- Validating $pkg ---"',
    '  cd "$pkg"',
    '  pnpm exec publint --strict',
    '  if [ "$pkg" != "packages/theme" ] && [ "$pkg" != "packages/angular" ]; then',
    '    if [ "$pkg" = "packages/react" ] || [ "$pkg" = "packages/vue" ] || [ "$pkg" = "packages/vanilla" ]; then',
    '      pnpm exec attw --pack --profile esm-only',
    '    else',
    '      pnpm exec attw --pack',
    '    fi',
    '  fi',
    '  cd "$GITHUB_WORKSPACE"',
    'done',
  ].join('\n');
}

/** Every publishable package must execute the reviewed publint/attw loop. */
export function packageValidationProblems(workflow, packages) {
  const matches = workflowStepEntries(workflow).filter(({ step }) => step.name === VALIDATION_STEP);
  if (matches.length !== 1) {
    return [`ci.yml must have exactly one ${JSON.stringify(VALIDATION_STEP)} step`];
  }
  const [{ jobId, step }] = matches;
  const problems = [];
  if (jobId !== 'build') {
    problems.push(`ci.yml ${VALIDATION_STEP} step must execute in job "build"`);
  }
  const actual = typeof step.run === 'string' ? liveShell(step.run).trim() : '';
  const expected = expectedPackageValidationShell(packages);
  problems.push(
    ...exactStructureProblems(
      { ...step, run: actual },
      { name: VALIDATION_STEP, run: expected },
      `ci.yml ${VALIDATION_STEP} step`
    )
  );
  return problems;
}

function main() {
  const manifest = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  const workflow = readFileSync(workflowPath, 'utf8');
  const failures = [];

  const angularWorkspace = JSON.parse(readFileSync(join(repoRoot, ANGULAR_WORKSPACE_PATH), 'utf8'));
  for (const problem of angularCacheProblems(angularWorkspace)) failures.push(problem);

  try {
    parseWorkflow(workflow);
  } catch (error) {
    console.error(
      `[ci-wiring] FAILED:\n  - ci.yml is not a valid workflow structure: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    process.exit(1);
  }

  for (const name of REQUIRED_SCRIPTS) {
    if (!Object.keys(manifest.scripts ?? {}).includes(name)) {
      failures.push(`this gate requires a "${name}" script, which package.json no longer declares`);
    }
  }

  const scripts = gateScripts(manifest);
  for (const problem of gateExecutionProblems(workflow, scripts)) failures.push(problem);
  for (const name of unwiredScripts(scripts, workflow)) {
    failures.push(
      `package.json declares "${name}" but .github/workflows/ci.yml never runs it, ` +
        'so it guards nothing on a pull request'
    );
  }

  for (const skipped of skippedSteps(workflow)) {
    failures.push(`ci.yml carries conditional ${skipped}, so it is not an unconditional gate`);
  }
  // Local-only checks must remain executable locally and absent from hosted CI.
  const invoked = scriptInvocations(workflow);
  for (const name of LOCAL_ONLY_SCRIPTS) {
    const contract = LOCAL_ONLY_CONTRACTS[name];
    if (manifest.scripts?.[name] !== contract.full) {
      failures.push(`package.json must keep the reviewed full local-only script "${name}"`);
      continue;
    }
    if (manifest.scripts?.[contract.unitName] !== contract.unit) {
      failures.push(
        `package.json must keep the deterministic CI script "${contract.unitName}" for "${name}"`
      );
    }
    if (invoked.has(name)) {
      failures.push(
        `ci.yml runs local-only "${name}", which self-skips without a sibling repository checkout`
      );
    }
  }

  // The other direction: a step invoking a script that no longer exists would
  // fail the build with a confusing pnpm error rather than a useful one.
  const declared = new Set(Object.keys(manifest.scripts ?? {}));
  for (const name of invoked) {
    if (name.startsWith('test:') && !declared.has(name)) {
      failures.push(`ci.yml runs "pnpm ${name}", which package.json does not declare`);
    }
  }

  // Supply-chain policy applies to every workflow, including focused workflows
  // that do not invoke package.json scripts and therefore are outside the
  // script-wiring checks above.
  const workflowNames = readdirSync(workflowsRoot)
    .filter((name) => /\.ya?ml$/.test(name))
    .sort();
  if (!workflowNames.includes(CODEQL_WORKFLOW)) {
    failures.push(`${CODEQL_WORKFLOW} is missing, so CodeQL never scans the repository`);
  }
  if (!workflowNames.includes(DEPENDENCY_REVIEW_WORKFLOW)) {
    failures.push(
      `${DEPENDENCY_REVIEW_WORKFLOW} is missing, so dependency changes are never reviewed`
    );
  }
  for (const workflowName of workflowNames) {
    const candidate = readFileSync(join(workflowsRoot, workflowName), 'utf8');
    try {
      parseWorkflow(candidate);
    } catch (error) {
      failures.push(
        `${workflowName} is not a valid workflow structure: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      continue;
    }
    for (const problem of leastPrivilegePermissionProblems(candidate, { workflowName })) {
      failures.push(`${workflowName} ${problem}`);
    }
    for (const problem of dangerousTriggerProblems(candidate)) {
      failures.push(`${workflowName} ${problem}`);
    }
    if (workflowName === CODEQL_WORKFLOW) {
      for (const problem of codeqlWorkflowProblems(candidate)) {
        failures.push(`${workflowName} ${problem}`);
      }
    }
    if (workflowName === CI_WORKFLOW) {
      for (const problem of ciTriggerProblems(candidate)) failures.push(problem);
    }
    if (workflowName === DEPENDENCY_REVIEW_WORKFLOW) {
      for (const problem of dependencyReviewWorkflowProblems(candidate)) {
        failures.push(`${workflowName} ${problem}`);
      }
    }
    if (
      workflowName !== CI_WORKFLOW &&
      workflowSteps(candidate).some(
        ({ uses }) =>
          typeof uses === 'string' && uses.toLowerCase().startsWith('codecov/codecov-action@')
      )
    ) {
      failures.push(`${workflowName} runs Codecov outside the exact reviewed ci.yml coverage job`);
    }
    for (const reference of unpinnedActions(candidate)) {
      failures.push(
        `${workflowName} uses mutable external reference "${reference}" instead of a full commit SHA or image digest`
      );
    }
    for (const reference of localActionReferences(candidate)) {
      failures.push(
        `${workflowName} uses local action "${reference}", whose implementation is not recursively audited`
      );
    }
    for (const checkout of checkoutStepsWithPersistedCredentials(candidate)) {
      failures.push(
        `${workflowName} checkout step "${checkout}" must set persist-credentials: false`
      );
    }
    for (const runner of unapprovedRunners(candidate)) {
      failures.push(`${workflowName} job ${runner} must use the reviewed ubuntu-24.04 runner`);
    }
    for (const nonBlocking of nonBlockingChecks(candidate)) {
      failures.push(`${workflowName} ${nonBlocking} can ignore failures through continue-on-error`);
    }
  }

  for (const problem of actionlintProblems(workflow)) failures.push(problem);
  for (const problem of pnpmSetupProblems(manifest, workflow)) failures.push(problem);
  for (const problem of packageManagerConsistencyProblems(manifest, nestedPackageManifests())) {
    failures.push(problem);
  }
  for (const problem of codecovProblems(workflow)) failures.push(problem);
  for (const problem of coverageArtifactProblems(workflow)) failures.push(problem);

  const expected = discoverPublishablePackages().map(({ name }) => `packages/${name}`);
  for (const problem of packageValidationProblems(workflow, expected)) failures.push(problem);
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

  const dependabotPath = join(repoRoot, '.github', DEPENDABOT_CONFIG);
  if (!existsSync(dependabotPath)) {
    failures.push(
      `${DEPENDABOT_CONFIG} is missing, so automated dependency maintenance is disabled`
    );
  } else {
    try {
      for (const problem of dependabotConfigProblems(readFileSync(dependabotPath, 'utf8'))) {
        failures.push(problem);
      }
    } catch (error) {
      failures.push(
        `${DEPENDABOT_CONFIG} is not valid YAML: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  if (failures.length > 0) {
    console.error('[ci-wiring] FAILED:');
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }

  console.log(
    `[ci-wiring] OK - ${String(scripts.length)} checks enforced in CI, ` +
      `${String(expected.length)} packages validated by publint and attw ` +
      `(local-only: ${[...LOCAL_ONLY_SCRIPTS].join(', ')})`
  );
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
