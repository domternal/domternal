/**
 * Normalizes opaque browser-computed RGB colors to hex format.
 * Browsers convert hex colors to rgb() in element.style, causing
 * isActive mismatches when comparing stored values after HTML re-parsing.
 * Translucent colors retain their alpha and spelling without quantization.
 * This is a representation helper, not a CSS validator or sanitizer.
 */
export function normalizeColor(color: string): string {
  const rgbMatch = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(1(?:\.0+)?|100(?:\.0+)?%)\s*)?\)$/i.exec(color)
    ?? /^rgba?\(\s*(\d+)\s+(\d+)\s+(\d+)\s*(?:\/\s*(1(?:\.0+)?|100(?:\.0+)?%)\s*)?\)$/i.exec(color);
  if (rgbMatch?.[1] && rgbMatch[2] && rgbMatch[3]) {
    const r = parseInt(rgbMatch[1], 10);
    const g = parseInt(rgbMatch[2], 10);
    const b = parseInt(rgbMatch[3], 10);
    if (r > 255 || g > 255 || b > 255) return color;
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }
  return color;
}
