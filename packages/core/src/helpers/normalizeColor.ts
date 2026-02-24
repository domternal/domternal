/**
 * Normalizes browser-computed color values (rgb/rgba) to hex format.
 * Browsers convert hex colors to rgb() in element.style, causing
 * isActive mismatches when comparing stored values after HTML re-parsing.
 */
export function normalizeColor(color: string): string {
  const rgbMatch = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(color);
  if (rgbMatch?.[1] && rgbMatch[2] && rgbMatch[3]) {
    const r = parseInt(rgbMatch[1], 10);
    const g = parseInt(rgbMatch[2], 10);
    const b = parseInt(rgbMatch[3], 10);
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }
  return color;
}
