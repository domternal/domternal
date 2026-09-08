/**
 * Test data for the URL policy, shared by the unit tests and the browser
 * parity suite (e2e/link-security.browser.ts), so Node and every browser
 * judge the same values. Nothing in the package imports it.
 */
import type { UrlPolicyOptions } from './checkUrl.js';

export type UrlStatus = 'allowed' | 'unsupported' | 'unsafe';

export interface UrlCorpusRow {
  /** The row of the edge-case matrix, such as 'A5'. */
  readonly id: string;
  readonly value: unknown;
  /** The default Link profile: http, https, mailto and tel, relative references allowed. */
  readonly link: UrlStatus;
  /** The cleaned spelling when a profile allows the value; the value itself when omitted. */
  readonly url?: string;
  /** The Link profile without relative references; `link` when omitted, except for relative rows. */
  readonly absolute?: UrlStatus;
  /** The image profile with data images allowed, then without. */
  readonly image: readonly [withDataImages: UrlStatus, withoutDataImages: UrlStatus];
  /** Whether a browser reads the value as a script address, which every consumer must refuse. */
  readonly script?: boolean;
}

export const LINK_PROFILE: UrlPolicyOptions = {
  protocols: ['http:', 'https:', 'mailto:', 'tel:'],
  allowRelative: true,
};

export const ABSOLUTE_LINK_PROFILE: UrlPolicyOptions = { ...LINK_PROFILE, allowRelative: false };

export const imageProfile = (allowDataImages: boolean): UrlPolicyOptions => ({
  protocols: 'any',
  allowRelative: true,
  allowNetworkPath: true,
  allowDataImages,
});

const ALLOWED = ['allowed', 'allowed'] as const;
const UNSAFE = ['unsafe', 'unsafe'] as const;
const UNSUPPORTED = ['unsupported', 'unsupported'] as const;
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

