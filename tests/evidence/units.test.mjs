/**
 * The ported list-markers unit against the committed report and the preserved
 * originals. The full port is proven locally by `pnpm evidence:replay`, which
 * reproduces the committed files byte for byte from the archived inputs; these
 * tests pin what can be checked without the archive.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectFromCandidates } from './inventory.mjs';
import { indentedBytes, parseJson } from './json.mjs';
import * as unit from './units/2026-09-27-list-markers.mjs';
import { UNITS, unitFor } from './units/index.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (path) => readFileSync(join(repoRoot, path));
const committedJson = read(unit.REPORT);
const committed = parseJson(committedJson);

test('every authored string still occurs verbatim in the preserved original it came from', () => {
  const sources = new Map();
  const strings = unit.authoredStrings();
  assert.ok(strings.length > 100);
  for (const [file, text] of strings) {
    if (!sources.has(file)) sources.set(file, read(`${unit.HISTORICAL_TOOLS}/${file}`).toString('utf8'));
    assert.ok(sources.get(file).includes(text), `${file} does not contain ${JSON.stringify(text)}`);
  }
  assert.deepEqual([...sources.keys()].sort(), ['domternal-n12-assemble-evidence.py', 'domternal-n12-free-evidence.py', 'domternal-n12-verify-evidence.py']);
});

test('the authored case tables have the sizes the originals asserted', () => {
  assert.equal(new Set(unit.NEW_TITLES).size, 17);
  assert.equal(unit.BROWSERS.length * unit.FRAMEWORKS.length * unit.NEW_TITLES.length, 204);
  assert.equal(Object.values(unit.LEGACY).reduce((sum, count) => sum + count, 0), 30);
  assert.equal(unit.SUITES.length, 7);
});

test('the selection rules select exactly the committed inventory', () => {
  const paths = committed.frozenInputs.inventory.map((row) => row.path);
  const { selected, missingFiles } = selectFromCandidates(unit.SELECTION_RULES, paths);
  assert.deepEqual(missingFiles, []);
  assert.deepEqual(selected, paths);
  assert.equal(paths.length, 784);
});

test('the port reads every raw input the report records', () => {
  const required = unit.requiredInputs();
  const inputs = new Set(required.files.map((file) => file.originalPath));
  for (const artifact of committed.artifacts) {
    const inDirectory = required.directories.some(({ directory, suffix }) => artifact.localPath.startsWith(`${directory}/`) && artifact.localPath.endsWith(suffix));
    const inRepository = required.repositoryFiles.some(({ path }) => artifact.localPath === `${unit.ROOT}/${path}`);
    assert.ok(inputs.has(artifact.localPath) || inDirectory || inRepository, artifact.localPath);
  }
  assert.ok(inputs.has(unit.SNAPSHOT));
});

test('everything the assembler derived is rederived from the committed files', () => {
  const problems = unit.rederive(committed, { jsonBytes: committedJson, markdownBytes: read(unit.MARKDOWN), priorBytes: read(unit.PRIOR) });
  assert.deepEqual(problems, []);
  const tampered = structuredClone(committed);
  tampered.runs.paste.suites[0].total += 1;
  tampered.releaseChecks[0].execution = 'Run again later.';
  const found = unit.rederive(tampered, { jsonBytes: indentedBytes(tampered, { ensureAscii: false }), markdownBytes: read(unit.MARKDOWN), priorBytes: read(unit.PRIOR) });
  assert.ok(found.some((problem) => problem.startsWith('runs.paste.suites')));
  assert.ok(found.some((problem) => problem.startsWith('releaseChecks')));
  assert.ok(found.some((problem) => problem.includes('is not what the assembler writes')), 'the Markdown embeds the JSON digest');
});

test('the Markdown template renders the committed Markdown', () => {
  const markdown = unit.renderMarkdown({
    jsonSha256: '1c20a386321b1772985a3841a541362c366b690b5cc61ee0e9c604f17a3edffa',
    inventorySha256: committed.frozenInputs.inventorySha256,
    pasteCaseInventorySha256: committed.runs.paste.caseInventorySha256,
    legacyCaseInventorySha256: committed.runs.legacy.caseInventorySha256,
    playwrightVersion: committed.runs.paste.playwrightVersion,
  });
  assert.ok(Buffer.from(markdown, 'utf8').equals(read(unit.MARKDOWN)));
});

test('run commands match what the assembler recorded', () => {
  for (const kind of ['paste', 'legacy']) assert.equal(unit.runCommand(kind), committed.runs[kind].command);
});

test('units are looked up by report stem', () => {
  assert.equal(unitFor(unit.STEM), UNITS.get(unit.STEM));
  assert.throws(() => unitFor('2026-09-27-styled-breaks'), /Unknown evidence unit/);
});
