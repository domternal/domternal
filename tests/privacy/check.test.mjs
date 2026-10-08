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
import { deflateRawSync, deflateSync } from 'node:zlib';
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
  const encoded = address.replaceAll('@', '&#64;');
  assert.deepEqual(scanFile('a.html', Buffer.from(`<p>${encoded}</p>`), names).map((finding) => [finding.location, finding.category]), [['a.html#decoded', 'e-mail address']]);
  assert.deepEqual(categories('a.css', `content: "${address.replaceAll('@', '\\40 ')}";`), ['e-mail address']);
  assert.deepEqual(categories('a.txt', address.replaceAll('@', '%40')), ['e-mail address']);
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
  const encoded = address.replaceAll('@', '&#64;');
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

test('an RTF text is read with its hexadecimal groups decoded: a theme package, a color scheme mapping, a picture', () => {
  // Word's RTF flavor writes binary data as hexadecimal digits, wrapped in lines, which no reading of the text sees.
  const hex = (bytes) => bytes.toString('hex').replace(/(.{128})/gu, '$1\n');
  const chunk = (type, data) => {
    const header = Buffer.alloc(8);
    header.writeUInt32BE(data.length, 0);
    header.write(type, 4, 'latin1');
    return Buffer.concat([header, data, Buffer.alloc(4)]);
  };
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('tEXt', Buffer.from(`Author\0${address}`, 'latin1'))]);
  const theme = writePackage(new Map([['theme/theme/theme1.xml', Buffer.from(`<a:theme name="${address}"/>`)]]));
  const mapping = Buffer.from(`<a:clrMap bg1="lt1"/><!-- ${slash('', 'Users', person, 'Library', 'x.xml')} -->`);
  const rtf = `{\\rtf1\\ansi\\rsid1145325{\\*\\themedata ${hex(theme)}}\n{\\*\\colorschememapping ${hex(mapping)}}{\\pict\\pngblip\\bliptag255{\\*\\blipuid b40ec0e86951e96d9beeb5dde66a355c}${hex(png)}}}`;
  const bundle = JSON.stringify({ payload: { text: { 'text/rtf': `${rtf}\0` } } });
  // A picture is read by its text chunks and its printable runs, which both hold the address.
  const distinct = (findings) => [...new Set(findings.map((finding) => `${finding.location} ${finding.category}`))];
  assert.deepEqual(distinct(scanFile('capture.json', Buffer.from(bundle), names)), [
    'capture.json:text/rtf#hex[0]:theme/theme/theme1.xml e-mail address',
    'capture.json:text/rtf#hex[1] home folder path',
    'capture.json:text/rtf#hex[2] e-mail address',
  ]);
  assert.deepEqual(distinct(scanFile('docs/sample.rtf', Buffer.from(rtf), names)), [
    'docs/sample.rtf#hex[0]:theme/theme/theme1.xml e-mail address', 'docs/sample.rtf#hex[1] home folder path', 'docs/sample.rtf#hex[2] e-mail address']);
  // Short hexadecimal runs, as revision ids, colors and picture ids, are no data; nor are hexadecimal digits outside RTF.
  assert.deepEqual(categories('docs/plain.rtf', '{\\rtf1 {\\colortbl;\\red0\\green0\\blue0;}\\rsid0045fa12 Text}'), []);
  assert.deepEqual(categories('src/hash.ts', `const digest = '${hex(Buffer.from(`write to ${address}`)).replace(/\n/gu, '')}';\n`), []);
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

// ---------------------------------------------------------------------------
// Image metadata: display profiles, EXIF and XMP. Every value is authored for the test.
// ---------------------------------------------------------------------------

