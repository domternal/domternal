/**
 * Surface Tone Helper
 *
 * Tells whether a background color the document keeps, such as a highlight
 * or a table cell's shading, is light or dark, so the editor can draw the
 * text without a color of its own in black or white on it, whatever the
 * theme. The answer depends only on the stored value, never on the theme.
 */
import { isSafeCssValue } from './isSafeCssValue.js';

/** How a kept background reads: its tone, and whether it is a mid tone. */
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

const NUMBER = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:e[+-]?\\d+)?';
const COMPONENT = new RegExp(`^(${NUMBER})(%|deg|grad|rad|turn)?$`, 'i');

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

/** The arguments of a color function, in its comma or its space syntax, with the alpha last or null. */
function argumentsOf(body: string): { channels: string[]; alpha: string | undefined } | null {
  const trimmed = body.trim();
  if (trimmed.includes(',')) {
    const parts = trimmed.split(',').map((part) => part.trim());
    if (parts.length !== 3 && parts.length !== 4) return null;
    return { channels: parts.slice(0, 3), alpha: parts[3] };
  }
  const [main = '', alpha, ...extra] = trimmed.split('/').map((part) => part.trim());
  if (extra.length > 0 || alpha === '') return null;
  const channels = main.split(/\s+/);
  return channels.length === 3 ? { channels, alpha } : null;
}

function rgbOf(body: string): Rgba | null {
  const parsed = argumentsOf(body);
  if (!parsed) return null;
  const channels: number[] = [];
  for (const text of parsed.channels) {
    const part = component(text);
    if (!part || (part.unit !== '' && part.unit !== '%')) return null;
    channels.push(clamp(part.unit === '%' ? (part.value * 255) / 100 : part.value, 0, 255));
  }
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
  if (perTurn === undefined || ![saturation, lightness].every((part) => part.unit === '%' || part.unit === '')) return null;
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

/**
 * The tone of a background color the document keeps: light, dark, and
 * whether it is a mid tone; or null when it paints no color the editor can
 * read.
 *
 * Reads hex colors (`#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`), `rgb()` and
 * `rgba()` in their comma and space syntax with numbers or percentages,
 * `hsl()` and `hsla()`, and the CSS named colors, in any letter case. A
 * translucent color is composited over white and over black: when both
 * composites agree that is its tone, and otherwise it has none, because the
 * surface behind it decides. Anything else is null: `transparent`,
 * `currentcolor`, CSS-wide keywords, system colors, `var()`, `color-mix()`,
 * `oklch()` and other functions, and unknown names.
 *
 * @example
 * ```ts
 * surfaceTone('#fef08a');            // { tone: 'light', mid: false }
 * surfaceTone('rgb(0, 32, 96)');     // { tone: 'dark', mid: false }
 * surfaceTone('teal');               // { tone: 'dark', mid: true }
 * surfaceTone('var(--highlight)');   // null
 * ```
 */
export function surfaceTone(value: unknown): SurfaceTone | null {
  if (typeof value !== 'string' || value.length > 256) return null;
  const color = value.trim().toLowerCase();
  const named = NAMED.get(color);
  if (named) return { ...named };
  let rgba: Rgba | null = null;
  if (color.startsWith('#')) rgba = hexOf(color.slice(1));
  else {
    const match = /^(rgba?|hsla?)\(([^()]*)\)$/.exec(color);
    if (match) rgba = match[1]?.startsWith('rgb') ? rgbOf(match[2] ?? '') : hslOf(match[2] ?? '');
  }
  if (!rgba) return null;
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
 * The view attribute that marks an element painting `value` as its
 * background: `data-dm-tone` with `light` or `dark`, followed by `mid` for a
 * mid tone. Null when the value would not be rendered (it is not a safe CSS
 * value) or has no tone. The theme draws text without a color of its own in
 * black or white on such an element.
 *
 * @example
 * ```ts
 * surfaceToneAttributes('#002060'); // { 'data-dm-tone': 'dark' }
 * surfaceToneAttributes('#808080'); // { 'data-dm-tone': 'light mid' }
 * surfaceToneAttributes('url(x)');  // null
 * ```
 */
export function surfaceToneAttributes(value: unknown): { 'data-dm-tone': string } | null {
  if (!isSafeCssValue(value)) return null;
  const tone = surfaceTone(value);
  return tone ? { 'data-dm-tone': tone.mid ? `${tone.tone} mid` : tone.tone } : null;
}
