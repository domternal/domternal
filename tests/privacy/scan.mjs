/**
 * Personal data in a repository's files: the scanner the Free repository's
 * privacy gate (tests/privacy/scan.mjs) and the site's (scripts/privacy-scan.mjs)
 * share byte for byte, so the two policies cannot drift apart. Each repository's
 * tests compare the two copies where the other repository sits beside it, and
 * each passes its own configuration (vendored notices, certificate addresses).
 * It imports nothing but Node's own modules, so the site can carry it alone.
 *
 * Reading. A file is read as text, or, when it is binary, by its printable runs
 * as bytes and as UTF-16 in both alignments and by the text chunks of a PNG.
 * A zip package (a Word document, a zip download) is read part by part, a
 * capture bundle flavor by flavor and clipboard file by clipboard file, a
 * base64 data URI by what it decodes to, and an RTF text also by what its
 * hexadecimal groups decode to (Word's theme package, color scheme mapping,
 * data store and pictures, list pictures among them). Every text is read again with its
 * escapes decoded: HTML character references, percent escapes (twice encoded
 * too), JSON and JavaScript escapes (\u0040, \x40, \/) and CSS escapes. A match
 * only the decoded reading holds is reported at `<location>#decoded`.
 *
 * What it looks for: e-mail addresses; home folders (/Users/name, /home/name,
 * /var/home/name, /export/home/name, ~name/, WSL's /mnt/c/Users/name, MSYS's
 * /c/Users/name, and the same with JSON's escaped slashes); folder names a tool
 * encoded from a home folder (-Users-name-); drive paths (C:\Users\name with
 * one or two backslashes or slashes); UNC paths (\\host\share); file URLs;
 * author data inside Office packages and capture bundles; and the login, short
 * host name and Git e-mail address of the machine running the scan, plus any
 * name listed in the PRIVACY_NAMES environment variable, which a CI secret can
 * hold, since a CI runner's own names identify nobody.
 *
 * What it allows, and why:
 *
 * - E-mail addresses at domains reserved for documentation and tests (RFC 2606
 *   and RFC 6761: example, example.com, .net and .org, and any name under
 *   .example, .test, .invalid, .localhost or .local); the project's own role
 *   addresses (PROJECT_ADDRESSES) and placeholder users at its domain; a
 *   no-reply sender (noreply, no-reply, donotreply or a GitHub no-reply
 *   address), except at a personal webmail domain; the git@ SSH user of a
 *   known code host; a placeholder user in a URL (https://user@host); a file
 *   name that only looks like an address (icon@2x.png, font@2x.woff2,
 *   lib@1.2.3.min.js).
 * - Addresses in third-party license notices, which name their authors by law
 *   (THIRD-PARTY-LICENSES.md, third-party-licenses.txt, LICENSE files, and the
 *   vendored notices a repository lists with their reason).
 * - In binary data read by its printable runs, an address whose user or first
 *   domain label is one character and a ~name/ path, which compressed image and
 *   video data spell by chance, and the certificate addresses a repository lists
 *   per file: content credentials an image tool embedded name their authority.
 * - Home, encoded home, drive and UNC paths of a placeholder user or host (me,
 *   user, username, you, name, example, test, someone, redacted, owner, x,
 *   $USER, <user>, a ${...} or {id} template), of a generic account that names
 *   nobody (a CI runner, a container's node, macOS's Shared, Windows' Public),
 *   and a lowercase /home/word or /users/word that ends there: that is a URL
 *   path such as /home/intro or /users/settings, while a home folder path goes
 *   on into the folder.
 * - File URLs on this computer that name no person's folder, such as test
 *   inputs like file:///etc/passwd.
 * - Author properties and attributes outside Office packages and capture
 *   bundles: in source code they are markup under test, not a person. Inside a
 *   package, an author value a repository lists for that file as an example its
 *   own content sets (a tutorial's sample metadata).
 * - This machine's names only when they are at least four characters long and
 *   not a generic account or host name (GENERIC_ACCOUNTS, GENERIC_HOSTS), and
 *   not at all in CI (the CI environment variable), where they name a runner.
 *   A no-reply Git address of this machine is still reported: it names the
 *   account it belongs to.
 *
 * A finding names its file, line and category, never the matched text.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { hostname, userInfo } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync, inflateSync } from 'node:zlib';

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

const MAX_INFLATED = 1024 * 1024;
const MAX_PARTS = 2048;
const MAX_DATA_URI = 4 * 1024 * 1024;
const MAX_RTF_HEX = 8 * 1024 * 1024;

/** The parts of a zip package, read from its central directory; null when it is not one this reader can read. */
export function zipParts(bytes) {
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0 || end + 22 > bytes.length) return null;
  const count = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16);
  const parts = [];
  for (let index = 0; index < count && index < MAX_PARTS; index++) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== 0x02014b50) return null;
    const method = bytes.readUInt16LE(offset + 10);
    const compressed = bytes.readUInt32LE(offset + 20);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const skip = nameLength + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
    const local = bytes.readUInt32LE(offset + 42);
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    offset += 46 + skip;
    if (local + 30 > bytes.length || bytes.readUInt32LE(local) !== 0x04034b50) return null;
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const data = bytes.subarray(start, Math.min(start + compressed, bytes.length));
    let content;
    try {
      content = method === 0 ? data : method === 8 ? inflateRawSync(data, { maxOutputLength: MAX_INFLATED }) : null;
    } catch {
      content = null;
    }
    if (content !== null && !name.endsWith('/')) parts.push([name, content]);
  }
  return parts;
}

