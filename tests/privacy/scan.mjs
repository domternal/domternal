/**
 * Personal data in a repository's files: the scanner the Free repository's
 * privacy gate (tests/privacy/scan.mjs) and the site's (scripts/privacy-scan.mjs)
 * share byte for byte, so the two policies cannot drift apart. Each repository's
 * tests compare the two copies where the other repository sits beside it, and
 * each passes its own configuration (vendored notices, certificate addresses).
 * It imports nothing but Node's own modules, so the site can carry it alone.
 *
 * Reading. A file is read as text, or, when it is binary or a PDF, by its
 * printable runs as bytes and as UTF-16 in both alignments, by the text chunks
 * of a PNG, by the texts of a display profile or XMP packet it holds compressed,
 * and by the metadata of an image or a document: the ICC profile of a PNG (iCCP,
 * inflated), a JPEG (APP2, in as many parts as it has, or its Photoshop
 * resources), a WebP (ICCP), a TIFF (its profile tag), a GIF (its ICCRGBG1
 * application extension), ISO media such as AVIF, HEIC, MP4 and MOV (a color
 * box's prof or rICC) or a PDF (a profile stream, plain or inflated); EXIF (a
 * PNG's eXIf or raw profile text chunk, a JPEG's APP1, a WebP's EXIF, a TIFF's
 * own directories, an EXIF item of ISO media); XMP (in its own chunk, segment,
 * tag or stream, and any packet a file holds as plain bytes); IPTC (a JPEG's or
 * TIFF's Photoshop resources or IPTC tag, a PNG's raw profile); QuickTime's
 * recorded location; a PDF's Info and compressed object streams; and the PNG
 * and JPEG images of an ICO or ICNS icon.
 * A zip package (a Word document, a zip download) is read part by part, a
 * capture bundle flavor by flavor and clipboard file by clipboard file, a
 * base64 data URI by what it decodes to, also with parameters and with its
 * digits wrapped in lines, character references or escaped line breaks, and an
 * RTF text also by what its hexadecimal groups decode to (Word's theme package,
 * color scheme mapping, data store and pictures, list pictures among them).
 * What the reader cannot read is reported as unscanned data, never skipped: a
 * package part in another compression method, encrypted or damaged, one that
 * inflates past 64 MB or past its package's 256 MB, the parts after the first
 * 2048, data URIs or RTF groups past 32 MB of digits in one text, and data
 * nested more than three levels deep. Every text is read again with its
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
 * hold, since a CI runner's own names identify nobody. In image metadata it
 * looks for the device and the person: a device serial number (a serial number
 * in the make and model tag macOS writes into a display profile, a profile
 * description that labels a serial number, a calibration entry with a serial
 * number or an EDID hash, EXIF's and XMP's body, lens and camera serial
 * numbers), a device make or model (EXIF's Make, Model, HostComputer, LensMake
 * and LensModel and their XMP properties), an image author (Artist, the camera
 * owner, XPAuthor, XMP's dc:creator, IPTC's By-line and Writer/Editor), a
 * document author (a PDF's Author) and a GPS location (EXIF's, XMP's and the
 * place QuickTime records in a video).
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
 * - In image metadata, a profile that names a product and not a unit: sRGB,
 *   Display P3, a printer's, a display's make and model without a serial
 *   number or with a placeholder one (EDID's 0x01010101 for none, which the
 *   standard ProPhoto RGB profile carries, or all ones), a description without
 *   a labeled serial number; and what macOS
 *   writes into a screenshot: its orientation, resolution, pixel dimensions and
 *   comment. Empty values name nothing.
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
const MAX_PART = 64 * 1024 * 1024;
const MAX_PACKAGE = 256 * 1024 * 1024;
const MAX_PARTS = 2048;
const MAX_DATA_URI = 32 * 1024 * 1024;
const MAX_RTF_HEX = 32 * 1024 * 1024;
const UNSCANNED = 'unscanned data';

/** What the scanner could not read, reported at its location so that nothing is skipped in silence. */
const unscanned = (location, inside) => ({ location, text: '', binary: true, inside, device: [{ where: 'unscanned', category: UNSCANNED }] });

/**
 * The parts of a zip package, read from its central directory, as [name, content]; null when it is not one this
 * reader can read. A part's content is null when it cannot be read: a compression method other than stored and
 * deflate, an encrypted or damaged part, one that inflates past 64 MB or past the package's 256 MB, and the parts
 * after the first 2048.
 */
export function zipParts(bytes) {
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0 || end + 22 > bytes.length) return null;
  const count = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16);
  const parts = [];
  let budget = MAX_PACKAGE;
  for (let index = 0; index < count; index++) {
    if (index === MAX_PARTS) { parts.push([`${String(count - MAX_PARTS)} more parts`, null]); break; }
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
      content = method === 0 ? data : method === 8 ? inflateRawSync(data, { maxOutputLength: Math.min(MAX_PART, budget) }) : null;
    } catch {
      content = null;
    }
    if (content !== null) budget -= content.length;
    if (!name.endsWith('/')) parts.push([name, content]);
  }
  return parts;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const isPng = (bytes) => bytes.subarray(0, 8).equals(PNG_SIGNATURE);
