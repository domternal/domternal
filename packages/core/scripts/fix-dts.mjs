/**
 * Fix module augmentation paths in bundled DTS.
 *
 * Source files use relative paths (declare module '../types/Commands.js')
 * which become meaningless after tsup bundles everything into index.d.ts.
 * Replace with package-level augmentation so consumers get typed commands.
 */
import { readFile, writeFile } from 'node:fs/promises';

const pattern = /declare module '\.\.\/types\/Commands\.js'/g;
const replacement = "declare module '@domternal/core'";
const files = ['dist/index.d.ts', 'dist/index.d.cts'];

let totalReplacements = 0;

for (const file of files) {
  const content = await readFile(file, 'utf-8');
  const matches = content.match(pattern);
  if (!matches) continue;

  await writeFile(file, content.replace(pattern, replacement));
  totalReplacements += matches.length;
}

if (totalReplacements === 0) {
  console.error('fix-dts: No module augmentations found — check if source pattern changed');
  process.exit(1);
}

console.log(`fix-dts: Fixed ${totalReplacements} module augmentations in ${files.length} files`);
