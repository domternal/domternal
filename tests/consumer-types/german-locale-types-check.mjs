#!/usr/bin/env node
// Each locale gets a fresh compiler program, so another package cannot register its keys for it.
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const owners = Object.keys(JSON.parse(readFileSync(join(root, 'tests/i18n/namespaces.json'), 'utf8')));
const inventory = JSON.parse(readFileSync(join(root, 'tests/i18n/inventory.json'), 'utf8')).messages;
const scratch = mkdtempSync(join(tmpdir(), 'domternal-german-types-'));
const options = {
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  target: ts.ScriptTarget.ES2022,
  lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
  strict: true,
  noEmit: true,
  skipLibCheck: false,
  verbatimModuleSyntax: true,
  isolatedModules: true,
  types: [],
};
let failures = 0;

try {
  writeFileSync(join(scratch, 'package.json'), '{"private":true,"type":"module"}\n');
  symlinkSync(join(here, 'node_modules'), join(scratch, 'node_modules'), 'dir');
  for (const owner of owners) for (const format of ['esm', 'cjs']) {
    const prefix = format === 'esm'
      ? `import type * as core from '@domternal/core';\nimport * as locale from '${owner}/locales/de';`
      : `import core = require('@domternal/core');\nimport locale = require('${owner}/locales/de');`;
    const firstKey = inventory.find((message) => message.owner === owner).id;
    const fixture = `${prefix}
const options: core.I18nOptions = { locale: 'de', messages: locale.deMessages, searchAliases: locale.deSearchAliases };
type RegisteredMessage<Id extends core.MessageId> = Id;
type RegisteredAlias<Id extends core.SearchableMessageId> = Id;
type EveryMessageIsRegistered = RegisteredMessage<keyof typeof locale.deMessages>;
type EveryAliasIsRegistered = RegisteredAlias<keyof typeof locale.deSearchAliases>;
const typedMessages: { readonly [Id in keyof typeof locale.deMessages]: core.MessageValue<core.MessageParameters[Id]> } = locale.deMessages;
// @ts-expect-error Official locale messages remain readonly in published declarations.
locale.deMessages[${JSON.stringify(firstKey)}] = 'Changed';
`;
    const path = join(scratch, `consumer.${format === 'esm' ? 'ts' : 'cts'}`);
    writeFileSync(path, fixture);
    const program = ts.createProgram([path], options, ts.createCompilerHost(options));
    const diagnostics = ts.getPreEmitDiagnostics(program);
    if (diagnostics.length > 0) {
      failures += 1;
      console.error(`[german-locale-types] FAILED: ${owner}/locales/de (${format})`);
      console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCanonicalFileName: (name) => name,
        getCurrentDirectory: () => scratch,
        getNewLine: () => '\n',
      }));
    } else console.log(`[german-locale-types] ${owner}/locales/de: isolated ${format} consumer OK`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
if (failures > 0) process.exitCode = 1;
