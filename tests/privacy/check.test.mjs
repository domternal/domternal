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
import { existsSync, readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { GENERIC_ACCOUNTS, localMachineNames, machineNames, main, placeholderUser, scanFile, scanRepository } from './check.mjs';

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
  assert.deepEqual(categories('a.md', slash('file:', '', `${person}-nas`, 'share', 'a.html')), ['file URL with a host']);
  for (const allowed of ['file:///etc/passwd', 'file://localhost/etc/hosts', 'file:///Users/me/a.html', 'file://$HOME/a.html', 'file:', 'file:x',
    slash('file:', '', 'server', 'share'), slash('file:', '', 'files.example', 'a')]) {
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

// Windows and other home forms as JSON, JavaScript, WSL and MSYS write them, assembled from fragments.
const bs = String.fromCharCode(92);
const homeForms = {
  'Windows path in a JSON or JavaScript string': `{"rootDir": "C:${bs}${bs}Users${bs}${bs}${person}${bs}${bs}src"}`,
  'Windows path with slashes': `D:/Users/${person}/src`,
  'JSON escaped slashes': `{"rootDir": "${bs}/Users${bs}/${person}${bs}/repo"}`,
  'WSL path': `cwd /mnt/c/Users/${person}/repo`,
  'MSYS path': `cd /c/Users/${person}/repo`,
  'Fedora Silverblue home': `/var/home/${person}/repo`,
  'Solaris home': `/export/home/${person}/x`,
};

test('home folders are found in the forms JSON, JavaScript, WSL, MSYS and other systems write them', () => {
  for (const [form, text] of Object.entries(homeForms)) {
    assert.ok(categories(form.includes('JSON') ? 'e2e/report.json' : 'a.log', text).length >= 1, form);
  }
});

test('an allowed match never hides a personal one that only its escapes show, in either order', () => {
  const encoded = address.replace('@', '&#64;');
  const allowed = at('team', 'example.com');
  for (const text of [`${encoded} wrote to ${allowed}`, `${allowed} wrote to ${encoded}`]) {
    assert.deepEqual(categories('docs/a.md', text), ['e-mail address'], text);
  }
  for (const text of [`%2FUsers%2F${person}%2Fx and /Users/me/y`, `/Users/me/y and %2FUsers%2F${person}%2Fx`]) {
    assert.deepEqual(categories('docs/a.md', text), ['home folder path'], text);
  }
});

test('further hidden forms are read: a tilde home, twice percent-encoded paths, JSON and JavaScript escapes, encoded homes, network paths, data URIs', () => {
  const forms = {
    'tilde home': [`see ~${person}/notes.txt`, 'tilde home folder'],
    'twice percent-encoded home': [`x=%252FUsers%252F${person}%252Fx`, 'home folder path'],
    'JSON unicode escape for @': [`{"a": "${person}${bs}u0040corp.co.uk"}`, 'e-mail address'],
    'JavaScript hex escape for @': [`'${person}${bs}x40corp.co.uk'`, 'e-mail address'],
    'address split by a soft hyphen': [`${person}${String.fromCharCode(0xad)}${at('', 'corp.co.uk')}`, 'e-mail address'],
    'lowercase encoded home': [`/private/tmp/claude-1/-users-${person}-repo/x`, 'encoded home folder'],
    'encoded home at the end of a folder name': [`projects/-Users-${person}/x`, 'encoded home folder'],
    'network path': [`${bs}${bs}fileserver${bs}home$${bs}${person}${bs}x`, 'UNC path'],
    'network path in a JavaScript string': [`'${bs}${bs}${bs}${bs}${person}-pc${bs}${bs}docs'`, 'UNC path'],
    'base64 data URI': [`data:text/plain;base64,${Buffer.from(slash('', 'Users', person, 'x')).toString('base64')}`, 'home folder path'],
  };
  for (const [form, [text, category]] of Object.entries(forms)) {
    assert.ok(categories('a.md', text).includes(category), form);
  }
});

test('URL paths, CI and container homes, system folders and file names that look like addresses are not personal', () => {
  for (const text of [
    '[Home](/home/intro)', "app.get('/users/:id', handler)", '<a href="/users/settings">Settings</a>', '"/Users/{id}"',
    '/home/runner/work/domternal/domternal/e2e', '/Users/runner/work/domternal', 'WORKDIR /home/node/app', '/Users/Shared/Relocated Items',
    `C:${bs}Users${bs}Public${bs}Documents`, `${bs}${bs}server${bs}share`, at('font', '2x.woff2'), at('img', '1.5x.png'), at('jquery', '3.7.1.min.js'),
    'prosemirror-model@1.25.0', '@domternal/core.js', `ssh ${at('deploy', 'server.example.com')}`, `/\\${bs}nbreak${bs}.ts/`,
  ]) {
    assert.deepEqual(categories('docs/a.md', text), [], text);
  }
  // A capital /Users/ folder and a home path that goes on into the folder are still a person's.
  assert.deepEqual(categories('a.md', `/home/${person}/repo`), ['home folder path']);
  assert.deepEqual(categories('a.md', `cd /Users/${person}`), ['home folder path']);
});

test('the default names of CI runners, containers and new machines identify nobody', () => {
  for (const name of ['localhost', 'vscode', 'codespace', 'gitpod', 'github', 'build', 'test', 'jenkins', 'circleci', 'macbook-pro', 'raspberrypi']) {
    assert.deepEqual(machineNames({ login: name, host: name }), [], name);
  }
});

test('in binary data, one-character address parts are noise; a real address is still found', () => {
  const binary = (path, text) => scanFile(path, Buffer.concat([Buffer.from([0x89, 0, 0, 0]), Buffer.from(text, 'latin1')]), names).map((finding) => finding.category);
  assert.deepEqual(binary('media/clip.mp4', `\x01${at('G', 'Eo.mf')}\x01${at('GC9', 'D.gz')}\x01~noise/\x01`), []);
  assert.deepEqual(binary('media/clip.mp4', `xxxx ${address} yyyy`), ['e-mail address']);
});

test('addresses that look like policy exceptions but name a person are reported', () => {
  for (const text of [at(person, 'domternal.dev'), at('noreply', 'gmail.com'), at('git', `${person}.co.uk`)]) {
    assert.deepEqual(categories('docs/a.md', text), ['e-mail address'], text);
  }
  for (const text of [at('support', 'domternal.dev'), at('user', 'domternal.dev'), at('noreply', 'anthropic.com'), at('git', 'gitlab.com')]) {
    assert.deepEqual(categories('docs/a.md', text), [], text);
  }
});

test('names a CI secret lists are looked for, and a runner\'s own login and host are not', () => {
  const listed = ['quill', 'ion'].join('');
  const inCi = localMachineNames({ CI: 'true', PRIVACY_NAMES: `${listed}, ${['studio', 'mac'].join('-')}\nab` });
  assert.deepEqual(inCi.filter(([category]) => category !== 'Git e-mail address'), [['listed name', listed], ['listed name', 'studio-mac']]);
  assert.deepEqual(categories('a.md', `by ${listed.toUpperCase()}`, inCi), ['listed name']);
});

test('a zip package of any kind is read part by part', () => {
  const entry = (name, data) => {
    const deflated = deflateRawSync(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(deflated.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
    return { name, local: Buffer.concat([local, Buffer.from(name), deflated]), deflated, size: data.length };
  };
  const parts = [entry('notes/readme.txt', Buffer.from(`write to ${address}`))];
  const central = [];
  let offset = 0;
  for (const part of parts) {
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0); header.writeUInt16LE(8, 10); header.writeUInt32LE(part.deflated.length, 20); header.writeUInt32LE(part.size, 24);
    header.writeUInt16LE(part.name.length, 28); header.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([header, Buffer.from(part.name)]));
    offset += part.local.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(parts.length, 8); end.writeUInt16LE(parts.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  const zip = Buffer.concat([...parts.map((part) => part.local), directory, end]);
  assert.deepEqual(scanFile('public/sample.zip', zip, names).map((finding) => [finding.location, finding.category]), [['public/sample.zip:notes/readme.txt', 'e-mail address']]);
});

test('the site carries the same scanner, byte for byte, where its checkout sits inside this one', (t) => {
  const here = new URL('./scan.mjs', import.meta.url);
  const site = new URL('../../domternal.dev/scripts/privacy-scan.mjs', import.meta.url);
  if (!existsSync(new URL('../../domternal.dev/scripts/', import.meta.url))) {
    t.skip('no site checkout here, as in CI');
    return;
  }
  assert.ok(existsSync(site), 'domternal.dev/scripts/privacy-scan.mjs is missing');
  assert.ok(readFileSync(here).equals(readFileSync(site)), 'tests/privacy/scan.mjs and domternal.dev/scripts/privacy-scan.mjs differ');
});
