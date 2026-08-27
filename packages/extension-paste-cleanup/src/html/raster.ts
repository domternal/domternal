const MAX_SIDE = 16_384;
const MAX_PIXELS = 25_000_000;
const MAX_FRAMES = 100;

/** Inspect container headers only. No image decoder or browser resource is created. */
export function boundedRaster(bytes: string, format: string, consumePixels: (pixels: number) => boolean = () => true): boolean {
  let maximumPixels = 0;
  const at = (offset: number): number => bytes.charCodeAt(offset);
  const le16 = (offset: number): number => at(offset) + at(offset + 1) * 256;
  const be16 = (offset: number): number => at(offset) * 256 + at(offset + 1);
  const le24 = (offset: number): number => le16(offset) + at(offset + 2) * 65_536;
  const be32 = (offset: number): number => be16(offset) * 65_536 + be16(offset + 2);
  const dimensions = (width: number, height: number, frames = 1): boolean => {
    maximumPixels = Math.max(maximumPixels, width * height * frames);
    return Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0
      && width <= MAX_SIDE && height <= MAX_SIDE && width * height * frames <= MAX_PIXELS;
  };

  if (format === 'png') {
    if (!bytes.startsWith('\x89PNG\r\n\x1a\n') || bytes.length < 33 || be32(8) !== 13 || bytes.slice(12, 16) !== 'IHDR') return false;
    if (!dimensions(be32(16), be32(20))) return false;
    // Animated PNG has a separate allocation budget and is not accepted here.
    let offset = 8;
    let hasPixels = false;
    while (offset + 12 <= bytes.length) {
      const size = be32(offset);
      if (offset + 12 + size > bytes.length) return false;
      const type = bytes.slice(offset + 4, offset + 8);
      if (type === 'acTL') return false;
      if (type === 'IDAT' && size > 0) hasPixels = true;
      if (type === 'IEND') return size === 0 && hasPixels && offset + 12 === bytes.length && consumePixels(maximumPixels);
      offset += size + 12;
    }
    return false;
  }
  if (format === 'jpeg') {
    if (!bytes.startsWith('\xff\xd8\xff')) return false;
    let offset = 2;
    let validDimensions = false;
    while (offset + 4 < bytes.length) {
      if (at(offset) !== 255) return false;
      while (at(offset) === 255) offset++;
      const marker = at(offset++);
      if (marker === 217) return false;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      const size = be16(offset);
      if (size < 2 || offset + size > bytes.length) return false;
      if (marker === 218) return validDimensions && size >= 6 && offset + size < bytes.length - 2 && bytes.endsWith('\xff\xd9') && consumePixels(maximumPixels);
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
        if (size < 8 || !dimensions(be16(offset + 5), be16(offset + 3))) return false;
        validDimensions = true;
      }
      offset += size;
    }
    return false;
  }
  if (format === 'gif') {
    if (!/^(?:GIF87a|GIF89a)/.test(bytes) || bytes.length < 13) return false;
    const width = le16(6);
    const height = le16(8);
    if (!dimensions(width, height)) return false;
    let offset = 13 + ((at(10) & 128) === 0 ? 0 : 3 * 2 ** ((at(10) & 7) + 1));
    let frames = 0;
    const skipBlocks = (): boolean => {
      while (offset < bytes.length) {
        const size = at(offset++);
        if (size === 0) return true;
        offset += size;
      }
      return false;
    };
    while (offset < bytes.length) {
      const type = at(offset++);
      if (type === 59) return frames > 0 && consumePixels(maximumPixels);
      if (type === 33) { offset++; if (!skipBlocks()) return false; continue; }
      if (type !== 44 || offset + 9 > bytes.length) return false;
      const frameWidth = le16(offset + 4);
      const frameHeight = le16(offset + 6);
      if (++frames > MAX_FRAMES || !dimensions(width, height, frames) || !dimensions(frameWidth, frameHeight)
        || le16(offset) + frameWidth > width || le16(offset + 2) + frameHeight > height) return false;
      const packed = at(offset + 8);
      offset += 9 + ((packed & 128) === 0 ? 0 : 3 * 2 ** ((packed & 7) + 1));
      offset++; // LZW minimum code size.
      if (!skipBlocks()) return false;
    }
    return false;
  }
  if (format === 'webp') {
    if (!bytes.startsWith('RIFF') || bytes.slice(8, 12) !== 'WEBP' || bytes.length < 25) return false;
    if (le16(4) + le16(6) * 65_536 + 8 !== bytes.length) return false;
    let offset = 12;
    let valid = false;
    while (offset + 8 <= bytes.length) {
      const type = bytes.slice(offset, offset + 4);
      const size = le16(offset + 4) + le16(offset + 6) * 65_536;
      const data = offset + 8;
      if (data + size > bytes.length) return false;
      if (type === 'ANIM' || type === 'ANMF') return false;
      if (type === 'VP8X') {
        if (size < 10 || (at(data) & 2) !== 0 || !dimensions(le24(data + 4) + 1, le24(data + 7) + 1)) return false;
      } else if (type === 'VP8L') {
        if (size < 5 || at(data) !== 47) return false;
        const width = 1 + (at(data + 1) | ((at(data + 2) & 63) << 8));
        const height = 1 + ((at(data + 2) >> 6) | (at(data + 3) << 2) | ((at(data + 4) & 15) << 10));
        if (!dimensions(width, height)) return false;
        valid = true;
      } else if (type === 'VP8 ') {
        if (size < 10 || bytes.slice(data + 3, data + 6) !== '\x9d\x01\x2a' || !dimensions(le16(data + 6) & 0x3fff, le16(data + 8) & 0x3fff)) return false;
        valid = true;
      }
      offset = data + size + (size % 2);
    }
    return valid && offset === bytes.length && consumePixels(maximumPixels);
  }
  return false;
}
