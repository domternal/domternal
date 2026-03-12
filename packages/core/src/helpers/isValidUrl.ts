/**
 * URL Validation Helper
 *
 * Provides a utility for validating URLs.
 */

/**
 * Options for URL validation
 */
export interface IsValidUrlOptions {
  /**
   * List of allowed URL protocols
   * @default ['http:', 'https:']
   */
  protocols?: string[];
}

/**
 * Checks if a string is a valid URL
 *
 * @param url - The string to validate
 * @param options - Validation options
 * @returns True if the string is a valid URL with an allowed protocol
 *
 * @example
 * ```ts
 * isValidUrl('https://example.com'); // true
 * isValidUrl('javascript:alert(1)'); // false (protocol not allowed)
 * isValidUrl('not a url'); // false
 * ```
 */
export function isValidUrl(
  url: string,
  options: IsValidUrlOptions = {}
): boolean {
  const { protocols = ['http:', 'https:'] } = options;

  try {
    const parsed = new URL(url);
    return protocols.includes(parsed.protocol);
  } catch {
    return false;
  }
}