const inflated = (data, maxOutputLength = MAX_INFLATED) => { try { return inflateSync(data, { maxOutputLength }); } catch { return Buffer.alloc(0); } };

/** The chunks of a PNG as [type, data], within fixed bounds. Their CRCs are not checked: a reader of what they say needs none. */
function pngChunks(bytes) {
  const chunks = [];
  if (!isPng(bytes)) return chunks;
  for (let at = 8; at + 12 <= bytes.length && chunks.length < 4096;) {
    const length = bytes.readUInt32BE(at);
    chunks.push([bytes.subarray(at + 4, at + 8).toString('latin1'), bytes.subarray(at + 8, Math.min(at + 8 + length, bytes.length))]);
    at += 12 + length;
  }
  return chunks;
}

/** The text chunks of a PNG as [keyword, text, reading], inflated where compressed; the reading keeps every field. */
function pngTextChunks(bytes) {
  const texts = [];
  for (const [type, data] of pngChunks(bytes)) {
    const keyword = data.indexOf(0);
    if (keyword < 0) continue;
    const name = data.subarray(0, keyword).toString('latin1');
    if (type === 'tEXt') texts.push([name, data.subarray(keyword + 1).toString('latin1'), data.toString('latin1')]);
    else if (type === 'zTXt') {
      const text = inflated(data.subarray(keyword + 2)).toString('latin1');
      texts.push([name, text, `${name} ${text}`]);
    } else if (type === 'iTXt') {
      const compressed = data[keyword + 1] === 1;
      const language = data.indexOf(0, keyword + 3);
      const translated = language < 0 ? -1 : data.indexOf(0, language + 1);
      if (translated < 0) continue;
      const raw = data.subarray(translated + 1);
      const text = (compressed ? inflated(raw) : raw).toString('utf8');
      texts.push([name, text, `${data.subarray(0, translated).toString('utf8')} ${text}`]);
    }
  }
  return texts;
}

// ---------------------------------------------------------------------------
// Image metadata: what a picture says about the device that made it
// ---------------------------------------------------------------------------

const MAX_PROFILE = 4 * 1024 * 1024;
const XMP_KEYWORD = 'XML:com.adobe.xmp';
const exifBody = (data) => (data.subarray(0, 6).toString('latin1') === 'Exif\0\0' ? data.subarray(6) : data);
/** What a raw profile ImageMagick writes into a PNG text chunk decodes to: its name, its length and hexadecimal digits. */
function rawProfile(text) {
  const digits = /^\s*[A-Za-z0-9-]+\s+\d+\s+([0-9A-Fa-f\s]+)$/u.exec(text)?.[1].replace(/\s+/gu, '') ?? '';
  return Buffer.from(digits.slice(0, digits.length - (digits.length % 2)), 'hex');
}

const TIFF_TYPE_SIZES = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8];
const isTiff = (bytes) => bytes.length >= 8 && ((bytes.toString('latin1', 0, 2) === 'II' && bytes.readUInt16LE(2) === 42)
  || (bytes.toString('latin1', 0, 2) === 'MM' && bytes.readUInt16BE(2) === 42));
const named = (found, where, category) => { found.named.push({ where, category }); };

/** The values of the wanted tags in a TIFF structure's directories, IFD0 and those it chains, as [tag, bytes]. */
function tiffEntries(tiff, wanted) {
  const entries = [];
  const little = tiff.toString('latin1', 0, 2) === 'II';
  const u16 = (at) => (at >= 0 && at + 2 <= tiff.length ? (little ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at)) : -1);
  const u32 = (at) => (at >= 0 && at + 4 <= tiff.length ? (little ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at)) : -1);
  const visited = new Set();
  for (let offset = u32(4); offset >= 8 && !visited.has(offset) && visited.size < 32;) {
    visited.add(offset);
    const count = u16(offset);
    if (count <= 0 || count > 1024) break;
    for (let index = 0; index < count; index++) {
      const entry = offset + 2 + index * 12;
      const [tag, type, length] = [u16(entry), u16(entry + 2), u32(entry + 4)];
      if (!wanted.has(tag) || type < 0 || length < 0) continue;
      const size = (TIFF_TYPE_SIZES[type] ?? 0) * length;
      const at = size <= 4 ? entry + 8 : u32(entry + 8);
      if (size > 0 && at >= 0 && at + size <= tiff.length) entries.push([tag, tiff.subarray(at, at + size)]);
    }
    offset = u32(offset + 2 + count * 12);
  }
  return entries;
}

// IPTC datasets of record 2 that name a person: By-line and Writer/Editor.
const IPTC_AUTHORS = new Set([80, 122]);

/** What IPTC records name: an author, by its By-line or Writer/Editor dataset. */
function iptcData(data, found) {
  for (let at = 0, count = 0; at + 5 <= data.length && data[at] === 0x1c && count < 4096; count++) {
    const [record, dataset] = [data[at + 1], data[at + 2]];
    let length = data.readUInt16BE(at + 3);
    let start = at + 5;
    // An extended dataset gives the size of its length first.
    if (length & 0x8000) {
      const size = length & 0x7fff;
      if (size === 0 || size > 4 || start + size > data.length) break;
      length = data.readUIntBE(start, size);
      start += size;
    }
    if (record === 2 && IPTC_AUTHORS.has(dataset) && /[^\0\s]/u.test(data.toString('latin1', start, Math.min(start + length, data.length)))) named(found, 'iptc', 'image author');
    at = start + length;
  }
}

