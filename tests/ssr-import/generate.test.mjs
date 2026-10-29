// The built SSR helpers in plain Node: with no document option, both module
// systems load the installed linkedom peer themselves. An unbundled ES module
// has no require, which is the half a source-level test cannot reach.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const core = resolve(dirname(fileURLToPath(import.meta.url)), '../../packages/core');
const html = '<p>Hello <strong>world</strong></p>';
const content = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello ' }, { type: 'text', text: 'world', marks: [{ type: 'bold' }] }] }],
};

// The child's code is constant: the entry path and the input reach it as
// arguments, so nothing the test computes is ever evaluated as source.
const CHECK = `
  const input = JSON.parse(process.argv[2]);
  if (typeof window !== 'undefined') throw new Error('window must be undefined');
  if (input.withoutBuiltinModule) delete process.getBuiltinModule;
  let output;
  try {
    output = {
      html: core.generateHTML(input.content, [core.StarterKit]),
      json: core.generateJSON(input.html, [core.StarterKit]),
    };
  } catch (error) {
    output = { error: error.message };
  }
  console.log(JSON.stringify(output));
`;
const SOURCES = {
  js: `import { pathToFileURL } from 'node:url';\nconst core = await import(pathToFileURL(process.argv[1]).href);\n${CHECK}`,
  cjs: `const core = require(process.argv[1]);\n${CHECK}`,
};

/** Runs the check in a fresh Node process against the built entry of one module system. */
function run(format, input) {
  const file = resolve(core, `dist/index.${format}`);
  assert.ok(existsSync(file), `${file} does not exist; run pnpm build first`);
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  const result = spawnSync(
    process.execPath,
    [`--input-type=${format === 'js' ? 'module' : 'commonjs'}`, '-e', SOURCES[format], file, JSON.stringify(input)],
    { cwd: core, env, encoding: 'utf8', timeout: 20_000 },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout.trim());
}

for (const format of ['js', 'cjs']) {
  test(`the built ${format} entry generates HTML and JSON without a document option`, () => {
    assert.deepEqual(run(format, { content, html }), { html, json: content });
  });
}

test('the built ES module names both remedies when Node.js cannot create a require', () => {
  const output = run('js', { content, html, withoutBuiltinModule: true });
  assert.match(output.error ?? '', /pnpm add linkedom, or pass options\.document/);
});