/** A text tag of an ICC profile: textDescription ('desc') or multiLocalizedUnicode ('mluc') in UTF-16BE. */
function iccText(value, type = 'desc') {
  if (type === 'mluc') {
    const text = Buffer.from(value, 'utf16le').swap16();
    const tag = Buffer.alloc(28 + text.length);
    tag.write('mluc', 0, 'latin1'); tag.writeUInt32BE(1, 8); tag.writeUInt32BE(12, 12); tag.write('enUS', 16, 'latin1');
    tag.writeUInt32BE(text.length, 20); tag.writeUInt32BE(28, 24); text.copy(tag, 28);
    return tag;
  }
  const ascii = Buffer.from(`${value}\0`, 'latin1');
  const tag = Buffer.alloc(12 + ascii.length + 79);
  tag.write('desc', 0, 'latin1'); tag.writeUInt32BE(ascii.length, 8); ascii.copy(tag, 12);
  return tag;
}
/** Apple's make and model tag: manufacturer, model, serial number and manufacture date. */
function makeAndModel(serial, date = 0) {
  const tag = Buffer.alloc(40);
  tag.write('mmod', 0, 'latin1'); tag.writeUInt32BE(0x10ac, 8); tag.writeUInt32BE(0x4279, 12); tag.writeUInt32BE(serial, 16); tag.writeUInt32BE(date, 20);
  return tag;
}
/** An ICC dictType ('dict') tag of name and value pairs, as calibration tools write their 'meta' tag. */
function iccDictionary(entries) {
  const strings = entries.map(([name, value]) => [Buffer.from(name, 'utf16le').swap16(), Buffer.from(value, 'utf16le').swap16()]);
  let offset = 16 + entries.length * 16;
  const records = [];
  const data = [];
  for (const [name, value] of strings) {
    records.push([offset, name.length, offset + name.length, value.length]);
    data.push(name, value); offset += name.length + value.length;
  }
  const tag = Buffer.alloc(offset);
  tag.write('dict', 0, 'latin1'); tag.writeUInt32BE(entries.length, 8); tag.writeUInt32BE(16, 12);
  records.forEach((record, index) => record.forEach((value, field) => tag.writeUInt32BE(value, 16 + index * 16 + field * 4)));
  Buffer.concat(data).copy(tag, 16 + entries.length * 16);
  return tag;
}
/** An ICC profile with the given tags, each [signature, data]. */
function iccProfile(tags, deviceClass = 'mntr') {
  const table = 4 + tags.length * 12;
  let offset = 128 + table;
  const entries = [];
  const data = [];
  for (const [signature, content] of tags) {
    const padded = Buffer.concat([content, Buffer.alloc((4 - (content.length % 4)) % 4)]);
    entries.push([signature, offset, content.length]); data.push(padded); offset += padded.length;
  }
  const profile = Buffer.alloc(offset);
  profile.writeUInt32BE(offset, 0); profile.write('appl', 4, 'latin1'); profile.writeUInt32BE(0x04000000, 8); profile.write(deviceClass, 12, 'latin1');
  profile.write('RGB ', 16, 'latin1'); profile.write('XYZ ', 20, 'latin1'); profile.write('acsp', 36, 'latin1'); profile.writeUInt32BE(tags.length, 128);
  entries.forEach(([signature, at, size], index) => {
    profile.write(signature, 132 + index * 12, 'latin1'); profile.writeUInt32BE(at, 136 + index * 12); profile.writeUInt32BE(size, 140 + index * 12);
  });
  Buffer.concat(data).copy(profile, 128 + table);
  return profile;
}
const pngChunk = (type, data) => {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length, 0); header.write(type, 4, 'latin1');
  return Buffer.concat([header, data, Buffer.alloc(4)]);
};
/** A PNG with the given chunks, each [type, data], between its header and its end. */
const pngOf = (chunks) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk('IHDR', Buffer.alloc(13)),
  ...chunks.map(([type, data]) => pngChunk(type, data)), pngChunk('IDAT', deflateSync(Buffer.alloc(8))), pngChunk('IEND', Buffer.alloc(0))]);
const iccChunk = (profile) => ['iCCP', Buffer.concat([Buffer.from('ICC Profile\0\0', 'latin1'), deflateSync(profile)])];
/** A JPEG with the given segments, each [marker, data], before its scan. */
const jpegOf = (segments) => Buffer.concat([Buffer.from([0xff, 0xd8]), ...segments.map(([marker, data]) => {
  const header = Buffer.from([0xff, marker, 0, 0]);
  header.writeUInt16BE(data.length + 2, 2);
  return Buffer.concat([header, data]);
}), Buffer.from([0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0xff, 0xd9])]);
/** A profile in APP2 segments, split into the given number of parts, as JPEG carries a profile over 64 KB. */
const jpegProfile = (profile, parts = 2) => {
  const size = Math.ceil(profile.length / parts);
  return Array.from({ length: parts }, (_, index) => [0xe2, Buffer.concat([Buffer.from('ICC_PROFILE\0', 'latin1'), Buffer.from([index + 1, parts]),
    profile.subarray(index * size, (index + 1) * size)])]);
};
/** A WebP with the given chunks, each [fourcc, data]. */
const webpOf = (chunks) => {
  const body = Buffer.concat([Buffer.from('WEBP', 'latin1'), ...chunks.map(([fourcc, data]) => {
    const header = Buffer.alloc(8);
    header.write(fourcc, 0, 'latin1'); header.writeUInt32LE(data.length, 4);
    return Buffer.concat([header, data, Buffer.alloc(data.length % 2)]);
  })]);
  const riff = Buffer.alloc(8);
  riff.write('RIFF', 0, 'latin1'); riff.writeUInt32LE(body.length, 4);
  return Buffer.concat([riff, body]);
};
/**
 * A TIFF structure as EXIF holds it: IFD0 with its entries, and an Exif and a GPS IFD when they have any. An entry is
 * [tag, value]: a string is ASCII, a number a LONG, an array of numbers RATIONALs with denominator 1.
 */
