/**
 * Surface Tone Helper
 *
 * Tells whether a background color the document keeps, such as a highlight
 * or a table cell's shading, is light or dark, so the editor can draw the
 * text without a color of its own in black or white on it, whatever the
 * theme. The answer depends only on the stored value, never on the theme.
 */
import { isSafeCssValue } from './isSafeCssValue.js';

/** @experimental How a kept background reads: its tone, and whether it is a mid tone. */
export interface SurfaceTone {
  /** `light`: black text reads best on it; `dark`: white text does. */
  tone: 'light' | 'dark';
  /**
   * A mid tone, between the package palettes' role colors and their
   * opposites: a theme's link, muted and quote colors fall below 3:1 on it,
   * so only black or white text stays readable there.
   */
  mid: boolean;
}

/**
 * The relative luminance at which black and white text have the same
 * contrast, about 4.58:1. On a lighter background black is the better of the
 * two, on a darker one white, so the better one never falls below 4.58:1.
 */
export const SURFACE_TONE_THRESHOLD = Math.sqrt(1.05 * 0.05) - 0.05;
/** Light backgrounds below this luminance are mid tones: the light palette's roles reach 3:1 only above about 0.601. */
export const SURFACE_TONE_MID_LIGHT = 0.61;
/** Dark backgrounds above this luminance are mid tones: the dark palette's roles reach 3:1 only below about 0.084. */
export const SURFACE_TONE_MID_DARK = 0.08;

// CSS Color 4 named colors by tone, from their hex values (surfaceTone.test.ts derives and checks the lists).
// `transparent` and system colors are not here: they paint no color of their own.
const NAMED = ((): Map<string, SurfaceTone> => {
  const groups: [SurfaceTone, string][] = [
    [{ tone: 'dark', mid: false }, 'black blue darkblue darkmagenta darkred darkslateblue darkslategray darkslategrey indigo maroon mediumblue midnightblue navy purple rebeccapurple'],
    [{ tone: 'dark', mid: true }, 'blueviolet brown crimson darkgreen darkolivegreen darkorchid darkviolet dimgray dimgrey firebrick green mediumvioletred royalblue saddlebrown sienna slateblue teal'],
    [{ tone: 'light', mid: true }, 'burlywood cadetblue chocolate coral cornflowerblue darkcyan darkgoldenrod darkgray darkgrey darkkhaki darkorange darksalmon darkseagreen darkturquoise deeppink deepskyblue dodgerblue forestgreen fuchsia goldenrod gray grey hotpink indianred lightcoral lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue limegreen magenta mediumaquamarine mediumorchid mediumpurple mediumseagreen mediumslateblue mediumturquoise olive olivedrab orange orangered orchid palevioletred peru plum red rosybrown salmon sandybrown seagreen silver skyblue slategray slategrey steelblue tan thistle tomato turquoise violet yellowgreen'],
    [{ tone: 'light', mid: false }, 'aliceblue antiquewhite aqua aquamarine azure beige bisque blanchedalmond chartreuse cornsilk cyan floralwhite gainsboro ghostwhite gold greenyellow honeydew ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightyellow lime linen mediumspringgreen mintcream mistyrose moccasin navajowhite oldlace palegoldenrod palegreen paleturquoise papayawhip peachpuff pink powderblue seashell snow springgreen wheat white whitesmoke yellow'],
  ];
  return new Map(groups.flatMap(([tone, names]) => names.split(' ').map((name): [string, SurfaceTone] => [name, tone])));
})();

type Rgba = [red: number, green: number, blue: number, alpha: number];

// A CSS number: no trailing dot, an exponent allowed. CSS white space is space, tab and line breaks only; JS
// trim() and \s also take a no-break space, U+2028 or U+3000, which make the declaration invalid.
const NUMBER = '[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:e[+-]?\\d+)?';
const COMPONENT = new RegExp(`^(${NUMBER})(%|deg|grad|rad|turn)?$`, 'i');
const SPACE = '[ \\t\\n\\r\\f]';
const TRIM = new RegExp(`^${SPACE}+|${SPACE}+$`, 'g');
const SPACES = new RegExp(`${SPACE}+`);
const trim = (text: string): string => text.replace(TRIM, '');

