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
    // No real host holds `&`, and `&#64;` there reads as `@` wherever HTML is decoded.
    if (url.hostname.includes('&')) return undefined;
    if ((url.protocol === 'mailto:' || url.protocol === 'tel:') && hidesCharacter(url.href, url.protocol)) return undefined;
    return url.href;
  } catch { return undefined; }
}

/** Controls, invisible format characters and the noncharacters U+FFFE and U+FFFF. */
const HIDDEN_CHARACTER = /[\p{Cc}\p{Cf}\ufffe\uffff]/u;

/**
 * Whether a mail or phone address hides a character from the reader once the
 * mail client or dialer decodes it, judged at least as strictly as the core URL
 * policy: everything before the query, and for `mailto:` also the `to`, `cc`
 * and `bcc` fields.
 */
function hidesCharacter(href: string, protocol: string): boolean {
  const end = href.search(/[?#]/);
  let address = end < 0 ? href : href.slice(0, end);
  const query = href.indexOf('?');
  if (protocol === 'mailto:' && query >= 0) {
    for (const field of href.slice(query + 1).split('&')) {
      const equals = field.indexOf('=');
      if (equals > 0 && /^(?:to|cc|bcc)$/i.test(percentDecoded(field.slice(0, equals)))) address += ` ${field.slice(equals + 1)}`;
    }
  }
  return HIDDEN_CHARACTER.test(percentDecoded(address));
}

/** `value` with every run of percent-encoded bytes read as UTF-8, a malformed sequence as U+FFFD and a byte order mark kept. */
function percentDecoded(value: string): string {
  if (!value.includes('%')) return value;
  const decoder = new TextDecoder('utf-8', { ignoreBOM: true });
  return value.replace(/(?:%[\da-f]{2})+/gi, run => decoder.decode(new Uint8Array(run.slice(1).split('%').map(hex => parseInt(hex, 16)))));
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