function exifOf({ ifd0 = [], exif = [], gps = [] } = {}, little = true) {
  const directories = [['ifd0', [...ifd0, ...(exif.length > 0 ? [[0x8769, 'exif']] : []), ...(gps.length > 0 ? [[0x8825, 'gps']] : [])]],
    ...(exif.length > 0 ? [['exif', exif]] : []), ...(gps.length > 0 ? [['gps', gps]] : [])];
  const at = {};
  let offset = 8;
  for (const [name, entries] of directories) { at[name] = offset; offset += 2 + entries.length * 12 + 4; }
  const values = [];
  const tiff = [];
  let data = offset;
  const u16 = (value) => { const b = Buffer.alloc(2); if (little) b.writeUInt16LE(value); else b.writeUInt16BE(value); return b; };
  const u32 = (value) => { const b = Buffer.alloc(4); if (little) b.writeUInt32LE(value); else b.writeUInt32BE(value); return b; };
  tiff.push(Buffer.from(little ? 'II' : 'MM', 'latin1'), u16(42), u32(8));
  for (const [name, entries] of directories) {
    tiff.push(u16(entries.length));
    for (const [tag, value] of entries) {
      if (typeof value === 'string' && ['exif', 'gps'].includes(value) && (tag === 0x8769 || tag === 0x8825)) {
        tiff.push(u16(tag), u16(4), u32(1), u32(at[value])); continue;
      }
      const [type, bytes] = typeof value === 'string' ? [2, Buffer.from(`${value}\0`, 'latin1')]
        : Array.isArray(value) ? [5, Buffer.concat(value.flatMap((number) => [u32(number), u32(1)]))] : [4, u32(value)];
      const count = type === 5 ? value.length : type === 2 ? bytes.length : 1;
      if (bytes.length <= 4) tiff.push(u16(tag), u16(type), u32(count), Buffer.concat([bytes, Buffer.alloc(4 - bytes.length)]));
      else { tiff.push(u16(tag), u16(type), u32(count), u32(data)); values.push(bytes); data += bytes.length; }
    }
    tiff.push(u32(0));
    void name;
  }
  return Buffer.concat([...tiff, ...values]);
}
const xmpOf = (properties) => `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">`
  + `<rdf:Description rdf:about="" xmlns:exif="http://ns.adobe.com/exif/1.0/" xmlns:tiff="http://ns.adobe.com/tiff/1.0/">${properties}</rdf:Description></rdf:RDF></x:xmpmeta>`;
const itxt = (keyword, text) => ['iTXt', Buffer.concat([Buffer.from(`${keyword}\0\u0001\0\0\0`, 'latin1'), deflateSync(Buffer.from(text, 'utf8'))])];
const found = (path, bytes) => scanFile(path, bytes, names).map((finding) => `${finding.location} ${finding.category}`);

// The profile macOS writes for a display: Apple's description and make and model tag, with the unit's serial number.
const displayProfile = (serial, date = 0x5e000000) => iccProfile([['desc', iccText('Display')], ['dscm', iccText('Authored Monitor', 'mluc')], ['mmod', makeAndModel(serial, date)]]);
const SERIAL = 0x0a0b0c0d;

test('a display profile names its unit by a serial number, in a PNG, a JPEG in several parts and a WebP, and in any container', () => {
  assert.deepEqual(found('shot.png', pngOf([iccChunk(displayProfile(SERIAL))])), ['shot.png#icc device serial number']);
  assert.deepEqual(found('photo.jpg', jpegOf([[0xe0, Buffer.from('JFIF\0')], ...jpegProfile(displayProfile(SERIAL), 3)])), ['photo.jpg#icc device serial number']);
  // A JPEG under a .png name, as a screenshot tool may save one: the bytes decide.
  assert.deepEqual(found('named.png', jpegOf(jpegProfile(displayProfile(SERIAL)))), ['named.png#icc device serial number']);
  assert.deepEqual(found('image.webp', webpOf([['VP8X', Buffer.alloc(10)], ['ICCP', displayProfile(SERIAL)]])), ['image.webp#icc device serial number']);
  const picture = pngOf([iccChunk(displayProfile(SERIAL))]);
  const bundle = JSON.stringify({ payload: { text: { 'text/html': '<p>x</p>' }, files: [{ itemIndex: 0, base64: picture.toString('base64') }] } });
  assert.deepEqual(found('capture.json', Buffer.from(bundle)), ['capture.json:files[0]#icc device serial number']);
  const docx = writePackage(new Map([['word/media/image1.png', picture]]));
  assert.deepEqual(found('fixture.docx', docx), ['fixture.docx:word/media/image1.png#icc device serial number']);
  assert.deepEqual(found('page.html', Buffer.from(`<img src="data:image/png;base64,${picture.toString('base64')}">`)), ['page.html#data[0]#icc device serial number']);
});

