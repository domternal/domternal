/**
 * WCAG 2 contrast read in the page, shared by the contrast specs. Colors come from computed styles in
 * whatever form the engine serializes them: rgb() and rgba(), and anything else (color(srgb-linear ...)
 * from a relative color, oklch(), a system color) through a one pixel canvas, which paints it in sRGB.
 * A background is every layer behind the element, translucent ones included (a details summary row,
 * which its box paints with a ::before, too), composited down to the white page; a text or border color is
 * composited over what it is painted on before the ratio is taken.
 *
 * installContrastTools runs in the page and is self-contained, so page.evaluate can ship its source.
 */
import type { Page } from '@playwright/test';

/** A color as sRGB channels from 0 to 255 and an alpha from 0 to 1. */
export type Rgba = [red: number, green: number, blue: number, alpha: number];

export interface ContrastTools {
  /** The color a computed value paints. */
  rgba(value: string): Rgba;
  /** Every background behind the element and its own, composited down to the white page. */
  background(element: Element | null): Rgba;
  /** WCAG 2 contrast ratio between two opaque colors. */
  ratio(first: Rgba, second: Rgba): number;
  /** The element's text color over its background, and their ratio. */
  text(element: Element): { text: Rgba; background: Rgba; ratio: number };
  /** One side's border as painted over the element's own background, against the background around the element. */
  edge(element: Element, side: 'top' | 'left'): { edge: Rgba; background: Rgba; ratio: number };
  /** An opaque color as rgb(r, g, b) with rounded channels. */
  css(color: Rgba): string;
}

export function installContrastTools(): void {
  const host = window as unknown as { __contrastTools?: ContrastTools };
  if (host.__contrastTools) return;
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const rgba = (value: string): Rgba => {
    const match = /^rgba?\(([^)]*)\)$/.exec(value.trim());
    if (match?.[1] !== undefined) {
      const parts = match[1].split(/[\s,/]+/).filter(Boolean).map(Number);
      return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1];
    }
    if (!context) throw new Error(`Unreadable color ${value}`);
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = 'rgba(0, 0, 0, 0)';
    context.fillStyle = value;
    context.fillRect(0, 0, 1, 1);
    const data = context.getImageData(0, 0, 1, 1).data;
    return [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0, (data[3] ?? 0) / 255];
  };
  const over = (top: Rgba, base: Rgba): Rgba => {
    const alpha = top[3];
    const mix = (index: 0 | 1 | 2): number => top[index] * alpha + base[index] * (1 - alpha);
    return [mix(0), mix(1), mix(2), 1];
  };
  const luminance = (color: Rgba): number => {
    const linear = (channel: number): number => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * linear(color[0]) + 0.7152 * linear(color[1]) + 0.0722 * linear(color[2]);
  };
  const ratio = (first: Rgba, second: Rgba): number => {
    const [a, b] = [luminance(first), luminance(second)];
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };
  const background = (element: Element | null): Rgba => {
    const layers: Rgba[] = [];
    // A details box paints its summary row with a ::before behind the summary, above its own background.
    const summaryBox = element?.closest('summary')?.closest('div[data-type="details"]') ?? null;
    for (let current = element; current; current = current.parentElement) {
      if (current === summaryBox) {
        const row = rgba(getComputedStyle(current, '::before').backgroundColor);
        if (row[3] > 0) layers.push(row);
        if (row[3] >= 1) break;
      }
      const layer = rgba(getComputedStyle(current).backgroundColor);
      if (layer[3] > 0) layers.push(layer);
      if (layer[3] >= 1) break;
    }
    let result: Rgba = [255, 255, 255, 1];
    for (const layer of layers.reverse()) result = over(layer, result);
    return result;
  };
  host.__contrastTools = {
    rgba,
    background,
    ratio,
    text(element) {
      const behind = background(element);
      const text = over(rgba(getComputedStyle(element).color), behind);
      return { text, background: behind, ratio: ratio(text, behind) };
    },
    edge(element, side) {
      const style = getComputedStyle(element);
      const edge = over(rgba(side === 'top' ? style.borderTopColor : style.borderLeftColor), background(element));
      const around = background(element.parentElement);
      return { edge, background: around, ratio: ratio(edge, around) };
    },
    css: (color) => `rgb(${color.slice(0, 3).map((channel) => Math.round(channel)).join(', ')})`,
  };
}

/** Installs the tools in the page once; later page.evaluate calls read them from window.__contrastTools. */
export async function withContrastTools(page: Page): Promise<void> {
  await page.evaluate(installContrastTools);
}
