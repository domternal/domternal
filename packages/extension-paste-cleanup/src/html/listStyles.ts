/** Closed marker vocabulary, shared only within the paste package. */
export const orderedListStyles = Object.freeze(['decimal', 'lower-alpha', 'upper-alpha', 'lower-roman', 'upper-roman']);
export const bulletListStyles = Object.freeze(['disc', 'circle', 'square']);

export function validListStyle(tag: string, value: unknown): value is string {
  return typeof value === 'string' && (tag === 'ol' ? orderedListStyles : tag === 'ul' ? bulletListStyles : []).includes(value);
}

/** HTML ordered-list type values are case sensitive. */
export function listStyleFromType(tag: string, value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (tag === 'ul') return validListStyle(tag, value.trim().toLowerCase()) ? value.trim().toLowerCase() : undefined;
  if (tag !== 'ol') return undefined;
  const types: Readonly<Record<string, string>> = { '1': 'decimal', a: 'lower-alpha', A: 'upper-alpha', i: 'lower-roman', I: 'upper-roman' };
  return Object.hasOwn(types, value) ? types[value] : undefined;
}