/** Photoshop's image resources, as a JPEG's APP13 segment, a TIFF and a PNG raw profile hold them: IPTC, a profile, EXIF and XMP. */
function photoshopData(data, found) {
  let at = data.toString('latin1', 0, 14) === 'Photoshop 3.0\0' ? 14 : 0;
  if (data[at] === 0x1c) { iptcData(data.subarray(at), found); return; }
  for (let count = 0; at + 12 <= data.length && count < 1024 && data.toString('latin1', at, at + 4) === '8BIM'; count++) {
    const id = data.readUInt16BE(at + 4);
    // A Pascal name, padded to an even length.
    const sizeAt = at + 6 + ((data[at + 6] + 2) & ~1);
    if (sizeAt + 4 > data.length) break;
    const size = data.readUInt32BE(sizeAt);
    const value = data.subarray(sizeAt + 4, Math.min(sizeAt + 4 + size, data.length));
    if (id === 0x0404) iptcData(value, found);
    else if (id === 0x040f) found.profiles.push(value);
    else if (id === 0x0422) found.exif.push(exifBody(value));
    else if (id === 0x0424) found.xmp.push(value.toString('utf8'));
    at = sizeAt + 4 + size + (size % 2);
  }
}

/** A TIFF's metadata: its directories as EXIF reads them, and its ICC profile, XMP, IPTC and Photoshop tags. */
function tiffData(tiff, found) {
  found.exif.push(tiff);
  for (const [tag, value] of tiffEntries(tiff, new Set([0x8773, 0x02bc, 0x83bb, 0x8649]))) {
    if (tag === 0x8773) found.profiles.push(value);
    else if (tag === 0x02bc) found.xmp.push(value.toString('utf8'));
    else if (tag === 0x83bb) iptcData(value, found);
    else photoshopData(value, found);
  }
}

/** A GIF's ICC profile, which an application extension (ICCRGBG1012) holds in its data sub-blocks. */
function gifData(gif, found) {
  const colors = (flags) => ((flags & 0x80) === 0 ? 0 : 3 * (2 << (flags & 7)));
  // The sub-blocks from an index: their data when it is collected, and the index after their terminator.
  const blocks = (from, collect) => {
    const parts = [];
    let at = from;
    for (let count = 0; at < gif.length && gif[at] !== 0 && count < 1 << 20; count++) {
      if (collect) parts.push(gif.subarray(at + 1, at + 1 + gif[at]));
      at += 1 + gif[at];
    }
    return [collect ? Buffer.concat(parts) : undefined, at + 1];
  };
  let at = 13 + colors(gif[10]);
  for (let count = 0; at < gif.length && count < 1 << 16; count++) {
    if (gif[at] === 0x21) {
      const application = gif[at + 1] === 0xff && gif[at + 2] === 11 ? gif.toString('latin1', at + 3, at + 14) : '';
      const [data, next] = blocks(application === '' ? at + 2 : at + 14, application === 'ICCRGBG1012');
      if (data !== undefined) found.profiles.push(data);
      at = next;
    } else if (gif[at] === 0x2c) at = blocks(at + 11 + colors(gif[at + 9]), false)[1];
    else break;
  }
}

// A position as ISO 6709 writes it, as QuickTime's location does: a signed latitude, then a signed longitude.
const ISO_6709 = /[+-]\d{1,2}(?:\.\d+)?[+-]\d{1,3}(?:\.\d+)?/u;
const QUICKTIME_LOCATION = Buffer.from([0xa9, 0x78, 0x79, 0x7a]);

/**
 * ISO base media (AVIF, HEIC, MP4, MOV): a color box's ICC profile (prof, rICC), an EXIF item (Exif and a TIFF
 * header), and a place QuickTime recorded, in its ©xyz user data or its location metadata key.
 */
function mediaData(media, found) {
  const each = (signature, visit) => {
    for (let at = media.indexOf(signature, 4), count = 0; at >= 4 && count < 4096; at = media.indexOf(signature, at + 1), count++) visit(at);
  };
  each('colr', (at) => {
    const size = media.readUInt32BE(at - 4);
    const kind = media.toString('latin1', at + 4, at + 8);
    if ((kind === 'prof' || kind === 'rICC') && size > 12 && at - 4 + size <= media.length) found.profiles.push(media.subarray(at + 8, at - 4 + size));
  });
  each('Exif\0\0', (at) => {
    const head = media.toString('latin1', at + 6, at + 10);
    if (head === 'II*\0' || head === 'MM\0*') found.exif.push(media.subarray(at + 6, Math.min(at + 6 + MAX_PROFILE, media.length)));
  });
  each(QUICKTIME_LOCATION, (at) => {
    const size = media.readUInt32BE(at - 4);
    if (ISO_6709.test(media.toString('latin1', at + 4, Math.min(at - 4 + size, media.length)))) named(found, 'video', 'GPS location');
  });
  if (media.includes('com.apple.quicktime.location.ISO6709') && ISO_6709.test(media.toString('latin1'))) named(found, 'video', 'GPS location');
}

