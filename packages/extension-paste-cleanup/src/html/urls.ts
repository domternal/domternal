/** Resolve against the declared source, never the receiving page or a pasted base tag. */
export function safeLink(value: unknown, sourceURL?: string): string | undefined {
  if (typeof value !== 'string') return undefined;
  for (const char of value) {
    if (char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127) return undefined;
  }
  try {
    let base: URL | undefined;
    if (sourceURL !== undefined) {
      const candidate = new URL(sourceURL);
      if (candidate.protocol === 'http:' || candidate.protocol === 'https:') base = candidate;
    }
    // Fragment links need a destination anchor mapping, which this HTML stage does not have.
    if (value.startsWith('#')) return undefined;
    const url = new URL(value, base);
    if (!['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol)) return undefined;
    if (url.username !== '' || url.password !== '') return undefined;
    return url.href;
  } catch { return undefined; }
}

/** Raster data only. SVG, blob, local file, and external clipboard references are never durable assets. */
export function safeImage(value: unknown, allowRemote: boolean, allowData: boolean, consumePixels?: (pixels: number) => boolean): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (allowRemote && /^https?:\/\//i.test(value)) {
    const url = safeLink(value);
    if (url !== undefined) return url;
  }
  if (!allowData) return undefined;
  const match = /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(value);
  if (match === null) return undefined;
  const data = match[2] ?? '';
  if (data.length % 4 !== 0) return undefined;
  // The input length bound also limits decoded bytes. Verify the declared format.
  let bytes: string;
  try { bytes = atob(data); } catch { return undefined; }
  return boundedRaster(bytes, match[1]?.toLowerCase() ?? '', consumePixels) ? value : undefined;
}
import { boundedRaster } from './raster.js';
