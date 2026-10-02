#!/usr/bin/env node
/**
 * Scan fixture artifacts for personal or machine-identifying data before they are committed: e-mail
 * addresses, home folder, drive and network paths, file: URLs, filled author, company, people and custom
 * properties, device data in image metadata (a display profile's serial number, EXIF and XMP makes,
 * models, serial numbers, authors and positions), and the login and host names of the machine that runs
 * the scan, which nobody has to write down for it. The patterns, readers and decoding are the repository
 * privacy gate's (tests/privacy/scan.mjs): a Word package is scanned part by part, a binary part (an image)
 * by its text chunks, printable runs and metadata, a capture bundle flavor by flavor, field by field and
 * clipboard file by clipboard file, and a data URI by what it decodes to; text is also read with its HTML, percent, JSON,
 * JavaScript and CSS escapes decoded, so an encoded address is found too. The policy here is stricter than
 * the gate's: nothing is allowed, and this machine's names are matched inside longer words from three
 * characters on, with one exception the gate makes for the same reason: in the printable runs of binary
 * data, such as a clipboard picture's compressed pixels, a tilde, a word and a slash is what the bytes spell
 * by chance, not a home folder. Findings name a category, a location and an offset, never the matched text.
 */
import { readdir, readFile } from 'node:fs/promises';
import { hostname, userInfo } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { artifactTexts as gateTexts, decoded, locate } from '../../tests/privacy/scan.mjs';

/** Names of this machine, at least three characters long, matched without regard to case. */
function machineNames() {
  const names = [];
  try { names.push(['login name', userInfo().username]); } catch { /* no login name in this environment */ }
  names.push(['host name', hostname().split('.')[0] ?? '']);
  return names.filter(([, value]) => value.length >= 3).map(([category, value]) => [category, value.toLowerCase()]);
}

/** Matches by category in one text, with each match's length: every pattern, and the names anywhere in a word. */
function located(location, value, names) {
  const found = locate(location, value).map(({ category, offset, length }) => ({ location, category, offset, length }));
  const lower = value.toLowerCase();
  for (const [category, name] of names) {
    for (let at = lower.indexOf(name); at >= 0; at = lower.indexOf(name, at + 1)) found.push({ location, category, offset: at, length: name.length });
  }
  return found;
}

/** Matches by category in one text: category and offset only. */
function matches(location, value, names) {
  return located(location, value, names).map(({ location: where, category, offset }) => ({ location: where, category, offset }));
}

// What compressed binary data spells by chance in its printable runs, which the gate's policy calls noise too.
const BINARY_NOISE = new Set(['tilde home folder']);

/**
 * Findings in one text: category and offset only. Text that only its escapes hide is reported at `#decoded`.
 * `binary` marks the printable runs of binary data, where a tilde home folder is noise.
 */
export function scanText(location, value, names = machineNames(), { binary = false } = {}) {
  if (binary) return scanText(location, value, names).filter(entry => !BINARY_NOISE.has(entry.category));
  const findings = matches(location, value, names);
  const plain = decoded(value);
  if (plain !== value) {
    const counted = new Map();
    for (const entry of findings) counted.set(entry.category, (counted.get(entry.category) ?? 0) + 1);
    for (const entry of matches(`${location}#decoded`, plain, names)) {
      const left = counted.get(entry.category) ?? 0;
      if (left > 0) counted.set(entry.category, left - 1);
      else findings.push(entry);
    }
  }
  return findings;
}

/**
 * Every text an artifact holds, as [location, text] pairs: the parts of a Word package, the text chunks
 * and printable runs of binary data, the flavors, fields and clipboard files of a capture bundle, what a
 * data URI decodes to, or the file as text.
 */
export function artifactTexts(name, bytes) {
  return gateTexts(name, bytes).map(({ location, text }) => [location, text]);
}

/** Scan the given files. A finding in image metadata is at the metadata's location, with offset 0. */
export async function scanFiles(paths, names = machineNames()) {
  const findings = [];
  for (const path of paths) {
    for (const { location, text, binary, device = [] } of gateTexts(path, await readFile(path))) {
      findings.push(...scanText(location, text, names, { binary }));
      for (const { where, category } of device) findings.push({ location: `${location}#${where}`, category, offset: 0 });
    }
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
