import type { Root } from 'hast';

/**
 * The line spacings of Word's Normal style when the copy does not name its own: 1.15 (Word 2007, 2010 and
 * since 2023) and 1.08, which Word writes as 107 % (Word 2013 to 2021). Safari writes the spacing it computes
 * on every block it copies, the style's included, as a length; as a ratio, these are the source's own.
 */
const WORD_DEFAULT_SPACINGS: ReadonlySet<string> = new Set(['1.15', '1.07', '1.08']);
// Word's Normal style rule, as Word writes it: `p.MsoNormal, li.MsoNormal, div.MsoNormal {...}`.
const normalRule = /(?:^|[\s,}>])p\.MsoNormal(?:[\t\n\f\r ]*,[^{}]{0,256})?[\t\n\f\r ]*\{([^{}]{0,16384})\}/i;
const maxStyleText = 1_000_000;

/** A line height declared in a stylesheet rule, as a ratio rounded to two places: a percentage or a plain number. */
function ruleLineHeight(body: string): string | undefined {
  let value: string | undefined;
  for (const declaration of body.split(';')) {
    const separator = declaration.indexOf(':');
    if (separator > 0 && declaration.slice(0, separator).trim().toLowerCase() === 'line-height') value = declaration.slice(separator + 1).trim().toLowerCase();
  }
  if (value === undefined) return '1';
  const match = /^(\d{1,4}(?:\.\d{1,6})?)(%?)$/.exec(value);
  if (match === null) return undefined;
  const ratio = Number(match[1]) / (match[2] === '%' ? 100 : 1);
  return ratio > 0 && ratio <= 10 ? String(Math.round(ratio * 100) / 100) : undefined;
}

/**
 * The line spacings that are a Word copy's own rather than formatting: the Normal style's spacing when the
 * copy carries Word's stylesheet, which Safari keeps for copies with lists, and otherwise Word's defaults.
 * A copy cannot tell a paragraph that keeps its style's spacing from one set to the same value; both are
 * the style's. Other sources have none.
 */
export function routineLineHeights(tree: Root, word: boolean): ReadonlySet<string> | undefined {
  if (!word) return undefined;
  for (const node of tree.children) {
    if (node.type !== 'element' || node.tagName !== 'style') continue;
    for (const child of node.children) {
      if (child.type !== 'text' || child.value.length > maxStyleText) continue;
      const rule = normalRule.exec(child.value);
      if (rule === null) continue;
      const spacing = ruleLineHeight(rule[1] ?? '');
      return spacing === undefined ? WORD_DEFAULT_SPACINGS : new Set([spacing]);
    }
  }
  return WORD_DEFAULT_SPACINGS;
}
