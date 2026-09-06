/**
 * CSS Value Helper
 *
 * Decides whether a stored value may be written as the value of one CSS
 * declaration in a style attribute.
 */

/** Functions a value may call: colors and arithmetic, none of which loads anything. */
const ALLOWED_FUNCTIONS = new Set([
  'rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'color', 'color-mix', 'light-dark',
  'var', 'calc', 'min', 'max', 'clamp',
]);

/**
 * Characters that end a declaration, open a block that would swallow the
 * next declaration, quote, escape, or start importance or a rule; and a comment.
 */
const FORBIDDEN = /[;{}[\]<>\\"'!@]|\/\*/;
const MAX_LENGTH = 256;

/**
 * Whether `value` is safe to write as the value of one CSS declaration, such
 * as `color: <value>`: a string of at most 256 characters that is not blank,
 * with no control character, none of `; { } [ ] < > \ " ' ! @`, no comment,
 * balanced parentheses, and no function other than the color and arithmetic
 * functions `rgb`, `rgba`, `hsl`, `hsla`, `hwb`, `lab`, `lch`, `oklab`,
 * `oklch`, `color`, `color-mix`, `light-dark`, `var`, `calc`, `min`, `max`
 * and `clamp`.
 *
 * Such a value cannot add another declaration, leave the style attribute or
 * load a resource: `url()`, `image-set()` and `expression()` are refused. It
 * says nothing about whether the value is valid for a given property; the
 * browser ignores an invalid one.
 *
 * @example
 * ```ts
 * isSafeCssValue('#ff0000');                    // true
 * isSafeCssValue('rgb(1, 2, 3)');               // true
 * isSafeCssValue('red;position:fixed');         // false
 * isSafeCssValue('url(https://example.com/x)'); // false
 * ```
 */
export function isSafeCssValue(value: unknown): boolean {
  if (typeof value !== 'string' || value.length > MAX_LENGTH || value.trim() === '') return false;
  if (FORBIDDEN.test(value)) return false;
  // Every parenthesis must open an allowed function whose name comes right
  // before it, and close again: an unclosed one would swallow the declarations
  // written after this one.
  let depth = 0;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    // C0 controls, including tabs and line breaks, DEL and C1 controls.
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return false;
    const char = value[index];
    if (char === '(') {
      const name = /[a-z-]*$/i.exec(value.slice(0, index))?.[0].toLowerCase() ?? '';
      if (!ALLOWED_FUNCTIONS.has(name)) return false;
      depth++;
    } else if (char === ')' && --depth < 0) {
      return false;
    }
  }
  return depth === 0;
}