test('generic and cleared profiles name no unit: sRGB, Display P3, a printer, a display without a serial number', () => {
  const srgb = iccProfile([['desc', iccText('sRGB IEC61966-2.1')], ['dmnd', iccText('IEC http://www.iec.ch')],
    ['dmdd', iccText('IEC 61966-2.1 Default RGB colour space - sRGB')], ['cprt', Buffer.concat([Buffer.from('text\0\0\0\0', 'latin1'), Buffer.from('Copyright (c) 1998 Hewlett-Packard Company\0')])]]);
  const p3 = iccProfile([['desc', iccText('Display P3', 'mluc')], ['cprt', iccText('Copyright Apple Inc., 2017', 'mluc')]]);
  const printer = iccProfile([['desc', iccText('Authored Printer Glossy')], ['dmdd', iccText('Authored Printer 9000')]], 'prtr');
  for (const [name, profile] of [['sRGB', srgb], ['Display P3', p3], ['printer', printer], ['cleared display', displayProfile(0, 0)],
    ['a display without a serial number', displayProfile(0)]]) {
    assert.deepEqual(found('shot.png', pngOf([iccChunk(profile)])), [], name);
    assert.deepEqual(found('photo.jpg', jpegOf(jpegProfile(profile))), [], name);
  }
  // A profile that is no ICC profile, or one cut short, is not read.
  assert.deepEqual(found('shot.png', pngOf([iccChunk(Buffer.from('not a profile at all'))])), []);
  assert.deepEqual(found('shot.png', pngOf([iccChunk(displayProfile(SERIAL).subarray(0, 140))])), []);
});

test('a profile description or calibration dictionary that names a serial number names the unit', () => {
  for (const [name, tag] of [
    ['a model description', ['dmdd', iccText('Authored Monitor S/N: AM12345')]],
    ['a manufacturer description', ['dmnd', iccText('Authored Displays, serial number 7781234', 'mluc')]],
    ['a profile description', ['desc', iccText('Authored Monitor SN: X9Y8Z7 2026-03-01')]],
  ]) {
    assert.deepEqual(found('shot.png', pngOf([iccChunk(iccProfile([tag]))])), ['shot.png#icc device serial number'], name);
  }
  const meta = (entries) => found('shot.png', pngOf([iccChunk(iccProfile([['desc', iccText('Calibrated')], ['meta', iccDictionary(entries)]]))]));
  assert.deepEqual(meta([['prefix', 'EDID_'], ['EDID_serial', 'AM12345']]), ['shot.png#icc device serial number']);
  assert.deepEqual(meta([['EDID_md5', '0f0e0d0c0b0a09080706050403020100']]), ['shot.png#icc device serial number']);
  assert.deepEqual(meta([['prefix', 'EDID_'], ['EDID_model', 'Authored Monitor'], ['EDID_serial', '']]), []);
  // A model or a serial number label without a number names no unit.
  assert.deepEqual(found('shot.png', pngOf([iccChunk(iccProfile([['dmdd', iccText('Authored Monitor U2723QE')], ['desc', iccText('Serial numbering test')]]))])), []);
});

test('the texts of a compressed display profile are read for names and addresses like the rest of the image', () => {
  const [login] = names[0].slice(1);
  const profile = iccProfile([['desc', iccText(`Calibrated by ${login}`)], ['dscm', iccText(`Monitor of ${address}`, 'mluc')]]);
  assert.deepEqual(found('shot.png', pngOf([iccChunk(profile)])).sort(), ['shot.png e-mail address', 'shot.png login name']);
});

test('EXIF names a camera, its serial numbers, a position and an author; a screenshot\'s size and comment name nobody', () => {
  const device = exifOf({ ifd0: [[0x010f, 'Authored Camera Co'], [0x0110, 'Authored Model 1'], [0x0112, 1]],
    exif: [[0xa431, 'AC0012345'], [0xa435, 'LN000777'], [0xa002, 1600]], gps: [[0x0001, 'N'], [0x0002, [45, 48, 30]], [0x0003, 'E'], [0x0004, [15, 58, 40]]] });
  const expected = (location) => ['device make or model', 'device serial number', 'GPS location'].map((category) => `${location}#exif ${category}`);
  assert.deepEqual(found('photo.jpg', jpegOf([[0xe1, Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), device])]])).sort(), expected('photo.jpg').sort());
  assert.deepEqual(found('photo.jpg', jpegOf([[0xe1, Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), exifOf({ ifd0: [[0x010f, 'Authored Camera Co']] }, false)])]])),
    ['photo.jpg#exif device make or model']);
  assert.deepEqual(found('shot.png', pngOf([['eXIf', exifOf({ ifd0: [[0x013b, 'Authored Artist']], exif: [[0xa430, 'Authored Owner']] })]])), ['shot.png#exif image author']);
  assert.deepEqual(found('image.webp', webpOf([['EXIF', Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), exifOf({ exif: [[0xa431, 'AC0012345']] })])]])),
    ['image.webp#exif device serial number']);
  // ImageMagick keeps EXIF as hexadecimal digits in a text chunk.
  const raw = exifOf({ ifd0: [[0x0110, 'Authored Model 1']] });
  const hex = `\nexif\n${String(raw.length + 6).padStart(8)}\n${Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), raw]).toString('hex').replace(/(.{72})/gu, '$1\n')}\n`;
  assert.deepEqual(found('shot.png', pngOf([['zTXt', Buffer.concat([Buffer.from('Raw profile type exif\0\0', 'latin1'), deflateSync(Buffer.from(hex))])]])),
    ['shot.png#exif device make or model']);
  // What macOS writes into a screenshot: orientation, resolution, a user comment and the pixel dimensions; and empty values.
  const screenshot = exifOf({ ifd0: [[0x0112, 1], [0x011a, [144]], [0x0128, 2], [0x010f, ''], [0x0110, '   ']],
    exif: [[0x9286, 'ASCII\0\0\0Screenshot'], [0xa002, 1178], [0xa003, 514]], gps: [[0x0000, 0x02020000]] });
  assert.deepEqual(found('shot.png', pngOf([['eXIf', screenshot]])), []);
  assert.deepEqual(found('shot.png', pngOf([['eXIf', Buffer.from('not a TIFF structure')]])), []);
});