/** Whether a PDF string, literal or hexadecimal, holds a character that shows. */
function pdfText(value) {
  if (value.startsWith('<')) {
    const digits = value.slice(1, -1).replace(/\s+/gu, '');
    return /[^\0\s\xfe\xff]/u.test(Buffer.from(digits.slice(0, digits.length - (digits.length % 2)), 'hex').toString('latin1'));
  }
  return /[^\0\s\xfe\xff]/u.test(value.slice(1, -1).replace(/\\(?:[0-7]{1,3}|[\s\S])/gu, ' '));
}

/**
 * A PDF's ICC profile streams (/N with a profile's signature) and metadata streams, read plain or inflated, and the
 * author its Info dictionary names, in the file or in a compressed object stream.
 */
function pdfData(pdf, found) {
  const author = (text) => {
    for (const match of text.matchAll(/\/Author\s*(\((?:[^()\\]|\\[\s\S]|\((?:[^()\\]|\\[\s\S])*\))*\)|<[0-9A-Fa-f\s]*>)/gu)) {
      if (pdfText(match[1])) named(found, 'pdf', 'document author');
    }
  };
  const text = pdf.toString('latin1');
  author(text);
  let count = 0;
  for (const match of text.matchAll(/stream\r?\n/gu)) {
    if (++count > 4096) break;
    const start = match.index + match[0].length;
    const end = text.indexOf('endstream', start);
    if (end < 0) break;
    const dictionary = text.slice(Math.max(text.lastIndexOf('obj', match.index), match.index - 4096, 0), match.index);
    const objects = /\/Type\s*\/ObjStm\b/u.test(dictionary);
    const metadata = /\/Type\s*\/Metadata\b/u.test(dictionary);
    if (!objects && !metadata && !/\/N\s+\d/u.test(dictionary)) continue;
    let data = pdf.subarray(start, end);
    if (/\/FlateDecode\b/u.test(dictionary)) data = inflated(data, MAX_PROFILE);
    else if (/\/Filter\b/u.test(dictionary)) continue;
    if (data.toString('latin1', 36, 40) === 'acsp') found.profiles.push(data);
    if (metadata) found.xmp.push(data.toString('utf8'));
    if (objects) author(data.toString('latin1'));
  }
}

/** The images an icon holds, as an ICO's directory and an ICNS's elements list them. */
function iconImages(bytes) {
  const images = [];
  if (bytes.length >= 22 && bytes.readUInt16LE(0) === 0 && [1, 2].includes(bytes.readUInt16LE(2))) {
    for (let index = 0; index < Math.min(bytes.readUInt16LE(4), 256); index++) {
      const entry = 6 + index * 16;
      if (entry + 16 > bytes.length) break;
      const [size, offset] = [bytes.readUInt32LE(entry + 8), bytes.readUInt32LE(entry + 12)];
      images.push(bytes.subarray(offset, Math.min(offset + size, bytes.length)));
    }
  } else if (bytes.length >= 8 && bytes.toString('latin1', 0, 4) === 'icns') {
    for (let at = 8, count = 0; at + 8 <= bytes.length && count < 256; count++) {
      const size = bytes.readUInt32BE(at + 4);
      if (size < 8) break;
      images.push(bytes.subarray(at + 8, Math.min(at + size, bytes.length)));
      at += size;
    }
  }
  return images.filter((image) => isPng(image) || (image[0] === 0xff && image[1] === 0xd8));
}

/** The XMP packets any file holds as plain bytes, as GIF, ISO media, PDF and TIFF write them. */
function xmpPackets(bytes, found) {
  for (let at = bytes.indexOf('<x:xmpmeta'), count = 0; at >= 0 && count < 16; count++) {
    const close = bytes.indexOf('</x:xmpmeta>', at);
    const end = Math.min(close < 0 ? bytes.length : close + 12, at + MAX_INFLATED);
    found.xmp.push(bytes.toString('utf8', at, end));
    at = bytes.indexOf('<x:xmpmeta', end);
  }
}

/**
 * The ICC profiles, EXIF structures and XMP packets of an image, and what else its metadata names (`named`, as
 * { where, category }), read within fixed bounds: a PNG's iCCP and eXIf chunks and its XMP and raw profile text
 * chunks (EXIF, ICC, XMP, IPTC and Photoshop's), a JPEG's APP1 EXIF and XMP segments, its APP2 profile in as many
 * parts as it has and its APP13 Photoshop resources, a WebP's ICCP, EXIF and XMP chunks, a TIFF's directories and
 * profile, XMP, IPTC and Photoshop tags, a GIF's ICC application extension, ISO media's color boxes, EXIF items and
 * QuickTime location, a PDF's profile, metadata and object streams and its author, the PNG and JPEG images of an
 * icon, and the XMP packets any file holds as plain bytes.
 */
