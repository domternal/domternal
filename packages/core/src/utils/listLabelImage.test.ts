import { describe, expect, it } from 'vitest';
import { deflateSync } from 'node:zlib';
import { validListLabelImage, listLabelImageIdentifier } from './listLabelImage.js';

function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0); }
  return (crc ^ 0xffff_ffff) >>> 0;
}
export function markerPng(width = 12, height = 12, extra = ''): string {
  const chunk = (name: string, data: Buffer): Buffer => {
    const bytes = Buffer.concat([Buffer.from(name), data]); const size = Buffer.alloc(4); size.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(bytes)); return Buffer.concat([size, bytes, crc]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const pixels = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const at = y * (width * 4 + 1) + 1 + x * 4; pixels[at] = 220; pixels[at + 1] = 35; pixels[at + 2] = 60; pixels[at + 3] = 255; }
  return `data:image/png;base64,${Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
    ...(extra ? [chunk(extra, Buffer.alloc(8))] : []), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]).toString('base64')}`;
}

describe('local picture list marker source bounds', () => {
  it('accepts a bounded static PNG and uses an injection-safe injective identifier', () => {
    const source = markerPng(); expect(validListLabelImage(source)).toBe(true);
    const name = listLabelImageIdentifier(source, '"\\</style>');
    expect(name).toMatch(/^dm-ll-png-[a-f0-9]+-z-[A-Za-z0-9_-]+$/u);
    expect(name).not.toBe(listLabelImageIdentifier(source, 'other'));
    expect(name).not.toBe(listLabelImageIdentifier(markerPng(13), '"\\</style>'));
  });
  it.each([markerPng(0), markerPng(33), markerPng(12, 33), markerPng(12, 12, 'acTL'), markerPng(12, 12, 'eXIf'),
    'https://example.test/marker.png', 'data:image/svg+xml,<svg/>', 'data:image/png;base64,AAAA',
    `data:image/png;base64,${'AAAA'.repeat(1500)}`])('rejects out-of-profile data: %s', value => { expect(validListLabelImage(value)).toBe(false); });
  it('rejects corrupted chunk checksums, truncated files, appended payloads and noncanonical base64', () => {
    const source = markerPng(); const bytes = Buffer.from(source.split(',')[1]!, 'base64'); bytes[45] = bytes[45]! ^ 1;
    for (const value of [`data:image/png;base64,${bytes.toString('base64')}`, source.slice(0, -4), `${source}AAAA`, ` ${source}`, source.replace(',', ',\n')]) {
      expect(validListLabelImage(value)).toBe(false);
    }
  });
});