test('XMP names a camera, a serial number, a position and an author as EXIF does, in a PNG, a JPEG and a WebP', () => {
  const properties = '<tiff:Model>Authored Model 1</tiff:Model><aux:SerialNumber xmlns:aux="http://ns.adobe.com/exif/1.0/aux/">AC0012345</aux:SerialNumber>'
    + '<exif:GPSLatitude>45,48.5N</exif:GPSLatitude><dc:creator xmlns:dc="http://purl.org/dc/elements/1.1/"><rdf:Seq><rdf:li>Authored Person</rdf:li></rdf:Seq></dc:creator>';
  const expected = (location) => ['device make or model', 'device serial number', 'GPS location', 'image author'].map((category) => `${location}#xmp ${category}`);
  assert.deepEqual(found('shot.png', pngOf([itxt('XML:com.adobe.xmp', xmpOf(properties))])).sort(), expected('shot.png').sort());
  assert.deepEqual(found('photo.jpg', jpegOf([[0xe1, Buffer.from(`http://ns.adobe.com/xap/1.0/\0${xmpOf(properties)}`, 'utf8')]])).sort(), expected('photo.jpg').sort());
  assert.deepEqual(found('image.webp', webpOf([['XMP ', Buffer.from(xmpOf('<rdf:Description tiff:Make="Authored Camera Co"/>'))]])), ['image.webp#xmp device make or model']);
  // A screenshot's XMP and empty properties name nobody.
  const screenshot = '<exif:PixelXDimension>1986</exif:PixelXDimension><exif:UserComment>Screenshot</exif:UserComment><tiff:Orientation>1</tiff:Orientation>'
    + '<tiff:Make></tiff:Make><dc:creator><rdf:Seq><rdf:li/></rdf:Seq></dc:creator><aux:Lens> </aux:Lens>';
  assert.deepEqual(found('shot.png', pngOf([itxt('XML:com.adobe.xmp', xmpOf(screenshot))])), []);
});

test('XMP distinguishes empty markup from text, including malformed tag fragments', () => {
  for (const [value, populated] of [
    [' \n<rdf:Seq><rdf:li> \t </rdf:li></rdf:Seq> ', false],
    ['<rdf:Seq><rdf:li data-note="Authored Person"/></rdf:Seq>', false],
    ['<rdf:Seq><rdf:li>Authored Person</rdf:li></rdf:Seq>', true],
    ['before<rdf:Seq/>', true],
    ['<rdf:Seq/>after', true],
    ['<script', true],
    ['<<script>script>', true],
  ]) {
    const packet = xmpOf(`<dc:creator>${value}</dc:creator>`);
    assert.deepEqual(found('shot.png', pngOf([itxt('XML:com.adobe.xmp', packet)])), populated ? ['shot.png#xmp image author'] : [], value);
  }
});

test('a placeholder serial number names no unit: EDID\'s unused 0x01010101, which the standard ProPhoto RGB profile carries, and all ones', () => {
  for (const serial of [0x01010101, 0xffffffff]) {
    assert.deepEqual(found('shot.png', pngOf([iccChunk(displayProfile(serial))])), [], serial.toString(16));
    assert.deepEqual(found('photo.jpg', jpegOf(jpegProfile(displayProfile(serial)))), [], serial.toString(16));
  }
  assert.deepEqual(found('shot.png', pngOf([iccChunk(displayProfile(0x01010102))])), ['shot.png#icc device serial number']);
});

// ---------------------------------------------------------------------------
// Where else a picture or its metadata sits: wrapped data URIs, TIFF, ISO media, GIF, PDF, IPTC, large parts
// ---------------------------------------------------------------------------

