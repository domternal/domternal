/**
 * Zero denotes an unmeasured column. Fractions remain valid because hosts can store measured
 * CSS widths; each width and their bounded sum must stay finite when the table view renders.
 */
export function validColumnWidths(value: unknown): value is number[] | null {
  if (value === null) return true;
  if (!Array.isArray(value) || value.length > 1000) return false;
  for (const entry of value) {
    const width: unknown = entry;
    if (typeof width !== 'number' || !Number.isFinite(width) || width < 0 || width > Number.MAX_SAFE_INTEGER) return false;
  }
  return true;
}

export function validateColumnWidths(value: unknown): void {
  if (!validColumnWidths(value)) throw new RangeError('Invalid table column widths');
}

/** Invalid stored widths draw as automatic widths without mutating collaborative content. */
export const resolveColumnWidths = (value: unknown): number[] | null => validColumnWidths(value) ? value : null;
