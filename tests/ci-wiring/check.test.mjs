/** Fixture tests for the wiring gate's YAML-aware workflow inspection. */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILT_OUTPUT_GATES,
  FOCUSED_BROWSER_SCRIPTS,
  LOCAL_ONLY_SCRIPTS,
  MANDATORY_GATES,
  NOT_GATES,
  REQUIRED_SCRIPTS,
  actionlintProblems,
  buildOrderProblems,
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
  focusedBrowserWorkflowProblems,
  leastPrivilegePermissionProblems,
  localActionReferences,
  localOnlyProblems,
  mandatoryGateProblems,
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
const realManifest = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
);
const realDependencyReview = readFileSync(
  new URL('../../.github/workflows/dependency-review.yml', import.meta.url),
  'utf8'
);
const realDependabot = readFileSync(
  new URL('../../.github/dependabot.yml', import.meta.url),
  'utf8'
);
const realPasteCleanup = readFileSync(
  new URL('../../.github/workflows/paste-cleanup-e2e.yml', import.meta.url),
  'utf8'
);
const pasteCleanupManifest = { scripts: {
  'test:e2e:paste-cleanup': 'playwright test --config e2e/paste-cleanup.config.ts',
} };

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
  assert.deepEqual([...LOCAL_ONLY_SCRIPTS].sort(), ['test:dedupe-reachable']);
  assert.deepEqual([...FOCUSED_BROWSER_SCRIPTS], [['test:e2e:paste-cleanup', 'paste-cleanup-e2e.yml']]);
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
      'test:dedupe-reachable': 'node local-only',
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

test('only the explicitly contracted paste browser script leaves the main gate set', () => {
  const manifest = { scripts: {
    'test:e2e:paste-cleanup': 'playwright test --config e2e/paste-cleanup.config.ts',
    'test:e2e:unreviewed-feature': 'playwright test --config e2e/unknown.config.ts',
    'test:package-policy': 'node tests/package-policy/check.mjs',
  } };
  assert.deepEqual(gateScripts(manifest), ['test:e2e:unreviewed-feature', 'test:package-policy']);
});

test('the ProseMirror range check is an ordinary gate that CI runs in full', () => {
  /* A hosted install holds the y-prosemirror that @domternal/core installs for
     its own tests, so the full check has a peer to compare there. Going back
     to its unit suite alone would leave that comparison unenforced. */
  assert.ok(gateScripts(realManifest).includes('test:pm-ranges'));
  assert.ok(scriptInvocations(realCi).has('test:pm-ranges'));
  assert.deepEqual(gateExecutionProblems(realCi, ['test:pm-ranges']), []);
  assert.deepEqual(localOnlyProblems(realManifest, realCi), []);

  const unitOnly = realCi.replace(
    '        run: pnpm test:pm-ranges\n',
    '        run: pnpm test:pm-ranges:unit\n'
  );
  assert.notEqual(unitOnly, realCi);
  assert.deepEqual(unwiredScripts(['test:pm-ranges'], unitOnly), ['test:pm-ranges']);
});

test('the dedupe check stays local-only, with just its unit suite in CI', () => {
  assert.deepEqual(localOnlyProblems(realManifest, realCi), []);
  assert.ok(gateScripts(realManifest).includes('test:dedupe-reachable:unit'));
  assert.equal(gateScripts(realManifest).includes('test:dedupe-reachable'), false);
  assert.ok(scriptInvocations(realCi).has('test:dedupe-reachable:unit'));

  const fullInCi = realCi.replace(
    '        run: pnpm test:dedupe-reachable:unit\n',
    '        run: pnpm test:dedupe-reachable\n'
  );
  assert.notEqual(fullInCi, realCi);
  assert.match(
    localOnlyProblems(realManifest, fullInCi).join('\n'),
    /runs local-only "test:dedupe-reachable"/
  );

  const withoutUnit = { ...realManifest.scripts };
  delete withoutUnit['test:dedupe-reachable:unit'];
  assert.match(
    localOnlyProblems({ scripts: withoutUnit }, realCi).join('\n'),
    /CI script "test:dedupe-reachable:unit"/
  );
  const rewritten = { ...realManifest.scripts, 'test:dedupe-reachable': 'echo skipped' };
  assert.match(
    localOnlyProblems({ scripts: rewritten }, realCi).join('\n'),
    /full local-only script "test:dedupe-reachable"/
  );
});

