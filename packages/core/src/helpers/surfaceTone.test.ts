import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  relativeLuminance,
  surfaceTone,
  surfaceToneAttributes,
  SURFACE_TONE_MID_DARK,
  SURFACE_TONE_MID_LIGHT,
  SURFACE_TONE_THRESHOLD,
} from './surfaceTone.js';
import * as core from '../index.js';

/** The CSS Color 4 named colors and their hex values, the table the shipped tone lists come from. */
const NAMED_COLORS = new Map([
  'aliceblue:f0f8ff antiquewhite:faebd7 aqua:00ffff aquamarine:7fffd4 azure:f0ffff beige:f5f5dc bisque:ffe4c4',
  'black:000000 blanchedalmond:ffebcd blue:0000ff blueviolet:8a2be2 brown:a52a2a burlywood:deb887',
  'cadetblue:5f9ea0 chartreuse:7fff00 chocolate:d2691e coral:ff7f50 cornflowerblue:6495ed cornsilk:fff8dc',
  'crimson:dc143c cyan:00ffff darkblue:00008b darkcyan:008b8b darkgoldenrod:b8860b darkgray:a9a9a9',
  'darkgreen:006400 darkgrey:a9a9a9 darkkhaki:bdb76b darkmagenta:8b008b darkolivegreen:556b2f darkorange:ff8c00',
  'darkorchid:9932cc darkred:8b0000 darksalmon:e9967a darkseagreen:8fbc8f darkslateblue:483d8b',
  'darkslategray:2f4f4f darkslategrey:2f4f4f darkturquoise:00ced1 darkviolet:9400d3 deeppink:ff1493',
  'deepskyblue:00bfff dimgray:696969 dimgrey:696969 dodgerblue:1e90ff firebrick:b22222 floralwhite:fffaf0',
  'forestgreen:228b22 fuchsia:ff00ff gainsboro:dcdcdc ghostwhite:f8f8ff gold:ffd700 goldenrod:daa520 gray:808080',
  'green:008000 greenyellow:adff2f grey:808080 honeydew:f0fff0 hotpink:ff69b4 indianred:cd5c5c indigo:4b0082',
  'ivory:fffff0 khaki:f0e68c lavender:e6e6fa lavenderblush:fff0f5 lawngreen:7cfc00 lemonchiffon:fffacd',
  'lightblue:add8e6 lightcoral:f08080 lightcyan:e0ffff lightgoldenrodyellow:fafad2 lightgray:d3d3d3',
  'lightgreen:90ee90 lightgrey:d3d3d3 lightpink:ffb6c1 lightsalmon:ffa07a lightseagreen:20b2aa',
  'lightskyblue:87cefa lightslategray:778899 lightslategrey:778899 lightsteelblue:b0c4de lightyellow:ffffe0',
  'lime:00ff00 limegreen:32cd32 linen:faf0e6 magenta:ff00ff maroon:800000 mediumaquamarine:66cdaa',
  'mediumblue:0000cd mediumorchid:ba55d3 mediumpurple:9370db mediumseagreen:3cb371 mediumslateblue:7b68ee',
  'mediumspringgreen:00fa9a mediumturquoise:48d1cc mediumvioletred:c71585 midnightblue:191970 mintcream:f5fffa',
  'mistyrose:ffe4e1 moccasin:ffe4b5 navajowhite:ffdead navy:000080 oldlace:fdf5e6 olive:808000 olivedrab:6b8e23',
  'orange:ffa500 orangered:ff4500 orchid:da70d6 palegoldenrod:eee8aa palegreen:98fb98 paleturquoise:afeeee',
  'palevioletred:db7093 papayawhip:ffefd5 peachpuff:ffdab9 peru:cd853f pink:ffc0cb plum:dda0dd powderblue:b0e0e6',
  'purple:800080 rebeccapurple:663399 red:ff0000 rosybrown:bc8f8f royalblue:4169e1 saddlebrown:8b4513',
  'salmon:fa8072 sandybrown:f4a460 seagreen:2e8b57 seashell:fff5ee sienna:a0522d silver:c0c0c0 skyblue:87ceeb',
  'slateblue:6a5acd slategray:708090 slategrey:708090 snow:fffafa springgreen:00ff7f steelblue:4682b4 tan:d2b48c',
  'teal:008080 thistle:d8bfd8 tomato:ff6347 turquoise:40e0d0 violet:ee82ee wheat:f5deb3 white:ffffff',
  'whitesmoke:f5f5f5 yellow:ffff00 yellowgreen:9acd32',
].join(' ').split(' ').map((entry) => entry.split(':') as [string, string]));