export function imageMetadata(bytes) {
  const found = { profiles: [], exif: [], xmp: [], named: [] };
  if (isPng(bytes)) {
    for (const [type, data] of pngChunks(bytes)) {
      const name = data.indexOf(0);
      if (type === 'iCCP' && name > 0 && data[name + 1] === 0) found.profiles.push(inflated(data.subarray(name + 2), MAX_PROFILE));
      else if (type === 'eXIf') found.exif.push(exifBody(data));
    }
    for (const [keyword, text] of pngTextChunks(bytes)) {
      if (keyword === XMP_KEYWORD) found.xmp.push(text);
      else if (/^Raw profile type (?:exif|APP1)$/iu.test(keyword)) found.exif.push(exifBody(rawProfile(text)));
      else if (/^Raw profile type ic[cm]$/iu.test(keyword)) found.profiles.push(rawProfile(text));
      else if (/^Raw profile type xmp$/iu.test(keyword)) found.xmp.push(rawProfile(text).toString('utf8'));
      else if (/^Raw profile type (?:iptc|8bim)$/iu.test(keyword)) photoshopData(rawProfile(text), found);
    }
  } else if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    const parts = [];
    for (let at = 2, count = 0; at + 4 <= bytes.length && count < 4096 && bytes[at] === 0xff; count++) {
      const marker = bytes[at + 1];
      // Fill bytes, and markers without a length.
      if (marker === 0xff) { at++; continue; }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { at += 2; continue; }
      // The scan, or the end: no metadata follows.
      if (marker === 0xda || marker === 0xd9) break;
      const length = bytes.readUInt16BE(at + 2);
      if (length < 2) break;
      const data = bytes.subarray(at + 4, Math.min(at + 2 + length, bytes.length));
      at += 2 + length;
      const head = data.subarray(0, 40).toString('latin1');
      if (marker === 0xe1 && head.startsWith('Exif\0\0')) found.exif.push(data.subarray(6));
      else if (marker === 0xe1 && head.startsWith('http://ns.adobe.com/xap/1.0/\0')) found.xmp.push(data.subarray(29).toString('utf8'));
      // Extended XMP: after its name, a GUID, the full length and this part's offset.
      else if (marker === 0xe1 && head.startsWith('http://ns.adobe.com/xmp/extension/\0')) found.xmp.push(data.subarray(75).toString('utf8'));
      else if (marker === 0xe2 && head.startsWith('ICC_PROFILE\0') && data.length > 14) parts.push([data[12], data.subarray(14)]);
      else if (marker === 0xed && head.startsWith('Photoshop 3.0\0')) photoshopData(data, found);
    }
    if (parts.length > 0) found.profiles.push(Buffer.concat(parts.sort((left, right) => left[0] - right[0]).map(([, part]) => part)));
  } else if (bytes.length >= 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') {
    for (let at = 12, count = 0; at + 8 <= bytes.length && count < 4096; count++) {
      const type = bytes.toString('latin1', at, at + 4);
      const length = bytes.readUInt32LE(at + 4);
      const data = bytes.subarray(at + 8, Math.min(at + 8 + length, bytes.length));
      if (type === 'ICCP') found.profiles.push(data);
      else if (type === 'EXIF') found.exif.push(exifBody(data));
      else if (type === 'XMP ') found.xmp.push(data.toString('utf8'));
      at += 8 + length + (length % 2);
    }
  } else if (isTiff(bytes)) tiffData(bytes, found);
  else if (bytes.length >= 13 && /^GIF8[79]a$/u.test(bytes.toString('latin1', 0, 6))) gifData(bytes, found);
  else if (bytes.length >= 12 && bytes.toString('latin1', 4, 8) === 'ftyp') mediaData(bytes, found);
  else if (bytes.subarray(0, 1024).includes('%PDF-')) pdfData(bytes, found);
  else {
    for (const image of iconImages(bytes)) {
      const inner = imageMetadata(image);
      for (const key of Object.keys(found)) found[key].push(...inner[key]);
    }
  }
  xmpPackets(bytes, found);
  return found;
}

const utf16be = (data) => Buffer.from(data.subarray(0, data.length - (data.length % 2))).swap16().toString('utf16le');

/** The text an ICC text tag holds: a textDescription, a text or a multiLocalizedUnicode in every language it has. */
function profileText(tag) {
  const type = tag.toString('latin1', 0, 4);
  if (type === 'desc' && tag.length >= 12) return tag.subarray(12, Math.min(12 + tag.readUInt32BE(8), tag.length)).toString('latin1').replace(/\0+$/u, '');
  if (type === 'text') return tag.subarray(8).toString('latin1').replace(/\0+$/u, '');
  if (type !== 'mluc' || tag.length < 16 || tag.readUInt32BE(12) < 12) return '';
  const texts = new Set();
  for (let index = 0, record = 16; index < Math.min(tag.readUInt32BE(8), 256) && record + 12 <= tag.length; index++, record += tag.readUInt32BE(12)) {
    const length = tag.readUInt32BE(record + 4);
    const offset = tag.readUInt32BE(record + 8);
    if (offset + length <= tag.length) texts.add(utf16be(tag.subarray(offset, offset + length)));
  }
  return [...texts].join('\n');
}

