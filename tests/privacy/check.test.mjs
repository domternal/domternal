/**
 * The privacy gate: one probe per category it reports and per rule that
 * allows something, the readings it shares with the native capture scanner,
 * and the promise that a finding never prints what it found. Every personal
 * value here is assembled at run time from fragments, so this file passes the
 * gate itself, and the machine's names are passed in, never read.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { writePackage } from '../../e2e/native-office-capture/redact.mjs';
import { GENERIC_ACCOUNTS, machineNames, main, placeholderUser, scanFile, scanRepository } from './check.mjs';

const at = (...parts) => parts.join('@');
const slash = (...parts) => parts.join('/');
const person = ['jane', 'roe'].join('');
const address = at(person, ['corp', 'co', 'uk'].join('.'));
const names = machineNames({ login: ['quill', 'ion'].join(''), host: ['studio', 'mac', 'pro'].join('-'), gitEmail: at('dev', ['mail', 'test'].join('.')) });

const categories = (path, text, given = names) => scanFile(path, Buffer.from(text), given).map((finding) => finding.category);

test('an e-mail address is reported with its line, never its text', () => {
  const findings = scanFile('docs/a.md', Buffer.from(`first line\nwrite to ${address}\n`), names);
  assert.deepEqual(findings, [{ path: 'docs/a.md', location: 'docs/a.md', line: 2, category: 'e-mail address' }]);
});

test('addresses at reserved, project and no-reply domains, SSH users, URL placeholders and file names are allowed', () => {
  for (const allowed of [
    at('a', 'b.example'),
    at('someone', 'example.com'),
    at('anonymous', 'ftp.example.org'),
    at('a', 'host.test'),
    at('a', 'x.invalid'),
    at('viewer', 'camera.local'),
    at('dev', 'site.localhost'),
    at('hello', 'domternal.dev'),
    at('noreply', 'service.co'),
    at('no-reply', 'service.co'),
    at('1234+someone', 'users.noreply.github.com'),
    `ssh://${at('git', 'github.com')}/org/repo.git`,
    `https://${at('user', 'host.co')}/path`,
    at('icon', '2x.png'),
  ]) {
    assert.deepEqual(categories('src/a.ts', `const value = '${allowed}';\n`), [], allowed);
  }
  assert.deepEqual(categories('src/a.ts', `https://${at(person, 'host.co')}/path`), ['e-mail address'], 'only a placeholder user in a URL is allowed');
});

test('addresses in license notices are allowed where the license puts them', () => {
  for (const path of ['THIRD-PARTY-LICENSES.md', 'packages/x/THIRD-PARTY-LICENSES.md', 'LICENSE', 'third-party-licenses.txt', 'packages/extension-table/src/helpers/pasteCells.ts']) {
    assert.deepEqual(categories(path, `Copyright ${address}\n`), [], path);
  }
  assert.deepEqual(categories('packages/extension-table/src/other.ts', `Copyright ${address}\n`), ['e-mail address']);
});

test('home, encoded home and drive paths are reported unless the user is a placeholder', () => {
  assert.deepEqual(categories('a.json', `"${slash('', 'Users', person, 'x')}"`), ['home folder path']);
  assert.deepEqual(categories('a.json', `"${slash('', 'home', person, 'x')}"`), ['home folder path']);
  assert.deepEqual(categories('a.log', `/private/tmp/claude-1/-Users-${person}-project/x`), ['encoded home folder']);
  assert.deepEqual(categories('a.txt', `C:${['', 'Users', person, 'x'].join('\\')}`), ['drive path']);
  for (const user of ['me', 'user', 'username', 'you', 'name', 'example', 'test', 'someone', 'redacted', 'owner', 'x', '$USER', '${home}']) {
    assert.deepEqual(categories('a.md', `"${slash('', 'Users', user, 'x')}" -Users-${user}- C:\\Users\\${user}\\x`), [], user);
  }
  assert.equal(placeholderUser('<user>'), true);
  // A URL path that merely contains /home/ is not a home folder.
  assert.deepEqual(categories('a.md', 'https://site.example/home/page'), []);
});

test('file URLs are reported when they name a person\'s folder or another host', () => {
  assert.deepEqual(categories('a.md', `file://${slash('', 'Users', person, 'a.html')}`), ['home folder path', 'file URL in a home folder']);
  assert.deepEqual(categories('a.md', slash('file:', '', 'fileserver', 'share', 'a.html')), ['file URL with a host']);
  for (const allowed of ['file:///etc/passwd', 'file://localhost/etc/hosts', 'file:///Users/me/a.html', 'file://$HOME/a.html', 'file:', 'file:x']) {
    assert.deepEqual(categories('a.md', allowed), [], allowed);
  }
});

test("this machine's names are found as whole words, in any letter case, and only when they identify someone", () => {
  const [login, host, email] = names.map(([, value]) => value);
  assert.deepEqual(categories('a.md', `by ${login.toUpperCase()} on ${host}, ${email}`), ['login name', 'host name', 'Git e-mail address']);
  assert.deepEqual(categories('a.md', `x${login}y`), [], 'a name inside a longer word is not a match');
  assert.deepEqual(machineNames({ login: 'abc', host: 'runner', gitEmail: '' }), [], 'short and generic names are skipped');
  for (const generic of GENERIC_ACCOUNTS) assert.deepEqual(machineNames({ login: generic }), []);
  assert.deepEqual(machineNames({ login: 'Mixed' }), [['login name', 'mixed']]);
});

test('escaped text is read decoded', () => {
  const encoded = address.replace('@', '&#64;');
  assert.deepEqual(scanFile('a.html', Buffer.from(`<p>${encoded}</p>`), names).map((finding) => [finding.location, finding.category]), [['a.html#decoded', 'e-mail address']]);
  assert.deepEqual(categories('a.css', `content: "${address.replace('@', '\\40 ')}";`), ['e-mail address']);
  assert.deepEqual(categories('a.txt', address.replace('@', '%40')), ['e-mail address']);
});

test('Word packages, image text chunks and capture bundles are read inside', () => {
  const core = `<cp:coreProperties><dc:creator>${['Jane', 'Roe'].join(' ')}</dc:creator></cp:coreProperties>`;
  const docx = writePackage(new Map([['docProps/core.xml', Buffer.from(core)], ['word/document.xml', Buffer.from(`<w:t>${address}</w:t>`)]]));
  assert.deepEqual(scanFile('fixture.docx', docx, names).map((finding) => [finding.location, finding.category]), [
    ['fixture.docx:docProps/core.xml', 'author property'],
    ['fixture.docx:word/document.xml', 'e-mail address'],
  ]);
  const chunk = (type, data) => {
    const header = Buffer.alloc(8);
    header.writeUInt32BE(data.length, 0);
    header.write(type, 4, 'latin1');
    return Buffer.concat([header, data, Buffer.alloc(4)]);
  };
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('tEXt', Buffer.from(`Author\0${address}`, 'latin1'))]);
  assert.ok(scanFile('image.png', png, names).some((finding) => finding.category === 'e-mail address'));
  const bundle = JSON.stringify({ payload: { text: { 'text/html': `<o:Author>${person}</o:Author>` } } });
  assert.deepEqual(categories('capture.json', bundle), ['author property']);
  assert.deepEqual(categories('src/fixture.ts', `const html = '<o:Author>${person}</o:Author>';`), [], 'author markup in source code is not a package');
});

test('the gate fails with locations and categories only, and passes a clean tree', () => {
  const root = mkdtempSync(join(tmpdir(), 'privacy-gate-'));
  try {
    const write = (path, text) => {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    };
    write('docs/clean.md', `Write to ${at('team', 'example.com')}.\n`);
    write('docs/leak.md', `# Notes\n\nfrom ${address} at ${slash('', 'Users', person, 'x')}\n`);
    const output = [];
    const collect = (line) => output.push(line);
    assert.equal(main({ root, names, files: ['docs/clean.md', 'docs/leak.md'], log: collect, error: collect }), 1);
    assert.deepEqual(output.slice(1, 3), ['  - docs/leak.md:3 e-mail address', '  - docs/leak.md:3 home folder path']);
    assert.ok(output.every((line) => !line.includes(person)), 'the matched text is never printed');
    output.length = 0;
    assert.equal(main({ root, names, files: ['docs/clean.md'], log: collect, error: collect }), 0);
    assert.match(output[0], /\[privacy\] OK: 1 tracked files/);
    assert.equal(scanRepository(root, { names, files: ['missing.md'] }).scanned, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
