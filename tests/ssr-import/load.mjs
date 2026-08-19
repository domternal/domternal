#!/usr/bin/env node
// Loads one module system's worth of entries for tests/ssr-import/check.mjs.
//
// It exists as a separate process so the ESM and CJS halves of a package are
// never evaluated in the same realm. Anything that guards its own identity
// through globalThis, which is what packages/core/src/utils/prosemirrorSingleton.ts
// does, treats `prosemirror-model`'s ESM build plus its CJS build as two copies
// and says so. A gate that printed that warning on every clean run and exited 0
// would be teaching the reader to ignore it. Split like this, the warning has no
// innocent cause left, so check.mjs can fail on it.
//
// The parent learns what happened from a JSONL record file rather than from
// stdout, because a loaded bundle is free to print whatever it likes and a
// crash can truncate the stream. Each attempt writes `start` before anything is
// touched and `ok` or `fail` after, so a load that ends the process is still
// attributable to the entry that ended it, and the entries after it are visibly
// unreached rather than silently missing.
//
// Being an ES module says nothing about what it loads: a `require` run reaches
// its targets through createRequire and never imports their ESM half, which is
// the whole point of the split.
import { appendFileSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1 || process.argv[index + 1] === undefined) {
    throw new Error(`tests/ssr-import/load.mjs needs --${name}`);
  }
  return process.argv[index + 1];
}

const kind = argument('kind');
const recordsFile = argument('records');
const targets = JSON.parse(readFileSync(argument('targets'), 'utf8'));

const record = (entry) => appendFileSync(recordsFile, `${JSON.stringify(entry)}\n`);

/** Evaluates one file the way this child's module system reaches it. */
async function load(file, directory) {
  if (kind === 'import') await import(pathToFileURL(file).href);
  else createRequire(join(directory, 'package.json'))(file);
}

/**
 * Loads a target's `preload` dependency first, resolved from that package.
 *
 * @domternal/angular is the only entry that asks for one: ng-packagr output is
 * partial-compiled and plain Node has no linker, so @angular/compiler has to be
 * in the realm before the import or it throws before a line of Domternal code
 * runs. It is loaded here rather than at the top of this file so that the
 * entries evaluated earlier in this same process never see it, which is also
 * why check.mjs sorts the package that needs it last.
 */
async function preload(target) {
  const resolved = createRequire(join(target.directory, 'package.json')).resolve(target.preload);
  await load(resolved, target.directory);
}

for (const [index, target] of targets.entries()) {
  // Before the preload, not just before the target: a preload that ends the
  // process belongs to the entry that asked for it.
  record({ event: 'start', index, label: target.label });
  if (target.preload) {
    try {
      await preload(target);
    } catch (error) {
      record({
        event: 'fail',
        index,
        label: target.label,
        message:
          `${target.preload} could not be loaded first, so this entry cannot be checked ` +
          `(${error instanceof Error ? error.message : String(error)})`,
      });
      continue;
    }
  }
  try {
    await load(target.file, target.directory);
    record({ event: 'ok', index, label: target.label });
  } catch (error) {
    record({
      event: 'fail',
      index,
      label: target.label,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
