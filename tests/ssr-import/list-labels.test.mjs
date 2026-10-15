import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

for (const format of ['js', 'cjs']) {
  test(`the built ${format} list label entry needs no editor, DOM or runtime dependency`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'domternal-list-labels-'));
    try {
      // Workspace project references require declarations without generated sibling chunks.
      const declaration = readFileSync(join(root, `packages/core/dist/list-labels.d.${format === 'cjs' ? 'cts' : 'ts'}`), 'utf8');
      assert.doesNotMatch(declaration, /(?:import|export)[^\n]*\bfrom\s+['"]/u);
      // No sibling bundle or node_modules is available to this isolated published file.
      writeFileSync(join(directory, 'package.json'), '{"type":"module"}');
      copyFileSync(join(root, `packages/core/dist/list-labels.${format}`), join(directory, `labels.${format}`));
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
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], { cwd: directory, encoding: 'utf8', timeout: 10_000 });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.equal(result.stderr, '');
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
}
