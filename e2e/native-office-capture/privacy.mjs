#!/usr/bin/env node
/**
 * Scan fixture artifacts for personal or machine-identifying data before they are committed: e-mail
 * addresses, home folder and drive paths, file: URLs, filled author, company, people and custom
 * properties, and the login and host names of the machine that runs the scan, which nobody has to write
 * down for it. A Word package is scanned part by part, a binary part (an image) by its text chunks and
 * printable runs, a capture bundle flavor by flavor, field by field and clipboard file by clipboard file.
 * Text is also read with its HTML, percent and CSS escapes decoded, so an encoded address is found too.
 * Findings name a category, a location and an offset, never the matched text.
 */
import { readdir, readFile } from 'node:fs/promises';
import { hostname, userInfo } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { readPackageParts } from './offline.mjs';

const PATTERNS = Object.freeze({
  'e-mail address': /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/gu,
  // In any letter case: a path a tool lowercased still names the account.
  'home folder path': /(?:^|[^A-Za-z0-9])\/(?:users|home)\/[^/\s"'<>)]+/giu,
  'drive path': /\b[A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/]/giu,
  'file URL': /\bfile:/giu,
  'author property': /<(?:[A-Za-z]+:)?(?:creator|lastModifiedBy|Author|LastAuthor|Company|Manager)\b[^<>]*>[^<]+</gu,
  // Revision, comment and people attributes under any namespace prefix, such as w:author, w15:author and w15:userId.
  'author attribute': /\b(?:[A-Za-z][A-Za-z0-9]*:)?(?:author|initials|userId)="[^"]+"/gu,
});
// A document's custom properties can hold anything, a reviewer's or a label owner's name among it.
const CUSTOM_PROPERTY = /<vt:[A-Za-z0-9]+>[^<]+</gu;
const MAX_INFLATED = 1024 * 1024;

/** Names of this machine, at least three characters long, matched without regard to case. */
function machineNames() {
  const names = [];
  try { names.push(['login name', userInfo().username]); } catch { /* no login name in this environment */ }
  names.push(['host name', hostname().split('.')[0] ?? '']);
  return names.filter(([, value]) => value.length >= 3).map(([category, value]) => [category, value.toLowerCase()]);
}

