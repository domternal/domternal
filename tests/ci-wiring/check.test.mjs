/** Fixture tests for the wiring gate's YAML-aware workflow inspection. */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LOCAL_ONLY_SCRIPTS,
  NOT_GATES,
  REQUIRED_SCRIPTS,
  actionlintProblems,
  checkoutStepsWithPersistedCredentials,
  ciTriggerProblems,
  codeqlWorkflowProblems,
  codecovProblems,
  coverageArtifactProblems,
  dangerousTriggerProblems,
  dependabotConfigProblems,
  dependencyReviewWorkflowProblems,
  gateExecutionProblems,
  gateScripts,
  leastPrivilegePermissionProblems,
  localActionReferences,
  nonBlockingChecks,
  packageManagerConsistencyProblems,
  packageValidationProblems,
  parseWorkflow,
  pnpmSetupProblems,
  scriptInvocations,
  skippedSteps,
  unapprovedRunners,
  unpinnedActions,
  unwiredScripts,
  validatedPackages,
} from './check.mjs';

const repoRoot = new URL('../../', import.meta.url);
const realCi = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
const realDependencyReview = readFileSync(
  new URL('../../.github/workflows/dependency-review.yml', import.meta.url),
  'utf8'
);
const realDependabot = readFileSync(
  new URL('../../.github/dependabot.yml', import.meta.url),
  'utf8'
);

function workflow(steps, extraJobs = '') {
  const indented = steps
    .split('\n')
    .map((line) => `      ${line}`)
    .join('\n');
  return `name: fixture\njobs:\n  test:\n    runs-on: ubuntu-24.04\n    steps:\n${indented}${extraJobs}`;
}

function codeqlWorkflow() {
  return `name: CodeQL
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  merge_group: {}
  workflow_dispatch: {}
  schedule:
    - cron: '41 3 * * 4'
concurrency:
  group: codeql-${'${{ github.workflow }}'}-${'${{ github.ref }}'}
  cancel-in-progress: true
permissions:
  contents: read
jobs:
  analyze:
    name: JavaScript and TypeScript analysis
    runs-on: ubuntu-24.04
    timeout-minutes: 20
    permissions:
      contents: read
      security-events: write
    steps:
      - name: Checkout without persisting credentials
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1
        with:
          persist-credentials: false
      - name: Initialize CodeQL
        uses: github/codeql-action/init@db488ddef3bf6cb639b32c2e9a7c0a7ea8271d28
        with:
          languages: javascript-typescript
          build-mode: none
      - name: Analyze
        uses: github/codeql-action/analyze@db488ddef3bf6cb639b32c2e9a7c0a7ea8271d28
        with:
          category: /language:javascript-typescript
`;
}

test('exception lists are pinned, so one word cannot silently remove a gate', () => {
  assert.deepEqual([...NOT_GATES].sort(), [
    'test',
    'test:api-surface:update',
    'test:e2e',
    'test:e2e:matrix',
  ]);
  assert.deepEqual([...LOCAL_ONLY_SCRIPTS].sort(), ['test:dedupe-reachable', 'test:pm-ranges']);
  assert.deepEqual(REQUIRED_SCRIPTS, ['build', 'lint', 'typecheck', 'typecheck:e2e']);
});

