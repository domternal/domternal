import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Check the actual published entry in isolation, including alternate --core copies. */
export function checkListLabelBundle(packageDirectory, format) {
  assert.ok(format === 'js' || format === 'cjs');
  const manifest = JSON.parse(readFileSync(join(packageDirectory, 'package.json'), 'utf8'));
  assert.equal(manifest.name, '@domternal/core');
  const entry = (manifest.publishConfig?.exports ?? manifest.exports)?.['./list-labels'];
  const condition = format === 'js' ? 'import' : 'require';
  const types = `./dist/list-labels.d.${format === 'cjs' ? 'cts' : 'ts'}`;
  const runtime = `./dist/list-labels.${format}`;
  assert.equal(entry?.[condition]?.default, runtime, `list-labels ${condition} must select its independent bundle`);
  assert.equal(entry?.[condition]?.types, types, `list-labels ${condition} must select its self-contained declarations`);
  const declaration = readFileSync(join(packageDirectory, types), 'utf8');
  assert.doesNotMatch(declaration, /(?:import|export)[^\n]*\bfrom\s+['"]/u);
  const directory = mkdtempSync(join(tmpdir(), 'domternal-list-labels-'));
  try {
    // No sibling bundle or node_modules is available to this isolated published file.
    writeFileSync(join(directory, 'package.json'), '{"type":"module"}');
    copyFileSync(join(packageDirectory, runtime), join(directory, `labels.${format}`));
    const source = `
        import assert from 'node:assert/strict';
        for (const key of ['window', 'document', 'HTMLElement', 'DOMParser', 'navigator']) {
          Object.defineProperty(globalThis, key, { get() { throw new Error('Unexpected DOM access: ' + key); } });
        }
        const loaded = await import('./labels.${format}');
        const labels = ${format === 'cjs' ? 'loaded.default' : 'loaded'};
        assert.deepEqual(Object.keys(labels).sort(), ['formatListLabel', 'getListLabelStyleSheet', 'readListLabel']);
        const label = labels.readListLabel({ kind: 'counter', format: 'upper-alpha', prefix: 'Section ', suffix: ')' });
        assert.deepEqual(label, { kind: 'counter', format: 'upper-alpha', prefix: 'Section ', suffix: ')' });
        assert.equal(labels.formatListLabel(label, 27), 'Section AA)');
        const styles = labels.getListLabelStyleSheet({ type: 'orderedList', attrs: { listLabel: label } });
        assert.match(styles, /system: extends upper-alpha/);
        assert.match(styles, /prefix: "Section "/);
        assert.equal(labels.readListLabel({ kind: 'text', text: '\\u202eunsafe' }), null);
      `;
    const env = { ...process.env };
    delete env.NODE_OPTIONS;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
      cwd: directory, env, encoding: 'utf8', timeout: 10_000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stderr, '');
    return declaration;
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
