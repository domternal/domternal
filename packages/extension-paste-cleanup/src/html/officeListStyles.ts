/**
 * Bounded reader for the Word list level definitions (`@list lN:levelL[ lfoF]`) that Word
 * writes into the clipboard stylesheet. It records only the levels that pasted paragraphs
 * reference, so its output never exceeds the number of candidate paragraphs. It does not
 * resolve general CSS: every other rule, at-rule and declaration is skipped.
 */

/** Word level number formats this reader distinguishes. Every other format is `other`. */
export type OfficeLevelFormat = 'decimal' | 'bullet' | 'alpha-lower' | 'alpha-upper' | 'roman-lower' | 'roman-upper' | 'other';

/** One level definition, with a matching instance override applied over its base level. */
export interface OfficeLevelDefinition {
  format: OfficeLevelFormat;
  /** Decoded `mso-level-text`. Absent when the rule keeps Word's default level text. */
  text?: string;
  /** First `font-family` entry, unquoted and lowercased. */
  font?: string;
  /** `mso-level-legal-format` renders every level in Arabic numerals. */
  legal: boolean;
}

interface LevelRule {
  format?: string;
  text?: string;
  font?: string;
  legal?: boolean;
}

/** Recorded rules per referenced key. `null` marks an unusable or ambiguous definition. */
export type OfficeListRules = ReadonlyMap<string, LevelRule | null>;