test('checks that are not test:-prefixed are held down too', () => {
  const manifest = {
    scripts: {
      build: 'nx build',
      lint: 'eslint .',
      typecheck: 'tsc',
      'typecheck:e2e': 'tsc -p e2e',
      'test:css-vars': 'node x',
      'test:pm-ranges': 'node local-only',
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
  assert.deepEqual(unwiredScripts(gateScripts(manifest), workflow('- run: pnpm lint')), [
    'build',
    'test:css-vars',
    'typecheck',
    'typecheck:e2e',
  ]);
});

test('only commands from run fields count as invocations', () => {
  const fixture = workflow(
    [
      '- name: pnpm test:name-only',
      '  uses: owner/action@0123456789012345678901234567890123456789',
      '  with:',
      '    text: pnpm test:with-only',
      '- name: real command',
      '  run: pnpm test:real',
    ].join('\n')
  );
  assert.deepEqual([...scriptInvocations(fixture)], ['test:real']);
});

test('a commented-out shell command does not count as wired', () => {
  const fixture = workflow(
    ['- name: SSR', '  run: |', '    # pnpm test:ssr-import', '    # pnpm lint'].join('\n')
  );
  assert.deepEqual(unwiredScripts(['test:ssr-import', 'lint'], fixture), [
    'test:ssr-import',
    'lint',
  ]);
});

test('every conditional job or step is excluded from unconditional gates', () => {
  assert.deepEqual(skippedSteps(workflow('- if: false\n  run: pnpm test:x')), [
    'step <unnamed> if: false',
  ]);
  assert.deepEqual(skippedSteps(workflow('- if: ${{ false }}\n  run: pnpm test:x')), [
    'step <unnamed> if: ${{ false }}',
  ]);
  assert.deepEqual(
    skippedSteps(workflow("- if: github.event_name == 'push'\n  run: pnpm test:x")),
    ["step <unnamed> if: github.event_name == 'push'"]
  );
  assert.deepEqual(
    skippedSteps(
      workflow(
        '- run: pnpm test:x',
        '\n  conditional:\n    if: false\n    runs-on: ubuntu-24.04\n    steps: []\n'
      )
    ),
    ['job conditional if: false']
  );
  assert.deepEqual(
    [...scriptInvocations(workflow("- if: github.event_name == 'push'\n  run: pnpm test:x"))],
    []
  );
});

test('a package named anywhere else does not count as validated', () => {
  const fixture = workflow(
    [
      '- name: Upload coverage',
      '  with:',
      '    files: ./packages/core/coverage/lcov.info',
      '- name: Validate packages',
      '  run: |',
      '    for pkg in packages/theme packages/pm; do',
      '      cd "$pkg"',
      '    done',
    ].join('\n')
  );
  assert.deepEqual(validatedPackages(fixture), ['packages/pm', 'packages/theme']);
  assert.equal(validatedPackages(workflow('- name: Lint\n  run: pnpm lint')), null);
});

test('prefix-sharing scripts do not satisfy each other', () => {
  const updater = workflow('- run: pnpm test:api-surface:update');
  assert.deepEqual(unwiredScripts(['test:api-surface'], updater), ['test:api-surface']);
  assert.deepEqual(unwiredScripts(['test:api-surface:update'], updater), []);

  const artifacts = workflow('- run: pnpm test:package-artifacts');
  assert.deepEqual(unwiredScripts(['test:package'], artifacts), ['test:package']);
  assert.deepEqual(unwiredScripts(['test:package-artifacts'], artifacts), []);
});

test('multiple real commands in one run block are found', () => {
  const fixture = workflow(
    [
      '- name: Gates',
      '  run: |',
      '    pnpm test:css-vars',
      '    pnpm test:bundle-size',
      '    pnpm test:externals',
    ].join('\n')
  );
  assert.deepEqual(
    unwiredScripts(['test:css-vars', 'test:bundle-size', 'test:externals'], fixture),
    []
  );
});

test('workflow defaults and per-gate execution overrides fail closed', () => {
  const gates = ['lint', 'test:ci-wiring'];
  assert.deepEqual(gateExecutionProblems(realCi, gates), []);

  const workflowShell = realCi.replace(
    'jobs:\n',
    'defaults:\n  run:\n    shell: true {0}\njobs:\n'
  );
  assert.notDeepEqual(gateExecutionProblems(workflowShell, gates), []);
  assert.deepEqual([...scriptInvocations(workflowShell)], []);

  const jobDefaults = realCi.replace(
    '  build:\n',
    '  build:\n    defaults:\n      run:\n        shell: true {0}\n'
  );
  assert.notDeepEqual(gateExecutionProblems(jobDefaults, gates), []);
  assert.deepEqual([...scriptInvocations(jobDefaults)], []);

  const emptyStrategy = realCi.replace(
    '  build:\n',
    '  build:\n    strategy:\n      matrix:\n        node: []\n'
  );
  assert.notDeepEqual(gateExecutionProblems(emptyStrategy, gates), []);

  for (const override of [
    '        shell: true {0}\n',
    '        working-directory: packages/core\n',
    '        env:\n          PATH: ./attacker-bin\n',
  ]) {
    const changed = realCi.replace(
      '      - name: Lint\n        run: pnpm lint\n',
      `      - name: Lint\n${override}        run: pnpm lint\n`
    );
    assert.notDeepEqual(gateExecutionProblems(changed, gates), [], override);
    assert.equal(scriptInvocations(changed).has('lint'), false, override);
  }

  const disabledChecker = realCi.replace('        shell: bash\n', '        shell: true {0}\n');
  assert.notDeepEqual(gateExecutionProblems(disabledChecker, gates), []);
});

test('wrappers, swallowed failures, pipes and heredocs never impersonate gates', () => {
  for (const command of [
    'true || pnpm test:x',
    'pnpm test:x || true',
    'pnpm test:x | tee result.txt',
    'if true; then pnpm test:x; fi',
    'pnpm test:x --unexpected-argument',
    "printf '%s\\n' 'pnpm test:x'",
  ]) {
    assert.deepEqual([...scriptInvocations(workflow(`- run: ${command}`))], [], command);
  }

  const heredoc = workflow('- run: |\n    cat <<EOF\n    pnpm test:x\n    EOF');
  assert.deepEqual([...scriptInvocations(heredoc)], []);

  const mixedBlock = workflow('- run: |\n    pnpm test:x\n    echo later');
  assert.deepEqual([...scriptInvocations(mixedBlock)], []);
});

test('filtered package commands do not impersonate a root gate', () => {
  const fixture = workflow('- run: pnpm --filter demo-angular typecheck\n- run: pnpm -r run build');
  assert.deepEqual([...scriptInvocations(fixture)], []);
  assert.deepEqual(unwiredScripts(['typecheck', 'build'], fixture), ['typecheck', 'build']);
});

test('invalid or incomplete YAML is rejected before wiring checks', () => {
  assert.throws(() => parseWorkflow('jobs: [not-a-mapping]'), /jobs mapping/);
  assert.throws(() => parseWorkflow('jobs:\n  x: ['));
});

test('external actions and Docker images require immutable digests', () => {
  const fixture = workflow(
    [
      '- uses: actions/checkout@v7',
      '- uses: owner/pinned@0123456789012345678901234567890123456789',
      '- uses: ./local-action',
      '- uses: docker://rhysd/actionlint:1.7.12',
      `- uses: docker://example/image@sha256:${'a'.repeat(64)}`,
    ].join('\n'),
    `
  reusable:
    uses: owner/workflow@main
  containerized:
    runs-on: ubuntu-24.04
    container:
      image: node:22
    services:
      postgres:
        image: postgres:17
      redis:
        image: redis@sha256:${'b'.repeat(64)}
    steps: []
`
  );
  assert.deepEqual(unpinnedActions(fixture).sort(), [
    'actions/checkout@v7',
    'docker://node:22',
    'docker://postgres:17',
    'docker://rhysd/actionlint:1.7.12',
    'owner/workflow@main',
  ]);
  assert.deepEqual(localActionReferences(fixture), ['./local-action']);
});

test('every checkout disables persisted credentials', () => {
  const fixture = workflow(
    [
      '- name: hardened',
      '  uses: actions/checkout@0123456789012345678901234567890123456789',
      '  with:',
      '    persist-credentials: false',
      '- name: default credentials',
      '  uses: actions/checkout@0123456789012345678901234567890123456789',
    ].join('\n')
  );
  assert.deepEqual(checkoutStepsWithPersistedCredentials(fixture), ['default credentials']);
});

test('continue-on-error cannot turn a wired gate into a non-blocking step', () => {
  const fixture = workflow(
    ['- name: ignored', '  continue-on-error: true', '  run: pnpm test:css-vars'].join('\n'),
    '\n  ignored-job:\n    continue-on-error: ${{ true }}\n    runs-on: ubuntu-24.04\n    steps: []\n'
  );
  assert.deepEqual(nonBlockingChecks(fixture), ['step ignored', 'job ignored-job']);
  assert.deepEqual([...scriptInvocations(fixture)], []);

  const expression = workflow(
    "- name: maybe ignored\n  continue-on-error: ${{ github.event_name == 'push' }}\n  run: pnpm test:x"
  );
  assert.deepEqual(nonBlockingChecks(expression), ['step maybe ignored']);
  assert.deepEqual([...scriptInvocations(expression)], []);
});

test('runner labels are immutable and workflow permissions are least-privilege', () => {
  assert.deepEqual(unapprovedRunners(workflow('- run: pnpm lint')), []);
  const floating = workflow('- run: pnpm lint').replace('ubuntu-24.04', 'ubuntu-latest');
  assert.deepEqual(unapprovedRunners(floating), ['test: "ubuntu-latest"']);
  const arrayRunner = workflow('- run: pnpm lint').replace(
    'runs-on: ubuntu-24.04',
    'runs-on: [ubuntu-latest]'
  );
  assert.deepEqual(unapprovedRunners(arrayRunner), ['test: ["ubuntu-latest"]']);
  const expressionRunner = workflow('- run: pnpm lint').replace(
    'runs-on: ubuntu-24.04',
    'runs-on: ${{ matrix.runner }}'
  );
  assert.deepEqual(unapprovedRunners(expressionRunner), ['test: "${{ matrix.runner }}"']);
  assert.deepEqual(leastPrivilegePermissionProblems(workflow('- run: pnpm lint')), [
    'workflow has no explicit permissions block',
  ]);
  assert.deepEqual(
    leastPrivilegePermissionProblems(
      `name: fixture\npermissions:\n  contents: read\njobs:\n  x:\n    runs-on: ubuntu-24.04\n`
    ),
    []
  );
  assert.match(
    leastPrivilegePermissionProblems(
      `name: fixture\npermissions: write-all\njobs:\n  x:\n    runs-on: ubuntu-24.04\n`
    ).join('\n'),
    /write-all/
  );
  assert.match(
    leastPrivilegePermissionProblems(
      `name: fixture\npermissions:\n  contents: write\njobs:\n  x:\n    runs-on: ubuntu-24.04\n`
    ).join('\n'),
    /contents: write/
  );
});

test('security-events write is isolated to the exact reviewed CodeQL workflow', () => {
  const exact = codeqlWorkflow();
  assert.deepEqual(codeqlWorkflowProblems(exact), []);
  assert.deepEqual(leastPrivilegePermissionProblems(exact, { workflowName: 'codeql.yml' }), []);

  assert.match(
    leastPrivilegePermissionProblems(exact, { workflowName: 'renamed.yml' }).join('\n'),
    /security-events: write/
  );

  const secondGrant = exact.replace(
    'jobs:\n',
    `jobs:
  unrelated:
    runs-on: ubuntu-24.04
    permissions:
      contents: read
      security-events: write
    steps: []
`
  );
  assert.match(
    leastPrivilegePermissionProblems(secondGrant, { workflowName: 'codeql.yml' }).join('\n'),
    /job unrelated grants unnecessary security-events: write/
  );
  assert.notDeepEqual(codeqlWorkflowProblems(secondGrant), []);

  const workflowGrant = exact.replace(
    'permissions:\n  contents: read\n',
    'permissions:\n  contents: read\n  security-events: write\n'
  );
  assert.match(
    leastPrivilegePermissionProblems(workflowGrant, { workflowName: 'codeql.yml' }).join('\n'),
    /workflow grants unnecessary security-events: write/
  );
});

test('any CodeQL execution or trigger drift fails closed', () => {
  const exact = codeqlWorkflow();
  const extraShell = exact.replace(
    '      - name: Analyze\n',
    '      - name: Unexpected shell\n        run: echo unsafe\n      - name: Analyze\n'
  );
  assert.match(codeqlWorkflowProblems(extraShell).join('\n'), /exactly 3 entries/);
  assert.match(
    leastPrivilegePermissionProblems(extraShell, { workflowName: 'codeql.yml' }).join('\n'),
    /security-events: write/
  );

  const mutableAction = exact.replace(
    'github/codeql-action/init@db488ddef3bf6cb639b32c2e9a7c0a7ea8271d28',
    'github/codeql-action/init@v4'
  );
  assert.deepEqual(unpinnedActions(mutableAction), ['github/codeql-action/init@v4']);
  assert.notDeepEqual(codeqlWorkflowProblems(mutableAction), []);

  const privilegedTrigger = exact.replace('  pull_request:\n', '  pull_request_target:\n');
  assert.deepEqual(dangerousTriggerProblems(privilegedTrigger), [
    'workflow uses forbidden pull_request_target trigger',
  ]);
  assert.notDeepEqual(codeqlWorkflowProblems(privilegedTrigger), []);

  const ignoredFailure = exact.replace(
    '      - name: Initialize CodeQL\n',
    '      - name: Initialize CodeQL\n        continue-on-error: true\n'
  );
  assert.deepEqual(nonBlockingChecks(ignoredFailure), ['step Initialize CodeQL']);
  assert.notDeepEqual(codeqlWorkflowProblems(ignoredFailure), []);
});

test('pull_request_target is forbidden in every workflow shape', () => {
  assert.deepEqual(
    dangerousTriggerProblems(`name: bad
on: [push, pull_request_target]
permissions:
  contents: read
jobs:
  x:
    runs-on: ubuntu-24.04
    steps: []
`),
    ['workflow uses forbidden pull_request_target trigger']
  );
  assert.deepEqual(dangerousTriggerProblems(workflow('- run: pnpm lint')), []);
});

test('actionlint bootstrap is versioned, checksum-verified and executed', () => {
  assert.deepEqual(actionlintProblems(realCi), []);
  const echoedVerification = realCi.replace(
    'echo "$ACTIONLINT_SHA256  $archive" | sha256sum --check --strict',
    "echo 'sha256sum --check --strict'"
  );
  assert.notDeepEqual(actionlintProblems(echoedVerification), []);
  const commentedExecution = realCi.replace(
    '          "$RUNNER_TEMP/actionlint" -config-file "$RUNNER_TEMP/actionlint.yaml" -color',
    '          # "$RUNNER_TEMP/actionlint" -config-file "$RUNNER_TEMP/actionlint.yaml" -color'
  );
  assert.notDeepEqual(actionlintProblems(commentedExecution), []);
  const autoLoadedConfig = realCi.replace(' -config-file "$RUNNER_TEMP/actionlint.yaml"', '');
  assert.notDeepEqual(actionlintProblems(autoLoadedConfig), []);
  assert.notDeepEqual(actionlintProblems(realCi.replace('  build:\n', '  decoy:\n')), []);
  assert.match(actionlintProblems(workflow('- run: true'))[0], /exactly one actionlint step/);
});

test('the build bootstrap pins checkout, Node, pnpm and the frozen install', () => {
  const manifest = { packageManager: 'pnpm@10.34.4' };
  assert.deepEqual(pnpmSetupProblems(manifest, realCi, '22.23.2\n'), []);
  assert.match(
    pnpmSetupProblems({ packageManager: 'pnpm@10.34.3' }, realCi, '22.23.2\n').join('\n'),
    /10\.34\.3/
  );
  assert.match(
    pnpmSetupProblems({ packageManager: 'pnpm@latest' }, realCi, '22.23.2\n')[0],
    /exact pnpm/
  );
  assert.match(pnpmSetupProblems(manifest, realCi, '22\n').join('\n'), /MAJOR\.MINOR\.PATCH/);

  const duplicate = realCi.replace(
    '      - name: Setup pnpm\n',
    '      - uses: pnpm/action-setup@1111111111111111111111111111111111111111\n\n      - name: Setup pnpm\n'
  );
  assert.match(pnpmSetupProblems(manifest, duplicate, '22.23.2\n').join('\n'), /exactly one/);
  assert.notDeepEqual(
    pnpmSetupProblems(
      manifest,
      realCi.replace('pnpm install --frozen-lockfile', 'pnpm install'),
      '22.23.2\n'
    ),
    []
  );
  assert.notDeepEqual(
    pnpmSetupProblems(manifest, realCi.replace('  build:\n', '  decoy:\n'), '22.23.2\n'),
    []
  );
});

test('nested Corepack pins cannot select a different pnpm release', () => {
  const root = { packageManager: 'pnpm@10.34.4' };
  assert.deepEqual(
    packageManagerConsistencyProblems(root, [
      { path: 'apps/same/package.json', manifest: { packageManager: 'pnpm@10.34.4' } },
      { path: 'packages/inherited/package.json', manifest: {} },
    ]),
    []
  );
  assert.deepEqual(
    packageManagerConsistencyProblems(root, [
      { path: 'apps/stale/package.json', manifest: { packageManager: 'pnpm@10.17.0' } },
    ]),
    ['apps/stale/package.json pins "pnpm@10.17.0", but the root pins "pnpm@10.34.4"']
  );
});

test('Codecov OIDC is isolated and its downloaded CLI is pinned', () => {
  assert.deepEqual(codecovProblems(realCi), []);
  assert.deepEqual(leastPrivilegePermissionProblems(realCi, { workflowName: 'ci.yml' }), []);

  const broad = realCi.replace('permissions:\n  contents: read', 'permissions:\n  id-token: write');
  assert.match(codecovProblems(broad).join('\n'), /workflow-level id-token/);

  const latest = realCi.replace('version: v11.3.1', 'version: latest');
  assert.match(codecovProblems(latest).join('\n'), /must be pinned/);

  const arbitraryShell = realCi.replace(
    '      - name: Upload coverage to Codecov\n',
    '      - name: Unexpected shell\n        run: echo unsafe\n\n      - name: Upload coverage to Codecov\n'
  );
  assert.match(codecovProblems(arbitraryShell).join('\n'), /exactly 4 entries/);
  assert.match(
    leastPrivilegePermissionProblems(arbitraryShell, { workflowName: 'ci.yml' }).join('\n'),
    /id-token: write/
  );

  const archiveExtraction = realCi.replace(
    '      - name: Upload coverage to Codecov\n',
    '      - name: Extract untrusted archive\n        run: tar -xf artifact.tar\n\n      - name: Upload coverage to Codecov\n'
  );
  assert.notDeepEqual(codecovProblems(archiveExtraction), []);
});

test('only the fixed coverage-report allowlist crosses into the OIDC job', () => {
  assert.deepEqual(coverageArtifactProblems(realCi), []);
  assert.notDeepEqual(
    coverageArtifactProblems(
      realCi.replace(
        '            packages/core/coverage/lcov.info',
        '            packages/*/coverage/lcov.info'
      )
    ),
    []
  );
  assert.notDeepEqual(
    coverageArtifactProblems(
      realCi.replace('run: pnpm test:coverage-reports', 'run: echo coverage-reports')
    ),
    []
  );
  assert.notDeepEqual(coverageArtifactProblems(realCi.replace('  build:\n', '  decoy:\n')), []);
  assert.notDeepEqual(
    coverageArtifactProblems(
      realCi.replace(
        '            packages/core/coverage/lcov.info',
        '            packages/core/coverage/lcov.info\n            arbitrary-file'
      )
    ),
    []
  );
});

test('CI keeps its push, PR, merge-queue, manual and scheduled entry points', () => {
  assert.deepEqual(ciTriggerProblems(realCi), []);
  assert.notDeepEqual(
    ciTriggerProblems(realCi.replace('  pull_request:\n    branches: [main]\n', '')),
    []
  );
  assert.notDeepEqual(ciTriggerProblems(realCi.replace('  merge_group: {}\n', '')), []);
  assert.notDeepEqual(
    ciTriggerProblems(realCi.replace('branches: [main]', 'branches: [never]')),
    []
  );
});

test('dependency review cannot be deleted, narrowed or weakened', () => {
  assert.deepEqual(dependencyReviewWorkflowProblems(realDependencyReview), []);
  assert.notDeepEqual(
    dependencyReviewWorkflowProblems(realDependencyReview.replace('  merge_group: {}\n', '')),
    []
  );
  assert.notDeepEqual(
    dependencyReviewWorkflowProblems(
      realDependencyReview.replace('fail-on-severity: low', 'fail-on-severity: critical')
    ),
    []
  );
});

test('Dependabot disables version PRs while preserving reviewed update policy', () => {
  assert.deepEqual(dependabotConfigProblems(realDependabot), []);
  assert.notDeepEqual(
    dependabotConfigProblems(
      realDependabot.replace('open-pull-requests-limit: 0', 'open-pull-requests-limit: 1')
    ),
    []
  );
  assert.notDeepEqual(
    dependabotConfigProblems(
      realDependabot.replace(
        'versioning-strategy: increase-if-necessary',
        'versioning-strategy: increase'
      )
    ),
    []
  );
  assert.notDeepEqual(
    dependabotConfigProblems(realDependabot.replace('        update-types: [minor, patch]\n', '')),
    []
  );
});

test('package validation executes the full reviewed publint and attw loop', () => {
  const packages = validatedPackages(realCi);
  assert.notEqual(packages, null);
  assert.deepEqual(packageValidationProblems(realCi, packages), []);
  assert.notDeepEqual(
    packageValidationProblems(
      realCi.replace('pnpm exec publint --strict', 'echo publint --strict'),
      packages
    ),
    []
  );
  assert.notDeepEqual(
    packageValidationProblems(
      realCi.replace('          for pkg in ', '          if false; then for pkg in '),
      packages
    ),
    []
  );
  for (const override of [
    '        shell: true {0}\n',
    '        working-directory: packages/core\n',
    '        env:\n          PATH: ./attacker-bin\n',
  ]) {
    const changed = realCi.replace(
      '      - name: Validate packages\n',
      `      - name: Validate packages\n${override}`
    );
    assert.notDeepEqual(packageValidationProblems(changed, packages), [], override);
  }
  assert.notDeepEqual(
    packageValidationProblems(realCi.replace('  build:\n', '  decoy:\n'), packages),
    []
  );
});

test('the fixture suite itself executes the live repository checker', () => {
  const result = spawnSync(process.execPath, ['tests/ci-wiring/check.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
