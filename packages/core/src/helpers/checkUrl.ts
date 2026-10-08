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
 *   credentials in a web, mail or phone address, where they read as the
 *   host, a control character or a bidi embedding,
 *   override or isolate anywhere, an invisible format character or bidi mark
 *   in the scheme, the host or the address of a scheme without a host, where
 *   a percent-encoded one counts too (the address is everything before the
 *   query, and for `mailto:` also the `to`, `cc` and `bcc` fields), or a
 *   value that is not a string. A `mailto:`, `tel:` or `sms:` link without
 *   right-to-left letters may hold LRM, LRE, LRI, PDF and PDI, which
 *   right-to-left environments write to keep it left to right.
 * - `unsupported`: the value is harmless but these options do not allow it:
 *   another scheme, a relative or network-path reference, a backslash, an
 *   `&` where a character reference could spell a scheme or a host, an
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
// A user before the host of these reads as the host itself, as in
// https://google.com@evil.example. Other schemes name a user as their
// standard form, such as ssh://git@host/repo.git or ftp://anonymous@host/.
const CREDENTIAL_SCHEMES = new Set(['http:', 'https:', 'ws:', 'wss:', 'mailto:', 'tel:']);
// Mail, phone and message addresses, which their handler shows to the reader.
const ADDRESS_SCHEMES = new Set(['mailto:', 'tel:', 'sms:']);
/**
 * The bidi controls that only keep text left to right: LRM, LRE and LRI, and
 * the PDF and PDI that end an embedding or isolate. Right-to-left
 * environments write them around a phone number or mail address so it reads
 * in its own order, and in text without right-to-left letters none of them
 * changes the order it is shown in. RLM, ALM, RLE, RLO, LRO, RLI and FSI do,
 * even in a phone number, so they stay unsafe.
 */
const LEFT_TO_RIGHT_CONTROLS = /[\u200e\u202a\u202c\u2066\u2069]/g;
/** A character of a right-to-left script, whose order a left-to-right control can change. */
const RIGHT_TO_LEFT_SCRIPT = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufefe\u{10800}-\u{10fff}\u{1e800}-\u{1efff}]/u;
const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
/**
 * An `&` that starts a character reference: a numeric one, which HTML reads
 * without its `;` too, or a name and a `;`. The names HTML reads without a
 * `;` are the legacy Latin-1 ones, none of which spells a `:`, `/` or `\`.
 */
