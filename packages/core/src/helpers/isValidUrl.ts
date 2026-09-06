/**
 * URL Validation Helper
 *
 * A yes-or-no answer from the URL policy, {@link checkUrl}.
 */
import { checkUrl, type UrlPolicyOptions } from './checkUrl.js';

/**
 * Options for URL validation: the URL policy options. `protocols` defaults
 * to `['http:', 'https:']` and relative references are refused unless
 * `allowRelative` is set.
 */
export type IsValidUrlOptions = UrlPolicyOptions;

/**
 * Whether the URL policy allows the value: a string that browsers read as an
 * address with an allowed scheme, or as a relative reference when
 * `allowRelative` is set. Values that are not strings, credentials, hidden
 * characters, `javascript:` and `vbscript:`, and `data:` other than an
 * allowed image are always refused. Use {@link checkUrl} for the cleaned
 * spelling to store, render or open.
 *
 * @param url - The value to validate
 * @param options - Validation options
 * @returns True if the URL policy allows the value
 *
 * @example
 * ```ts
 * isValidUrl('https://example.com'); // true
 * isValidUrl('javascript:alert(1)'); // false (never allowed)
 * isValidUrl('https://google.com@evil.example'); // false (credentials)
 * isValidUrl('#intro', { allowRelative: true }); // true
 * isValidUrl('not a url'); // false
 * ```
 */
export function isValidUrl(
  url: unknown,
  options: IsValidUrlOptions = {}
): boolean {
  return checkUrl(url, options).status === 'allowed';
}
