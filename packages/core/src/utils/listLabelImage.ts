const PREFIX = 'data:image/png;base64,';
const MAX_BYTES = 4_096;
const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const ANCILLARY = new Set(['sRGB', 'gAMA', 'cHRM', 'pHYs']);

function uint32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0;
}
function crc32(bytes: Uint8Array, start: number, end: number): number {
  let value = 0xffff_ffff;
  for (let index = start; index < end; index++) {
    value ^= bytes[index]!;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb8_8320 : 0);
  }
  return (value ^ 0xffff_ffff) >>> 0;
}

/** A local static true-color PNG marker. Pixel decoding remains the renderer's responsibility. */
export function validListLabelImage(source: unknown): source is string {
  if (typeof source !== 'string' || !source.startsWith(PREFIX) || source.length > PREFIX.length + Math.ceil(MAX_BYTES / 3) * 4) return false;
  const encoded = source.slice(PREFIX.length);
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(encoded)) return false;
  let bytes: Uint8Array;
  try {
    const decoded = atob(encoded);
    if (btoa(decoded) !== encoded || decoded.length > MAX_BYTES) return false;
    bytes = Uint8Array.from(decoded, value => value.charCodeAt(0));
  } catch { return false; }
  if (bytes.length < 57 || SIGNATURE.some((value, index) => bytes[index] !== value)) return false;
  let offset = 8; let header = false; let data = false; let dataEnded = false;
  while (offset + 12 <= bytes.length) {
    const length = uint32(bytes, offset);
    const end = offset + 8 + length;
    if (end + 4 > bytes.length) return false;
    const name = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (crc32(bytes, offset + 4, end) !== uint32(bytes, end)) return false;
    if (name === 'IHDR') {
      if (header || offset !== 8 || length !== 13) return false;
      const width = uint32(bytes, offset + 8); const height = uint32(bytes, offset + 12);
      if (width < 1 || width > 32 || height < 1 || height > 32 || bytes[offset + 16] !== 8
        || ![2, 6].includes(bytes[offset + 17]!) || bytes[offset + 18] !== 0 || bytes[offset + 19] !== 0 || bytes[offset + 20] !== 0) return false;
      header = true;
    } else if (!header) return false;
    else if (name === 'IDAT') { if (dataEnded || length === 0) return false; data = true; }
    else if (name === 'IEND') return data && length === 0 && end + 4 === bytes.length;
    else {
      if (!ANCILLARY.has(name)) return false;
      if (data) dataEnded = true;
    }
    offset = end + 4;
  }
  return false;
}

/** Base64url is an injective CSS identifier encoding for this fixed PNG MIME type. */
export function listLabelImageIdentifier(source: string, text: string): string {
  let prefix = '';
  for (let index = 0; index < text.length; index++) prefix += text.charCodeAt(index).toString(16).padStart(4, '0');
  return `dm-ll-png-${prefix}-z-${source.slice(PREFIX.length).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')}`;
}