const CHARACTER_REFERENCE = /&(?:#|[a-z][a-z0-9]*;)/i;
const REFERENCE_AFTER_LEADING_SLASH = /^[/\\]&(?:#|[a-z][a-z0-9]*;)/i;
const RELATIVE_BASE = 'https://relative.invalid/';
const RELATIVE_ORIGIN = 'https://relative.invalid';

/** A scheme spelled as the URL parser reports it: lower case with a trailing colon. */
export function normalizeUrlProtocol(protocol: string): string {
  const lower = protocol.toLowerCase();
  return lower.endsWith(':') ? lower : `${lower}:`;
}

/** Strips what browsers strip before parsing an address: outer controls and spaces, inner tabs and line breaks. */
export function cleanUrl(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value.charCodeAt(start) <= 0x20) start++;
  while (end > start && value.charCodeAt(end - 1) <= 0x20) end--;
  const trimmed = start === 0 && end === value.length ? value : value.slice(start, end);
  return /[\t\n\r]/.test(trimmed) ? trimmed.replace(/[\t\n\r]/g, '') : trimmed;
}

/**
 * Controls, the bidi embeddings, overrides and isolates, the noncharacters
 * U+FFFE and U+FFFF, and unpaired surrogates: characters that hide or reorder
 * what a reader sees of an address wherever they stand.
 */
// Unicode mode reads a valid surrogate pair as one astral code point, so the
// surrogate range matches only unpaired units. The native scan avoids a JS
// branch for every code unit in a large Unicode path, including under coverage.
const HIDDEN_CHARACTER = /[\p{Cc}\u202a-\u202e\u2066-\u2069\ud800-\udfff\ufffe\uffff]/u;

function hasHiddenCharacter(value: string): boolean {
  return HIDDEN_CHARACTER.test(value);
}

/**
 * The invisible format characters (Unicode Cf), such as the zero-width
 * joiners of Persian, Arabic, Indic and emoji text, the bidi marks, the soft
 * hyphen and the tag characters. Browsers percent-encode them in a path,
 * query or fragment, where they are ordinary text, but in a scheme, a host or
 * the address of a scheme without a host they hide what a reader sees, even
 * where a URL parser drops them from a host.
 */
const FORMAT_CHARACTER = /\p{Cf}/u;

/**
 * The part of an address that says where it leads: the scheme and the
 * authority, such as `https://host:port`. A relative reference says it only
 * as a network path (`//host`), or where its first segment holds a colon and
 * so reads as a scheme to some consumers; any other relative reference stays
 * on the page. A scheme without an authority is judged by `addressOf`.
 */
function destinationOf(url: string, schemeLength: number): string {
  if (schemeLength === 0 && !/^[/\\]{2}/.test(url)) {
    const end = url.search(/[/\\?#]/);
    const firstSegment = end < 0 ? url : url.slice(0, end);
    return firstSegment.includes(':') ? firstSegment : '';
  }
  let start = schemeLength;
  while (url[start] === '/' || url[start] === '\\') start++;
  const end = url.slice(start).search(/[/\\?#]/);
  return end < 0 ? url : url.slice(0, start + end);
}

/**
 * The address of a scheme without an authority, such as `mailto:` or `tel:`,
 * as its handler reads it: everything before the query or fragment, where a
 * `/` means nothing, and for `mailto:` also the `to`, `cc` and `bcc` fields,
 * which name recipients too.
 */
function addressOf(url: string, scheme: string): string {
  let address = beforeQuery(url);
  const query = url.indexOf('?');
  if (scheme === 'mailto:' && query >= 0) {
    for (const field of url.slice(query + 1).split('&')) {
      const equals = field.indexOf('=');
      if (equals > 0 && /^(?:to|cc|bcc)$/i.test(percentDecoded(field.slice(0, equals)))) address += ` ${field.slice(equals + 1)}`;
    }
  }
  return address;
}

/**
 * `value` with every run of percent-encoded bytes read as UTF-8, and a
 * malformed sequence as U+FFFD, as a mail client or dialer reads an address.
 * A leading byte order mark is kept, as it is a character of the address.
 */
function percentDecoded(value: string): string {
  if (!value.includes('%')) return value;
  const decoder = new TextDecoder('utf-8', { ignoreBOM: true });
  return value.replace(/(?:%[\da-f]{2})+/gi, run => decoder.decode(new Uint8Array(run.slice(1).split('%').map(hex => parseInt(hex, 16)))));
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
 * The policy guards against script and deception, so any release can change
 * it: an address allowed before can be refused once a new way to hide a
 * scheme or a host is known. Check a stored address where you use it instead
 * of keeping an earlier answer.
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
  const url = cleanUrl(value);
  if (url === '') return UNSUPPORTED;
  const {
    protocols = DEFAULT_PROTOCOLS,
    allowRelative = false,
    allowNetworkPath = false,
    allowDataImages = false,
  } = options;
  const match = SCHEME.exec(url);
  const scheme = match ? normalizeUrlProtocol(match[1] ?? '') : null;
  const schemeLength = match?.[0].length ?? 0;
  // A scheme without an authority, such as mailto: or tel:, hands its whole
  // address to a handler that decodes it, so the decoded address is judged.
  const opaque = scheme !== null && scheme !== 'data:' && !SPECIAL_SCHEMES.has(scheme) && !url.startsWith('//', schemeLength);
  // A mail, phone or message link without right-to-left letters may hold the
  // controls that keep it left to right; they are left out of the judgment.
  const decodedLink = opaque && ADDRESS_SCHEMES.has(scheme) ? percentDecoded(url) : '';
  const leftToRight = /[^ -~]/.test(decodedLink) && !RIGHT_TO_LEFT_SCRIPT.test(decodedLink);
  const judged = leftToRight ? url.replace(LEFT_TO_RIGHT_CONTROLS, '') : url;
  // Printable ASCII, such as the body of a data image, holds no hidden
  // character; one pattern test settles it several times faster than the scan.
  if (/[^ -~]/.test(judged) && hasHiddenCharacter(judged)) return UNSAFE;
  const destination = percentDecoded(opaque ? addressOf(judged, scheme) : destinationOf(judged, schemeLength));
  const shown = leftToRight ? destination.replace(LEFT_TO_RIGHT_CONTROLS, '') : destination;
  if (/[^ -~]/.test(shown) && (hasHiddenCharacter(shown) || FORMAT_CHARACTER.test(shown))) return UNSAFE;

  if (!allowNetworkPath && (scheme === null || SPECIAL_SCHEMES.has(scheme)) && beforeQuery(url).includes('\\')) {
    return UNSUPPORTED;
  }

  if (scheme !== null) {
    if (SCRIPT_SCHEMES.has(scheme)) return UNSAFE;
    if (scheme === 'data:') {
      if (!allowDataImages || !isImageData(url)) return UNSAFE;
      // An image media type follows the colon, so the parser reads an opaque
      // path that it never rejects and that holds no host or credentials. A
      // long image need not be parsed on every render.
      return { status: 'allowed', url };
    }
    if (!allowedScheme(scheme, protocols)) return UNSUPPORTED;
    const parsed = parse(url);
    if (parsed === null) return UNSUPPORTED;
    // A web host never holds `%` once parsed; Chromium keeps an invalid one percent-encoded
    // where other parsers reject it, so this keeps the decision the same everywhere. The
    // host of another scheme, such as myapp://my%20host, keeps its encoding.
    if (SPECIAL_SCHEMES.has(scheme) && parsed.hostname.includes('%')) return UNSUPPORTED;
    // No real host holds `&`, and `&#64;` there reads as `@` wherever HTML is decoded.
    if (parsed.hostname.includes('&')) return UNSUPPORTED;
    if (CREDENTIAL_SCHEMES.has(scheme) && (parsed.username !== '' || parsed.password !== '')) return UNSAFE;
    return { status: 'allowed', url };
  }

  if (!allowRelative) return UNSUPPORTED;
  const networkPath = /^[/\\]{2}/.test(url);
  if (networkPath && !allowNetworkPath) return UNSUPPORTED;
  // RFC 3986 path-noscheme: a colon in the first segment reads as a scheme to
  // some consumers and hides a look-alike one, such as a fullwidth letter.
  // HTML that leaves `&` unescaped in an attribute, as linkedom writes it, is
  // read with its character references decoded, so a reference there, as in
  // `javascript&colon;` or `&#106;avascript:`, could spell a scheme, and one
  // right after the leading slash, as in `/&#47;host`, a network path. An `&`
  // that starts no reference, as in `R&D.png`, stays text: without a `;` only
  // the legacy names are read, as Latin-1 letters and signs.
  const firstSegmentEnd = url.search(/[/\\?#]/);
  const firstSegment = url.slice(0, firstSegmentEnd < 0 ? url.length : firstSegmentEnd);
  // The `#` of a numeric reference, as in `&#106;avascript:`, ends the segment
  // for the URL parser but not for the HTML decoder, so the test reaches it.
  if (firstSegment.includes(':') || CHARACTER_REFERENCE.test(url.slice(0, firstSegment.length + 1))) return UNSUPPORTED;
  if (!allowNetworkPath && REFERENCE_AFTER_LEADING_SLASH.test(url)) return UNSUPPORTED;
  const resolved = parse(url, RELATIVE_BASE);
  if (resolved === null || resolved.hostname.includes('%') || resolved.hostname.includes('&')) return UNSUPPORTED;
  if (!allowNetworkPath && resolved.origin !== RELATIVE_ORIGIN) return UNSUPPORTED;
  if (resolved.username !== '' || resolved.password !== '') return UNSAFE;
  return { status: 'allowed', url };
}
