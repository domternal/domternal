// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { boundedRaster } from './raster.js';
import { safeImage, safeLink } from './urls.js';

// The PNG was generated from one white RGB pixel with zlib and CRC32 chunks.
// The JPEG was encoded from it with macOS ImageIO, with optional APP segments removed.
// Both WebP fixtures are complete one-pixel images verified with ImageIO.
const png = atob(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC'
);
const jpeg = atob(
  '/9j/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9sAQwACAgICAgIDAgIDBQMDAwUGBQUFBQYIBgYGBgYICggICAgICAoKCgoKCgoKDAwMDAwMDg4ODg4PDw8PDw8PDw8P/9sAQwECAgIEBAQHBAQHEAsJCxAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ/90ABAAB/9oADAMBAAIRAxEAPwD9/KKKKAP/2Q=='
);
const lossyWebP = atob('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA');
const losslessWebP = atob('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==');

function byte(...values: number[]): string {
  return String.fromCharCode(...values);
}

function le16(value: number): string {
  return byte(value & 255, (value >>> 8) & 255);
}

function le24(value: number): string {
  return le16(value) + byte((value >>> 16) & 255);
}

function le32(value: number): string {
  return le16(value) + le16(value >>> 16);
}

function be32(value: number): string {
  return byte((value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255);
}

function replace(bytes: string, offset: number, value: string): string {
  return bytes.slice(0, offset) + value + bytes.slice(offset + value.length);
}

function pngChunk(type: string, data: string): string {
  let crc = 0xffffffff;
  for (const character of type + data) {
    crc ^= character.charCodeAt(0);
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) === 0 ? 0 : 0xedb88320);
  }
  return be32(data.length) + type + data + be32((crc ^ 0xffffffff) >>> 0);
}

function pngDimensions(width: number, height: number): string {
  return (
    png.slice(0, 8) +
    pngChunk('IHDR', be32(width) + be32(height) + byte(8, 2, 0, 0, 0)) +
    png.slice(33)
  );
}

function jpegDimensions(width: number, height: number): string {
  return replace(jpeg, 7, byte(height >>> 8, height & 255, width >>> 8, width & 255));
}

function gifFrame(width = 1, height = 1, left = 0, top = 0): string {
  // Three-bit LZW codes: clear, palette index zero, end of information.
  return ',' + le16(left) + le16(top) + le16(width) + le16(height) + byte(0, 2, 2, 0x44, 0x01, 0);
}

function gif(width = 1, height = 1, frames = gifFrame()): string {
  return (
    'GIF89a' +
    le16(width) +
    le16(height) +
    byte(0x80, 0, 0) +
    byte(255, 255, 255, 0, 0, 0) +
    frames +
    ';'
  );
}

function riffChunk(type: string, data: string, padding = true): string {
  return type + le32(data.length) + data + (padding && data.length % 2 !== 0 ? '\0' : '');
}

function riff(chunks: string): string {
  return 'RIFF' + le32(chunks.length + 4) + 'WEBP' + chunks;
}

function extendedWebP(width: number, height: number, flags = 0): string {
  return riff(
    riffChunk('VP8X', byte(flags, 0, 0, 0) + le24(width - 1) + le24(height - 1)) +
      losslessWebP.slice(12)
  );
}