const PICTURE = () => pngOf([iccChunk(displayProfile(SERIAL))]);
/** An ISO base media box: its size, its type and its content. */
const box = (type, ...parts) => {
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + body.length, 0); head.write(type, 4, 'latin1');
  return Buffer.concat([head, body]);
};
/** A TIFF file whose first directory holds the given entries, each [tag, type, bytes], with their values after it. */
function tiffOf(entries, little = true) {
  const u16 = (value) => { const b = Buffer.alloc(2); if (little) b.writeUInt16LE(value); else b.writeUInt16BE(value); return b; };
  const u32 = (value) => { const b = Buffer.alloc(4); if (little) b.writeUInt32LE(value); else b.writeUInt32BE(value); return b; };
  let data = 8 + 2 + entries.length * 12 + 4;
  const directory = [u16(entries.length)];
  const values = [];
  for (const [tag, type, bytes] of entries) {
    directory.push(u16(tag), u16(type), u32(bytes.length), bytes.length <= 4 ? Buffer.concat([bytes, Buffer.alloc(4 - bytes.length)]) : u32(data));
    if (bytes.length > 4) { values.push(bytes); data += bytes.length; }
  }
  return Buffer.concat([Buffer.from(little ? 'II' : 'MM', 'latin1'), u16(42), u32(8), ...directory, u32(0), ...values]);
}
/** IPTC records, each [dataset, text], in record 2, as Photoshop and ImageMagick write them. */
const iptcOf = (records) => Buffer.concat(records.map(([dataset, text]) => {
  const value = Buffer.from(text, 'latin1');
  const head = Buffer.from([0x1c, 2, dataset, 0, 0]);
  head.writeUInt16BE(value.length, 3);
  return Buffer.concat([head, value]);
}));
/** Photoshop image resources, each [id, data], as a JPEG's APP13 segment holds them after its name. */
const photoshopOf = (resources) => Buffer.concat([Buffer.from('Photoshop 3.0\0', 'latin1'), ...resources.map(([id, data]) => {
  const head = Buffer.alloc(12);
  head.write('8BIM', 0, 'latin1'); head.writeUInt16BE(id, 4); head.writeUInt32BE(data.length, 8);
  return Buffer.concat([head, data, Buffer.alloc(data.length % 2)]);
})]);
/** A GIF with one application extension, its data in sub-blocks of at most 255 bytes, before a one-pixel image. */
function gifOf(application, data) {
  const blocks = [];
  for (let at = 0; at < data.length; at += 255) { const part = data.subarray(at, at + 255); blocks.push(Buffer.from([part.length]), part); }
  return Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.from([1, 0, 1, 0, 0x80, 0, 0]), Buffer.alloc(6), Buffer.from([0x21, 0xff, 11]),
    Buffer.from(application, 'latin1'), ...blocks, Buffer.from([0, 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x44, 0x01, 0, 0x3b])]);
}
/** A PDF with the given objects, each [dictionary, stream] where a stream is optional. */
const pdfOf = (objects) => Buffer.concat([Buffer.from('%PDF-1.7\n', 'latin1'), ...objects.flatMap(([dictionary, stream], index) => [
  Buffer.from(`${String(index + 1)} 0 obj\n<< ${dictionary}${stream === undefined ? '' : ` /Length ${String(stream.length)}`} >>\n`, 'latin1'),
  ...(stream === undefined ? [] : [Buffer.from('stream\n', 'latin1'), stream, Buffer.from('\nendstream\n', 'latin1')]), Buffer.from('endobj\n', 'latin1')]),
  Buffer.from('%%EOF\n', 'latin1')]);

test('a data URI is read wrapped in lines or character references, with parameters, and after a large one', () => {
  const picture = PICTURE().toString('base64');
  const lines = (separator) => picture.match(/.{1,76}/gu).join(separator);
  for (const [name, text] of [
    ['wrapped in lines, as Inkscape writes an embedded image', `<svg><image xlink:href="data:image/png;base64,${lines('\n')}"/></svg>`],
    ['wrapped in indented CRLF lines', `<svg><image href="data:image/png;base64,\r\n    ${lines('\r\n    ')}"/></svg>`],
    ['wrapped with character references', `<svg><image href="data:image/png;base64,${lines('&#10;')}"/></svg>`],
    ['wrapped with hexadecimal character references', `<svg><image href="data:image/png;base64,${lines('&#xA;')}"/></svg>`],
    ['with a parameter', `<img src="data:image/png;name=shot.png;base64,${picture}">`],
    ['with two parameters', `<img src="data:image/png;charset=binary;name=shot.png;base64,${picture}">`],
  ]) assert.deepEqual(found('page.svg', Buffer.from(text)), ['page.svg#data[0]#icc device serial number'], name);
  // A data URI past what the old bound read, then the picture: both are read.
  const filler = Buffer.alloc(4 * 1024 * 1024, 7).toString('base64');
  assert.deepEqual(found('page.html', Buffer.from(`<img src="data:image/gif;base64,${filler}"><img src="data:image/png;base64,${picture}">`)),
    ['page.html#data[1]#icc device serial number']);
});