/** One numeric component and its unit, or null. */
function component(text: string | undefined): { value: number; unit: string } | null {
  const match = COMPONENT.exec(text ?? '');
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? { value, unit: (match[2] ?? '').toLowerCase() } : null;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** An alpha component: a number from 0 to 1, or a percentage. */
function alphaOf(text: string | undefined): number | null {
  if (text === undefined) return 1;
  const part = component(text);
  if (!part || (part.unit !== '' && part.unit !== '%')) return null;
  return clamp(part.unit === '%' ? part.value / 100 : part.value, 0, 1);
}

/**
 * The arguments of a color function with the alpha last or undefined, and whether they came in the legacy
 * comma syntax, whose channels CSS Color 4 types more strictly than the space syntax.
 */
function argumentsOf(body: string): { channels: string[]; alpha: string | undefined; legacy: boolean } | null {
  const trimmed = trim(body);
  if (trimmed.includes(',')) {
    const parts = trimmed.split(',').map(trim);
    if (parts.length !== 3 && parts.length !== 4) return null;
    return { channels: parts.slice(0, 3), alpha: parts[3], legacy: true };
  }
  const [main = '', alpha, ...extra] = trimmed.split('/').map(trim);
  if (extra.length > 0 || alpha === '') return null;
  const channels = main.split(SPACES);
  return channels.length === 3 ? { channels, alpha, legacy: false } : null;
}

function rgbOf(body: string): Rgba | null {
  const parsed = argumentsOf(body);
  if (!parsed) return null;
  const parts = parsed.channels.map(component);
  // The legacy syntax takes three numbers or three percentages, never a mix; the space syntax mixes them.
  const units = new Set(parts.map((part) => part?.unit));
  if (parts.some((part) => !part || (part.unit !== '' && part.unit !== '%')) || (parsed.legacy && units.size > 1)) return null;
  const channels = parts.map((part) => (part ? clamp(part.unit === '%' ? (part.value * 255) / 100 : part.value, 0, 255) : 0));
  const alpha = alphaOf(parsed.alpha);
  return alpha === null ? null : [channels[0] ?? 0, channels[1] ?? 0, channels[2] ?? 0, alpha];
}

function hslOf(body: string): Rgba | null {
  const parsed = argumentsOf(body);
  if (!parsed) return null;
  const [hueText, saturationText, lightnessText] = parsed.channels;
  const hue = component(hueText);
  const saturation = component(saturationText);
  const lightness = component(lightnessText);
  if (!hue || !saturation || !lightness) return null;
  const turns = { '': 1 / 360, deg: 1 / 360, grad: 1 / 400, rad: 1 / (2 * Math.PI), turn: 1 } as Record<string, number>;
  const perTurn = turns[hue.unit];
  // Saturation and lightness are percentages in the legacy syntax, and numbers or percentages in the space syntax.
  const allowed = parsed.legacy ? ['%'] : ['%', ''];
  if (perTurn === undefined || ![saturation, lightness].every((part) => allowed.includes(part.unit))) return null;
  const h = (((hue.value * perTurn) % 1) + 1) % 1;
  const s = clamp(saturation.value / 100, 0, 1);
  const l = clamp(lightness.value / 100, 0, 1);
  const f = (n: number): number => {
    const k = (n + h * 12) % 12;
    return 255 * (l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
  };
  const alpha = alphaOf(parsed.alpha);
  return alpha === null ? null : [f(0), f(8), f(4), alpha];
}

function hexOf(hex: string): Rgba | null {
  if (!/^[0-9a-f]+$/.test(hex) || ![3, 4, 6, 8].includes(hex.length)) return null;
  const short = hex.length <= 4;
  const channel = (index: number): number =>
    Number.parseInt(short ? (hex[index] ?? '0').repeat(2) : hex.slice(index * 2, index * 2 + 2), 16);
  const alpha = hex.length === 4 || hex.length === 8 ? channel(3) / 255 : 1;
  return [channel(0), channel(1), channel(2), alpha];
}

/** The WCAG 2 relative luminance of an opaque sRGB color with 0 to 255 channels. */
export function relativeLuminance(red: number, green: number, blue: number): number {
  const linear = (channel: number): number => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
}

function toneOfLuminance(luminance: number): SurfaceTone {
  return luminance > SURFACE_TONE_THRESHOLD
    ? { tone: 'light', mid: luminance < SURFACE_TONE_MID_LIGHT }
    : { tone: 'dark', mid: luminance > SURFACE_TONE_MID_DARK };
}

/** The tone of a value this reader understands; null when the surface behind it decides; undefined when it cannot read it. */
function readTone(value: string): SurfaceTone | null | undefined {
  const color = trim(value).toLowerCase();
  const named = NAMED.get(color);
  if (named) return { ...named };
  let rgba: Rgba | null = null;
  if (color.startsWith('#')) rgba = hexOf(color.slice(1));
  else {
    const match = /^(rgba?|hsla?)\(([^()]*)\)$/.exec(color);
    if (match) rgba = match[1]?.startsWith('rgb') ? rgbOf(match[2] ?? '') : hslOf(match[2] ?? '');
  }
  if (!rgba) return undefined;
  const [red, green, blue, alpha] = rgba;
  if (alpha >= 1) return toneOfLuminance(relativeLuminance(red, green, blue));
  const over = (base: number): SurfaceTone =>
    toneOfLuminance(relativeLuminance(red * alpha + base * (1 - alpha), green * alpha + base * (1 - alpha), blue * alpha + base * (1 - alpha)));
  const onWhite = over(255);
  const onBlack = over(0);
  if (onWhite.tone !== onBlack.tone) return null;
  return { tone: onWhite.tone, mid: onWhite.mid || onBlack.mid };
}

/**
 * @experimental The tone of a background color the document keeps: light,
 * dark, and whether it is a mid tone; or null when it paints no color the
 * editor can read. A later release can read more color forms or report more
 * tones.
 *
 * Reads hex colors (`#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`), `rgb()` and
 * `rgba()` in their comma and space syntax, `hsl()` and `hsla()`, and the CSS
 * named colors, in any letter case, by the CSS Color 4 grammar: the comma
 * syntax takes three numbers or three percentages for `rgb()` and
 * percentages for the saturation and lightness of `hsl()`, a number never
 * ends in a dot, and only CSS white space (space, tab, line breaks) may
 * surround the value or its parts. A value outside that grammar is one the
 * browser does not paint, so it has no tone. A translucent color is
 * composited over white and over black: when both composites agree that is
 * its tone, and otherwise it has none, because the surface behind it
 * decides. Anything else is null: `transparent`, `currentcolor`, CSS-wide
 * keywords, system colors, `var()`, `color-mix()`, `oklch()` and other
 * functions, `none` components, and unknown names.
 *
 * @example
 * ```ts
 * surfaceTone('#fef08a');            // { tone: 'light', mid: false }
 * surfaceTone('rgb(0, 32, 96)');     // { tone: 'dark', mid: false }
 * surfaceTone('teal');               // { tone: 'dark', mid: true }
 * surfaceTone('rgb(0, 0, 50%)');     // null: legacy syntax mixing numbers and percentages paints nothing
 * surfaceTone('var(--highlight)');   // null
 * ```
 */
export function surfaceTone(value: unknown): SurfaceTone | null {
  if (typeof value !== 'string' || value.length > 256) return null;
  return readTone(value) ?? null;
}

/** @experimental The view attributes of an element that paints a kept background; see surfaceToneAttributes. */
export interface SurfaceToneAttributes {
  /** `light` or `dark`, followed by `mid` for a mid tone; or `unknown` for a painted value the editor cannot read. */
  'data-dm-tone': string;
  /** For `unknown` only: the value as `--dm-tone-surface`, from which the theme computes the text color in CSS. */
  style?: string;
}

// Keywords that paint no color of their own: no background, the text's own color, and the CSS-wide keywords
// (`inherit` paints the parent's background, whose tone the text around it follows already).
const NO_PAINT = new Set(['transparent', 'currentcolor', 'inherit', 'initial', 'unset', 'revert', 'revert-layer']);

/**
 * Whether the engine paints `value` as a background color. Where no engine can be asked, as in SSR, the
 * grammar this reader knows decides for the forms it reads (hex, `rgb()`, `hsl()`): one it cannot read there is
 * not painted. A keyword or another function it cannot judge counts as painted.
 */
function painted(value: string, read: boolean): boolean {
  const css = (globalThis as { CSS?: { supports?: (property: string, value: string) => boolean } }).CSS;
  if (typeof css?.supports === 'function') return css.supports('background-color', value);
  return read || /^(?!(?:rgba?|hsla?)\()[a-z][a-z0-9-]*(?:\(.*\))?$/.test(trim(value).toLowerCase());
}

// A cell plugin asks again for every shaded cell on each document change; the answer for a value never changes.
const answers = new Map<string, SurfaceToneAttributes | null>();

/**
 * @experimental The view attributes that mark an element painting `value` as
 * its background: `data-dm-tone` with `light` or `dark`, followed by `mid` for a
 * mid tone, and the theme draws text without a color of its own in black or
 * white on it. A value the browser paints but this reader cannot read, such
 * as `var()`, `oklch()`, `color-mix()` or a system color, is marked
 * `unknown` and handed to the theme as `--dm-tone-surface`, from which CSS
 * computes black or white. Null when the value would not be rendered (it is
 * not a safe CSS value), when the browser does not paint it (asked through
 * `CSS.supports` where there is one), when it paints no color of its own
 * (`transparent`, `currentcolor`, CSS-wide keywords), or when it is
 * translucent and the surface behind it decides its tone. A later release can
 * read more color forms or report more tones.
 *
 * @example
 * ```ts
 * surfaceToneAttributes('#002060');      // { 'data-dm-tone': 'dark' }
 * surfaceToneAttributes('#808080');      // { 'data-dm-tone': 'light mid' }
 * surfaceToneAttributes('var(--brand)'); // { 'data-dm-tone': 'unknown', style: '--dm-tone-surface: var(--brand)' }
 * surfaceToneAttributes('url(x)');       // null
 * ```
 */
export function surfaceToneAttributes(value: unknown): SurfaceToneAttributes | null {
  if (typeof value !== 'string' || !isSafeCssValue(value)) return null;
  let answer = answers.get(value);
  if (answer === undefined) {
    answer = null;
    const tone = readTone(value);
    if (painted(value, tone !== undefined)) {
      if (tone) answer = { 'data-dm-tone': tone.mid ? `${tone.tone} mid` : tone.tone };
      else if (tone === undefined && !NO_PAINT.has(trim(value).toLowerCase())) answer = { 'data-dm-tone': 'unknown', style: `--dm-tone-surface: ${value}` };
    }
    if (answers.size >= 512) answers.clear();
    answers.set(value, answer);
  }
  return answer && { ...answer };
}