/** WCAG 2 contrast ratio between two luminances. */
const contrast = (a: number, b: number): number => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

const hexLuminance = (hex: string): number =>
  relativeLuminance(Number.parseInt(hex.slice(0, 2), 16), Number.parseInt(hex.slice(2, 4), 16), Number.parseInt(hex.slice(4, 6), 16));

/** A gray whose luminance is just above or below a bound, as an rgb() string with fractional channels. */
function grayAt(luminance: number): string {
  const linear = luminance <= 0.0031308 ? luminance * 12.92 : 1.055 * luminance ** (1 / 2.4) - 0.055;
  const channel = linear * 255;
  return `rgb(${String(channel)}, ${String(channel)}, ${String(channel)})`;
}

describe('surfaceTone', () => {
  it('splits light from dark where black and white text have the same contrast', () => {
    expect(SURFACE_TONE_THRESHOLD).toBeCloseTo(0.17913, 5);
    expect(contrast(SURFACE_TONE_THRESHOLD, 0)).toBeCloseTo(contrast(SURFACE_TONE_THRESHOLD, 1), 10);
    expect(contrast(SURFACE_TONE_THRESHOLD, 0)).toBeCloseTo(4.58, 2);
    expect(surfaceTone(grayAt(SURFACE_TONE_THRESHOLD + 1e-4))).toEqual({ tone: 'light', mid: true });
    expect(surfaceTone(grayAt(SURFACE_TONE_THRESHOLD - 1e-4))).toEqual({ tone: 'dark', mid: true });
  });

  it('marks mid tones on both sides of each bound', () => {
    expect(surfaceTone(grayAt(SURFACE_TONE_MID_LIGHT - 1e-4))).toEqual({ tone: 'light', mid: true });
    expect(surfaceTone(grayAt(SURFACE_TONE_MID_LIGHT + 1e-4))).toEqual({ tone: 'light', mid: false });
    expect(surfaceTone(grayAt(SURFACE_TONE_MID_DARK + 1e-4))).toEqual({ tone: 'dark', mid: true });
    expect(surfaceTone(grayAt(SURFACE_TONE_MID_DARK - 1e-4))).toEqual({ tone: 'dark', mid: false });
  });

  it('keeps the palettes readable: the better of black and white reaches 4.58:1 on every tone', () => {
    for (let step = 0; step <= 255; step++) {
      for (const hex of [[step, 0, 0], [0, step, 0], [0, 0, step], [step, step, step], [255, step, 0], [step, 255, 255]]) {
        const [red = 0, green = 0, blue = 0] = hex;
        const tone = surfaceTone(`rgb(${String(red)}, ${String(green)}, ${String(blue)})`);
        const luminance = relativeLuminance(red, green, blue);
        const text = tone?.tone === 'light' ? 0 : 1;
        expect(contrast(luminance, text)).toBeGreaterThanOrEqual(4.58);
      }
    }
  });

  it.each([
    ['#fef08a', 'light', false], ['#FEF08A', 'light', false], ['#fff', 'light', false], ['#ffff00', 'light', false],
    ['#d9d9d9', 'light', false], ['#fff2cc', 'light', false], ['#8eaadb', 'light', true], ['#808080', 'light', true],
    ['#70ad47', 'light', true], ['#4472c4', 'dark', true], ['#7f7f7f', 'light', true], ['#595959', 'dark', true],
    ['#404040', 'dark', false], ['#002060', 'dark', false], ['#1f3864', 'dark', false], ['#c00000', 'dark', true],
    ['#000', 'dark', false], ['#000080', 'dark', false], ['#008080', 'dark', true], ['#ff0000', 'light', true],
  ] as const)('reads %s as %s (mid %s)', (value, tone, mid) => {
    expect(surfaceTone(value)).toEqual({ tone, mid });
  });

  it('reads every CSS named color in any case, with the tone its hex value has', () => {
    expect(NAMED_COLORS.size).toBe(148);
    for (const [name, hex] of NAMED_COLORS) {
      expect(surfaceTone(name), name).toEqual(surfaceTone(`#${hex}`));
      expect(surfaceTone(` ${name.toUpperCase()} `), name).toEqual(surfaceTone(`#${hex}`));
    }
    const dark = [...NAMED_COLORS].filter(([, hex]) => hexLuminance(hex) <= SURFACE_TONE_THRESHOLD).map(([name]) => name);
    expect(dark).toHaveLength(32);
  });

  it('reads rgb() and rgba() in comma and space syntax, with numbers and percentages', () => {
    const dark = { tone: 'dark', mid: false };
    const light = { tone: 'light', mid: false };
    expect(surfaceTone('rgb(217, 217, 217)')).toEqual(light);
    expect(surfaceTone('rgb(217 217 217)')).toEqual(light);
    expect(surfaceTone('rgb(85% 85% 85%)')).toEqual(light);
    expect(surfaceTone('RGB(0, 32, 96)')).toEqual(dark);
    expect(surfaceTone('rgba(0, 32, 96, 1)')).toEqual(dark);
    expect(surfaceTone('rgb(0 32 96 / 100%)')).toEqual(dark);
    expect(surfaceTone('rgb(300, -5, 0)')).toEqual({ tone: 'light', mid: true });
    expect(surfaceTone('rgb(1e2, 1e2, 1e2)')).toEqual(surfaceTone('#646464'));
  });

  it('reads hsl() and hsla() with degree, unitless, turn, radian and gradian hues', () => {
    expect(surfaceTone('hsl(60, 100%, 50%)')).toEqual(surfaceTone('#ffff00'));
    expect(surfaceTone('hsl(60 100% 50%)')).toEqual(surfaceTone('#ffff00'));
    expect(surfaceTone('hsl(60deg 100% 50%)')).toEqual(surfaceTone('#ffff00'));
    expect(surfaceTone('hsl(0.1667turn 100% 50%)')).toEqual(surfaceTone('#ffff00'));
    expect(surfaceTone('hsl(240 100% 25%)')).toEqual(surfaceTone('#000080'));
    expect(surfaceTone('hsl(-120, 100%, 25%)')).toEqual(surfaceTone('#000080'));
    expect(surfaceTone('hsla(240, 100%, 25%, 1)')).toEqual(surfaceTone('#000080'));
    expect(surfaceTone('hsl(4.18879rad 100% 25%)')).toEqual(surfaceTone('#000080'));
    expect(surfaceTone('hsl(266.667grad 100% 25%)')).toEqual(surfaceTone('#000080'));
  });

  it('composites a translucent color over white and black and gives it a tone only when both agree', () => {
    // Opaque enough that the surface behind it does not decide.
    expect(surfaceTone('#000080f0')).toEqual({ tone: 'dark', mid: false });
    expect(surfaceTone('rgba(255, 255, 0, 0.95)')).toEqual({ tone: 'light', mid: false });
    expect(surfaceTone('rgb(255 255 0 / 95%)')).toEqual({ tone: 'light', mid: false });
    // Half transparent: white shows a light surface, black a dark one.
    expect(surfaceTone('#0000ff80')).toBeNull();
    expect(surfaceTone('#00f8')).toBeNull();
    expect(surfaceTone('rgba(0, 0, 0, 0.5)')).toBeNull();
    expect(surfaceTone('hsla(240, 100%, 50%, 0.5)')).toBeNull();
    // Yellow is light even half over black.
    expect(surfaceTone('#ffff0080')).toEqual({ tone: 'light', mid: true });
    expect(surfaceTone('rgba(0, 0, 0, 0)')).toBeNull();
    // A mid composite marks the tone mid.
    expect(surfaceTone('rgba(0, 0, 0, 0.6)')).toEqual({ tone: 'dark', mid: true });
    expect(surfaceTone('rgba(0, 0, 0, 0.85)')).toEqual({ tone: 'dark', mid: false });
  });

  it.each([
    '', ' ', 'transparent', 'currentcolor', 'currentColor', 'inherit', 'initial', 'unset', 'revert',
    'canvas', 'Canvas', 'ButtonFace', 'Highlight', 'var(--x)', 'var(--x, #fff)', 'color-mix(in srgb, red 50%, white)',
    'oklch(60% 0.15 50)', 'lab(50% 40 59.5)', 'hwb(0 0% 0%)', 'color(srgb 1 0 0)', 'light-dark(#fff, #000)',
    'url(x)', 'reddish', '#ff', '#fffff', '#ggg', 'rgb(1, 2)', 'rgb(1, 2, 3, 4, 5)', 'rgb(1 2 3 /)', 'rgb(1 2 3 / 4 / 5)',
    'rgb(1deg, 2, 3)', 'rgb(none 0 0)', 'hsl(120, 50, 50, 1, 2)', 'hsl(1px 50% 50%)', 'rgb(calc(1) 0 0)',
    '#'.padEnd(300, 'f'),
  ])('has no tone for %j', (value) => {
    expect(surfaceTone(value)).toBeNull();
  });

  it.each([null, undefined, 0, 1, {}, [], true])('has no tone for a stored %j', (value) => {
    expect(surfaceTone(value)).toBeNull();
  });

  // Each of these is a value the browser does not paint (CSS.supports is false in Chromium, Firefox and WebKit),
  // so a tone for it would draw black or white text on a background that is not there.
  it.each([
    // Legacy comma syntax takes three numbers or three percentages, never a mix.
    'rgb(0, 0, 50%)', 'rgb(100%, 255, 0)', 'rgba(0%, 0, 0, 1)',
    // Legacy hsl() takes its saturation and lightness as percentages.
    'hsl(60, 100, 50)', 'hsl(60, 100%, 50)', 'hsla(60, 100, 50%, 1)',
    // A CSS number never ends in a dot.
    'rgb(255., 255., 0)', 'rgb(0 0 128 / 1.)', 'hsl(60., 100%, 50%)', 'hsl(60, 100.0%, 50.%)', 'rgba(0, 0, 128, 1.)',
    // White space CSS does not have, around the value or inside it.
    'navy\u00a0', '\u00a0navy', 'navy\ufeff', 'navy\u3000', '\u2028#000080', '#000080\u00a0', 'rgb(0,\u00a00, 128)', 'rgb(0\u00a00 128)',
    'rgb(0 0 128 /\u00a00.5)',
    // A space between a number and its unit, and commas mixed with spaces.
    'rgb(0, 0, 50 %)', 'hsl(60 deg 100% 50%)', 'rgb(0, 0 128)', 'rgb(0 0, 128)',
  ])('has no tone for %j, which no engine paints', (value) => {
    expect(surfaceTone(value)).toBeNull();
  });

  it('reads the modern syntax, which mixes numbers and percentages and takes unitless hsl() lightness', () => {
    expect(surfaceTone('rgb(100% 255 0)')).toEqual(surfaceTone('#ffff00'));
    expect(surfaceTone('rgb(0 0 50%)')).toEqual(surfaceTone('#000080'));
    expect(surfaceTone('hsl(60 100 50)')).toEqual(surfaceTone('#ffff00'));
    expect(surfaceTone('hsl(60deg 100 50)')).toEqual(surfaceTone('#ffff00'));
    expect(surfaceTone('hsl(240 100% 25 / 1)')).toEqual(surfaceTone('#000080'));
  });

  it('reads CSS numbers in every form the engines paint, and CSS white space', () => {
    const navy = surfaceTone('#000080');
    expect(surfaceTone('rgb(.5, 0, 128)')).toEqual(navy);
    expect(surfaceTone('rgb(+0, -0, 128)')).toEqual(navy);
    expect(surfaceTone('rgb(0.0, 0.0, 128.0)')).toEqual(navy);
    expect(surfaceTone('rgb(00, 00, 0128)')).toEqual(navy);
    expect(surfaceTone('rgb(0E0 0e+0 1.28e2)')).toEqual(navy);
    expect(surfaceTone('rgba(0, 0, 128, .95)')).toEqual(navy);
    expect(surfaceTone('rgba(0, 0, 128, 95%)')).toEqual(navy);
    expect(surfaceTone('rgb(0%, 0%, 50.2%)')).toEqual(navy);
    expect(surfaceTone('hsl(+240, 100%, 25%)')).toEqual(navy);
    expect(surfaceTone('hsl(2.4e2, 100%, 25%)')).toEqual(navy);
    expect(surfaceTone('rgb( 0 , 0 , 128 )')).toEqual(navy);
    expect(surfaceTone('rgb(0 0 128/1)')).toEqual(navy);
    expect(surfaceTone('\t navy\n')).toEqual(navy);
    expect(surfaceTone('rgb(0\t0\n128)')).toEqual(navy);
    expect(surfaceTone('rgb(0,\r\f0, 128)')).toEqual(navy);
  });
});