test('a TIFF names its display, camera and author as EXIF does, and its profile, XMP and IPTC are read', () => {
  const profile = displayProfile(SERIAL);
  for (const little of [true, false]) {
    assert.deepEqual(found('scan.tif', tiffOf([[0x0100, 3, Buffer.from([1, 0])], [0x8773, 7, profile]], little)), ['scan.tif#icc device serial number'], String(little));
  }
  assert.deepEqual(found('scan.tif', tiffOf([[0x010f, 2, Buffer.from('Authored Camera Co\0', 'latin1')]])), ['scan.tif#exif device make or model']);
  assert.deepEqual(found('scan.tif', tiffOf([[0x02bc, 1, Buffer.from(xmpOf('<tiff:Artist>Authored Person</tiff:Artist>'))]])), ['scan.tif#xmp image author']);
  assert.deepEqual(found('scan.tif', tiffOf([[0x83bb, 7, iptcOf([[80, 'Authored Person']])]])), ['scan.tif#iptc image author']);
  // A TIFF of pixels alone names nothing.
  assert.deepEqual(found('scan.tif', tiffOf([[0x0100, 3, Buffer.from([1, 0])], [0x0101, 3, Buffer.from([1, 0])]])), []);
});

test('ISO media (AVIF, HEIC, MP4, MOV) names a display by its color profile, a camera by its EXIF and a place by its location', () => {
  const profile = displayProfile(SERIAL);
  const avif = Buffer.concat([box('ftyp', Buffer.from('avif\0\0\0\0avifmif1', 'latin1')), box('meta', Buffer.alloc(4), box('iprp', box('ipco', box('colr', Buffer.from('prof', 'latin1'), profile))))]);
  assert.deepEqual(found('image.avif', avif), ['image.avif#icc device serial number']);
  const mov = Buffer.concat([box('ftyp', Buffer.from('qt  \0\0\0\0qt  ', 'latin1')), box('moov', box('trak', box('mdia', box('minf', box('stbl', box('colr', Buffer.from('rICC', 'latin1'), profile))))))]);
  assert.deepEqual(found('clip.mov', mov), ['clip.mov#icc device serial number']);
  const heic = Buffer.concat([box('ftyp', Buffer.from('heic\0\0\0\0mif1heic', 'latin1')),
    box('mdat', Buffer.from([0, 0, 0, 0]), Buffer.from('Exif\0\0', 'latin1'), exifOf({ ifd0: [[0x010f, 'Authored Camera Co']] }))]);
  assert.deepEqual(found('photo.heic', heic), ['photo.heic#exif device make or model']);
  const located = Buffer.concat([box('ftyp', Buffer.from('mp42\0\0\0\0isommp42', 'latin1')), box('moov', box('udta', box('©xyz', Buffer.from([0, 18, 0x15, 0xc7]), Buffer.from('+45.8150+015.9819/', 'latin1'))))]);
  assert.deepEqual(found('clip.mp4', located), ['clip.mp4#video GPS location']);
  // An encoder's name and a generic profile name nothing.
  const plain = Buffer.concat([box('ftyp', Buffer.from('isom\0\0\x02\0isomiso2', 'latin1')), box('moov', box('udta', box('meta', Buffer.alloc(4), box('ilst', box('©too', Buffer.from('Lavf60.3.100', 'latin1')))))),
    box('colr', Buffer.from('nclx', 'latin1'), Buffer.from([0, 1, 0, 1, 0, 1, 0]))]);
  assert.deepEqual(found('clip.mp4', plain), []);
});

test('a GIF names a display by the color profile of its application extension, and its XMP is read', () => {
  assert.deepEqual(found('anim.gif', gifOf('ICCRGBG1012', displayProfile(SERIAL))), ['anim.gif#icc device serial number']);
  assert.deepEqual(found('anim.gif', gifOf('ICCRGBG1012', displayProfile(0))), []);
  assert.deepEqual(found('anim.gif', gifOf('NETSCAPE2.0', Buffer.from([1, 0, 0]))), []);
  const xmp = Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.from([1, 0, 1, 0, 0, 0, 0]), Buffer.from([0x21, 0xff, 11]), Buffer.from('XMP DataXMP', 'latin1'),
    Buffer.from(xmpOf('<tiff:Model>Authored Model 1</tiff:Model>'), 'utf8'), Buffer.from([1, ...Array.from({ length: 256 }, (_, index) => 255 - index), 0, 0]), Buffer.from([0x3b])]);
  assert.deepEqual(found('anim.gif', xmp), ['anim.gif#xmp device make or model']);
});