/** The text chunks of a PNG, inflated where compressed, within fixed bounds. */
function pngText(bytes) {
  const texts = [];
  if (!bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return texts;
  const inflate = (data) => { try { return inflateSync(data, { maxOutputLength: MAX_INFLATED }); } catch { return Buffer.alloc(0); } };
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

const isZip = (bytes) => bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
const isText = (bytes) => {
  if (bytes.includes(0)) return false;
  try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); return true; } catch { return false; }
};

/** What base64 data URIs in a text decode to, each as its own artifact. */
function dataUris(location, text, depth) {
  const found = [];
  let budget = MAX_DATA_URI;
  let index = 0;
  for (const match of text.matchAll(/data:[^,;"'\s]*;base64,([A-Za-z0-9+/]{16,}={0,2})/gu)) {
    if (match[1].length > budget) break;
    budget -= match[1].length;
    found.push(...readBytes(`${location}#data[${String(index++)}]`, Buffer.from(match[1], 'base64'), depth + 1, true));
  }
  return found;
}

/**
 * What the hexadecimal groups of an RTF text decode to, each as its own artifact: Word writes its theme package,
 * color scheme mapping, data store and pictures as hexadecimal digits, wrapped in lines, which no reading of the
 * text sees. A group is a run of at least 64 digits; shorter runs are revision ids, colors and picture ids.
 */
function rtfHexGroups(location, text, depth) {
  if (!/^[\t\n\r ]*\{\\rtf/u.test(text)) return [];
  const found = [];
  let budget = MAX_RTF_HEX;
  let index = 0;
  for (const match of text.matchAll(/[0-9A-Fa-f][0-9A-Fa-f\r\n]{63,}/gu)) {
    const digits = match[0].replace(/[\r\n]/gu, '');
    if (digits.length < 64) continue;
    if (digits.length > budget) break;
    budget -= digits.length;
    found.push(...readBytes(`${location}#hex[${String(index++)}]`, Buffer.from(digits.slice(0, digits.length - (digits.length % 2)), 'hex'), depth + 1, true));
  }
  return found;
}

/** Every text in some bytes, as { location, text, binary, inside }. */
function readBytes(location, bytes, depth, inside) {
  if (depth > 3) return [];
  if (isZip(bytes)) {
    const parts = zipParts(bytes);
    if (parts !== null) return parts.flatMap(([part, content]) => readBytes(`${location}:${part}`, content, depth + 1, true));
  }
  if (!isText(bytes)) return [{ location, text: binaryText(bytes), binary: true, inside }];
  const text = bytes.toString('utf8');
  return [{ location, text, binary: false, inside }, ...dataUris(location, text, depth), ...rtfHexGroups(location, text, depth)];
}

/**
 * Every text a file holds, as { location, text, binary, inside }: the parts of
 * a zip package, the flavors, fields and clipboard files of a capture bundle
 * (JSON with payload.text), what its data URIs decode to, the readable runs of
 * binary data, or the file as text. `inside` marks text from inside a package,
 * a bundle or a data URI.
 */
export function artifactTexts(name, bytes) {
  if (!isZip(bytes) && isText(bytes) && name.endsWith('.json')) {
    const value = bytes.toString('utf8');
    let bundle;
    try { bundle = JSON.parse(value); } catch { bundle = undefined; }
    const flavors = bundle?.payload?.text;
    if (flavors && typeof flavors === 'object') {
      // A flavor keeps its own offsets; a clipboard file is read as the bytes it holds; everything else is the serialized remainder.
      const files = Array.isArray(bundle.payload.files) ? bundle.payload.files : [];
      return [
        ...Object.entries(flavors).flatMap(([flavor, text]) => [{ location: `${name}:${flavor}`, text: String(text), binary: false, inside: true },
          ...dataUris(`${name}:${flavor}`, String(text), 1), ...rtfHexGroups(`${name}:${flavor}`, String(text), 1)]),
        ...files.flatMap((file, index) => (typeof file?.base64 === 'string' ? readBytes(`${name}:files[${String(index)}]`, Buffer.from(file.base64, 'base64'), 1, true) : [])),
        { location: `${name}:fields`, text: JSON.stringify({ ...bundle, payload: { ...bundle.payload, text: {}, files: files.map((file) => ({ ...file, base64: '' })) } }), binary: false, inside: true },
      ];
    }
  }
  return readBytes(name, bytes, 0, false);
}

/**
 * A text with its escapes decoded: HTML character references, percent escapes
 * (a twice encoded %252F too), JSON and JavaScript escapes (\u0040, \u{40},
 * \x40, \/) and CSS escapes (\40), and without the characters that print
 * nothing (soft hyphen, zero-width space and joiners, word joiner, BOM).
 */
export function decoded(value) {
  const code = (number, fallback) => (Number.isSafeInteger(number) && number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : fallback);
  let text = value
    .replace(/&#x([0-9a-f]{1,6});?/giu, (match, digits) => code(Number.parseInt(digits, 16), match))
    .replace(/&#([0-9]{1,7});?/gu, (match, digits) => code(Number(digits), match))
    .replace(/&(commat|period|sol|bsol|colon|lowbar|hyphen|dash|amp|quot|apos|lt|gt);/giu, (match, name) =>
      ({ commat: '@', period: '.', sol: '/', bsol: '\\', colon: ':', lowbar: '_', hyphen: '-', dash: '-', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' })[name.toLowerCase()] ?? match);
  for (let pass = 0; pass < 3 && /%[0-9a-f]{2}/iu.test(text); pass++) {
    text = text.replace(/%([0-9a-f]{2})/giu, (_, digits) => String.fromCharCode(Number.parseInt(digits, 16)));
  }
  return text
    // Characters that print nothing, so a name split by them reads as one.
    .replace(/[\u00ad\u200b-\u200d\u2060\ufeff]/gu, '')
    .replace(/\\u\{([0-9a-f]{1,6})\}/giu, (match, digits) => code(Number.parseInt(digits, 16), match))
    .replace(/\\u([0-9a-f]{4})/giu, (match, digits) => code(Number.parseInt(digits, 16), match))
    .replace(/\\x([0-9a-f]{2})/giu, (match, digits) => code(Number.parseInt(digits, 16), match))
    .replace(/\\\//gu, '/')
    .replace(/\\([0-9a-f]{1,6})[\t\n\f\r ]?/giu, (match, digits) => code(Number.parseInt(digits, 16), match));
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

// A path separator as written plainly, doubled in a JSON or JavaScript string, or with JSON's escaped slash.
const SEP = String.raw`(?:\\\\|\\\/|[\\/])`;
const SEGMENT = String.raw`[^\\/\s"'<>)\]\x60,;|]+`;

/**
 * Every category the scanner reports, as a pattern. A match's first group, where
 * there is one, is the user or host it names, which the policy judges.
 */
export const PATTERNS = Object.freeze({
  'e-mail address': /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/gu,
  // In any letter case: a path a tool lowercased still names the account. A prefix for WSL, MSYS and the
  // home folders of Fedora's image-based systems and of Solaris, and JSON's escaped slashes.
  'home folder path': new RegExp(String.raw`(?:^|[^A-Za-z0-9\\])(?:\\?\/mnt\\?\/[a-z]|\\?\/[a-z](?=\\?\/users\\?\/)|\\?\/var|\\?\/export)?\\?\/(?:users|home)\\?\/(${SEGMENT})`, 'giu'),
  // A home folder by its owner's name, as a shell expands it.
  'tilde home folder': /(?:^|(?<=[\s"'(=:]))~([A-Za-z_][A-Za-z0-9_.-]*)\//gu,
  'encoded home folder': /(?:^|(?<=[\\/\s"'=:]))-(?:users|home)-([A-Za-z0-9._]+)(?=[-\\/"'\s]|$)/giu,
  'drive path': new RegExp(String.raw`\b[A-Za-z]:${SEP}+(?:Users|Documents and Settings)${SEP}+(${SEGMENT}|$)`, 'giu'),
  // A Windows network path, \\host\share, plainly or doubled in a JSON or JavaScript string: host, then share.
  'UNC path': /(?<![\\\w])(?:\\\\){2}([A-Za-z0-9][\w.-]*)(?:\\\\)+([\w$][\w$.-]*)|(?<![\\\w])\\\\([A-Za-z0-9][\w.-]*)\\([\w$][\w$.-]*)/gu,
  'file URL': /\bfile:/giu,
  'author property': /<(?:[A-Za-z]+:)?(?:creator|lastModifiedBy|Author|LastAuthor|Company|Manager)\b[^<>]*>[^<]+</gu,
  // Revision, comment and people attributes under any namespace prefix, such as w:author, w15:author and w15:userId.
  'author attribute': /\b(?:[A-Za-z][A-Za-z0-9]*:)?(?:author|initials|userId)="[^"]+"/gu,
});
// A document's custom properties can hold anything, a reviewer's or a label owner's name among it.
const CUSTOM_PROPERTY = /<vt:[A-Za-z0-9]+>[^<]+</gu;

/** Matches by category in one text, each with its offset, length, the user or host it names, and the text. */
export function locate(location, text, names = []) {
  const found = [];
  for (const [category, pattern] of Object.entries(PATTERNS)) {
    for (const match of text.matchAll(pattern)) {
      // A home folder pattern may start with the character before the path; the match starts at the path.
      const lead = category === 'home folder path' && match[0] !== '' && !/[\\/]/u.test(match[0][0]) ? 1 : 0;
      const subject = category === 'UNC path' ? `${match[1] ?? match[3] ?? ''}\\${match[2] ?? match[4] ?? ''}` : match[1] ?? '';
      found.push({ location, category, offset: match.index + lead, length: match[0].length - lead, subject, text });
    }
  }
  if (location.endsWith('docProps/custom.xml')) {
    for (const match of text.matchAll(CUSTOM_PROPERTY)) found.push({ location, category: 'custom property', offset: match.index, length: match[0].length, subject: '', text });
  }
  const lower = text.toLowerCase();
  for (const [category, name] of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const match of lower.matchAll(new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'g'))) {
      found.push({ location, category, offset: match.index, length: name.length, subject: '', text });
    }
  }
  return found;
}

/**
 * The matches in one text that `classify` reports, each under the category it
 * gives (null drops a match), and those only its decoded reading holds. Judging
 * comes first: a match a rule allows never stands in for a hidden one of the
 * same category.
 */
export function findMatches(location, text, names = [], classify = (match) => match.category) {
  const judged = (entries) => entries.flatMap((entry) => {
    const category = classify(entry);
    return category ? [{ ...entry, category }] : [];
  });
  const found = judged(locate(location, text, names));
  const plain = decoded(text);
  if (plain === text) return found;
  const counted = new Map();
  for (const entry of found) counted.set(entry.category, (counted.get(entry.category) ?? 0) + 1);
  for (const entry of judged(locate(`${location}#decoded`, plain, names))) {
    const left = counted.get(entry.category) ?? 0;
    if (left > 0) counted.set(entry.category, left - 1);
    else found.push(entry);
  }
  return found;
}

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

export const PLACEHOLDER_USERS = new Set(['me', 'x', 'user', 'username', 'you', 'name', 'example', 'test', 'someone', 'redacted', 'owner', '$user']);
/** Accounts and folders that name nobody: CI runners, containers, system folders. */
export const GENERIC_ACCOUNTS = new Set(['runner', 'root', 'ubuntu', 'debian', 'admin', 'administrator', 'user', 'vsts', 'docker', 'node', 'ci',
  'shared', 'public', 'default', 'default user', 'all users', 'guest', 'vscode', 'codespace', 'codespaces', 'gitpod', 'github', 'gitlab',
  'jenkins', 'travis', 'circleci', 'buildkite', 'build', 'builder', 'test', 'tester', 'dev', 'developer', 'app', 'www', 'web', 'vagrant',
  'ec2-user', 'azureuser', 'cloudshell', 'localhost']);
/** Host names that name nobody: a machine's defaults. */
export const GENERIC_HOSTS = new Set(['localhost', 'macbook', 'macbook-pro', 'macbook-air', 'imac', 'mac-mini', 'mac-studio', 'mac-pro', 'raspberrypi']);
/** The project's role addresses at its own domain. */
export const PROJECT_ADDRESSES = new Set(['hello', 'info', 'support', 'security', 'sales', 'contact', 'privacy', 'legal', 'billing', 'team',
  'press', 'abuse', 'conduct', 'licensing', 'noreply', 'no-reply']);
/** Hosts whose SSH address is git@host. */
export const CODE_HOSTS = /^(?:github\.com|gitlab\.com|bitbucket\.org|codeberg\.org|gitea\.com|ssh\.dev\.azure\.com|vs-ssh\.visualstudio\.com|git\.sr\.ht|heroku\.com)$/iu;
const WEBMAIL = /^(?:gmail\.com|googlemail\.com|outlook\.com|hotmail\.[a-z.]+|live\.[a-z.]+|msn\.com|yahoo\.[a-z.]+|ymail\.com|icloud\.com|me\.com|mac\.com|proton\.me|protonmail\.[a-z]+|pm\.me|gmx\.[a-z.]+|web\.de|aol\.com|yandex\.[a-z]+|mail\.ru|zoho\.com|fastmail\.[a-z]+|hey\.com)$/iu;
const RESERVED_DOMAIN = /(?:^|\.)(?:example|test|invalid|localhost|local)$|(?:^|\.)example\.(?:com|net|org)$/iu;
const PROJECT_DOMAIN = /^domternal\.dev$/iu;
const NO_REPLY_USER = /^(?:noreply|no-reply|donotreply|do-not-reply)$/iu;
const GITHUB_NO_REPLY = /@users\.noreply\.github\.com$/iu;
// A file name that only looks like an address: a density descriptor (icon@2x.png) or a versioned file (lib@1.2.3.min.js).
const FILE_NAME = /^\d+(?:\.\d+)*x\.|\.(?:png|jpe?g|gif|webp|svg|avif|bmp|ico|woff2?|ttf|otf|eot|mp4|webm|mov|m4v|mp3|wav|ogg|pdf|m?js|cjs|css|map|wasm)$/iu;
const NOTICE_FILE = /(?:^|\/)(?:THIRD-PARTY-LICENSES\.md|third-party-licenses\.txt|LICENSE[^/]*)$/u;
// A network path in documentation: a placeholder host and share, such as \\server\share.
const PLACEHOLDER_HOSTS = new Set(['server', 'host', 'fileserver', 'computer', 'machine', 'localhost', 'example', 'nas']);
const PLACEHOLDER_SHARES = new Set(['share', 'shared', 'public', 'folder', 'path', 'dir', 'directory', 'data', 'files', 'docs', 'c$', 'd$']);
const OFFICE_ONLY = new Set(['author property', 'author attribute', 'custom property']);

/** Whether a user segment is a documented placeholder or a template, rather than a person. */
export function placeholderUser(user) {
  const name = user.toLowerCase();
  return PLACEHOLDER_USERS.has(name) || /^(?:\$|<|\{|\[|:|%)/u.test(name) || name.includes('*');
}

/** Whether a user segment names nobody: a placeholder or a generic account. */
export function nobody(user) {
  return placeholderUser(user) || GENERIC_ACCOUNTS.has(user.toLowerCase());
}

/** Why an e-mail address is allowed, or null. */
function allowedAddress(path, address, preceding, { binary, notices, certificates }) {
  const [local, domain = ''] = address.split('@');
  if (binary && (local.length < 2 || domain.split('.')[0].length < 2)) return 'noise in binary data';
  if (binary && certificates.get(path) === domain.toLowerCase()) return 'a certificate in embedded content credentials';
  if (RESERVED_DOMAIN.test(domain)) return 'a domain reserved for documentation';
  if (PROJECT_DOMAIN.test(domain) && (PROJECT_ADDRESSES.has(local.toLowerCase()) || placeholderUser(local))) return "the project's own role address";
  if (local.toLowerCase() === 'git' && CODE_HOSTS.test(domain)) return 'the SSH user of a code host';
  if (NO_REPLY_USER.test(local) && !WEBMAIL.test(domain)) return 'a no-reply sender';
  if (GITHUB_NO_REPLY.test(address)) return 'a no-reply sender';
  if (FILE_NAME.test(domain)) return 'a file name, not an address';
  if (/:\/\/$/u.test(preceding) && placeholderUser(local)) return 'a placeholder user in a URL';
  if (NOTICE_FILE.test(path)) return 'a third-party license notice';
  if (notices.has(path)) return 'a vendored license notice';
  return null;
}

/** The person a file URL names: a host other than this computer, or a home or drive folder. */
function fileUrlProblem(following) {
  const rest = /^\/\/([^\s"'<>)`]*)/u.exec(following)?.[1];
  if (rest === undefined) return null;
  const slash = rest.indexOf('/');
  const host = slash === -1 ? rest : rest.slice(0, slash);
  // An environment variable, a template value or a placeholder host in the host position names no machine.
  const named = host.toLowerCase();
  if (named !== '' && !PLACEHOLDER_HOSTS.has(named) && !RESERVED_DOMAIN.test(named) && !/^[$<{]/u.test(named)) return 'file URL with a host';
  const user = /^(?:[^/]*)\/+(?:[A-Za-z]:\/)?(?:users|home)\/([^/]+)/iu.exec(rest)?.[1];
  return user !== undefined && !nobody(user) ? 'file URL in a home folder' : null;
}

/**
 * The verdict on one match: the category to report, or null when a rule allows
 * it. `inside` is true for text from inside a package, a bundle or a data URI,
 * `binary` for the readable runs of binary data.
 */
export function judge(path, match, { inside = false, binary = false, notices = new Map(), certificates = new Map(), examples = new Map() } = {}) {
  const value = match.text.slice(match.offset, match.offset + match.length);
  const preceding = match.text.slice(Math.max(0, match.offset - 16), match.offset);
  const following = match.text.slice(match.offset + match.length, match.offset + match.length + 256);
  switch (match.category) {
    case 'e-mail address':
      return allowedAddress(path, value, preceding, { binary, notices, certificates }) ? null : match.category;
    case 'home folder path': {
      if (nobody(match.subject)) return null;
      // A lowercase /home/word or /users/word that ends there is a URL path, not a home folder.
      const capitalUsers = /(?:^|\/)Users\\?\/[^/]*$/u.test(value.replace(/\\\//gu, '/'));
      return capitalUsers || /^(?:\\\\|\\\/|[\\/])/u.test(following) ? match.category : null;
    }
    case 'tilde home folder':
      // Compressed image and video data spells a tilde, a word and a slash by chance.
      return binary || nobody(match.subject) ? null : match.category;
    case 'encoded home folder':
    case 'drive path':
      return nobody(match.subject) ? null : match.category;
    case 'UNC path': {
      const [host = '', share = ''] = match.subject.toLowerCase().replace(/\.+$/u, '').split('\\');
      const placeholderHost = PLACEHOLDER_HOSTS.has(host) || RESERVED_DOMAIN.test(host);
      return placeholderHost && (PLACEHOLDER_SHARES.has(share) || placeholderUser(share)) ? null : match.category;
    }
    case 'file URL':
      return fileUrlProblem(following);
    case 'author property':
      // An example value the document's own content sets, such as a tutorial's metadata.
      if (examples.get(path)?.has(/>([^<]*)<$/u.exec(value)?.[1] ?? '')) return null;
      return inside ? match.category : null;
    default:
      return OFFICE_ONLY.has(match.category) && !inside ? null : match.category;
  }
}

/**
 * The names worth looking for, as [category, lowercase value]: this machine's,
 * passed in, unless they are short or generic, and every name listed.
 */
export function machineNames({ login, host, gitEmail, listed = [] } = {}) {
  return [['login name', login], ['host name', host], ['Git e-mail address', gitEmail], ...listed.map((name) => ['listed name', name])]
    .filter(([category, value]) => typeof value === 'string' && value.trim().length >= 4
      && !(category !== 'listed name' && (GENERIC_ACCOUNTS.has(value.toLowerCase()) || GENERIC_HOSTS.has(value.toLowerCase()))))
    .map(([category, value]) => [category, value.trim().toLowerCase()]);
}

/**
 * This machine's names, read where they live, and those PRIVACY_NAMES lists
 * (comma or line separated). In CI the login and host name are a runner's and
 * are left out.
 */
export function localMachineNames(root, env = process.env) {
  const listed = (env.PRIVACY_NAMES ?? '').split(/[,\n]/u).map((name) => name.trim()).filter(Boolean);
  let gitEmail;
  try {
    gitEmail = execFileSync('git', ['config', 'user.email'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    gitEmail = undefined;
  }
  if (env.CI) return machineNames({ gitEmail, listed });
  let login;
  try {
    login = userInfo().username;
  } catch {
    login = undefined;
  }
  return machineNames({ login, host: hostname().split('.')[0], gitEmail, listed });
}

const lineOf = (text, offset) => text.slice(0, offset).split('\n').length;
const NAME_CATEGORIES = new Set(['login name', 'host name', 'Git e-mail address', 'listed name']);

/**
 * Findings in one file, as { path, location, line, category }. `notices` maps a
 * vendored file to the reason its license names people, `certificates` a file
 * to the one certificate domain its content credentials may name, `examples` a
 * package to the example author values its own content sets.
 */
export function scanFile(path, bytes, names, { notices = new Map(), certificates = new Map(), examples = new Map() } = {}) {
  const findings = [];
  for (const { location, text, binary, inside } of artifactTexts(path, bytes)) {
    const classify = (match) => (NAME_CATEGORIES.has(match.category) ? match.category : judge(path, match, { inside, binary, notices, certificates, examples }));
    for (const match of findMatches(location, text, names, classify)) {
      findings.push({ path, location: match.location, line: lineOf(match.text, match.offset), category: match.category });
    }
  }
  return findings;
}

/** Every file Git tracks or would add. */
export function trackedFiles(root) {
  return execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, maxBuffer: 1 << 28 })
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
}

/** Findings over a repository. */
export function scanRepository(root, { names = localMachineNames(root), files = trackedFiles(root), notices, certificates, examples } = {}) {
  const findings = [];
  let scanned = 0;
  for (const path of files) {
    const full = join(root, path);
    if (!existsSync(full) || !lstatSync(full).isFile()) continue;
    scanned++;
    findings.push(...scanFile(path, readFileSync(full), names, { notices, certificates, examples }));
  }
  return { scanned, findings };
}