test('the full dedupe check is refused in CI however the step reaches it', () => {
  /* A wrapped, filtered, conditional or direct run is not a wired gate, but it
     still prints a SKIPPED line that reads as a pass. Only the unit suite, or a
     commented-out mention, may appear. */
  const unitStep = '        run: pnpm test:dedupe-reachable:unit\n';
  for (const extra of [
    'run: pnpm test:dedupe-reachable && true',
    'run: pnpm test:dedupe-reachable || true',
    'run: pnpm --filter . test:dedupe-reachable',
    'run: node tests/dedupe-reachable/check.mjs',
    "if: github.event_name == 'schedule'\n        run: pnpm test:dedupe-reachable",
  ]) {
    const changed = realCi.replace(
      unitStep,
      `${unitStep}\n      - name: Probe\n        ${extra}\n`
    );
    assert.notEqual(changed, realCi);
    assert.match(
      localOnlyProblems(realManifest, changed).join('\n'),
      /runs local-only "test:dedupe-reachable"/,
      extra
    );
  }

  const commented = realCi.replace(
    unitStep,
    '        run: |\n          # pnpm test:dedupe-reachable\n          pnpm test:dedupe-reachable:unit\n'
  );
  assert.notEqual(commented, realCi);
  assert.deepEqual(localOnlyProblems(realManifest, commented), []);
});

test('the focused paste browser workflow executes the exact reviewed script and runner', () => {
  assert.deepEqual(focusedBrowserWorkflowProblems(pasteCleanupManifest, realPasteCleanup), []);
});

test('a focused browser classification cannot hide a removed workflow or changed command', () => {
  assert.ok(focusedBrowserWorkflowProblems(pasteCleanupManifest, undefined).length > 0);
  assert.ok(focusedBrowserWorkflowProblems({ scripts: {} }, realPasteCleanup).length > 0);
  assert.ok(focusedBrowserWorkflowProblems({ scripts: {
    'test:e2e:paste-cleanup': 'echo skipped',
  } }, realPasteCleanup).length > 0);
});

for (const [name, change] of [
  ['removed pull-request trigger', parsed => { delete parsed.on.pull_request; }],
  ['path-filtered pull requests', parsed => { parsed.on.pull_request.paths = ['unrelated/**']; }],
  ['conditional job', parsed => { parsed.jobs['paste-cleanup-e2e'].if = 'false'; }],
  ['ignored job failure', parsed => { parsed.jobs['paste-cleanup-e2e']['continue-on-error'] = true; }],
  ['removed package build', parsed => {
    const job = parsed.jobs['paste-cleanup-e2e'];
    job.steps = job.steps.filter(step => step.run !== 'pnpm build');
  }],
  ['incomplete public build', parsed => {
    parsed.jobs['paste-cleanup-e2e'].steps.find(step => step.run === 'pnpm build').run = 'pnpm --filter @domternal/extension-paste-cleanup build';
  }],
  ['conditional runner', parsed => {
    parsed.jobs['paste-cleanup-e2e'].steps.find(step => step.name === 'Run paste cleanup browser coverage').if = 'false';
  }],
  ['removed artifacts', parsed => { parsed.jobs['paste-cleanup-e2e'].steps.pop(); }],
]) {
  test(`focused browser enforcement rejects ${name}`, () => {
    const parsed = parseWorkflow(realPasteCleanup);
    change(parsed);
    assert.ok(focusedBrowserWorkflowProblems(pasteCleanupManifest, JSON.stringify(parsed)).length > 0);
  });
}

