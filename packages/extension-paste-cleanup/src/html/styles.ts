import { validListStyle } from './listStyles.js';

const color = /^(?:#[\da-f]{3,8}|[a-z]{1,24}|rgba?\([\d.% ,]+\)|hsla?\([\d.% ,]+\))$/i;
const length = /^(?:0|\d{1,4}(?:\.\d{1,3})?(?:px|pt|em|rem|%))$/i;
const rules: Readonly<Record<string, RegExp>> = {
  color,
  'background-color': color,
  'font-family': /^[\p{L}\p{N} ,'"._-]{1,160}$/u,
  'font-size': length,
  'font-weight': /^(?:normal|bold|[1-9]00)$/,
  'font-style': /^(?:normal|italic|oblique)$/,
  'text-decoration': /^(?:none|underline|line-through)(?: (?:underline|line-through))?$/,
  'text-decoration-line': /^(?:none|underline|line-through)(?: (?:underline|line-through))?$/,
  'text-align': /^(?:left|right|center|justify|start|end)$/,
  'vertical-align': /^(?:baseline|sub|super|top|middle|bottom)$/,
  'white-space': /^(?:normal|pre|pre-wrap|pre-line|break-spaces)$/,
  'line-height': /^(?:normal|[0-9](?:\.\d{1,3})?|\d{1,3}(?:\.\d{1,3})?(?:px|pt|%))$/,
  width: length,
  height: length,
};
const imagePlacementRules: Readonly<Record<string, RegExp>> = {
  float: /^(?:none|left|right)$/i,
  'margin-left': /^(?:auto|0)$/i,
  'margin-right': /^(?:auto|0)$/i,
};

/** Declaration names come from pasted markup, so inherited keys such as `constructor` are never rules. */
function ownRule(table: Readonly<Record<string, RegExp>>, name: string): RegExp | undefined {
  return Object.hasOwn(table, name) ? table[name] : undefined;
}

/** A deliberately small CSS value grammar: no functions that can load resources. */
export function readSafeStyles(value: unknown, imagePlacement = false, listTag = ''): { styles: Map<string, string>; removed: boolean } {
  const styles = new Map<string, string>();
  let removed = false;
  if (typeof value !== 'string') return { styles, removed };
  for (const declaration of value.split(';')) {
    if (declaration.trim() === '') continue;
    const separator = declaration.indexOf(':');
    const name = declaration.slice(0, separator).trim().toLowerCase();
    const content = declaration.slice(separator + 1).trim();
    if (name === 'list-style-type') {
      const marker = content.toLowerCase();
      if (validListStyle(listTag, marker)) styles.set(name, marker);
      else removed = true;
      continue;
    }
    const placement = ownRule(imagePlacementRules, name);
    const rule = ownRule(rules, name) ?? (imagePlacement ? placement : undefined);
    if (separator < 0 || !rule?.test(content)) { removed = true; continue; }
    styles.set(name, placement === undefined ? content : content.toLowerCase());
  }
  return { styles, removed };
}

export function serializeStyles(styles: ReadonlyMap<string, string>): string {
  return [...styles].map(([name, value]) => `${name}:${value}`).join(';');
}
