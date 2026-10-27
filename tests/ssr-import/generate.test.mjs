// The built SSR helpers in plain Node: with no document option, both module
// systems load the installed linkedom peer themselves. An unbundled ES module
// has no require, which is the half a source-level test cannot reach.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const core = resolve(dirname(fileURLToPath(import.meta.url)), '../../packages/core');
const html = '<p>Hello <strong>world</strong></p>';
const content = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello ' }, { type: 'text', text: 'world', marks: [{ type: 'bold' }] }] }],
};

/** Runs `body` in a fresh Node process with the built entry of one module system bound to `core`. */
function run(format, body) {
  const file = resolve(core, `dist/index.${format}`);
  assert.ok(existsSync(file), `${file} does not exist; run pnpm build first`);
  const load = format === 'js'
    ? `const core = await import(${JSON.stringify(pathToFileURL(file).href)});`
    : `const core = require(${JSON.stringify(file)});`;
  const source = format === 'js'
    ? `${load}\n${body}`
    : `(async () => { ${load}\n${body} })().catch((error) => { console.error(error); process.exitCode = 1; });`;
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  const result = spawnSync(process.execPath, [`--input-type=${format === 'js' ? 'module' : 'commonjs'}`, '-e', source], {
    cwd: core, env, encoding: 'utf8', timeout: 20_000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

for (const format of ['js', 'cjs']) {
  test(`the built ${format} entry generates HTML and JSON without a document option`, () => {
    const output = run(format, `
      if (typeof window !== 'undefined') throw new Error('window must be undefined');
      console.log(JSON.stringify({
        html: core.generateHTML(${JSON.stringify(content)}, [core.StarterKit]),
        json: core.generateJSON(${JSON.stringify(html)}, [core.StarterKit]),
      }));
    `);
    assert.deepEqual(JSON.parse(output), { html, json: content });
  });
}

test('the built ES module names both remedies when Node.js cannot create a require', () => {
  const output = run('js', `
    delete process.getBuiltinModule;
    try { core.generateHTML(${JSON.stringify(content)}, [core.StarterKit]); console.log('generated'); }
    catch (error) { console.log(error.message); }
  `);
  assert.match(output, /pnpm add linkedom, or pass options\.document/);
});
