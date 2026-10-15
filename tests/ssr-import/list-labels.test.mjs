import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkListLabelBundle } from './list-labels.mjs';

const core = resolve(dirname(fileURLToPath(import.meta.url)), '../../packages/core');

function withPackageCopy(run) {
  const directory = mkdtempSync(join(tmpdir(), 'domternal-list-label-package-'));
  try {
    mkdirSync(join(directory, 'dist'));
    const manifest = JSON.parse(readFileSync(join(core, 'package.json'), 'utf8'));
    writeFileSync(join(directory, 'package.json'), JSON.stringify(manifest));
    for (const extension of ['js', 'cjs', 'd.ts', 'd.cts']) {
      copyFileSync(join(core, `dist/list-labels.${extension}`), join(directory, `dist/list-labels.${extension}`));
    }
    run(directory, manifest);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

for (const format of ['js', 'cjs']) {
  const condition = format === 'js' ? 'import' : 'require';
  const declarationExtension = format === 'js' ? 'd.ts' : 'd.cts';

  test(`the built ${format} list label entry needs no editor, DOM or runtime dependency`, () => {
    checkListLabelBundle(core, format);
  });

  test(`an alternate package copy qualifies its own ${format} entry`, () => {
    withPackageCopy((directory, manifest) => {
      manifest.publishConfig = { ...manifest.publishConfig, exports: structuredClone(manifest.exports) };
      manifest.exports['./list-labels'][condition].default = './src/list-labels.ts';
      writeFileSync(join(directory, 'package.json'), JSON.stringify(manifest));
      checkListLabelBundle(directory, format);
    });
  });

  for (const leaf of ['default', 'types']) {
    test(`an alternate ${format} package cannot redirect the list label ${leaf} target`, () => {
      withPackageCopy((directory, manifest) => {
        manifest.exports['./list-labels'][condition][leaf] = leaf === 'default'
          ? `./dist/index.${format}` : `./dist/index.${declarationExtension}`;
        writeFileSync(join(directory, 'package.json'), JSON.stringify(manifest));
        assert.throws(() => checkListLabelBundle(directory, format), /must select its (?:independent bundle|self-contained declarations)/u);
      });
    });
  }

  test(`the published ${format} export map cannot redirect a valid workspace entry`, () => {
    withPackageCopy((directory, manifest) => {
      manifest.publishConfig = { ...manifest.publishConfig, exports: structuredClone(manifest.exports) };
      manifest.publishConfig.exports['./list-labels'][condition].default = `./dist/index.${format}`;
      writeFileSync(join(directory, 'package.json'), JSON.stringify(manifest));
      assert.throws(() => checkListLabelBundle(directory, format), /must select its independent bundle/u);
    });
  });

  for (const extension of [format, declarationExtension]) {
    test(`a missing ${extension} file in an alternate package is not replaced by the workspace build`, () => {
      withPackageCopy((directory) => {
        const missing = join(directory, `dist/list-labels.${extension}`);
        rmSync(missing);
        assert.throws(() => checkListLabelBundle(directory, format), (error) => {
          assert.equal(error.code, 'ENOENT');
          assert.equal(error.path, missing);
          return true;
        });
      });
    });
  }

  test(`the ${format} list label entry cannot depend on a sibling bundle`, () => {
    withPackageCopy((directory) => {
      const runtime = join(directory, `dist/list-labels.${format}`);
      const dependency = format === 'js' ? "import './sibling.js';\n" : "require('./sibling.cjs');\n";
      writeFileSync(join(directory, `dist/sibling.${format}`), 'void 0;\n');
      writeFileSync(runtime, dependency + readFileSync(runtime, 'utf8'));
      assert.throws(() => checkListLabelBundle(directory, format), /Cannot find module.*sibling/u);
    });
  });

  test(`the ${format} list label entry cannot access the DOM during import`, () => {
    withPackageCopy((directory) => {
      const runtime = join(directory, `dist/list-labels.${format}`);
      writeFileSync(runtime, 'void document;\n' + readFileSync(runtime, 'utf8'));
      assert.throws(() => checkListLabelBundle(directory, format), /Unexpected DOM access: document/u);
    });
  });

  test(`the ${format} list label declarations cannot depend on a sibling declaration`, () => {
    withPackageCopy((directory) => {
      const declarations = join(directory, `dist/list-labels.${declarationExtension}`);
      writeFileSync(declarations, "export type { Sibling } from './sibling.js';\n" + readFileSync(declarations, 'utf8'));
      assert.throws(() => checkListLabelBundle(directory, format), { code: 'ERR_ASSERTION' });
    });
  });
}