describe('boundedRaster container budgets', () => {
  it.each([
    { format: 'png', bytes: png },
    { format: 'jpeg', bytes: jpeg },
    { format: 'gif', bytes: gif() },
    { format: 'webp', bytes: lossyWebP },
    { format: 'webp', bytes: losslessWebP },
  ])('accepts an independently produced tiny $format container', ({ format, bytes }) => {
    expect(boundedRaster(bytes, format)).toBe(true);
    const value = `data:image/${format};base64,${btoa(bytes)}`;
    expect(safeImage(value, false, true)).toBe(value);
  });

  it.each([
    { format: 'png', make: pngDimensions },
    { format: 'jpeg', make: jpegDimensions },
    { format: 'gif', make: (width: number, height: number) => gif(width, height) },
    { format: 'webp', make: extendedWebP },
  ])('enforces side and decoded pixel limits for $format headers', ({ format, make }) => {
    // Compressed pixels stay tiny; only the independently written dimension headers change.
    expect(boundedRaster(make(16_384, 1), format)).toBe(true);
    expect(boundedRaster(make(5_000, 5_000), format)).toBe(true);
    expect(boundedRaster(make(16_385, 1), format)).toBe(false);
    expect(boundedRaster(make(1, 16_385), format)).toBe(false);
    expect(boundedRaster(make(5_001, 5_000), format)).toBe(false);
  });

  it.each(['png', 'jpeg', 'gif'] as const)('rejects zero dimensions for %s', (format) => {
    const make = format === 'png' ? pngDimensions : format === 'jpeg' ? jpegDimensions : gif;
    expect(boundedRaster(make(0, 1), format)).toBe(false);
    expect(boundedRaster(make(1, 0), format)).toBe(false);
  });

  it('rejects mismatched signatures and unsupported formats', () => {
    expect(boundedRaster(png, 'jpeg')).toBe(false);
    expect(boundedRaster(gif(), 'png')).toBe(false);
    expect(boundedRaster(jpeg, 'gif')).toBe(false);
    expect(boundedRaster(png, 'webp')).toBe(false);
    expect(boundedRaster(png, 'svg')).toBe(false);
  });

  it('rejects APNG before an animation can be rendered', () => {
    const animated = png.slice(0, 33) + pngChunk('acTL', be32(2) + be32(0)) + png.slice(33);
    expect(boundedRaster(animated, 'png')).toBe(false);
    expect(safeImage(`data:image/png;base64,${btoa(animated)}`, false, true)).toBeUndefined();
  });

  it('rejects PNG with incomplete headers, chunk bodies, and IEND', () => {
    for (const cutoff of [0, 8, 16, 24, 32, 34, png.length - 1]) {
      expect(boundedRaster(png.slice(0, cutoff), 'png'), `cutoff ${String(cutoff)}`).toBe(false);
    }
    expect(boundedRaster(replace(png, 33, be32(0xffffffff)), 'png')).toBe(false);
    expect(boundedRaster(png.slice(0, -12) + pngChunk('IEND', 'x'), 'png')).toBe(false);
  });

  it('requires PNG image data before the end marker', () => {
    expect(boundedRaster(png.slice(0, 33) + png.slice(-12), 'png')).toBe(false);
  });

  it('rejects truncated JPEG segments before dimensions are fully available', () => {
    for (const cutoff of [0, 2, 3, 5, 7, 10, 20]) {
      expect(boundedRaster(jpeg.slice(0, cutoff), 'jpeg'), `cutoff ${String(cutoff)}`).toBe(false);
    }
    expect(boundedRaster(replace(jpeg, 4, byte(255, 255)), 'jpeg')).toBe(false);
    expect(boundedRaster(replace(jpeg, 4, byte(0, 1)), 'jpeg')).toBe(false);
    expect(boundedRaster('\xff\xd8\xff\xda\x00\x08\0\0\0\0\0\0\xff\xd9', 'jpeg')).toBe(false);
  });

  it('finds JPEG dimensions after metadata and accepts progressive frame headers', () => {
    const withMetadata = jpeg.slice(0, 2) + '\xff\xe1\x00\x06test' + jpeg.slice(2);
    expect(boundedRaster(withMetadata, 'jpeg')).toBe(true);
    expect(boundedRaster(replace(jpeg, 3, '\xc2'), 'jpeg')).toBe(true);
  });

  it('requires a JPEG scan and end marker after valid dimensions', () => {
    const scanOffset = jpeg.indexOf('\xff\xda');
    expect(scanOffset).toBeGreaterThan(21);
    expect(boundedRaster(jpeg.slice(0, 21), 'jpeg')).toBe(false);
    expect(boundedRaster(jpeg.slice(0, -2), 'jpeg')).toBe(false);
    expect(boundedRaster(jpeg.slice(0, scanOffset) + '\xff\xd9', 'jpeg')).toBe(false);
    expect(boundedRaster(jpeg.slice(0, scanOffset + 5) + '\xff\xd9', 'jpeg')).toBe(false);
  });

  it('does not mistake JPEG marker bytes inside metadata for a scan', () => {
    const fakeScanMetadata = '\xff\xe1\x00\x06\xff\xda\xff\xd9';
    const noScan = jpeg.slice(0, 2) + fakeScanMetadata + jpeg.slice(2, 21) + '\xff\xd9';
    expect(boundedRaster(noScan, 'jpeg')).toBe(false);
  });

  it('bounds GIF frame count and total canvas pixels across frames', () => {
    expect(boundedRaster(gif(1, 1, gifFrame().repeat(100)), 'gif')).toBe(true);
    expect(boundedRaster(gif(1, 1, gifFrame().repeat(101)), 'gif')).toBe(false);
    expect(boundedRaster(gif(1_000, 1_000, gifFrame().repeat(25)), 'gif')).toBe(true);
    expect(boundedRaster(gif(1_000, 1_000, gifFrame().repeat(26)), 'gif')).toBe(false);
  });

  it.each([
    { name: 'wider frame', frame: gifFrame(2, 1) },
    { name: 'taller frame', frame: gifFrame(1, 2) },
    { name: 'horizontal offset', frame: gifFrame(1, 1, 1, 0) },
    { name: 'vertical offset', frame: gifFrame(1, 1, 0, 1) },
    { name: 'large frames behind a tiny canvas', frame: gifFrame(5_000, 5_000).repeat(2) },
  ])('rejects a GIF $name that escapes the declared canvas', ({ frame }) => {
    expect(boundedRaster(gif(1, 1, frame), 'gif')).toBe(false);
  });

  it('handles GIF extension blocks and local palettes without skipping truncated data', () => {
    const comment = '!\xfe\x04note\0';
    expect(boundedRaster(gif(1, 1, comment + gifFrame()), 'gif')).toBe(true);
    const localPalette = replace(gifFrame(), 9, '\x80');
    const withPalette =
      localPalette.slice(0, 10) + byte(0, 0, 0, 255, 255, 255) + localPalette.slice(10);
    expect(boundedRaster(gif(1, 1, withPalette), 'gif')).toBe(true);
    expect(boundedRaster(gif(1, 1, '!\xfe\xffshort'), 'gif')).toBe(false);
    expect(boundedRaster(gif(1, 1, replace(gifFrame(), 9, '\x87')), 'gif')).toBe(false);
    expect(boundedRaster(gif(1, 1, replace(gifFrame(), 11, '\xff')), 'gif')).toBe(false);
    expect(boundedRaster(gif(1, 1, ''), 'gif')).toBe(false);
    for (const cutoff of [6, 12, 18, 25, gif().length - 1]) {
      expect(boundedRaster(gif().slice(0, cutoff), 'gif'), `cutoff ${String(cutoff)}`).toBe(false);
    }
  });

  it('rejects WebP animation flags and animation chunks', () => {
    expect(boundedRaster(extendedWebP(1, 1, 2), 'webp')).toBe(false);
    for (const type of ['ANIM', 'ANMF']) {
      expect(
        boundedRaster(riff(riffChunk(type, '\0'.repeat(16)) + losslessWebP.slice(12)), 'webp')
      ).toBe(false);
    }
  });

  it('supports padded unknown RIFF chunks without accepting truncated payloads', () => {
    const unknown = riffChunk('JUNK', 'x');
    expect(boundedRaster(riff(unknown + losslessWebP.slice(12)), 'webp')).toBe(true);
    expect(boundedRaster(riff(losslessWebP.slice(12) + unknown), 'webp')).toBe(true);
    expect(boundedRaster(riff('JUNK' + le32(100) + 'x' + losslessWebP.slice(12)), 'webp')).toBe(
      false
    );
    expect(boundedRaster(riff(riffChunk('JUNK', 'unknown')), 'webp')).toBe(false);
    expect(boundedRaster(riff(riffChunk('VP8X', '\0'.repeat(10))), 'webp')).toBe(false);
  });

  it.each([0, 4, 0xffffffff])(
    'rejects a WebP RIFF length of %s that disagrees with its bytes',
    (declaredSize) => {
      expect(boundedRaster(replace(losslessWebP, 4, le32(declaredSize)), 'webp')).toBe(false);
    }
  );

  it('rejects incomplete trailing RIFF chunk headers and missing padding', () => {
    expect(boundedRaster(riff(losslessWebP.slice(12) + 'JUNK'), 'webp')).toBe(false);
    expect(boundedRaster(riff(losslessWebP.slice(12) + 'x'), 'webp')).toBe(false);
    expect(boundedRaster(riff(losslessWebP.slice(12, -1)), 'webp')).toBe(false);
  });

  it('rejects truncated WebP bitstream headers and incorrect signatures', () => {
    expect(boundedRaster(riff(riffChunk('VP8L', '\x2f\0\0\0')), 'webp')).toBe(false);
    expect(boundedRaster(replace(losslessWebP, 20, '\x30'), 'webp')).toBe(false);
    expect(boundedRaster(riff(riffChunk('VP8 ', '\0'.repeat(9))), 'webp')).toBe(false);
    expect(boundedRaster(replace(lossyWebP, 23, '\0\0\0'), 'webp')).toBe(false);
    expect(
      boundedRaster(riff(riffChunk('VP8X', '\0'.repeat(9)) + losslessWebP.slice(12)), 'webp')
    ).toBe(false);
  });
});