/** The name and value pairs of an ICC dictType tag, as calibration tools write their 'meta' tag. */
function profileDictionary(tag) {
  if (tag.toString('latin1', 0, 4) !== 'dict' || tag.length < 16 || ![16, 24, 32].includes(tag.readUInt32BE(12))) return [];
  const size = tag.readUInt32BE(12);
  const string = (offset, length) => (length > 0 && offset + length <= tag.length ? utf16be(tag.subarray(offset, offset + length)) : '');
  const entries = [];
  for (let index = 0, record = 16; index < Math.min(tag.readUInt32BE(8), 256) && record + 16 <= tag.length; index++, record += size) {
    entries.push([string(tag.readUInt32BE(record), tag.readUInt32BE(record + 4)), string(tag.readUInt32BE(record + 8), tag.readUInt32BE(record + 12))]);
  }
  return entries;
}

// A serial number label and a value with a digit in it, as a description that names one unit writes it.
const SERIAL_LABEL = /\b(?:serial(?:\s*(?:number|no\.?|num\.?|#))?|s\/n|sn)(?![A-Za-z0-9])\s*[:#=]?\s*([A-Za-z0-9][A-Za-z0-9-]{3,})/giu;
const namesSerial = (text) => [...text.matchAll(SERIAL_LABEL)].some((match) => /\d/u.test(match[1]));
const PROFILE_TEXTS = new Set(['desc', 'dmnd', 'dmdd', 'dscm', 'cprt']);
const PROFILE_DESCRIPTIONS = new Set(['desc', 'dmnd', 'dmdd', 'dscm']);
// Serial numbers that name no unit: none, EDID's placeholder for an unused serial number, which the standard
// ProPhoto RGB profile carries in its make and model tag, and all ones.
const PLACEHOLDER_SERIALS = new Set([0, 0x01010101, 0xffffffff]);

/**
 * What an ICC profile says about the unit it was made for, and the texts of its descriptions and copyright. A
 * profile names its unit by a nonzero serial number in Apple's make and model tag ('mmod'), which macOS writes into
 * every display profile, by a description that labels a serial number, or by a calibration dictionary entry with a
 * serial number or an EDID hash, which hashes one. A manufacturer, a model and a description without a serial
 * number name a product, not a unit, so sRGB, Display P3, a printer profile and a cleared display profile name none,
 * and so does a placeholder serial number (EDID's 0x01010101 for none, as ProPhoto RGB carries, or all ones).
 */
export function profileData(profile) {
  const result = { categories: new Set(), texts: [] };
  if (profile.length < 132 || profile.toString('latin1', 36, 40) !== 'acsp') return result;
  for (let index = 0; index < Math.min(profile.readUInt32BE(128), 1024) && 144 + index * 12 <= profile.length; index++) {
    const entry = 132 + index * 12;
    const signature = profile.toString('latin1', entry, entry + 4);
    const offset = profile.readUInt32BE(entry + 4);
    const tag = profile.subarray(offset, Math.min(offset + profile.readUInt32BE(entry + 8), profile.length));
    if (tag.length < 8) continue;
    if (signature === 'mmod' && tag.toString('latin1', 0, 4) === 'mmod' && tag.length >= 20 && !PLACEHOLDER_SERIALS.has(tag.readUInt32BE(16))) result.categories.add('device serial number');
    if (PROFILE_TEXTS.has(signature)) {
      const text = profileText(tag);
      result.texts.push(text);
      if (PROFILE_DESCRIPTIONS.has(signature) && namesSerial(text)) result.categories.add('device serial number');
    }
    if (signature === 'meta' && profileDictionary(tag).some(([name, value]) => /[A-Za-z0-9]/u.test(value)
      && (/serial/iu.test(name) || /^edid_?(?:md5|hash)$/iu.test(name)))) result.categories.add('device serial number');
  }
  return result;
}

// EXIF tags that name a device or a person, in IFD0 and the Exif IFD.
const EXIF_TAGS = new Map([
  [0x010f, 'device make or model'], [0x0110, 'device make or model'], [0x013c, 'device make or model'], [0xa433, 'device make or model'],
  [0xa434, 'device make or model'], [0xa431, 'device serial number'], [0xa435, 'device serial number'], [0xc62f, 'device serial number'],
  [0x013b, 'image author'], [0xa430, 'image author'], [0x9c9d, 'image author'],
]);
// GPS tags that hold a position: latitude, longitude and the destination's.
const GPS_POSITION = new Set([0x0002, 0x0004, 0x0014, 0x0016]);

/**
 * What an EXIF structure says about the device and the person: a make or model (Make, Model, HostComputer,
 * LensMake, LensModel), a serial number (BodySerialNumber, LensSerialNumber, CameraSerialNumber), an author (Artist,
 * CameraOwnerName, XPAuthor) or a GPS position. Empty values say nothing, and neither does what macOS writes into a
 * screenshot: orientation, resolution, the pixel dimensions and the comment.
 */
export function exifData(tiff) {
  const categories = new Set();
  const order = tiff.toString('latin1', 0, 2);
  if (tiff.length < 8 || (order !== 'II' && order !== 'MM')) return categories;
  const little = order === 'II';
  const u16 = (at) => (at >= 0 && at + 2 <= tiff.length ? (little ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at)) : -1);
  const u32 = (at) => (at >= 0 && at + 4 <= tiff.length ? (little ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at)) : -1);
  if (u16(2) !== 42) return categories;
  const visited = new Set();
  const visit = (offset, gps) => {
    if (offset < 8 || visited.has(offset) || visited.size >= 32) return;
    visited.add(offset);
    const count = u16(offset);
    if (count <= 0 || count > 1024) return;
    for (let index = 0; index < count; index++) {
      const entry = offset + 2 + index * 12;
      const [tag, type, length] = [u16(entry), u16(entry + 2), u32(entry + 4)];
      if (tag < 0 || type < 0 || length < 0) return;
      const size = (TIFF_TYPE_SIZES[type] ?? 0) * length;
      const at = size <= 4 ? entry + 8 : u32(entry + 8);
      const value = size > 0 && at >= 0 && at + size <= tiff.length ? tiff.subarray(at, at + size) : Buffer.alloc(0);
      if (gps) {
        if (GPS_POSITION.has(tag) && value.some((byte) => byte !== 0)) categories.add('GPS location');
      } else if (tag === 0x8769 || tag === 0x8825) visit(u32(entry + 8), tag === 0x8825);
      // XPAuthor is UTF-16LE; the others are ASCII. Only NULs and spaces say nothing.
      else if (EXIF_TAGS.has(tag) && /[^\0\s]/u.test(value.toString(tag === 0x9c9d ? 'utf16le' : 'latin1'))) categories.add(EXIF_TAGS.get(tag));
    }
    // IFD0 links the thumbnail's IFD1, which can hold the same tags.
    if (!gps) visit(u32(offset + 2 + count * 12), false);
  };
  visit(u32(4), false);
  return categories;
}

// The XMP properties that say what EXIF's tags say.
const XMP_PROPERTIES = new Map([
  ['device serial number', ['aux:SerialNumber', 'exifEX:BodySerialNumber', 'exifEX:LensSerialNumber', 'aux:LensSerialNumber']],
  ['device make or model', ['tiff:Make', 'tiff:Model', 'exifEX:LensMake', 'exifEX:LensModel', 'aux:Lens']],
  ['image author', ['tiff:Artist', 'exifEX:CameraOwnerName', 'aux:OwnerName', 'dc:creator']],
  ['GPS location', ['exif:GPSLatitude', 'exif:GPSLongitude', 'exif:GPSDestLatitude', 'exif:GPSDestLongitude']],
]);

/** What an XMP packet says about the device and the person, as an element or an attribute with a value. */
export function xmpData(packet) {
  const categories = new Set();
  const text = packet.slice(0, MAX_INFLATED);
  for (const [category, properties] of XMP_PROPERTIES) {
    const named = properties.some((property) =>
      [...text.matchAll(new RegExp(`<${property}(?=[\\s/>])[^>]*>([\\s\\S]*?)</${property}>`, 'gu'))].some((match) => /\S/u.test(match[1].replace(/<[^>]*>/gu, '')))
      || [...text.matchAll(new RegExp(`[\\s"']${property}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'gu'))].some((match) => /\S/u.test(match[1] ?? match[2] ?? '')));
    if (named) categories.add(category);
  }
  return categories;
}

/** The device data an image's metadata names, as { where, category }: where is icc, exif or xmp, each category once there. */
function deviceData(metadata, profiles) {
  const found = [];
  const add = (where, categories) => { for (const category of categories) if (!found.some((entry) => entry.where === where && entry.category === category)) found.push({ where, category }); };
  for (const profile of profiles) add('icc', profile.categories);
  for (const tiff of metadata.exif) add('exif', exifData(tiff));
  for (const packet of metadata.xmp) add('xmp', xmpData(packet));
  for (const { where, category } of metadata.named) add(where, [category]);
  return found;
}

/** The text chunks of a PNG, inflated where compressed, within fixed bounds. */
function pngText(bytes) {
  return pngTextChunks(bytes).map(([, , reading]) => reading);
}

/**
 * Everything readable in binary data: PNG text chunks, the texts of a PNG's display profile, which it compresses, and
 * printable runs, as bytes and as UTF-16 in both alignments.
 */
function binaryText(bytes, profileTexts = []) {
  const runs = [...pngText(bytes), ...profileTexts, ...(bytes.toString('latin1').match(/[\x20-\x7e]{4,}/gu) ?? [])];
  for (const start of [0, 1]) {
    const end = start + Math.floor((bytes.length - start) / 2) * 2;
    runs.push(...(bytes.subarray(start, end).toString('utf16le').match(/[\x20-\x7e]{4,}/gu) ?? []));
  }
  return runs.join('\n');
}

const isZip = (bytes) => bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
const isText = (bytes) => {
  // A PDF is read for its metadata, also one written in ASCII alone.
  if (bytes.includes(0) || bytes.subarray(0, 5).toString('latin1') === '%PDF-') return false;
  try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); return true; } catch { return false; }
};

// A base64 data URI: a media type, parameters, and its digits, which a writer may wrap in lines (Inkscape), with
// character references for the line breaks (&#10;) or with a string's escaped line breaks (\n).
const DATA_URI = /data:[^,;"'\s<>]*(?:;[^,;"'\s<>]*)*;base64,((?:[A-Za-z0-9+/=]+|[\t\n\f\r ]+|&#(?:0*1[03]|x0*[AaDd]);|\\[nr])+)/gu;

/**
 * What base64 data URIs in a text decode to, each as its own artifact. They are read up to 32 MB of digits
 * together; one past that is reported as unscanned data, and the next ones are still read.
 */
function dataUris(location, text, depth) {
  const found = [];
  let budget = MAX_DATA_URI;
  let index = 0;
  for (const match of text.matchAll(DATA_URI)) {
    const digits = /^[A-Za-z0-9+/]*={0,2}/u.exec(match[1].replace(/[\t\n\f\r ]+|&#[^;]*;|\\[nr]/gu, ''))?.[0] ?? '';
    if (digits.length < 16) continue;
    const where = `${location}#data[${String(index++)}]`;
    if (digits.length > budget) { found.push(unscanned(where, true)); continue; }
    budget -= digits.length;
    found.push(...readBytes(where, Buffer.from(digits, 'base64'), depth + 1, true));
  }
  return found;
}

/**
 * What the hexadecimal groups of an RTF text decode to, each as its own artifact: Word writes its theme package,
 * color scheme mapping, data store and pictures as hexadecimal digits, wrapped in lines, which no reading of the
 * text sees. A group is a run of at least 64 digits; shorter runs are revision ids, colors and picture ids. They
 * are read up to 32 MB of digits together; a group past that is reported as unscanned data.
 */
function rtfHexGroups(location, text, depth) {
  if (!/^[\t\n\r ]*\{\\rtf/u.test(text)) return [];
  const found = [];
  let budget = MAX_RTF_HEX;
  let index = 0;
  for (const match of text.matchAll(/[0-9A-Fa-f][0-9A-Fa-f\r\n]{63,}/gu)) {
    const digits = match[0].replace(/[\r\n]/gu, '');
    if (digits.length < 64) continue;
    const where = `${location}#hex[${String(index++)}]`;
    if (digits.length > budget) { found.push(unscanned(where, true)); continue; }
    budget -= digits.length;
    found.push(...readBytes(where, Buffer.from(digits.slice(0, digits.length - (digits.length % 2)), 'hex'), depth + 1, true));
  }
  return found;
}

/**
 * Every text in some bytes, as { location, text, binary, inside }, and for binary data the device data its image
 * metadata names. What it cannot read, a package part or data nested more than three levels deep, is reported as
 * unscanned data.
 */
function readBytes(location, bytes, depth, inside) {
  if (depth > 3) return [unscanned(location, inside)];
  if (isZip(bytes)) {
    const parts = zipParts(bytes);
    if (parts !== null) {
      return parts.flatMap(([part, content]) => (content === null ? [unscanned(`${location}:${part}`, true)] : readBytes(`${location}:${part}`, content, depth + 1, true)));
    }
  }
  if (!isText(bytes)) {
    const metadata = imageMetadata(bytes);
    const profiles = metadata.profiles.map(profileData);
    // A profile or XMP packet the file holds as plain bytes is read with its printable runs; one compressed or
    // written in hexadecimal, as a PNG, a PDF stream or an icon's PNG holds it, is read here. A PNG's XMP is
    // read with its text chunks.
    const packed = (data) => !bytes.includes(data);
    const texts = [...metadata.profiles.flatMap((profile, index) => (packed(profile) ? profiles[index].texts : [])),
      ...(isPng(bytes) ? [] : metadata.xmp.filter((packet) => packed(Buffer.from(packet, 'utf8'))))];
    return [{ location, text: binaryText(bytes, texts), binary: true, inside, device: deviceData(metadata, profiles) }];
  }
  const text = bytes.toString('utf8');
  return [{ location, text, binary: false, inside }, ...dataUris(location, text, depth), ...rtfHexGroups(location, text, depth)];
}

/**
 * Every text a file holds, as { location, text, binary, inside }: the parts of
 * a zip package, the flavors, fields and clipboard files of a capture bundle
 * (JSON with payload.text), what its data URIs decode to, the readable runs of
 * binary data, or the file as text. `inside` marks text from inside a package,
 * a bundle or a data URI. Binary data also has `device`, the device data its
 * image metadata names, as { where, category }.
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
  // A match starts where a run of address characters starts, so a long run without an at sign, such as base64
  // digits, is read once rather than once per character.
  'e-mail address': /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/gu,
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
  for (const { location, text, binary, inside, device = [] } of artifactTexts(path, bytes)) {
    const classify = (match) => (NAME_CATEGORIES.has(match.category) ? match.category : judge(path, match, { inside, binary, notices, certificates, examples }));
    for (const match of findMatches(location, text, names, classify)) {
      findings.push({ path, location: match.location, line: lineOf(match.text, match.offset), category: match.category });
    }
    // Image metadata has no lines: a finding names the metadata it is in.
    for (const { where, category } of device) findings.push({ path, location: `${location}#${where}`, line: 1, category });
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
