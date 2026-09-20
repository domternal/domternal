import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function run(args, cwd, success = true) {
  const result = spawnSync('pnpm', args, {
    cwd,
    encoding: 'utf8',
    timeout: 120000,
    env: {
      ...process.env,
      NX_DAEMON: 'false',
      NX_ISOLATE_PLUGINS: 'false',
      NX_NO_CLOUD: 'true',
      NX_TASKS_RUNNER_DYNAMIC_OUTPUT: 'false',
    },
  });
  if (result.error) throw result.error;
  const output = result.stdout + result.stderr;
  if (success) assert.equal(result.status, 0, `pnpm ${args.join(' ')} failed:\n${output}`);
  else
    assert.notEqual(
      result.status,
      0,
      `pnpm ${args.join(' ')} unexpectedly accepted stale locale artifacts`
    );
  return output;
}

function assertTypedImport(directory, format) {
  const path = join(directory, `consumer.${format === 'esm' ? 'ts' : 'cts'}`);
  const prefix =
    format === 'esm'
      ? "import { frMessages, frSearchAliases } from '@domternal/core/locales/fr';"
      : "import locale = require('@domternal/core/locales/fr');\nconst { frMessages, frSearchAliases } = locale;";
  writeFileSync(
    path,
    `${prefix}
const bold: string = frMessages['core.toolbar.bold'] as string;
const heading = frMessages['core.heading.level'];
if (typeof heading === 'function') {
  heading({ level: 2 }, {} as import('@domternal/core').I18nFormattingContext);
  // @ts-expect-error Published locale declarations preserve parameter types.
  heading({ level: 'two' }, {} as import('@domternal/core').I18nFormattingContext);
}
// @ts-expect-error Official messages remain readonly after packaging.
frMessages['core.toolbar.bold'] = 'Changed';
const aliases: import('@domternal/core').SearchAliases = frSearchAliases;
`
  );
  const options = {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    target: ts.ScriptTarget.ES2022,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
    strict: true,
    noEmit: true,
    skipLibCheck: false,
    types: [],
  };
  const program = ts.createProgram([path], options);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(
    diagnostics.length,
    0,
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (name) => name,
      getCurrentDirectory: () => directory,
      getNewLine: () => '\n',
    })
  );
}