const knownFormats = new Set(['bullet', 'alpha-lower', 'alpha-upper', 'roman-lower', 'roman-upper']);
const relevant = new Set(['mso-level-number-format', 'mso-level-text', 'font-family', 'mso-level-legal-format']);
const space = /[\t\n\f\r ]/;
// Word writes the selector without comments; any other form is not read as a level rule.
const levelRule = /@list[\t\n\f\r ]+l([0-9]{1,10}):level([1-9])(?:[\t\n\f\r ]+lfo([0-9]{1,10}))?[\t\n\f\r ]*\{/iy;
const maxRuleBody = 8192;
const maxRuleDeclarations = 64;
const maxLevelText = 64;

export function officeLevelKey(list: string, level: number | string, instance?: string): string {
  return `l${list}:level${String(level)}${instance === undefined ? '' : ` lfo${instance}`}`;
}

interface Declaration { name: string; value: string }

/** Split a declaration list without treating strings, comments, escapes or blocks as separators. */
function readDeclarations(input: string, maximum: number): Declaration[] | undefined {
  const declarations: Declaration[] = [];
  let current = '';
  let quote = '';
  const blocks: string[] = [];
  const flush = (): boolean => {
    const text = current.trim();
    current = '';
    if (text === '') return true;
    const colon = text.indexOf(':');
    const name = colon > 0 ? text.slice(0, colon).trim().toLowerCase() : '';
    if (!/^-{0,2}[a-z][a-z0-9-]*$/.test(name) || declarations.length >= maximum) return false;
    declarations.push({ name, value: text.slice(colon + 1).trim() });
    return true;
  };
  for (let index = 0; index < input.length; index++) {
    const char = input.charAt(index);
    if (char === '\\') {
      if (index + 1 >= input.length) return undefined;
      current += char + input.charAt(++index);
    } else if (quote !== '') {
      current += char;
      if (char === quote) quote = '';
    } else if (char === '"' || char === "'") {
      current += char;
      quote = char;
    } else if (char === '/' && input[index + 1] === '*') {
      const end = input.indexOf('*/', index + 2);
      if (end < 0) return undefined;
      current += ' ';
      index = end + 1;
    } else if (char === '(' || char === '[' || char === '{') {
      blocks.push(char === '(' ? ')' : char === '[' ? ']' : '}');
      current += char;
    } else if (char === ')' || char === ']' || char === '}') {
      if (blocks.pop() !== char) return undefined;
      current += char;
    } else if (char === ';' && blocks.length === 0) {
      if (!flush()) return undefined;
    } else current += char;
  }
  if (quote !== '' || blocks.length !== 0 || !flush()) return undefined;
  return declarations;
}

/** Decode a quoted or bare CSS value of at most 64 UTF-16 units. Invalid escapes and unescaped inner quotes are refused. */
function decodeText(value: string): string | undefined {
  const first = value.charAt(0);
  const quoted = (first === '"' || first === "'") && value.length >= 2 && value.endsWith(first);
  const source = quoted ? value.slice(1, -1) : value;
  let decoded = '';
  for (let index = 0; index < source.length; index++) {
    const char = source.charAt(index);
    if (char === '"' || char === "'") return undefined;
    if (char !== '\\') { decoded += char; continue; }
    const hex = /^[0-9a-f]{1,6}/i.exec(source.slice(index + 1, index + 7))?.[0];
    if (hex === undefined) {
      const next = source.charAt(index + 1);
      if (next === '' || /[\n\r\f]/.test(next)) return undefined;
      decoded += next;
      index++;
      continue;
    }
    const point = Number.parseInt(hex, 16);
    if (point === 0 || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) return undefined;
    decoded += String.fromCodePoint(point);
    index += hex.length;
    if (space.test(source.charAt(index + 1))) index++;
  }
  return decoded.length <= maxLevelText ? decoded : undefined;
}

/** The first family of a `font-family` value, unquoted and lowercased. */
function firstFamily(value: string): string | undefined {
  if (value.length > 160) return undefined;
  const text = value.trim();
  const quote = text.charAt(0);
  let family: string;
  if (quote === '"' || quote === "'") {
    const end = text.indexOf(quote, 1);
    const rest = end < 0 ? '' : text.slice(end + 1).trim();
    if (end < 0 || (rest !== '' && !rest.startsWith(','))) return undefined;
    family = text.slice(1, end);
  } else family = text.split(',')[0] ?? '';
  family = family.trim().replace(/[\t\n\f\r ]+/g, ' ').toLowerCase();
  return /^[\p{L}\p{N} ._-]{1,160}$/u.test(family) ? family : undefined;
}

function readLevelRule(body: string): LevelRule | null {
  if (body.length > maxRuleBody) return null;
  const declarations = readDeclarations(body, maxRuleDeclarations);
  if (declarations === undefined) return null;
  const values = new Map<string, string>();
  for (const { name, value } of declarations) {
    if (!relevant.has(name)) continue;
    const previous = values.get(name);
    if (previous !== undefined && previous !== value) return null;
    values.set(name, value);
  }
  const rule: LevelRule = {};
  const format = values.get('mso-level-number-format');
  if (format !== undefined) {
    if (!/^[a-z][a-z0-9-]{0,31}$/i.test(format)) return null;
    rule.format = format.toLowerCase();
  }
  const text = values.get('mso-level-text');
  if (text !== undefined) {
    const decoded = decodeText(text);
    if (decoded === undefined) return null;
    rule.text = decoded;
  }
  const font = values.get('font-family');
  if (font !== undefined) {
    const family = firstFamily(font);
    if (family === undefined) return null;
    rule.font = family;
  }
  const legal = values.get('mso-level-legal-format');
  if (legal !== undefined) rule.legal = legal.toLowerCase() !== 'no';
  return rule;
}

function sameRule(left: LevelRule, right: LevelRule): boolean {
  return left.format === right.format && left.text === right.text && left.font === right.font && left.legal === right.legal;
}

/** Index after the comment or string that starts at `at`, or -1 when it does not end. */
function skipToken(css: string, at: number): number {
  const char = css.charAt(at);
  if (char === '/') {
    const end = css.indexOf('*/', at + 2);
    return end < 0 ? -1 : end + 2;
  }
  for (let index = at + 1; index < css.length; index++) {
    const next = css.charAt(index);
    if (next === '\\') index++;
    else if (next === char) return index + 1;
    else if (next === '\n' || next === '\r' || next === '\f') return -1;
  }
  return -1;
}

function opensToken(css: string, index: number): boolean {
  const char = css.charAt(index);
  return char === '"' || char === "'" || (char === '/' && css.charAt(index + 1) === '*');
}

/** Index of the brace that closes the block opened at `open`, or -1 when it does not close. */
function blockEnd(css: string, open: number): number {
  let depth = 0;
  for (let index = open; index < css.length; index++) {
    const char = css.charAt(index);
    if (char === '\\') index++;
    else if (opensToken(css, index)) {
      const next = skipToken(css, index);
      if (next < 0) return -1;
      index = next - 1;
    } else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return index;
  }
  return -1;
}

/**
 * Scan one style text once, front to back. Every character is visited by at most the rule
 * scan and, for a referenced level rule, one declaration pass over its bounded body.
 * Unterminated syntax stops this style text: later definitions stay unknown.
 */
function scanStyle(css: string, referenced: ReadonlySet<string>, rules: Map<string, LevelRule | null>): void {
  let index = 0;
  while (index < css.length) {
    const char = css.charAt(index);
    if (space.test(char) || char === ';' || char === '}') { index++; continue; }
    if (css.startsWith('<!--', index)) { index += 4; continue; }
    if (css.startsWith('-->', index)) { index += 3; continue; }
    let open = index;
    for (; open < css.length; open++) {
      const next = css.charAt(open);
      if (next === '\\') open++;
      else if (opensToken(css, open)) {
        const after = skipToken(css, open);
        if (after < 0) return;
        open = after - 1;
      } else if (next === '{' || next === ';' || next === '}') break;
    }
    if (open >= css.length) return;
    if (css.charAt(open) !== '{') { index = open + 1; continue; }
    const end = blockEnd(css, open);
    if (end < 0) return;
    levelRule.lastIndex = index;
    const match = levelRule.exec(css);
    if (match !== null && levelRule.lastIndex === open + 1) {
      const key = officeLevelKey(match[1] ?? '', match[2] ?? '', match[3]);
      if (referenced.has(key)) {
        const rule = readLevelRule(css.slice(open + 1, end));
        const previous = rules.get(key);
        if (previous === undefined) rules.set(key, rule);
        else if (previous !== null && (rule === null || !sameRule(previous, rule))) rules.set(key, null);
      }
    }
    index = end + 1;
  }
}

/** Read the referenced level definitions from clipboard style texts. */
export function readOfficeListRules(styles: readonly string[], referenced: ReadonlySet<string>): OfficeListRules {
  const rules = new Map<string, LevelRule | null>();
  if (referenced.size === 0) return rules;
  for (const style of styles) scanStyle(style, referenced, rules);
  return rules;
}

/**
 * Resolve one paragraph level. `undefined` means Word metadata is absent for this level,
 * `null` that it exists but is unusable, ambiguous or an override lacks its base level.
 */
export function resolveOfficeLevel(rules: OfficeListRules, list: string, level: number, instance?: string): OfficeLevelDefinition | null | undefined {
  const base = rules.get(officeLevelKey(list, level));
  const override = instance === undefined ? undefined : rules.get(officeLevelKey(list, level, instance));
  if (base === undefined && override === undefined) return undefined;
  if (base === undefined || base === null || override === null) return null;
  const format = override?.format ?? base.format;
  const text = override?.text ?? base.text;
  const font = override?.font ?? base.font;
  return {
    format: format === undefined ? 'decimal' : knownFormats.has(format) ? format as OfficeLevelFormat : 'other',
    ...(text === undefined ? {} : { text }),
    ...(font === undefined ? {} : { font }),
    legal: override?.legal ?? base.legal ?? false,
  };
}

/**
 * The family an inline style declares for its element: `undefined` when it declares none,
 * `null` when the declaration is malformed, conflicting or hidden behind a `font` shorthand.
 */
export function declaredFont(style: unknown): string | null | undefined {
  if (typeof style !== 'string') return undefined;
  const declarations = readDeclarations(style, 128);
  if (declarations === undefined) return null;
  let family: string | null | undefined;
  for (const { name, value } of declarations) {
    if (name === 'font') return null;
    if (name !== 'font-family') continue;
    const next = firstFamily(value) ?? null;
    if (family !== undefined && family !== next) return null;
    family = next;
  }
  return family;
}