for (const [name, change] of [
  ['commented invocation', run => run.replace('PLAYWRIGHT_JSON_OUTPUT_NAME=', '# PLAYWRIGHT_JSON_OUTPUT_NAME=')],
  ['different root script', run => run.replace('pnpm test:e2e:paste-cleanup', 'pnpm test:e2e:matrix')],
  ['unreachable invocation', run => `if false; then\n${run}\nfi\n`],
  ['retries concealing failures', run => run.replace('--retries=0', '--retries=1')],
  ['ignored runner status', run => run.replace('wait "$runner_pid" || status=$?', 'wait "$runner_pid" || true')],
  ['successful final exit', run => run.replace('exit "$status"\n', 'exit 0\n')],
]) {
  test(`focused browser enforcement rejects ${name}`, () => {
    const parsed = parseWorkflow(realPasteCleanup);
    const step = parsed.jobs['paste-cleanup-e2e'].steps.find(step => step.name === 'Run paste cleanup browser coverage');
    step.run = change(step.run);
    assert.ok(focusedBrowserWorkflowProblems(pasteCleanupManifest, JSON.stringify(parsed)).length > 0);
  });
}

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

test('gates that read the built packages run after the explicit build', () => {
  const steps = (runs) => runs.map((run) => `      - run: ${JSON.stringify(run)}`).join('\n');
  const buildJob = (...runs) =>
    `name: fixture\njobs:\n  build:\n    runs-on: ubuntu-24.04\n    steps:\n${steps(runs)}\n`;
  const early = (name) =>
    `ci.yml runs "pnpm ${name}" before "pnpm build", but it reads packages/*/dist, ` +
    'which a clean checkout has only after the build';
  const unbuilt =
    'ci.yml build job never runs "pnpm build", so nothing builds the packages that ' +
    'lint and typecheck:e2e and test:mixed-version read';

  assert.deepEqual(BUILT_OUTPUT_GATES, ['lint', 'typecheck:e2e', 'test:mixed-version']);
  assert.deepEqual(buildOrderProblems(realCi), []);
  assert.deepEqual(
    buildOrderProblems(buildJob('pnpm build', 'pnpm lint', 'pnpm typecheck:e2e')),
    []
  );
  // Only the listed gates are held: Nx builds what the package type checks need.
  assert.deepEqual(
    buildOrderProblems(buildJob('pnpm typecheck', 'pnpm build', 'pnpm lint', 'pnpm typecheck:e2e')),
    []
  );
  assert.deepEqual(buildOrderProblems(buildJob('pnpm lint', 'pnpm build', 'pnpm typecheck:e2e')), [
    early('lint'),
  ]);
  assert.deepEqual(buildOrderProblems(buildJob('pnpm lint', 'pnpm typecheck:e2e', 'pnpm build')), [
    early('lint'),
    early('typecheck:e2e'),
  ]);
  // Line order inside one multi-line step counts as well.
  assert.deepEqual(buildOrderProblems(buildJob('pnpm typecheck:e2e\npnpm build', 'pnpm lint')), [
    early('typecheck:e2e'),
  ]);
  assert.deepEqual(buildOrderProblems(buildJob('pnpm build\npnpm typecheck:e2e', 'pnpm lint')), []);
  // The mixed-version collaboration test loads the built packages as well.
  assert.deepEqual(buildOrderProblems(buildJob('pnpm test:mixed-version', 'pnpm build', 'pnpm lint')), [
    early('test:mixed-version'),
  ]);
  // A filtered or swallowed build is not the full build the e2e paths resolve against.
  assert.deepEqual(
    buildOrderProblems(buildJob('pnpm --filter @domternal/core build', 'pnpm lint')),
    [unbuilt]
  );
  assert.deepEqual(buildOrderProblems(buildJob('pnpm build || true', 'pnpm lint')), [unbuilt]);
  // A build in another job leaves this runner without dist.
  assert.deepEqual(
    buildOrderProblems(
      `name: fixture\njobs:\n  prepare:\n    runs-on: ubuntu-24.04\n    steps:\n` +
        `${steps(['pnpm build'])}\n  build:\n    runs-on: ubuntu-24.04\n    steps:\n` +
        `${steps(['pnpm lint', 'pnpm typecheck:e2e'])}\n`
    ),
    [unbuilt]
  );
  assert.deepEqual(buildOrderProblems(realCi.replace('  build:\n', '  decoy:\n')), [unbuilt]);

  // The real workflow with its Build step moved back below the e2e type check.
  const buildStep = /\n {6}- name: Build\n(?: {8}.*\n)+/.exec(realCi);
  assert.ok(buildStep, 'ci.yml has a Build step');
  const moved = realCi
    .replace(buildStep[0], '')
    .replace(
      '        run: pnpm typecheck:e2e\n',
      '        run: pnpm typecheck:e2e\n\n      - name: Build\n        run: pnpm build\n'
    );
  assert.notEqual(moved, realCi);
  assert.deepEqual(buildOrderProblems(moved), [early('lint'), early('typecheck:e2e')]);
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

test('mandatory gates are declared with their reviewed command and run by ci.yml', () => {
  assert.deepEqual(mandatoryGateProblems(realManifest, realCi), []);
  assert.equal(MANDATORY_GATES.get('test:privacy'), 'node --test tests/privacy/check.test.mjs && node tests/privacy/check.mjs');
  const withoutScript = { scripts: { ...realManifest.scripts } };
  delete withoutScript.scripts['test:privacy'];
  const withoutStep = realCi.replace(/\n {6}- name: No personal data in tracked files\n(?: {8}.*\n)+/, '\n');
  assert.notEqual(withoutStep, realCi, 'the fixture removes the privacy step');
  assert.deepEqual(mandatoryGateProblems(withoutScript, withoutStep), [
    'package.json must declare the mandatory gate "test:privacy" as "node --test tests/privacy/check.test.mjs && node tests/privacy/check.mjs"',
    'ci.yml must run the mandatory gate "pnpm test:privacy"',
  ]);
  const hollowed = { scripts: { ...realManifest.scripts, 'test:privacy': 'node --test tests/privacy/check.test.mjs' } };
  assert.equal(mandatoryGateProblems(hollowed, realCi).length, 1);
});

test('the evidence gate holds declared redactions with the committed bytes alone, so the build checkout needs no history', () => {
  const command = 'node --test tests/evidence/*.test.mjs && node tests/evidence/cli.mjs check';
  assert.equal(MANDATORY_GATES.get('test:evidence'), command);
  // The history check is retired: the originals it compared were removed from the history on 2026-10-03.
  const withHistory = { scripts: { ...realManifest.scripts, 'test:evidence': `${command} --history` } };
  assert.deepEqual(mandatoryGateProblems(withHistory, realCi), [`package.json must declare the mandatory gate "test:evidence" as "${command}"`]);
  const hollowed = { scripts: { ...realManifest.scripts, 'test:evidence': 'node --test tests/evidence/*.test.mjs' } };
  assert.equal(mandatoryGateProblems(hollowed, realCi).length, 1);
  assert.equal(/fetch-depth: 0/.test(realCi), false, 'the build checkout fetches only the tested commit');
  assert.deepEqual(pnpmSetupProblems(realManifest, realCi), []);
  const deep = realCi.replace('          persist-credentials: false\n', '          fetch-depth: 0\n          persist-credentials: false\n');
  assert.notEqual(deep, realCi, 'the fixture adds a full history checkout');
  assert.notDeepEqual(pnpmSetupProblems(realManifest, deep), []);
});

test('the privacy step may read the names a CI secret lists, and nothing else from its environment', () => {
  assert.deepEqual(gateExecutionProblems(realCi, ['test:privacy']), []);
  assert.ok(scriptInvocations(realCi).has('test:privacy'));
  const secret = '          PRIVACY_NAMES: ${{ secrets.PRIVACY_NAMES }}\n';
  assert.ok(realCi.includes(secret), 'ci.yml passes the secret to the privacy step');
  for (const changed of [
    realCi.replace(secret, `${secret}          PATH: ./attacker-bin\n`),
    realCi.replace(secret, '          PRIVACY_NAMES: nobody\n'),
  ]) {
    assert.notDeepEqual(gateExecutionProblems(changed, ['test:privacy']), [], changed.slice(0, 0));
    assert.equal(scriptInvocations(changed).has('test:privacy'), false);
  }
});