test('a PDF names a display by an ICC profile stream, compressed or not, and an author by its Info or XMP', () => {
  const profile = displayProfile(SERIAL);
  assert.deepEqual(found('guide.pdf', pdfOf([['/N 3 /Filter /FlateDecode', deflateSync(profile)]])), ['guide.pdf#icc device serial number']);
  assert.deepEqual(found('guide.pdf', pdfOf([['/N 3 /Alternate /DeviceRGB', profile]])), ['guide.pdf#icc device serial number']);
  assert.deepEqual(found('guide.pdf', pdfOf([['/Title (A guide) /Author (Authored Person)']])), ['guide.pdf#pdf document author']);
  assert.deepEqual(found('guide.pdf', pdfOf([['/Author <FEFF0041>']])), ['guide.pdf#pdf document author']);
  // An Info dictionary in a compressed object stream.
  assert.deepEqual(found('guide.pdf', pdfOf([['/Type /ObjStm /N 1 /First 4 /Filter /FlateDecode', deflateSync(Buffer.from('2 0 << /Author (Authored Person) >>', 'latin1'))]])),
    ['guide.pdf#pdf document author']);
  assert.deepEqual(found('guide.pdf', pdfOf([['/Type /Metadata /Subtype /XML', Buffer.from(xmpOf('<dc:creator><rdf:Seq><rdf:li>Authored Person</rdf:li></rdf:Seq></dc:creator>'))]])),
    ['guide.pdf#xmp image author']);
  // A title, an empty author and a generic profile name nobody.
  assert.deepEqual(found('guide.pdf', pdfOf([['/Title (A guide) /Author () /Creator (Authored Tool)'], ['/N 3 /Filter /FlateDecode', deflateSync(displayProfile(0, 0))]])), []);
});

test('IPTC names an author: a JPEG\'s Photoshop resources, and a PNG\'s raw profile, with the profile and EXIF they hold', () => {
  const photoshop = photoshopOf([[0x0404, iptcOf([[5, 'A title'], [80, 'Authored Person']])]]);
  assert.deepEqual(found('photo.jpg', jpegOf([[0xed, photoshop]])), ['photo.jpg#iptc image author']);
  assert.deepEqual(found('photo.jpg', jpegOf([[0xed, photoshopOf([[0x0404, iptcOf([[122, 'Authored Writer']])]])]])), ['photo.jpg#iptc image author']);
  assert.deepEqual(found('photo.jpg', jpegOf([[0xed, photoshopOf([[0x040f, displayProfile(SERIAL)]])]])), ['photo.jpg#icc device serial number']);
  assert.deepEqual(found('photo.jpg', jpegOf([[0xed, photoshopOf([[0x0422, exifOf({ ifd0: [[0x0110, 'Authored Model 1']] })]])]])), ['photo.jpg#exif device make or model']);
  const hex = `\niptc\n${String(photoshop.length).padStart(8)}\n${photoshop.toString('hex').replace(/(.{72})/gu, '$1\n')}\n`;
  assert.deepEqual(found('shot.png', pngOf([['zTXt', Buffer.concat([Buffer.from('Raw profile type iptc\0\0', 'latin1'), deflateSync(Buffer.from(hex))])]])), ['shot.png#iptc image author']);
  // A caption and a title name nobody.
  assert.deepEqual(found('photo.jpg', jpegOf([[0xed, photoshopOf([[0x0404, iptcOf([[5, 'A title'], [120, 'A caption']])]])]])), []);
});

test('a package part is read however large it inflates within its bound, and data too large to read is reported, not skipped', () => {
  const large = pngOf([iccChunk(displayProfile(SERIAL)), ['tEXt', Buffer.concat([Buffer.from('Comment\0', 'latin1'), Buffer.alloc(3 * 1024 * 1024, 0x41)])]]);
  assert.deepEqual(found('fixture.docx', writePackage(new Map([['word/media/image1.png', large]]))), ['fixture.docx:word/media/image1.png#icc device serial number']);
  assert.deepEqual(found('fixture.docx', writePackage(new Map([['word/media/huge.bin', Buffer.alloc(65 * 1024 * 1024)]]))), ['fixture.docx:word/media/huge.bin#unscanned unscanned data']);
  // A part in a compression method the reader does not know.
  const stored = writePackage(new Map([['word/document.xml', Buffer.from('<w:document/>')]]));
  for (const offset of [8, stored.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 10]) stored.writeUInt16LE(14, offset);
  assert.deepEqual(found('fixture.docx', stored), ['fixture.docx:word/document.xml#unscanned unscanned data']);
  const huge = 'A'.repeat(33 * 1024 * 1024);
  assert.deepEqual(found('page.html', Buffer.from(`<img src="data:image/png;base64,${huge}"><img src="data:image/png;base64,${PICTURE().toString('base64')}">`)),
    ['page.html#data[0]#unscanned unscanned data', 'page.html#data[1]#icc device serial number']);
});