describe('image and link URL admission', () => {
  it('requires independent opt-ins for remote and data images', () => {
    const data = `data:image/png;base64,${btoa(png)}`;
    expect(safeImage(data, false, false)).toBeUndefined();
    expect(safeImage(data, true, false)).toBeUndefined();
    expect(safeImage(data, false, true)).toBe(data);
    expect(safeImage('https://example.test/image.png', false, true)).toBeUndefined();
    expect(safeImage('https://example.test/image.png', true, false)).toBe(
      'https://example.test/image.png'
    );
  });

  it.each([
    'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
    'data:image/png;base64,YWJjZA==',
    'data:image/png;base64,',
    'data:image/png;base64,====',
    'data:image/png;base64,YQ=',
    'data:image/png;base64,YQ===',
    'data:image/png;base64,YQ==\n',
    'data:image/png;charset=utf-8;base64,YQ==',
    'data:image/png,%89PNG',
    'blob:https://example.test/id',
    'file:///image.png',
    'cid:image1',
    '//example.test/image.png',
    '/image.png',
    'javascript:alert(1)',
    'https://user:password@example.test/image.png',
    'https://example.test/image\n.png',
  ])('refuses unsupported or malformed image references: %s', (value) => {
    expect(safeImage(value, true, true)).toBeUndefined();
  });

  it('checks data bytes against the declared MIME type and accepts case-insensitive MIME', () => {
    expect(safeImage(`data:image/jpeg;base64,${btoa(png)}`, false, true)).toBeUndefined();
    const uppercase = `DATA:IMAGE/PNG;BASE64,${btoa(png)}`;
    expect(safeImage(uppercase, false, true)).toBe(uppercase);
    expect(safeImage(null, true, true)).toBeUndefined();
    expect(safeLink(null)).toBeUndefined();
  });

  it('resolves links only against an explicit HTTP source URL', () => {
    expect(safeLink('guide')).toBeUndefined();
    expect(safeLink('guide', 'https://source.test/docs/')).toBe('https://source.test/docs/guide');
    expect(safeLink('//target.test/path', 'https://source.test/docs/')).toBe(
      'https://target.test/path'
    );
    expect(safeLink('guide', 'file:///private/doc')).toBeUndefined();
    expect(safeLink('#anchor', 'https://source.test/docs/')).toBeUndefined();
    expect(safeLink('https://user:password@example.test/')).toBeUndefined();
    expect(safeLink('java\tscript:alert(1)')).toBeUndefined();
    expect(safeLink('mailto:reader@example.test')).toBe('mailto:reader@example.test');
    expect(safeLink('tel:+3851234567')).toBe('tel:+3851234567');
  });
});