function assertStandaloneImport(root, expected) {
  const consumer = mkdtempSync(join(tmpdir(), 'domternal-locale-runtime-'));
  try {
    const destination = join(consumer, 'node_modules/@domternal/core');
    mkdirSync(join(destination, 'dist/locales'), { recursive: true });
    copyFileSync(join(root, 'packages/core/package.json'), join(destination, 'package.json'));
    for (const suffix of ['js', 'cjs'])
      copyFileSync(
        join(root, `packages/core/dist/locales/fr.${suffix}`),
        join(destination, `dist/locales/fr.${suffix}`)
      );
    const script = join(consumer, 'check.mjs');
    writeFileSync(
      script,
      `import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { frMessages, frSearchAliases } from '@domternal/core/locales/fr';
const cjs = createRequire(import.meta.url)('@domternal/core/locales/fr');
assert.equal(frMessages['core.toolbar.bold'], ${JSON.stringify(expected)});
assert.equal(cjs.frMessages['core.toolbar.bold'], ${JSON.stringify(expected)});
assert.deepEqual(cjs.frSearchAliases, frSearchAliases);
`
    );
    const result = spawnSync(process.execPath, [script], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  } finally {
    rmSync(consumer, { recursive: true, force: true });
  }
}

test(
  'adding one central file reaches normal builds and rejects stale packs',
  { timeout: 240000 },
  (t) => {
    const root = mkdtempSync(join(tmpdir(), 'domternal-locale-lifecycle-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    for (const folder of [
      'scripts',
      'tests/i18n',
      'locales',
      'packages/core',
      'packages/pm',
      'archives',
    ])
      mkdirSync(join(root, folder), { recursive: true });
    for (const path of [
      'scripts/locale-build.mjs',
      'tests/i18n/generate-locales.mjs',
      'tsconfig.base.json',
      'nx.json',
      '.gitignore',
      'packages/core/package.json',
      'packages/core/tsconfig.json',
      'packages/core/tsup.config.ts',
      'packages/pm/package.json',
    ])
      copyFileSync(join(repository, path), join(root, path));
    cpSync(join(repository, 'packages/core/src'), join(root, 'packages/core/src'), {
      recursive: true,
    });
    symlinkSync(join(repository, 'node_modules'), join(root, 'node_modules'), 'dir');
    symlinkSync(
      join(repository, 'packages/core/node_modules'),
      join(root, 'packages/core/node_modules'),
      'dir'
    );
    const manifest = JSON.parse(readFileSync(join(repository, 'package.json'), 'utf8'));
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'locale-lifecycle-fixture',
        private: true,
        packageManager: manifest.packageManager,
        scripts: {
          build: manifest.scripts.build,
          'locales:generate': manifest.scripts['locales:generate'],
        },
      })
    );
    writeFileSync(join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
    writeFileSync(
      join(root, 'tests/i18n/namespaces.json'),
      JSON.stringify({ '@domternal/core': 'core.' })
    );
    const inventory = JSON.parse(
      readFileSync(join(repository, 'tests/i18n/inventory.json'), 'utf8')
    );
    inventory.messages = inventory.messages.filter(
      (message) => message.owner === '@domternal/core'
    );
    writeFileSync(join(root, 'tests/i18n/inventory.json'), JSON.stringify(inventory));
    const source = ts.createSourceFile(
      'de.ts',
      readFileSync(join(repository, 'locales/de.ts'), 'utf8'),
      ts.ScriptTarget.Latest,
      true
    );
    const german = source.statements
      .filter(
        (statement) =>
          (ts.isImportDeclaration(statement) &&
            statement.moduleSpecifier.text === '@domternal/core') ||
          (ts.isFunctionDeclaration(statement) && statement.name.text === 'core')
      )
      .map((statement) => statement.getFullText(source))
      .join('\n');
    writeFileSync(join(root, 'locales/de.ts'), german);
    // This is a lifecycle fixture, never a French translation shipped to consumers.
    const french = german
      .replaceAll('deMessages', 'frMessages')
      .replaceAll('deSearchAliases', 'frSearchAliases')
      .replace("'core.toolbar.bold': 'Fett'", "'core.toolbar.bold': 'TEST ONLY French bold v1'");
    const frenchPath = join(root, 'locales/fr.ts');
    writeFileSync(frenchPath, french);
    const directory = join(root, 'packages/core');
    assert.equal(existsSync(join(directory, 'src/locales/fr.ts')), false);
    assert.equal(
      JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')).exports['./locales/fr'],
      undefined
    );
    run(['pack', '--pack-destination', join(root, 'archives')], directory, false);
    run(['build'], directory);
    assert.ok(existsSync(join(directory, 'src/locales/fr.ts')));
    assert.ok(
      JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')).exports['./locales/fr']
    );
    assertStandaloneImport(root, 'TEST ONLY French bold v1');
    assertTypedImport(directory, 'esm');
    assertTypedImport(directory, 'cjs');
    run(['pack', '--pack-destination', join(root, 'archives')], directory);
    writeFileSync(
      frenchPath,
      french.replace('TEST ONLY French bold v1', 'TEST ONLY French bold v2')
    );
    const stale = run(['pack', '--pack-destination', join(root, 'archives')], directory, false);
    assert.match(stale, /Stale generated locale|locale inputs changed/);
    run(['build'], root);
    assertStandaloneImport(root, 'TEST ONLY French bold v2');
    run(['pack', '--pack-destination', join(root, 'archives')], directory);
    writeFileSync(
      frenchPath,
      french.replace('TEST ONLY French bold v1', 'TEST ONLY French bold v3')
    );
    run(['build'], root);
    assertStandaloneImport(root, 'TEST ONLY French bold v3');
    run(['pack', '--pack-destination', join(root, 'archives')], directory);
  }
);
