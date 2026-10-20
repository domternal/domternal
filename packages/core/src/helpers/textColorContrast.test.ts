import { describe, expect, it } from 'vitest';
import { compositeContrastColor, measuredContrastColor, paintedTextColor, readableTextColor, textContrastPaint, textContrastRatio } from './textColorContrast.js';
import type { ContrastColor } from './textColorContrast.js';

describe('measured contrast colors', () => {
  it.each([
    ['#abc', [170, 187, 204, 1]], ['#aabbccff', [170, 187, 204, 1]], ['rgba(0, 0, 255, 0.5)', [0, 0, 255, 0.5]],
    ['rgb(100% 0% 0% / 25%)', [255, 0, 0, 0.25]], ['transparent', [0, 0, 0, 0]], ['rgb(300, -10, 20)', [255, 0, 20, 1]],
  ])('reads %s', (value, expected) => {
    const result = measuredContrastColor(value);
    expect(result).not.toBeNull();
    expected.forEach((part, index) => { expect(result?.[index]).toBeCloseTo(part); });
  });

  it.each(['currentColor', 'CanvasText', 'var(--ink)', 'red', 'oklch(.7 .2 15)', 'color(display-p3 1 0 0)',
    'rgb(100%, 0, 0)', 'rgb(0 0)', 'rgb(0 0 0 / .5 / 1)', 'rgb(infinity 0 0)', '#00', 'rgb(0 0 0); color:red'])(
    'leaves paint it cannot read unchanged: %s', value => { expect(measuredContrastColor(value)).toBeNull(); });

  it('composites nested transparent backgrounds without inventing an opaque canvas', () => {
    expect(compositeContrastColor([255, 255, 255, .5], [0, 0, 0, 1])).toEqual([127.5, 127.5, 127.5, 1]);
    expect(compositeContrastColor([255, 255, 255, 0], [0, 0, 0, 0])).toEqual([0, 0, 0, 0]);
    expect(compositeContrastColor([255, 0, 0, .5], [0, 0, 255, .5])).toEqual([170, 0, 85, .75]);
  });
});

describe('readable text color', () => {
  it('keeps sufficient contrast and deliberate translucent text', () => {
    expect(readableTextColor([255, 220, 0, 1], [0, 0, 0, 1])).toBeNull();
    expect(readableTextColor([0, 0, 0, 1], [255, 255, 255, 1])).toBeNull();
    expect(readableTextColor([0, 0, 0, .5], [0, 0, 0, 1])).toBeNull();
    expect(readableTextColor([0, 0, 0, 1], [255, 255, 255, .5])).toBeNull();
  });

  it('keeps the dominant channels when a colored ink needs a lighter or darker presentation', () => {
    const onDark = measuredContrastColor(readableTextColor([0, 35, 100, 1], [20, 20, 20, 1]) ?? '')!;
    expect(onDark[2]).toBeGreaterThan(onDark[1]);
    expect(onDark[1]).toBeGreaterThan(onDark[0]);
    expect(textContrastRatio(onDark, [20, 20, 20, 1])).toBeGreaterThanOrEqual(4.5);
    const onLight = measuredContrastColor(readableTextColor([255, 220, 0, 1], [255, 255, 255, 1]) ?? '')!;
    expect(onLight[0]).toBeGreaterThan(onLight[1]);
    expect(onLight[1]).toBeGreaterThan(onLight[2]);
    expect(textContrastRatio(onLight, [255, 255, 255, 1])).toBeGreaterThanOrEqual(4.5);
  });

  it('reaches the threshold with the rounded displayed value across midtones and saturated colors', () => {
    const palette: ContrastColor[] = [];
    for (const red of [0, 64, 128, 192, 255]) for (const green of [0, 64, 128, 192, 255]) {
      for (const blue of [0, 128, 255]) palette.push([red, green, blue, 1]);
    }
    for (const text of palette) for (const surface of palette) {
      const before = textContrastRatio(text, surface);
      const adjusted = readableTextColor(text, surface);
      if (before >= 4.5) expect(adjusted).toBeNull();
      else {
        expect(adjusted).not.toBeNull();
        expect(textContrastRatio(measuredContrastColor(adjusted!)!, surface)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe('text inside groups with opacity', () => {
  it('measures a checked task against the final canvas and keeps its opacity', () => {
    const paint = textContrastPaint([
      { background: [0, 0, 0, 0], opacity: .6 },
      { background: [32, 32, 32, 1], opacity: 1 },
    ])!;
    expect(paint).toEqual({ background: [32, 32, 32, 1], black: [12.8, 12.8, 12.8, 1], opacity: .6 });
    for (const value of [0, 26]) {
      const authored: ContrastColor = [value, value, value, 1];
      const adjusted = measuredContrastColor(readableTextColor(authored, paint.background, paint) ?? '')!;
      expect(adjusted).not.toBeNull();
      expect(textContrastRatio(paintedTextColor(adjusted, paint), paint.background)).toBeGreaterThanOrEqual(4.5);
      // A color that reaches the threshold before group opacity is applied can still be unreadable on screen.
      const naive = measuredContrastColor(readableTextColor(authored, paint.background) ?? '')!;
      expect(textContrastRatio(paintedTextColor(naive, paint), paint.background)).toBeLessThan(4.5);
    }
  });

  it('composites each background inside its own group before applying that group opacity', () => {
    const paint = textContrastPaint([
      { background: [10, 80, 160, .75], opacity: .8 },
      { background: [220, 200, 160, 1], opacity: .6 },
      { background: [32, 32, 32, 1], opacity: 1 },
    ])!;
    expect(paint.opacity).toBe(.48);
    [69.2, 89.6, 108.8, 1].forEach((value, index) => { expect(paint.background[index]).toBeCloseTo(value); });
    [39.2, 36.8, 32, 1].forEach((value, index) => { expect(paint.black[index]).toBeCloseTo(value); });
    const white = paintedTextColor([255, 255, 255, 1], paint);
    [161.6, 159.2, 154.4, 1].forEach((value, index) => { expect(white[index]).toBeCloseTo(value); });
  });

  it('keeps already readable colors and refuses impossible contrast instead of changing opacity or lowering the threshold', () => {
    const readable = textContrastPaint([
      { background: [0, 0, 0, 0], opacity: .6 }, { background: [32, 32, 32, 1], opacity: 1 },
    ])!;
    expect(readableTextColor([255, 255, 255, 1], readable.background, readable)).toBeNull();
    const impossible = textContrastPaint([
      { background: [0, 0, 0, 0], opacity: .1 }, { background: [32, 32, 32, 1], opacity: 1 },
    ])!;
    expect(readableTextColor([0, 0, 0, 1], impossible.background, impossible)).toBeNull();
    expect(readableTextColor([0, 0, 0, .5], readable.background, readable)).toBeNull();
  });

  it.each([0, -1, 2, NaN, Infinity])('does not infer paint for hidden or invalid opacity %s', opacity => {
    expect(textContrastPaint([{ background: [255, 255, 255, 1], opacity }])).toBeNull();
  });

  it('does not invent the canvas behind a translucent outer group', () => {
    expect(textContrastPaint([{ background: [255, 255, 255, 1], opacity: .6 }])).toBeNull();
    expect(textContrastPaint([])).toBeNull();
  });
});
