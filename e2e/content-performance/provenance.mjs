/**
 * Where a bundle of an earlier output came from. Every output lists its variants in
 * variants.json as soon as it has bundled them, so a later run that measures one of those
 * bundles again records the commit, inputs and working tree state it was built from, never
 * the local path it was read from.
 */
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

/**
 * @param {string} path the bundle, `<label>.js` in an earlier output directory
 * @param {string} sha256 the SHA-256 of the bundle's bytes
 * @returns {{ sha256: string, inputs: string[], commit: string, dirty: boolean, bundledAs: string }}
 */
export function earlierBundle(path, sha256) {
  const directory = dirname(path);
  const label = basename(path, '.js');
  // Outputs written before variants.json existed list their variants in report.json.
  const listing = ['variants.json', 'report.json'].map(name => join(directory, name)).find(file => existsSync(file));
  if (listing === undefined) throw new Error(`${basename(path)} is not a bundle of an earlier output: neither variants.json nor report.json is beside it`);
  const parsed = JSON.parse(readFileSync(listing, 'utf8'));
  const variants = Array.isArray(parsed) ? parsed : parsed.variants;
  const variant = Array.isArray(variants) ? variants.find(entry => entry.label === label && entry.sha256 === sha256) : undefined;
  if (variant === undefined) throw new Error(`${basename(listing)} does not record ${label}.js with SHA-256 ${sha256}`);
  if (typeof variant.commit !== 'string') throw new Error(`${label}.js names no commit in ${basename(listing)}`);
  return { sha256, inputs: variant.inputs, commit: variant.commit, dirty: variant.dirty === true, bundledAs: variant.bundledAs ?? label };
}