export const URL_CORPUS: readonly UrlCorpusRow[] = [
  // Web addresses as written.
  { id: 'A1', value: 'https://example.com/', link: 'allowed', image: ALLOWED },
  { id: 'A1', value: 'HTTPS://EXAMPLE.COM/', link: 'allowed', image: ALLOWED },
  { id: 'A1', value: 'http://example.com', link: 'allowed', image: ALLOWED },
  { id: 'A1', value: 'https://example.com/a?b=c&d=e#f', link: 'allowed', image: ALLOWED },
  // Characters browsers strip around an address, and tabs and line breaks they remove inside it.
  { id: 'A2', value: ' https://example.com/', url: 'https://example.com/', link: 'allowed', image: ALLOWED },
  { id: 'A2', value: 'https://example.com/ ', url: 'https://example.com/', link: 'allowed', image: ALLOWED },
  { id: 'A2', value: '\u0001https://x.example/', url: 'https://x.example/', link: 'allowed', image: ALLOWED },
  { id: 'A2', value: '\u0000 \u001f https://x.example/ \u0000', url: 'https://x.example/', link: 'allowed', image: ALLOWED },
  { id: 'A3', value: 'https://exa\nmple.com/', url: 'https://example.com/', link: 'allowed', image: ALLOWED },
  { id: 'A3', value: 'https://x.example/\tpath\r', url: 'https://x.example/path', link: 'allowed', image: ALLOWED },
  { id: 'A4', value: 'mailto:a@b.example', link: 'allowed', image: ALLOWED },
  { id: 'A4', value: 'tel:+385123', link: 'allowed', image: ALLOWED },
  { id: 'A4', value: 'tel:+1 234', link: 'allowed', image: ALLOWED },
  { id: 'A4', value: 'mailto:a\\b@x.example', link: 'allowed', image: ALLOWED },
  // Script addresses, however they are spelled.
  { id: 'A5', value: 'javascript:alert(1)', link: 'unsafe', image: UNSAFE, script: true },
  { id: 'A5', value: 'JaVaScRiPt:alert(1)', link: 'unsafe', image: UNSAFE, script: true },
  { id: 'A5', value: ' javascript:alert(1)', link: 'unsafe', image: UNSAFE, script: true },
  { id: 'A5', value: '\u0001javascript:alert(1)', link: 'unsafe', image: UNSAFE, script: true },
  { id: 'A5', value: 'java\tscr\nipt:alert(1)', link: 'unsafe', image: UNSAFE, script: true },
  { id: 'A5', value: 'java\rscript:alert(1)', link: 'unsafe', image: UNSAFE, script: true },
  { id: 'A5', value: 'javascript://%0aalert(1)', link: 'unsafe', image: UNSAFE, script: true },
  { id: 'A5', value: 'javascript:alert%281%29', link: 'unsafe', image: UNSAFE, script: true },
  // Hidden characters: a browser may read these differently from what a reader sees.
  { id: 'A6', value: 'java\u0000script:alert(1)', link: 'unsafe', image: UNSAFE },
  { id: 'A6', value: 'java\u200bscript:alert(1)', link: 'unsafe', image: UNSAFE },
  { id: 'A6', value: '\u202ehttps://x.example/', link: 'unsafe', image: UNSAFE },
  { id: 'A6', value: 'https://x.example/\u2066a', link: 'unsafe', image: UNSAFE },
  { id: 'A6', value: 'https://x.example/\u0085', link: 'unsafe', image: UNSAFE },
  { id: 'A6', value: 'https://x.example/\u007f', link: 'unsafe', image: UNSAFE },
  { id: 'A6', value: 'https://x.\u200bexample/', link: 'unsafe', image: UNSAFE },
  { id: 'A6', value: 'https://x.example/\ud800', link: 'unsafe', image: UNSAFE },
  { id: 'A6', value: 'https://x.example/\udc00', link: 'unsafe', image: UNSAFE },
  { id: 'A7', value: 'vbscript:msgbox(1)', link: 'unsafe', image: UNSAFE, script: true },
  { id: 'A7', value: 'VBScript:msgbox(1)', link: 'unsafe', image: UNSAFE, script: true },
  // Data addresses: script documents never, images only where the options allow them.
  { id: 'A8', value: 'data:text/html,<script>alert(1)</script>', link: 'unsafe', image: UNSAFE, script: true },
  { id: 'A8', value: 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==', link: 'unsafe', image: UNSAFE, script: true },
  { id: 'A8', value: 'data:,image/png', link: 'unsafe', image: UNSAFE },
  { id: 'A9', value: `data:image/png;base64,${PNG}`, link: 'unsafe', image: ['allowed', 'unsafe'] },
  { id: 'A9', value: ` data:image/png;base64,${PNG}`, url: `data:image/png;base64,${PNG}`, link: 'unsafe', image: ['allowed', 'unsafe'] },
  { id: 'A9', value: `da\nta:image/png;base64,${PNG}`, url: `data:image/png;base64,${PNG}`, link: 'unsafe', image: ['allowed', 'unsafe'] },
  { id: 'A9', value: `DATA:IMAGE/PNG;base64,${PNG}`, link: 'unsafe', image: ['allowed', 'unsafe'] },
  { id: 'A10', value: 'data:image/svg+xml,<svg onload=alert(1)>', link: 'unsafe', image: ['allowed', 'unsafe'] },
  // Credentials make an address read as another host.
  { id: 'A11', value: 'https://user:pass@example.com/', link: 'unsafe', image: UNSAFE },
  { id: 'A11', value: 'https://google.com@evil.example/', link: 'unsafe', image: UNSAFE },
  { id: 'A11', value: '//user:pass@cdn.example/x.png', link: 'unsupported', image: UNSAFE },
  { id: 'A11', value: 'https:google.com@evil.example', link: 'unsafe', image: UNSAFE },
  { id: 'A11', value: 'wss://user@example.com/', link: 'unsupported', image: UNSAFE },
  { id: 'A11', value: 'mailto://google.com@evil.example', link: 'unsafe', image: UNSAFE },
  // A user is the standard form of schemes without a web page, such as ssh: or ftp:, and names no host.
  { id: 'A11', value: 'ftp://anonymous@ftp.example/pub/', link: 'unsupported', image: ALLOWED },
  { id: 'A11', value: 'ssh://git@github.com/org/repo.git', link: 'unsupported', image: ALLOWED },
  { id: 'A12', value: 'file:///etc/passwd', link: 'unsupported', image: UNSUPPORTED },
  { id: 'A12', value: 'FILE:///C:/x.png', link: 'unsupported', image: UNSUPPORTED },
  { id: 'A13', value: 'blob:https://example.com/0000', link: 'unsupported', image: ALLOWED },
  { id: 'A13', value: 'about:blank', link: 'unsupported', image: ALLOWED },
  { id: 'A13', value: 'ftp://x.example/f', link: 'unsupported', image: ALLOWED },
  { id: 'A13', value: 'sms:+385', link: 'unsupported', image: ALLOWED },
  { id: 'A13', value: 'myapp://open', link: 'unsupported', image: ALLOWED },
  // A host of a scheme without a web host keeps its percent-encoding; an `&` there is still refused (A30).
  { id: 'A13', value: 'myapp://my%20host/path', link: 'unsupported', image: ALLOWED },
  { id: 'A13', value: 'myapp://a&#64;b/path', link: 'unsupported', image: UNSUPPORTED },
  // Relative references.
  { id: 'A14', value: '/path/page', link: 'allowed', absolute: 'unsupported', image: ALLOWED },
  { id: 'A14', value: './page', link: 'allowed', absolute: 'unsupported', image: ALLOWED },
  { id: 'A14', value: '../page', link: 'allowed', absolute: 'unsupported', image: ALLOWED },
  { id: 'A14', value: 'page.html', link: 'allowed', absolute: 'unsupported', image: ALLOWED },
  { id: 'A14', value: '?q=1', link: 'allowed', absolute: 'unsupported', image: ALLOWED },
  { id: 'A14', value: '#section', link: 'allowed', absolute: 'unsupported', image: ALLOWED },
  { id: 'A14', value: '/path#id', link: 'allowed', absolute: 'unsupported', image: ALLOWED },
  { id: 'A14', value: '/a:b', link: 'allowed', absolute: 'unsupported', image: ALLOWED },
  { id: 'A16', value: '//evil.example/x', link: 'unsupported', image: ALLOWED },
  // Backslashes read as slashes in web addresses and relative references.
  { id: 'A17', value: '\\\\evil.example\\x', link: 'unsupported', image: ALLOWED },
  { id: 'A17', value: '/\\evil.example', link: 'unsupported', image: ALLOWED },
  { id: 'A17', value: 'https:\\\\evil.example', link: 'unsupported', image: ALLOWED },
  { id: 'A17', value: 'images\\x.png', link: 'unsupported', image: ALLOWED },
  { id: 'A17', value: 'https://x.example/?a\\b', link: 'allowed', image: ALLOWED },
  { id: 'A17', value: 'https://x.example/#a\\b', link: 'allowed', image: ALLOWED },
  // A scheme without slashes: on a page of another scheme it reads as https://evil.example/, on an
  // https page as the relative path evil.example. Either way an allowed scheme, never a script.
  { id: 'A18', value: 'https:evil.example', link: 'allowed', image: ALLOWED },
  // Look-alikes of a scheme: without a real scheme they read as a path, which the colon rule refuses.
  { id: 'A19', value: '%6Aavascript:alert(1)', link: 'unsupported', image: UNSUPPORTED },
  { id: 'A19', value: '\uff4aavascript:alert(1)', link: 'unsupported', image: UNSUPPORTED },
  { id: 'A19', value: 'j\u0430vascript:alert(1)', link: 'unsupported', image: UNSUPPORTED },
  { id: 'A19', value: 'javascript :x', link: 'unsupported', image: UNSUPPORTED },
  { id: 'A19', value: '\u00a0javascript:x', link: 'unsupported', image: UNSUPPORTED },
  { id: 'A19', value: 'localhost:3000', link: 'unsupported', image: ALLOWED },
  { id: 'A19', value: '1abc:x', link: 'unsupported', image: UNSUPPORTED },
  { id: 'A20', value: 'javascript%3Aalert(1)', link: 'allowed', absolute: 'unsupported', image: ALLOWED },
  // Character references: HTML that leaves `&` unescaped in an attribute, as linkedom writes it, is
  // decoded by the browser that reads it, so `&colon;` or `&#106;` there spells a scheme. An `&` that
  // starts a reference (`&#`, or a name and `;`) in the first segment of a relative reference or after
  // its leading slash is refused, and any `&` in a host.
  { id: 'A30', value: 'javascript&colon;alert(1)', link: 'unsupported', image: UNSUPPORTED },
  { id: 'A30', value: '&#106;avascript:alert(1)', link: 'unsupported', image: UNSUPPORTED },
  { id: 'A30', value: '&#x6A;avascript&#x3A;alert(1)', link: 'unsupported', image: UNSUPPORTED },
  { id: 'A30', value: 'javascript&#58;alert(1)', link: 'unsupported', image: UNSUPPORTED },
  { id: 'A30', value: '&Tab;javascript:alert(1)', link: 'unsupported', image: UNSUPPORTED },
  { id: 'A30', value: `&#100;ata:image/png;base64,${PNG}`, link: 'unsupported', image: UNSUPPORTED },
  { id: 'A30', value: '/&#47;evil.example/x', link: 'unsupported', image: ALLOWED },
  { id: 'A30', value: '/&sol;evil.example/x', link: 'unsupported', image: ALLOWED },
  { id: 'A30', value: 'https://a.example&#64;evil.example/', link: 'unsupported', image: UNSUPPORTED },
  { id: 'A30', value: 'https://a.example&commat;evil.example/', link: 'unsupported', image: UNSUPPORTED },
  { id: 'A30', value: 'https:&#47;&#47;evil.example/', link: 'unsupported', image: UNSUPPORTED },
  { id: 'A30', value: 'javascript&#58alert(1)', link: 'unsupported', image: UNSUPPORTED },
  { id: 'A30', value: 'javascript&#x3a;alert(1)', link: 'unsupported', image: UNSUPPORTED },
  { id: 'A30', value: '/&bsol;evil.example/x', link: 'unsupported', image: ALLOWED },
  { id: 'A30', value: 'R&amp;D.png', link: 'unsupported', image: UNSUPPORTED },
  // An `&` that starts no reference stays text wherever HTML is decoded: without a `;` only the legacy
  // names are read, as Latin-1 letters and signs, never a `:`, `/` or `\`, and none before a letter or
  // digit. So file names that 1.2.0 loaded keep working.
  { id: 'A30', value: 'faq&help.html', link: 'allowed', absolute: 'unsupported', image: ALLOWED },
  { id: 'A30', value: 'R&D-chart.png', link: 'allowed', absolute: 'unsupported', image: ALLOWED },
  { id: 'A30', value: 'Q&A.png', link: 'allowed', absolute: 'unsupported', image: ALLOWED },
  { id: 'A30', value: 'Tom&Jerry.gif', link: 'allowed', absolute: 'unsupported', image: ALLOWED },
  { id: 'A30', value: '&copy2024.png', link: 'allowed', absolute: 'unsupported', image: ALLOWED },
  { id: 'A30', value: 'a&amp.png', link: 'allowed', absolute: 'unsupported', image: ALLOWED },
  { id: 'A30', value: '/&x/y', link: 'allowed', absolute: 'unsupported', image: ALLOWED },
  { id: 'A30', value: '/&lt/y', link: 'allowed', absolute: 'unsupported', image: ALLOWED },
  // An `&` past those places cannot spell a scheme or a host, so queries and paths keep it.
  { id: 'A30', value: '/search?a=1&b=2', link: 'allowed', absolute: 'unsupported', image: ALLOWED },
  { id: 'A30', value: '?q=x&copy;y', link: 'allowed', absolute: 'unsupported', image: ALLOWED },
  { id: 'A30', value: '#a&#58;b', link: 'allowed', absolute: 'unsupported', image: ALLOWED },
  { id: 'A30', value: './a&b.html', link: 'allowed', absolute: 'unsupported', image: ALLOWED },
  { id: 'A30', value: 'docs/a&#58;b', link: 'allowed', absolute: 'unsupported', image: ALLOWED },
  { id: 'A30', value: 'https://example.com/a&b?c=1&amp;d=2#e&f', link: 'allowed', image: ALLOWED },
  { id: 'A30', value: 'mailto:a@b.example?subject=Q&A', link: 'allowed', image: ALLOWED },
  { id: 'A21', value: 'https://exa mple.com', link: 'unsupported', image: UNSUPPORTED },
  { id: 'A21', value: 'https://', link: 'unsupported', image: UNSUPPORTED },
  { id: 'A21', value: 'https://exa%20mple.com/', link: 'unsupported', image: UNSUPPORTED },
  { id: 'A21', value: 'https://exa<mple.com/', link: 'unsupported', image: UNSUPPORTED },
  { id: 'A22', value: '', link: 'unsupported', image: UNSUPPORTED },
  { id: 'A22', value: '   ', link: 'unsupported', image: UNSUPPORTED },
  { id: 'A22', value: '\t\n', link: 'unsupported', image: UNSUPPORTED },
  { id: 'A22', value: null, link: 'unsupported', image: UNSUPPORTED },
  { id: 'A22', value: undefined, link: 'unsupported', image: UNSUPPORTED },
  // Values that are not strings: a renderer would stringify them into an address.
  { id: 'A23', value: ['javascript:alert(1)'], link: 'unsafe', image: UNSAFE },
  { id: 'A23', value: [['javascript:alert(1)']], link: 'unsafe', image: UNSAFE },
  { id: 'A23', value: ['https://example.com/'], link: 'unsafe', image: UNSAFE },
  { id: 'A23', value: 42, link: 'unsafe', image: UNSAFE },
  { id: 'A23', value: true, link: 'unsafe', image: UNSAFE },
  { id: 'A23', value: {}, link: 'unsafe', image: UNSAFE },
  { id: 'A23', value: { toString: () => 'javascript:alert(1)' }, link: 'unsafe', image: UNSAFE },
  // Longer than a diagnostic reports, still classified as usual.
  { id: 'A24', value: `https://example.com/${'a'.repeat(80)}`, link: 'allowed', image: ALLOWED },
  // The joiners and marks of Persian, Arabic, Indic and emoji text are ordinary characters of a path, query or
  // fragment, which browsers percent-encode. In a scheme or a host, or in the address of a scheme without a host,
  // they hide what a reader sees. Bidi embeddings, overrides and isolates stay refused anywhere (A6).
  { id: 'A31', value: 'https://fa.wikipedia.org/wiki/\u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u0645', link: 'allowed', image: ALLOWED },
  { id: 'A31', value: 'https://hi.wikipedia.org/wiki/\u0915\u094d\u200d\u0937', link: 'allowed', image: ALLOWED },
  { id: 'A31', value: 'https://example.com/search?q=\ud83d\udc68\u200d\ud83d\udc69\u200d\ud83d\udc67', link: 'allowed', image: ALLOWED },
  { id: 'A31', value: 'https://example.com/a\u200e\u200f\u061c\u2060\u2064b#c\u200bd\ufeff', link: 'allowed', image: ALLOWED },
  { id: 'A31', value: 'https://x.example/\ufeff', link: 'allowed', image: ALLOWED },
  { id: 'A31', value: 'mailto:a@b.example?subject=\u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u0645', link: 'allowed', image: ALLOWED },
  { id: 'A31', value: '/wiki/\u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u0645', link: 'allowed', absolute: 'unsupported', image: ALLOWED },
  { id: 'A31', value: '\u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u0645.html', link: 'allowed', absolute: 'unsupported', image: ALLOWED },
  { id: 'A31', value: '?q=\u0645\u06cc\u200c', link: 'allowed', absolute: 'unsupported', image: ALLOWED },
  { id: 'A31', value: '#\u200d', link: 'allowed', absolute: 'unsupported', image: ALLOWED },
  { id: 'A31', value: 'data:image/svg+xml,<svg><text>a\u200db</text></svg>', link: 'unsafe', image: ['allowed', 'unsafe'] },
  { id: 'A31', value: 'https://exa\u200dmple.com/', link: 'unsafe', image: UNSAFE },
  { id: 'A31', value: 'https://example.com\u200b/', link: 'unsafe', image: UNSAFE },
  { id: 'A31', value: 'https://example.com:44\u200c3/', link: 'unsafe', image: UNSAFE },
  { id: 'A31', value: 'https://\u200eexample.com', link: 'unsafe', image: UNSAFE },
  { id: 'A31', value: 'https:\u200b//example.com/', link: 'unsafe', image: UNSAFE },
  { id: 'A31', value: 'https:exa\u200bmple.com', link: 'unsafe', image: UNSAFE },
  { id: 'A31', value: 'http\u200bs://example.com/', link: 'unsafe', image: UNSAFE },
  { id: 'A31', value: 'mailto:a\u200db@example.com', link: 'unsafe', image: UNSAFE },
  { id: 'A31', value: 'tel:+385\u200e1234', link: 'unsafe', image: UNSAFE },
  { id: 'A31', value: '//cdn\u200c.example/x.png', link: 'unsafe', image: UNSAFE },
  { id: 'A31', value: '\\\\cdn\u200c.example\\x.png', link: 'unsafe', image: UNSAFE },
  { id: 'A31', value: '\ufeffjavascript:alert(1)', link: 'unsafe', image: UNSAFE },
  { id: 'A31', value: 'https://example.com/\u202eexe.txt', link: 'unsafe', image: UNSAFE },
  { id: 'A31', value: '?q=\u2067x', link: 'unsafe', image: UNSAFE },
];

/** Pieces the fuzzer joins: scheme parts, delimiters, controls, bidi and look-alike characters. */
const FUZZ_PIECES = [
  'javascript', 'JaVaScRiPt', 'vbscript', 'data', 'http', 'https', 'mailto', 'tel', 'file', 'ftp', 'blob',
  ':', ':', '/', '//', '\\', '#', '?', '%', '%3A', '%0a', '&', '&colon;', '&#58;', '&#x3a;', '&#106;', '&#47;',
  '&sol;', '&bsol;', '&commat;', '&Tab;', '&amp;', ';', ',', '@', '.', '-', '+',
  // References without a `;`: numeric ones are decoded, named ones only as the legacy Latin-1 names.
  '&#58', '&#x3A', '&#47', '&colon', '&sol', '&amp', '&lt', '&nbsp', '&not', 'R&D',
  '\t', '\n', '\r', '\u0000', '\u0001', '\u001f', ' ', '\u00a0', '\u200b', '\u200c', '\u200d', '\u200e', '\u202e', '\u2066', '\ufeff',
  '\uff4a', '\u0430', '\ud800', 'x', 'example.com', 'evil.example', 'alert(1)', 'image/png', 'text/html',
  'base64', 'user:pass', '0', '9',
];

/** Deterministic strings built from FUZZ_PIECES, so a failure reproduces from its seed. */
export function fuzzUrls(seed: number, count: number): string[] {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const values: string[] = [];
  for (let index = 0; index < count; index++) {
    const length = 1 + Math.floor(next() * 7);
    let value = '';
    for (let piece = 0; piece < length; piece++) value += FUZZ_PIECES[Math.floor(next() * FUZZ_PIECES.length)] ?? '';
    values.push(value);
  }
  return values;
}