/** Matches by category in one text, with each match's length. */
function located(location, value, names) {
  const found = [];
  for (const [category, pattern] of Object.entries(PATTERNS)) {
    for (const match of value.matchAll(pattern)) found.push({ location, category, offset: match.index, length: match[0].length });
  }
  if (location.endsWith('docProps/custom.xml')) for (const match of value.matchAll(CUSTOM_PROPERTY)) found.push({ location, category: 'custom property', offset: match.index, length: match[0].length });
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

/** A text with its HTML character references, percent escapes and CSS escapes decoded. */
function decoded(value) {
  const code = (number, fallback) => (Number.isSafeInteger(number) && number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : fallback);
  return value
    .replace(/&#x([0-9a-f]{1,6});?/giu, (text, digits) => code(Number.parseInt(digits, 16), text))
    .replace(/&#([0-9]{1,7});?/gu, (text, digits) => code(Number(digits), text))
    .replace(/&(commat|period|sol|bsol|colon|lowbar|hyphen|dash|amp|quot|apos|lt|gt);/giu, (text, name) =>
      ({ commat: '@', period: '.', sol: '/', bsol: '\\', colon: ':', lowbar: '_', hyphen: '-', dash: '-', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' })[name.toLowerCase()] ?? text)
    .replace(/%([0-9a-f]{2})/giu, (_, digits) => String.fromCharCode(Number.parseInt(digits, 16)))
    .replace(/\\([0-9a-f]{1,6})[\t\n\f\r ]?/giu, (text, digits) => code(Number.parseInt(digits, 16), text));
}

/** Findings in one text: category and offset only. Text that only its escapes hide is reported at `#decoded`. */
export function scanText(location, value, names = machineNames()) {
  const findings = matches(location, value, names);
  const plain = decoded(value);
  if (plain !== value) {
    const counted = new Map();
    for (const entry of findings) counted.set(entry.category, (counted.get(entry.category) ?? 0) + 1);
    const hidden = new Map();
    for (const entry of matches(`${location}#decoded`, plain, names)) hidden.set(entry.category, [...(hidden.get(entry.category) ?? []), entry]);
    for (const [category, entries] of hidden) findings.push(...entries.slice(counted.get(category) ?? 0));
  }
  return findings;
}

/**
 * Matches in one text and in its decoded form, for a caller that applies its own policy: each with its
 * category, offset and length, and the text it was found in, so the caller can judge the matched value.
 * The caller must not print or store that value; findings name a category and a location only.
 */
export function findMatches(location, value, names = []) {
  const found = located(location, value, names).map(entry => ({ ...entry, text: value }));
  const plain = decoded(value);
  if (plain === value) return found;
  const counted = new Map();
  for (const entry of found) counted.set(entry.category, (counted.get(entry.category) ?? 0) + 1);
  const hidden = new Map();
  for (const entry of located(`${location}#decoded`, plain, names)) hidden.set(entry.category, [...(hidden.get(entry.category) ?? []), { ...entry, text: plain }]);
  for (const [category, entries] of hidden) found.push(...entries.slice(counted.get(category) ?? 0));
  return found;
}

/** The text chunks of a PNG, inflated where compressed, within fixed bounds. */
function pngText(bytes) {
  const texts = [];
  if (!bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return texts;
  const inflate = data => { try { return inflateSync(data, { maxOutputLength: MAX_INFLATED }); } catch { return Buffer.alloc(0); } };
  for (let at = 8, count = 0; at + 12 <= bytes.length && count < 4096; count++) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.subarray(at + 4, at + 8).toString('latin1');
    const data = bytes.subarray(at + 8, Math.min(at + 8 + length, bytes.length));
    at += 12 + length;
    const keyword = data.indexOf(0);
    if (keyword < 0) continue;
    if (type === 'tEXt') texts.push(data.toString('latin1'));
    else if (type === 'zTXt') texts.push(`${data.subarray(0, keyword).toString('latin1')} ${inflate(data.subarray(keyword + 2)).toString('latin1')}`);
    else if (type === 'iTXt') {
      const compressed = data[keyword + 1] === 1;
      const language = data.indexOf(0, keyword + 3);
      const translated = language < 0 ? -1 : data.indexOf(0, language + 1);
      if (translated < 0) continue;
      const text = data.subarray(translated + 1);
      texts.push(`${data.subarray(0, translated).toString('utf8')} ${(compressed ? inflate(text) : text).toString('utf8')}`);
    }
  }
  return texts;
}

/** Everything readable in binary data: PNG text chunks and printable runs, as bytes and as UTF-16 in both alignments. */
function binaryText(bytes) {
  const runs = [...pngText(bytes), ...(bytes.toString('latin1').match(/[\x20-\x7e]{4,}/gu) ?? [])];
  for (const start of [0, 1]) {
    const end = start + Math.floor((bytes.length - start) / 2) * 2;
    runs.push(...(bytes.subarray(start, end).toString('utf16le').match(/[\x20-\x7e]{4,}/gu) ?? []));
  }
  return runs.join('\n');
}

const isPackage = bytes => bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
const isText = bytes => {
  if (bytes.includes(0)) return false;
  try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); return true; } catch { return false; }
};

/** Every text a byte artifact holds: package parts, binary data or the bytes as text. */
function byteTexts(location, bytes) {
  if (isPackage(bytes)) {
    try { return [...readPackageParts(bytes)].flatMap(([part, content]) => byteTexts(`${location}:${part}`, content)); }
    catch { return [[location, binaryText(bytes)]]; }
  }
  return [[location, isText(bytes) ? bytes.toString('utf8') : binaryText(bytes)]];
}

/** Every text an artifact holds: package parts, capture flavors, fields and clipboard files, or the file as text. */
function texts(name, bytes) {
  if (isPackage(bytes) || !isText(bytes) || !name.endsWith('.json')) return byteTexts(name, bytes);
  const value = bytes.toString('utf8');
  let bundle;
  try { bundle = JSON.parse(value); } catch { return [[name, value]]; }
  const flavors = bundle?.payload?.text;
  if (!flavors || typeof flavors !== 'object') return [[name, value]];
  // A flavor keeps its own offsets; a clipboard file is read as the bytes it holds; everything else is the serialized remainder.
  const files = Array.isArray(bundle.payload.files) ? bundle.payload.files : [];
  return [...Object.entries(flavors).map(([flavor, text]) => [`${name}:${flavor}`, String(text)]),
    ...files.flatMap((file, index) => (typeof file?.base64 === 'string' ? byteTexts(`${name}:files[${String(index)}]`, Buffer.from(file.base64, 'base64')) : [])),
    [`${name}:fields`, JSON.stringify({ ...bundle, payload: { ...bundle.payload, text: {}, files: files.map(file => ({ ...file, base64: '' })) } })]];
}

/**
 * Every text an artifact holds, as [location, text] pairs: the parts of a Word package, the text chunks
 * and printable runs of binary data, the flavors, fields and clipboard files of a capture bundle, or the
 * file as text.
 */
export function artifactTexts(name, bytes) {
  return texts(name, bytes);
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
