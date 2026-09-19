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

const tableTags = new Set(['table', 'caption', 'colgroup', 'col', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th']);
// Pagination, typesetting and table layout belong to the destination page and theme.
const destinationLayout = new Set([
  'page-break-before', 'page-break-after', 'page-break-inside', 'break-before', 'break-after', 'break-inside',
  'orphans', 'widows', 'tab-stops', 'tab-interval', 'text-autospace', 'layout-grid-mode', 'punctuation-wrap',
  'text-justify', 'word-wrap', 'overflow-wrap', 'word-break', 'line-break', 'font-kerning',
  'border-collapse', 'border-spacing', 'table-layout', 'text-decoration-skip-ink', 'text-decoration-skip',
  '-webkit-text-decoration-skip',
]);
// Values that render exactly like the property's absence.
const neutralValues: Readonly<Record<string, readonly string[]>> = {
  'text-transform': ['none'], 'letter-spacing': ['normal'], 'word-spacing': ['normal'],
  'font-stretch': ['normal', '100%'], 'font-feature-settings': ['normal'], 'text-wrap-mode': ['wrap'], 'text-wrap': ['wrap'],
  background: ['transparent', 'none'], 'background-image': ['none'], 'text-shadow': ['none'], 'box-shadow': ['none'],
  'mso-hide': ['none'], 'text-underline': ['none'],
};

/** A length whose magnitude cannot change layout, such as `0`, `0cm` or Word's `.0001pt`. */
export function zeroLength(value: string): boolean {
  const match = /^[+-]?(\d{0,6}(?:\.\d{0,6})?)(?:[a-z]{1,4}|%)?$/.exec(value);
  const magnitude = match?.[1];
  return magnitude !== undefined && /\d/.test(magnitude) && Number(magnitude) < 0.01;
}

const cssSpace = /^[\t\n\f\r ]+|[\t\n\f\r ]+$/g;

/** Whether every bracket of a text closes, in order, so no semicolon inside one is read as a separator. */
function closedBrackets(text: string): boolean {
  const closing: string[] = [];
  for (const char of text) {
    const open = '([{'.indexOf(char);
    if (open >= 0) closing.push(')]}'.charAt(open));
    else if (')]}'.includes(char) && closing.pop() !== char) return false;
  }
  return closing.length === 0;
}

/**
 * The declarations of a style attribute in order, names lowercased and both sides trimmed of CSS white space
 * only, so a name after a no-break space stays as unknown as CSS finds it. Undefined when CSS may read the text
 * otherwise than a split on semicolons, or a later declaration may not win: a comment, an escape, `!important`,
 * a string or bracket that is unclosed or holds a semicolon, or a declaration without a colon.
 */
export function plainDeclarations(style: unknown): [string, string][] | undefined {
  if (typeof style !== 'string') return [];
  // A string without a semicolon or line break cannot move a separator, so only its quotes are checked.
  const bare = style.replace(/"[^"\n\r\f;]*"|'[^'\n\r\f;]*'/g, '');
  if (/\/\*|[\\!]/.test(style) || /["']/.test(bare)) return undefined;
  const texts = style.split(';');
  const declarations: [string, string][] = [];
  for (const [index, part] of bare.split(';').entries()) {
    const text = texts[index] ?? '';
    if (!closedBrackets(part)) return undefined;
    if (text.replace(cssSpace, '') === '') continue;
    const separator = text.indexOf(':');
    if (separator < 0) return undefined;
    declarations.push([text.slice(0, separator).replace(cssSpace, '').toLowerCase(), text.slice(separator + 1).replace(cssSpace, '')]);
  }
  return declarations;
}

/** Box spacing: vertical space is destination layout, horizontal space is indentation unless it is zero. */
function routineBox(name: string, value: string, tag: string): boolean | undefined {
  const box = /^(?:margin|padding)(?:-(top|bottom|left|right|block|inline)(?:-(?:start|end))?)?$/.exec(name);
  if (box === null) return undefined;
  const side = box[1];
  if (side === 'top' || side === 'bottom' || side === 'block') return true;
  // Tables, cells and semantic lists own their indentation and padding in the destination theme.
  if (tableTags.has(tag) || tag === 'ul' || tag === 'ol') return true;
  const parts = value.split(/\s+/);
  if (side !== undefined) return parts.length === 1 && zeroLength(value);
  if (parts.length > 4) return false;
  const horizontal = parts.length === 4 ? [parts[1], parts[3]] : [parts[1] ?? parts[0]];
  return horizontal.every(part => part !== undefined && zeroLength(part));
}

/** Borders are drawn only with a visible style; table borders belong to the destination table theme. */
function routineBorder(name: string, value: string, tag: string): boolean | undefined {
  const border = /^border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?(?:-(color|style|width))?$/.exec(name);
  if (border === null) return undefined;
  if (tableTags.has(tag) || border[1] === 'color' || border[1] === 'width') return true;
  const parts = value.split(/\s+/);
  return parts.includes('none') || parts.includes('hidden') || parts.every(zeroLength);
}

/**
 * Decide whether a declaration that is not retained is routine: Office private properties,
 * values that render like their absence, and layout the destination page or theme owns.
 * Everything else, including hidden text and nonzero indentation, remains a reported loss.
 */
export function routineDeclaration(name: string, content: string, tag = ''): boolean {
  const value = content.trim().toLowerCase();
  if (name.startsWith('mso-') && name !== 'mso-hide') return true;
  if (destinationLayout.has(name)) return true;
  if ((name === 'letter-spacing' || name === 'word-spacing' || name === 'text-indent') && zeroLength(value)) return true;
  if (Object.hasOwn(neutralValues, name)) return neutralValues[name]?.includes(value) === true;
  if (/^font-variant(?:-[a-z]+)*$/.test(name)) return value === 'normal';
  if (name === 'overflow' && tableTags.has(tag)) return true;
  return routineBox(name, value, tag) ?? routineBorder(name, value, tag) ?? false;
}

/** A deliberately small CSS value grammar: no functions that can load resources. */
export function readSafeStyles(value: unknown, imagePlacement = false, tag = ''): { styles: Map<string, string>; removed: boolean } {
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
      if (validListStyle(tag, marker)) styles.set(name, marker);
      else removed = true;
      continue;
    }
    const placement = ownRule(imagePlacementRules, name);
    const rule = ownRule(rules, name) ?? (imagePlacement ? placement : undefined);
    if (separator < 0) { removed = true; continue; }
    if (!rule?.test(content)) { removed ||= !routineDeclaration(name, content, tag); continue; }
    styles.set(name, placement === undefined ? content : content.toLowerCase());
  }
  return { styles, removed };
}

export function serializeStyles(styles: ReadonlyMap<string, string>): string {
  return [...styles].map(([name, value]) => `${name}:${value}`).join(';');
}