describe('surfaceToneAttributes', () => {
  it('names the tone, and mid after it', () => {
    expect(surfaceToneAttributes('#fef08a')).toEqual({ 'data-dm-tone': 'light' });
    expect(surfaceToneAttributes('#002060')).toEqual({ 'data-dm-tone': 'dark' });
    expect(surfaceToneAttributes('#808080')).toEqual({ 'data-dm-tone': 'light mid' });
    expect(surfaceToneAttributes('teal')).toEqual({ 'data-dm-tone': 'dark mid' });
  });

  it('marks nothing a renderer would not write', () => {
    expect(surfaceToneAttributes('red;position:fixed')).toBeNull();
    expect(surfaceToneAttributes('url(x)')).toBeNull();
    expect(surfaceToneAttributes(' ')).toBeNull();
    expect(surfaceToneAttributes(42)).toBeNull();
  });

  it('marks a painted value it cannot read unknown and hands its value to the theme as --dm-tone-surface', () => {
    for (const value of ['var(--brand)', 'var(--x, #fef08a)', 'oklch(0.97 0.21 110)', 'hwb(60 0% 0%)', 'color-mix(in srgb, yellow 60%, white)',
      'lab(50% 40 59.5)', 'color(srgb 1 0 0)', 'light-dark(#fff, #000)', 'Mark', 'Canvas', ' ButtonFace ']) {
      expect(surfaceToneAttributes(value), value).toEqual({ 'data-dm-tone': 'unknown', style: `--dm-tone-surface: ${value}` });
    }
  });

  it('trusts its own grammar where no engine can be asked: a hex, rgb() or hsl() value it cannot read paints nothing', () => {
    for (const value of ['rgb(0, 0, 50%)', 'hsl(240, 100, 20)', '#002060\u00a0', 'navy\u00a0', '#00f0f', 'rgb(none 0 64)', 'rgba(calc(1), 0, 0)', '12px']) {
      expect(surfaceToneAttributes(value), value).toBeNull();
    }
  });

  it('leaves a value that paints nothing of its own, or whose tone the surface behind it decides, unmarked', () => {
    for (const value of ['transparent', 'TRANSPARENT', 'currentcolor', 'currentColor', 'inherit', 'initial', 'unset', 'revert', 'revert-layer', ' transparent ']) {
      expect(surfaceToneAttributes(value), value).toBeNull();
    }
    // Translucent with a tone over white and the other over black: the theme's text around it stays.
    expect(surfaceToneAttributes('#0000ff80')).toBeNull();
    expect(surfaceToneAttributes('rgba(0, 0, 0, 0.5)')).toBeNull();
    expect(surfaceToneAttributes('rgba(0, 0, 0, 0)')).toBeNull();
  });

  describe('in an engine that reports what it paints', () => {
    afterEach(() => { vi.unstubAllGlobals(); });
    const engine = (painted: (value: string) => boolean): void => {
      vi.stubGlobal('CSS', { supports: (property: string, value: string) => property === 'background-color' && painted(value) });
    };

    it('marks no value the engine does not paint, whether it reads a tone in it or not', () => {
      engine((value) => !value.includes('50%') && !value.startsWith('mystery'));
      expect(surfaceToneAttributes('#002060')).toEqual({ 'data-dm-tone': 'dark' });
      expect(surfaceToneAttributes('rgb(0 0 50%)')).toBeNull();
      expect(surfaceToneAttributes('mystery-color')).toBeNull();
      expect(surfaceToneAttributes('oklch(0.5 0.1 200)')).toEqual({ 'data-dm-tone': 'unknown', style: '--dm-tone-surface: oklch(0.5 0.1 200)' });
    });

    it('marks a form it reads but the engine paints from a component it does not read, `none` or calc(), unknown', () => {
      engine(() => true);
      expect(surfaceToneAttributes('rgb(none 0 128)')).toEqual({ 'data-dm-tone': 'unknown', style: '--dm-tone-surface: rgb(none 0 128)' });
      expect(surfaceToneAttributes('rgb(calc(1) 0 0)')).toEqual({ 'data-dm-tone': 'unknown', style: '--dm-tone-surface: rgb(calc(1) 0 0)' });
    });

    it('asks the engine about the exact value it renders', () => {
      const asked: string[] = [];
      engine((value) => { asked.push(value); return true; });
      surfaceToneAttributes(' #FEF08A ');
      expect(asked).toEqual([' #FEF08A ']);
    });
  });

  it('is exported from the package root', () => {
    expect(core.surfaceTone).toBe(surfaceTone);
    expect(core.surfaceToneAttributes).toBe(surfaceToneAttributes);
  });
});
