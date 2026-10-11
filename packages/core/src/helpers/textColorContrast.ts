/** The optional editor color policy works on measured, opaque sRGB paint only. */
export type ContrastColor = readonly [number, number, number, number];
const NUMBER = '[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:e[+-]?\\d+)?';
const PART = new RegExp(`^(${NUMBER})(%)?$`, 'i');
const clamp = (value: number, upper: number): number => Math.min(upper, Math.max(0, value));

/** Read the sRGB forms browsers return from getComputedStyle. Other color spaces stay unchanged. */
export function measuredContrastColor(value: string): ContrastColor | null {
  if (value.length > 256) return null;
  const color = value.trim().toLowerCase();
  if (color === 'transparent') return [0, 0, 0, 0];
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/u.exec(color)?.[1];
  if (hex) {
    const full = hex.length < 5 ? hex.replace(/[0-9a-f]/gu, part => part + part) : hex;
    return [Number.parseInt(full.slice(0, 2), 16), Number.parseInt(full.slice(2, 4), 16),
      Number.parseInt(full.slice(4, 6), 16), full.length === 8 ? Number.parseInt(full.slice(6, 8), 16) / 255 : 1];
  }
  const match = /^rgba?\(([^()]*)\)$/u.exec(color);
  if (!match) return null;
  const body = match[1] ?? '';
  const comma = body.includes(',');
  const parts = comma ? body.split(',').map(part => part.trim()) : body.replace(/\s*\/\s*/u, ' ').trim().split(/\s+/u);
  if (parts.length !== 3 && parts.length !== 4) return null;
  const parsed = parts.map(part => PART.exec(part));
  if (parsed.some(part => !part || !Number.isFinite(Number(part[1])))) return null;
  if (comma && new Set(parsed.slice(0, 3).map(part => part?.[2] ?? '')).size > 1) return null;
  const channel = (index: number): number => clamp(Number(parsed[index]?.[1]) * (parsed[index]?.[2] ? 2.55 : 1), 255);
  const alpha = parsed[3] ? clamp(Number(parsed[3][1]) / (parsed[3][2] ? 100 : 1), 1) : 1;
  return [channel(0), channel(1), channel(2), alpha];
}

/** An sRGB foreground over an sRGB background, including alpha in both. */
export function compositeContrastColor(front: ContrastColor, back: ContrastColor): ContrastColor {
  const alpha = front[3] + back[3] * (1 - front[3]);
  if (alpha === 0) return [0, 0, 0, 0];
  const channel = (index: 0 | 1 | 2): number => (front[index] * front[3] + back[index] * back[3] * (1 - front[3])) / alpha;
  return [channel(0), channel(1), channel(2), alpha];
}

const linear = (value: number): number => value / 255 <= 0.04045 ? value / 255 / 12.92 : ((value / 255 + 0.055) / 1.055) ** 2.4;
const srgb = (value: number): number => 255 * (value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055);
const luminance = (color: ContrastColor): number => 0.2126 * linear(color[0]) + 0.7152 * linear(color[1]) + 0.0722 * linear(color[2]);
export function textContrastRatio(first: ContrastColor, second: ContrastColor): number {
  const a = luminance(first); const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * Keep readable colors. Otherwise make the smallest linear-sRGB mix toward black or white that reaches 4.5:1.
 * Translucent foregrounds can express intentional visibility and are never made opaque by this policy.
 */
export function readableTextColor(text: ContrastColor, surface: ContrastColor): string | null {
  if (text[3] !== 1 || surface[3] !== 1 || textContrastRatio(text, surface) >= 4.5) return null;
  const original = [linear(text[0]), linear(text[1]), linear(text[2])];
  const choices = [0, 1].flatMap(endpoint => {
    const end: ContrastColor = [endpoint * 255, endpoint * 255, endpoint * 255, 1];
    if (textContrastRatio(end, surface) < 4.5) return [];
    // Search the rounded color that is actually painted, not an unrounded mathematical boundary.
    const mix = (share: number): ContrastColor => [
      Math.round(srgb((original[0] ?? 0) * (1 - share) + endpoint * share)),
      Math.round(srgb((original[1] ?? 0) * (1 - share) + endpoint * share)),
      Math.round(srgb((original[2] ?? 0) * (1 - share) + endpoint * share)), 1,
    ];
    let low = 0; let high = 1;
    for (let iteration = 0; iteration < 24; iteration++) {
      const middle = (low + high) / 2;
      if (textContrastRatio(mix(middle), surface) >= 4.5) high = middle;
      else low = middle;
    }
    return [{ share: high, color: mix(high) }];
  });
  choices.sort((a, b) => a.share - b.share);
  const best = choices[0]?.color;
  return best ? `rgb(${String(best[0])}, ${String(best[1])}, ${String(best[2])})` : null;
}
