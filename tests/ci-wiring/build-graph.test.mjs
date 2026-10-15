import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const nxManifestPath = require.resolve('nx/package.json');
const nxManifest = JSON.parse(readFileSync(nxManifestPath, 'utf8'));
const nxCli = resolve(dirname(nxManifestPath), nxManifest.bin.nx);
const interoperatingExtensions = [
  '@domternal/extension-paste-cleanup',
  '@domternal/extension-markdown',
  '@domternal/extension-details',
];

function assertAcyclic(taskGraph) {
  const complete = new Set();
  const visiting = new Set();
  const path = [];
  function visit(task) {
    assert.ok(Object.hasOwn(taskGraph.tasks, task), `Unknown build prerequisite: ${task}`);
    if (complete.has(task)) return;
    assert.equal(visiting.has(task), false, `Circular build dependency: ${[...path, task].join(' -> ')}`);
    visiting.add(task);
    path.push(task);
    for (const dependency of taskGraph.dependencies[task] ?? []) visit(dependency);
    path.pop();
    visiting.delete(task);
    complete.add(task);
  }
  for (const task of Object.keys(taskGraph.tasks)) visit(task);
}

test('the full Nx build graph keeps test interoperability without circular build prerequisites', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'domternal-build-graph-'));
  try {
    const output = join(scratch, 'graph.json');
    // The graph command resolves the same build tasks as CI without running them.
    const result = spawnSync(process.execPath, [
      nxCli, 'run-many', '--target=build', '--all', `--graph=${output}`,
    ], {
      cwd: root,
      env: {
        ...process.env,
        NX_DAEMON: 'false',
        NX_ISOLATE_PLUGINS: 'false',
        NX_LOAD_DOT_ENV_FILES: 'false',
        NX_WORKSPACE_DATA_DIRECTORY: join(scratch, 'workspace-data'),
        NX_CACHE_DIRECTORY: join(scratch, 'cache'),
      },
      encoding: 'utf8',
      timeout: 60_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, `Nx graph generation failed:\n${result.stdout}\n${result.stderr}`);
    const { graph, tasks } = JSON.parse(readFileSync(output, 'utf8'));
    assert.ok(graph?.nodes && graph.dependencies, 'Nx must return the project graph');
    assert.ok(tasks?.tasks && tasks.dependencies, 'Nx must return the build task graph');
    assertAcyclic(tasks);

    const expectedBuildTasks = Object.entries(graph.nodes)
      .filter(([, project]) => project.data.targets?.build)
      .map(([name]) => `${name}:build`)
      .sort();
    assert.ok(expectedBuildTasks.length > interoperatingExtensions.length, 'The graph must cover the whole workspace');
    assert.deepEqual(Object.keys(tasks.tasks).sort(), expectedBuildTasks);

    const productionProjects = ['@domternal/core', '@domternal/pm'];
    for (const name of productionProjects) assert.ok(graph.nodes[name], `Missing production project: ${name}`);
    assert.ok(graph.nodes['@domternal/core'].data.targets?.build, 'Core must be built before its consumers');
    // PM currently ships source re-exports, so Nx need not invent a build for it.
    const productionBuildTasks = productionProjects
      .filter(name => graph.nodes[name].data.targets?.build)
      .map(name => `${name}:build`)
      .sort();

    for (let index = 0; index < interoperatingExtensions.length; index++) {
      const name = interoperatingExtensions[index];
      const testedTogether = interoperatingExtensions[(index + 1) % interoperatingExtensions.length];
      assert.ok(graph.nodes[name], `The existing scoped project name must remain available: ${name}`);
      assert.deepEqual([...tasks.dependencies[`${name}:build`]].sort(), productionBuildTasks);
      for (const productionProject of productionProjects) {
        assert.ok(
          graph.dependencies[name].some(dependency => dependency.target === productionProject),
          `${name} must retain its production dependency on ${productionProject}`
        );
      }
      assert.ok(
        graph.dependencies[name].some(dependency => dependency.target === testedTogether),
        `${name} must retain its test dependency on ${testedTogether}`
      );
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
