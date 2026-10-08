#!/usr/bin/env node
/**
 * Deterministic PNG images for the Google Docs capture documents. The owner writes them to a
 * directory outside the repository and inserts them with Insert > Image > Upload from computer, so
 * every captured image is a known synthetic file. Pixels are solid colors, or seeded noise for the
 * large image, and the image data uses stored deflate blocks, so the bytes never depend on a zlib
 * version.
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const solid = (name, width, height, rgb) => Object.freeze({ name, width, height, rgb: Object.freeze(rgb) });

/** Every image the Google Docs specification inserts, by file name. */
export const GOOGLE_DOCS_IMAGES = Object.freeze([
  solid('gdocs-v1-blue-320x200.png', 320, 200, [0x1f, 0x4e, 0x9c]),
  solid('gdocs-v1-green-200x200.png', 200, 200, [0x2e, 0x8b, 0x57]),
  solid('gdocs-v1-orange-200x200.png', 200, 200, [0xf2, 0x8c, 0x28]),
  solid('gdocs-v1-red-160x120.png', 160, 120, [0xc6, 0x28, 0x28]),
  solid('gdocs-v1-purple-160x120.png', 160, 120, [0x6a, 0x1b, 0x9a]),
  // Seeded noise does not compress, so the file stays large after any re-encoding. At 5.8 MB it exceeds
  // the capture's 5 MiB file limit and, as a data URL, its 2 MiB text flavor limit, while the .docx export
  // of its own document stays well below the 16 MiB fixture source limit of prepare-fixture.mjs and offline.mjs.
  Object.freeze({ name: 'gdocs-v1-large-1600x1200.png', width: 1600, height: 1200, noise: 0x9e3779b9 }),
  // Fifty-one distinct colors: 37, 91 and 157 are odd, so each channel differs for every index.
  ...Array.from({ length: 51 }, (_, index) => solid(`gdocs-v1-limit-${String(index + 1).padStart(2, '0')}.png`, 32, 32,
    [(37 * (index + 1)) % 256, (91 * (index + 1)) % 256, (157 * (index + 1)) % 256])),
]);

const CRC_TABLE = Int32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc;
});
function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}
function chunk(type, data) {
  const bytes = Buffer.alloc(data.length + 12);
  bytes.writeUInt32BE(data.length, 0);
  bytes.write(type, 4, 'latin1');
  data.copy(bytes, 8);
  bytes.writeUInt32BE(crc32(bytes.subarray(4, data.length + 8)), data.length + 8);
  return bytes;
}
/** A zlib stream of stored deflate blocks: valid, uncompressed and identical on every runtime. */
function stored(raw) {
  const blocks = Math.max(1, Math.ceil(raw.length / 65_535));
  const bytes = Buffer.alloc(2 + blocks * 5 + raw.length + 4);
  bytes[0] = 0x78; bytes[1] = 0x01;
  let offset = 2;
  for (let block = 0; block < blocks; block++) {
    const data = raw.subarray(block * 65_535, Math.min(raw.length, (block + 1) * 65_535));
    bytes[offset] = block === blocks - 1 ? 1 : 0;
    bytes.writeUInt16LE(data.length, offset + 1);
    bytes.writeUInt16LE(~data.length & 0xffff, offset + 3);
    data.copy(bytes, offset + 5);
    offset += 5 + data.length;
  }
  let a = 1; let b = 0;
  for (const byte of raw) { a = (a + byte) % 65_521; b = (b + a) % 65_521; }
  bytes.writeUInt32BE(((b << 16) | a) >>> 0, offset);
  return bytes;
}

/** The PNG bytes of one image: 8 bit RGB, no filter, stored deflate. */
export function renderImage(image) {
  const row = image.width * 3 + 1;
  const raw = Buffer.alloc(row * image.height);
  let state = image.noise;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const offset = y * row + 1 + x * 3;
      if (state === undefined) { raw[offset] = image.rgb[0]; raw[offset + 1] = image.rgb[1]; raw[offset + 2] = image.rgb[2]; continue; }
      // xorshift32: three pseudorandom channels per pixel.
      state ^= state << 13; state ^= state >>> 17; state ^= state << 5; state >>>= 0;
      raw[offset] = state & 0xff; raw[offset + 1] = (state >>> 8) & 0xff; raw[offset + 2] = (state >>> 16) & 0xff;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0); header.writeUInt32BE(image.height, 4);
  header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', stored(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** Write every image into `directory`, which must lie outside this repository, and list them with their hashes. */
export async function writeGoogleDocsImages(directory) {
  const target = resolve(directory);
  const repository = fileURLToPath(new URL('../../../', import.meta.url));
  const inside = relative(repository, target);
  if (inside !== '..' && !inside.startsWith(`..${sep}`) && !isAbsolute(inside)) throw new Error('Write the images outside the repository, for example /private/tmp/gdocs-v1-images');
  await mkdir(target, { recursive: true });
  const written = [];
  for (const image of GOOGLE_DOCS_IMAGES) {
    const bytes = renderImage(image);
    await writeFile(join(target, image.name), bytes);
    written.push({ file: image.name, width: image.width, height: image.height, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  return written;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) {
    process.stderr.write('Usage: node google-docs-images.mjs <directory outside the repository>\n');
    process.exitCode = 2;
  } else {
    try {
      process.stdout.write(`${JSON.stringify(await writeGoogleDocsImages(process.argv[2]), null, 2)}\n`);
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    }
  }
}
