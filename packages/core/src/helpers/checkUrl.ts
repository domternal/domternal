/**
 * The URL policy: one decision for every link and image address the editor
 * stores, renders or opens.
 *
 * A value is first cleaned the way browsers read an address: leading and
 * trailing C0 controls and spaces are stripped, then every tab and line break
 * is removed. The decision is made on that cleaned spelling, so an address
 * that hides a scheme behind such characters is judged by the scheme the
 * browser would see.
 */

/** Options of {@link checkUrl} and {@link isValidUrl}. */
export interface UrlPolicyOptions {
  /**
   * The schemes an absolute address may use, such as `'https:'`. Entries are
   * compared in lower case, with or without the trailing colon. `'any'`
   * allows every scheme except the script schemes, `data:` and `file:`.
   * `javascript:` and `vbscript:` are never allowed, and `data:` only as an
   * image with `allowDataImages`.
   * @default ['http:', 'https:']
   */
  readonly protocols?: readonly string[] | 'any';
  /**
   * Allows relative references: `/path`, `./page`, `../page`, `page.html`,
   * `?query` and `#fragment`. A reference whose first segment holds a colon,
   * such as `localhost:3000` without a scheme the browser would read, is refused.
   * @default false
   */
  readonly allowRelative?: boolean;
  /**
   * Allows network-path references (`//host/path`) and backslashes, which
   * browsers read as slashes in web addresses. Meant for image sources.
   * @default false
   */
  readonly allowNetworkPath?: boolean;
  /**
   * Allows `data:` addresses whose media type is an image, such as
   * `data:image/png;base64,...`. Meant for image sources.
   * @default false
   */
  readonly allowDataImages?: boolean;
}

/**
 * The result of {@link checkUrl}.
 *
 * - `allowed`: `url` is the cleaned spelling to render and open.
 * - `unsafe`: the value can run script or deceive: a `javascript:` or
 *   `vbscript:` address, a `data:` address the options do not allow,
 *   credentials in the address, a hidden control, bidi or format character,
 *   or a value that is not a string.
 * - `unsupported`: the value is harmless but these options do not allow it:
 *   another scheme, a relative or network-path reference, a backslash, an
 *   address the URL parser rejects, or an empty value, null or undefined.
 */
export type UrlCheck =
  | { readonly status: 'allowed'; readonly url: string }
  | { readonly status: 'unsupported' | 'unsafe' };

const DEFAULT_PROTOCOLS: readonly string[] = ['http:', 'https:'];
const UNSUPPORTED: UrlCheck = Object.freeze({ status: 'unsupported' });
const UNSAFE: UrlCheck = Object.freeze({ status: 'unsafe' });
const SCRIPT_SCHEMES = new Set(['javascript:', 'vbscript:']);
// Browsers read a backslash as a slash in these schemes and in relative references.
const SPECIAL_SCHEMES = new Set(['http:', 'https:', 'ws:', 'wss:', 'ftp:', 'file:']);
const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const RELATIVE_BASE = 'https://relative.invalid/';
const RELATIVE_ORIGIN = 'https://relative.invalid';

/** A scheme spelled as the URL parser reports it: lower case with a trailing colon. */
export function normalizeUrlProtocol(protocol: string): string {
  const lower = protocol.toLowerCase();
  return lower.endsWith(':') ? lower : `${lower}:`;
}

/** Strips what browsers strip before parsing an address. */
function clean(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value.charCodeAt(start) <= 0x20) start++;
  while (end > start && value.charCodeAt(end - 1) <= 0x20) end--;
  const trimmed = start === 0 && end === value.length ? value : value.slice(start, end);
  return /[\t\n\r]/.test(trimmed) ? trimmed.replace(/[\t\n\r]/g, '') : trimmed;
}

/**
 * Controls, bidi controls, invisible format characters, the noncharacters
 * U+FFFE and U+FFFF, and unpaired surrogates: characters that hide or reorder
 * what a reader sees of an address.
 */
function hasHiddenCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x61c
      || (code >= 0x200b && code <= 0x200f) || (code >= 0x202a && code <= 0x202e)
      || (code >= 0x2060 && code <= 0x2064) || (code >= 0x2066 && code <= 0x2069)
      || code === 0xfeff || code === 0xfffe || code === 0xffff) {
      return true;
    }
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        index++;
        continue;
      }
      return true;
    }
    if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}

/** The part of an address before its query or fragment. */
function beforeQuery(value: string): string {
  const end = value.search(/[?#]/);
  return end < 0 ? value : value.slice(0, end);
}

function parse(value: string, base?: string): URL | null {
  try {
    return new URL(value, base);
  } catch {
    return null;
  }
}

function allowedScheme(scheme: string, protocols: readonly string[] | 'any'): boolean {
  if (protocols === 'any') return scheme !== 'file:';
  return protocols.some(entry => typeof entry === 'string' && normalizeUrlProtocol(entry) === scheme);
}

function isImageData(url: string): boolean {
  const end = url.slice(5).search(/[;,]/);
  const mediaType = (end < 0 ? url.slice(5) : url.slice(5, 5 + end)).trim().toLowerCase();
  return mediaType.startsWith('image/');
}

/**
 * Decides whether an address may be stored, rendered and opened, and returns
 * the cleaned spelling to use when it may.
 *
 * @example
 * ```ts
 * checkUrl(' https://example.com/');                   // { status: 'allowed', url: 'https://example.com/' }
 * checkUrl('java\tscript:alert(1)');                   // { status: 'unsafe' }
 * checkUrl('ftp://example.com/');                      // { status: 'unsupported' }
 * checkUrl('#intro', { allowRelative: true });         // { status: 'allowed', url: '#intro' }
 * ```
 */
export function checkUrl(value: unknown, options: UrlPolicyOptions = {}): UrlCheck {
  if (typeof value !== 'string') return value === null || value === undefined ? UNSUPPORTED : UNSAFE;
  const url = clean(value);
  if (url === '') return UNSUPPORTED;
  if (hasHiddenCharacter(url)) return UNSAFE;
  const {
    protocols = DEFAULT_PROTOCOLS,
    allowRelative = false,
    allowNetworkPath = false,
    allowDataImages = false,
  } = options;
  const match = SCHEME.exec(url);
  const scheme = match ? normalizeUrlProtocol(match[1] ?? '') : null;

  if (!allowNetworkPath && (scheme === null || SPECIAL_SCHEMES.has(scheme)) && beforeQuery(url).includes('\\')) {
    return UNSUPPORTED;
  }

  if (scheme !== null) {
    if (SCRIPT_SCHEMES.has(scheme)) return UNSAFE;
    if (scheme === 'data:') {
      if (!allowDataImages || !isImageData(url)) return UNSAFE;
    } else if (!allowedScheme(scheme, protocols)) {
      return UNSUPPORTED;
    }
    const parsed = parse(url);
    // A host never holds `%` once parsed; Chromium keeps an invalid host percent-encoded
    // where other parsers reject it, so this keeps the decision the same everywhere.
    if (parsed === null || parsed.hostname.includes('%')) return UNSUPPORTED;
    if (parsed.username !== '' || parsed.password !== '') return UNSAFE;
    return { status: 'allowed', url };
  }

  if (!allowRelative) return UNSUPPORTED;
  const networkPath = /^[/\\]{2}/.test(url);
  if (networkPath && !allowNetworkPath) return UNSUPPORTED;
  // RFC 3986 path-noscheme: a colon in the first segment reads as a scheme to
  // some consumers and hides a look-alike one, such as a fullwidth letter.
  const firstSegment = url.search(/[/\\?#]/);
  if (url.slice(0, firstSegment < 0 ? url.length : firstSegment).includes(':')) return UNSUPPORTED;
  const resolved = parse(url, RELATIVE_BASE);
  if (resolved === null || resolved.hostname.includes('%')) return UNSUPPORTED;
  if (!allowNetworkPath && resolved.origin !== RELATIVE_ORIGIN) return UNSUPPORTED;
  if (resolved.username !== '' || resolved.password !== '') return UNSAFE;
  return { status: 'allowed', url };
}
