#!/usr/bin/env node
/**
 * No personal data in tracked files.
 *
 * Every file Git tracks or would add is scanned for e-mail addresses, home
 * folder and drive paths (also as a tool encodes them into a directory name),
 * file URLs that name a person's folder or another host, author data inside
 * Office packages and capture bundles, and the login, short host name and Git
 * e-mail address of the machine that runs the scan, which nobody has to write
 * down for it. The reading is the native capture scanner's
 * (`e2e/native-office-capture/privacy.mjs`): Word packages part by part, the
 * text chunks and printable runs of binary files, capture bundles flavor by
 * flavor, and every text again with its HTML, percent and CSS escapes decoded.
 *
 * A finding prints its file, line and category, never the matched text, so the
 * gate's own output cannot leak what it found.
 *
 * What is allowed, and why (each rule is exercised in check.test.mjs):
 *
 * - E-mail addresses at domains reserved for documentation and tests (RFC 2606
 *   and RFC 6761: example, example.com, .net and .org, and any name under
 *   .example, .test, .invalid, .localhost or .local), at the project's own
 *   domternal.dev, from a no-reply sender, the git@ user of a code host's SSH
 *   address, a placeholder user in a URL (https://user@host), and a file name
 *   such as icon@2x.png, which only looks like an address.
 * - Addresses in third-party license notices, which name their authors by
 *   law (THIRD-PARTY-LICENSES.md, LICENSE files and the vendored notices
 *   listed in VENDORED_NOTICES with their reason).
 * - Home, encoded home and drive paths of a placeholder user (me, user,
 *   username, you, name, example, test, someone, redacted, owner, x, $USER, a
 *   ${...} template value), as documentation and tests write them.
 * - File URLs on this computer that name no person's folder, such as test
 *   inputs like file:///etc/passwd.
 * - Author properties and attributes outside Office packages and capture
 *   bundles: in source code they are markup under test, not a person.
 * - This machine's names only when they are at least four characters long and
 *   not a generic account (runner, root, ubuntu, admin, user, vsts, docker,
 *   node, ci): shorter or generic names would match ordinary words, and they
 *   identify nobody.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { hostname, userInfo } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { artifactTexts, findMatches } from '../../e2e/native-office-capture/privacy.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const PLACEHOLDER_USERS = new Set(['me', 'x', 'user', 'username', 'you', 'name', 'example', 'test', 'someone', 'redacted', 'owner', '$user']);
export const GENERIC_ACCOUNTS = new Set(['runner', 'root', 'ubuntu', 'admin', 'user', 'vsts', 'docker', 'node', 'ci']);
const RESERVED_DOMAIN = /(?:^|\.)(?:example|test|invalid|localhost|local)$|(?:^|\.)example\.(?:com|net|org)$/iu;
const PROJECT_DOMAIN = /(?:^|\.)domternal\.dev$/iu;
const NO_REPLY = /^(?:noreply|no-reply)@|@users\.noreply\.github\.com$/iu;
const FILE_NAME = /\.(?:png|jpe?g|gif|webp|svg|avif|bmp|ico)$/iu;
const NOTICE_FILE = /(?:^|\/)(?:THIRD-PARTY-LICENSES\.md|third-party-licenses\.txt|LICENSE[^/]*)$/u;
/** Vendored upstream code whose license header names its authors, as the license requires. */
export const VENDORED_NOTICES = new Map([
  ['packages/extension-table/src/helpers/pasteCells.ts', 'the MIT notice of the prosemirror-tables code it adapts'],
]);
const ENCODED_HOME = /-Users-([A-Za-z0-9._]+)-/gu;
const OFFICE_ONLY = new Set(['author property', 'author attribute', 'custom property']);

/** Whether a user segment is a documented placeholder rather than a person. */
export function placeholderUser(user) {
  const name = user.toLowerCase();
  return PLACEHOLDER_USERS.has(name) || name.startsWith('${') || name.startsWith('<');
}

/**
 * The names of the machine running the scan worth looking for, as
 * [category, lowercase value]. Each is passed in by the caller in tests.
 */
export function machineNames({ login, host, gitEmail } = {}) {
  return [['login name', login], ['host name', host], ['Git e-mail address', gitEmail]]
    .filter(([, value]) => typeof value === 'string' && value.length >= 4 && !GENERIC_ACCOUNTS.has(value.toLowerCase()))
    .map(([category, value]) => [category, value.toLowerCase()]);
}

