#!/usr/bin/env node
/**
 * Scan fixture artifacts for personal or machine-identifying data before they are committed: e-mail
 * addresses, home folder and drive paths, file: URLs, filled author and company properties, and the
 * login and host names of the machine that runs the scan, which nobody has to write down for it. A
 * Word package is scanned part by part, a capture bundle flavor by flavor and field by field. Findings
 * name a category, a location and an offset, never the matched text.
 */
import { readdir, readFile } from 'node:fs/promises';
import { hostname, userInfo } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPackageParts } from './offline.mjs';

const PATTERNS = Object.freeze({
  'e-mail address': /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/gu,
  'home folder path': /(?:^|[^A-Za-z0-9])\/(?:Users|home)\/[^/\s"'<>)]+/gu,
  'drive path': /\b[A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/]/gu,
  'file URL': /\bfile:/giu,
  'author property': /<(?:[A-Za-z]+:)?(?:creator|lastModifiedBy|Author|LastAuthor|Company|Manager)\b[^<>]*>[^<]+</gu,
  'author attribute': /\bw:(?:author|initials)="[^"]+"/gu,
});

/** Names of this machine, at least three characters long, matched without regard to case. */
function machineNames() {
  const names = [];
  try { names.push(['login name', userInfo().username]); } catch { /* no login name in this environment */ }
  names.push(['host name', hostname().split('.')[0] ?? '']);
  return names.filter(([, value]) => value.length >= 3).map(([category, value]) => [category, value.toLowerCase()]);
}

/** Findings in one text: category and offset only. */
export function scanText(location, value, names = machineNames()) {
  const findings = [];
  for (const [category, pattern] of Object.entries(PATTERNS)) {
    for (const match of value.matchAll(pattern)) findings.push({ location, category, offset: match.index });
  }
  const lower = value.toLowerCase();
  for (const [category, name] of names) {
    for (let at = lower.indexOf(name); at >= 0; at = lower.indexOf(name, at + 1)) findings.push({ location, category, offset: at });
  }
  return findings;
}

/** Every text an artifact holds: package parts, capture flavors and fields, or the file as text. */
function texts(name, bytes) {
  if (bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    const parts = readPackageParts(bytes);
    return [...parts].map(([part, content]) => [`${name}:${part}`, content.toString('latin1').includes('\u0000') ? '' : content.toString('utf8')]);
  }
  const value = bytes.toString('utf8');
  if (!name.endsWith('.json')) return [[name, value]];
  let bundle;
  try { bundle = JSON.parse(value); } catch { return [[name, value]]; }
  const flavors = bundle?.payload?.text;
  if (!flavors || typeof flavors !== 'object') return [[name, value]];
  // A flavor keeps its own offsets; everything else is scanned as the serialized remainder.
  return [...Object.entries(flavors).map(([flavor, text]) => [`${name}:${flavor}`, String(text)]),
    [`${name}:fields`, JSON.stringify({ ...bundle, payload: { ...bundle.payload, text: {} } })]];
}

/** Scan the given files. */
export async function scanFiles(paths, names = machineNames()) {
  const findings = [];
  for (const path of paths) {
    for (const [location, value] of texts(path, await readFile(path))) findings.push(...scanText(location, value, names));
  }
  return findings;
}

/** Scan every file of fixture directories, one level deep. */
export async function scanFixtures(directories, names = machineNames()) {
  const paths = [];
  for (const directory of directories) {
    for (const entry of await readdir(directory, { withFileTypes: true })) if (entry.isFile()) paths.push(join(directory, entry.name));
  }
  return { files: paths.length, findings: await scanFiles(paths.sort(), names) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directories = process.argv.slice(2).map(directory => resolve(directory));
  if (directories.length === 0) {
    process.stderr.write('Usage: node privacy.mjs <fixture-dir>...\n');
    process.exitCode = 2;
  } else {
    const report = await scanFixtures(directories);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (report.findings.length > 0) process.exitCode = 1;
  }
}