/** This machine's names, read where they live. */
export function localMachineNames() {
  let login;
  try {
    login = userInfo().username;
  } catch {
    login = undefined;
  }
  let gitEmail;
  try {
    gitEmail = execFileSync('git', ['config', 'user.email'], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    gitEmail = undefined;
  }
  return machineNames({ login, host: hostname().split('.')[0], gitEmail });
}

/** Why an e-mail address is allowed, or null. */
function allowedAddress(path, address, preceding) {
  const [local, domain = ''] = address.split('@');
  if (local.toLowerCase() === 'git') return 'the SSH user of a code host';
  if (RESERVED_DOMAIN.test(domain)) return 'a domain reserved for documentation';
  if (PROJECT_DOMAIN.test(domain)) return "the project's own domain";
  if (NO_REPLY.test(address)) return 'a no-reply sender';
  if (FILE_NAME.test(domain)) return 'a file name, not an address';
  if (/:\/\/$/u.test(preceding) && placeholderUser(local)) return 'a placeholder user in a URL';
  if (NOTICE_FILE.test(path)) return 'a third-party license notice';
  if (VENDORED_NOTICES.has(path)) return 'a vendored license notice';
  return null;
}

/** The person a file URL names: a host other than this computer, or a home or drive folder. */
function fileUrlProblem(following) {
  const rest = /^\/\/([^\s"'<>)`]*)/u.exec(following)?.[1];
  if (rest === undefined) return null;
  const slash = rest.indexOf('/');
  const host = slash === -1 ? rest : rest.slice(0, slash);
  // An environment variable or a template value in the host position is a placeholder, not a host.
  if (host !== '' && host.toLowerCase() !== 'localhost' && !host.startsWith('$')) return 'file URL with a host';
  const user = /^(?:[^/]*)\/+(?:[A-Za-z]:\/)?(?:users|home)\/([^/]+)/iu.exec(rest)?.[1];
  return user !== undefined && !placeholderUser(user) ? 'file URL in a home folder' : null;
}

const userAfter = (text) => /^([^\\/\s"'<>)`]*)/u.exec(text)?.[1] ?? '';

/**
 * The verdict on one match: the category to report, or null when a rule
 * allows it. `inside` is true for text from inside an Office package or a
 * capture bundle.
 */
export function judge(path, match, inside) {
  const value = match.text.slice(match.offset, match.offset + match.length);
  const preceding = match.text.slice(Math.max(0, match.offset - 16), match.offset);
  const following = match.text.slice(match.offset + match.length, match.offset + match.length + 256);
  switch (match.category) {
    case 'e-mail address':
      return allowedAddress(path, value, preceding) ? null : match.category;
    case 'home folder path':
      return placeholderUser(/\/(?:users|home)\/(.+)$/iu.exec(value)?.[1] ?? '') ? null : match.category;
    case 'drive path':
      return placeholderUser(userAfter(following)) ? null : match.category;
    case 'file URL':
      return fileUrlProblem(following);
    default:
      return OFFICE_ONLY.has(match.category) && !inside ? null : match.category;
  }
}

/** Matches of this machine's names as whole words, and of encoded home folders, in one text. */
function extraMatches(location, text, names) {
  const found = [];
  const lower = text.toLowerCase();
  for (const [category, name] of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const match of lower.matchAll(new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'g'))) {
      found.push({ location, category, offset: match.index, length: name.length, text });
    }
  }
  for (const match of text.matchAll(ENCODED_HOME)) {
    if (!placeholderUser(match[1])) found.push({ location, category: 'encoded home folder', offset: match.index, length: match[0].length, text, keep: true });
  }
  return found;
}

const lineOf = (text, offset) => text.slice(0, offset).split('\n').length;

/** Findings in one file, as { path, location, line, category }. */
export function scanFile(path, bytes, names) {
  const findings = [];
  for (const [location, text] of artifactTexts(path, bytes)) {
    const inside = location !== path;
    for (const match of [...findMatches(location, text), ...extraMatches(location, text, names)]) {
      const category = match.keep ? match.category : judge(path, match, inside);
      if (category) findings.push({ path, location: match.location, line: lineOf(match.text, match.offset), category });
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
export function scanRepository(root = repoRoot, { names = localMachineNames(), files = trackedFiles(root) } = {}) {
  const findings = [];
  let scanned = 0;
  for (const path of files) {
    const full = join(root, path);
    if (!existsSync(full) || !lstatSync(full).isFile()) continue;
    scanned++;
    findings.push(...scanFile(path, readFileSync(full), names));
  }
  return { scanned, findings };
}

/** CLI: print findings as location:line category and set the exit code. */
export function main({ root = repoRoot, names, files, log = console.log, error = console.error } = {}) {
  const { scanned, findings } = scanRepository(root, { ...(names ? { names } : {}), ...(files ? { files } : {}) });
  if (findings.length > 0) {
    error('[privacy] FAILED: personal data in tracked files (the matched text is not printed):');
    for (const finding of findings) error(`  - ${finding.location}:${finding.line} ${finding.category}`);
    error('[privacy] replace it with a placeholder such as $HOME, a reserved domain such as example.com, or a rule in tests/privacy/check.mjs with its reason');
    return 1;
  }
  log(`[privacy] OK: ${scanned} tracked files hold no e-mail address, home or drive path, file URL or name of this machine outside the documented rules`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = main();
}
