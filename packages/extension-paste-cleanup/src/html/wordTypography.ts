import type { Element, Root } from 'hast';
import { readDeclarations } from './hiddenText.js';
import { InheritanceLimitError, validColor, validFamily } from './inheritance.js';
import { forEachStyleRule, readBoundedStyleDeclarations } from './officeListStyles.js';
import { plainDeclarations, readSafeStyles } from './styles.js';

const properties = new Set(['font-family', 'font-size', 'color']);
const selectorPattern = /^(?:([a-z][a-z0-9]*)|([a-z][a-z0-9]*)?\.(-?[_a-z][\w-]*))$/i;
const cssSpace = /^[\t\n\f\r ]+|[\t\n\f\r ]+$/g;
const importance = /[\t\n\f\r ]*![\t\n\f\r ]*important$/i;
const maxRules = 1024;
const maxRuleLength = 8192;
const maxDeclarations = 256;
interface Declaration { name: string; value: string; important: boolean }
interface Candidate { value: string; important: boolean; rank: number; order: number }
const unsupportedKeywords = new Set(('inherit initial unset revert revert-layer currentcolor xx-small x-small small large x-large xx-large xxx-large smaller larger math '
  + 'accentcolor accentcolortext activetext buttonborder buttonface buttontext canvas canvastext field fieldtext graytext highlight highlighttext linktext mark marktext selecteditem selecteditemtext visitedtext '
  + 'activeborder activecaption appworkspace background buttonhighlight buttonshadow captiontext inactiveborder inactivecaption inactivecaptiontext infobackground infotext menu menutext scrollbar threeddarkshadow threedface threedhighlight threedlightshadow threedshadow window windowframe').split(' '));

/** Unknown CSS features cannot be allowed to expose an earlier declaration they might override. */
function valueKind(name: string, value: string): 'supported' | 'invalid' | 'unknown' {
  const lower = value.toLowerCase();
  if (unsupportedKeywords.has(lower)) return 'unknown';
  if (name === 'font-size' && lower === 'medium' || name === 'color' && lower === 'windowtext') return 'supported';
  const safe = readSafeStyles(`${name}:${value}`).styles.get(name);
  if (safe !== undefined && (name === 'color' ? validColor(safe) : name === 'font-family' ? validFamily(safe) : true)) return 'supported';
  if (name !== 'font-family' && /^[a-z]+$/i.test(value)) return 'invalid';
  if (name === 'font-size' && /^-\d+(?:\.\d+)?(?:px|pt|em|rem|%)$/i.test(value)) return 'invalid';
  return 'unknown';
}

/** Only recover the bounded typography subset. The ordinary sanitizer still judges every resulting value. */
function declarations(text: string): Declaration[] | undefined {
  if (text.length > maxRuleLength || text.includes('\\') || readBoundedStyleDeclarations(text, maxDeclarations) === undefined) return undefined;
  const read = readDeclarations(text, maxDeclarations + 1);
  if (read.length > maxDeclarations || read.some(entry => entry.name === 'font' || entry.name === 'all')) return undefined;
  const result = read.filter(entry => properties.has(entry.name)).map(entry => ({
    name: entry.name, important: entry.important,
    value: entry.text.slice(entry.text.indexOf(':') + 1).replace(importance, '').replace(cssSpace, ''),
  }));
  if (result.some(entry => plainDeclarations(`${entry.name}:${entry.value}`)?.length !== 1 || valueKind(entry.name, entry.value) === 'unknown')) return undefined;
  return result.filter(entry => valueKind(entry.name, entry.value) === 'supported');
}

/**
 * Flatten Word's simple typography rules into its detached HAST tree before inline inheritance.
 * No stylesheet is installed, no CSS resource is fetched, and no browser DOM is needed.
 * This implements the unlayered author cascade for type, class and type.class selectors only:
 * https://www.w3.org/TR/css-cascade-5/#cascade-sort
 */
export function applyWordTypography(
  tree: Root, limits: { maxNodes: number; maxInputLength: number }, report: (node: Element) => void,
): void {
  const rules = new Map<string, Map<string, Candidate>>();
  const offer = (into: Map<string, Candidate>, name: string, entry: Candidate): void => {
    const current = into.get(name);
    if (current === undefined || Number(entry.important) > Number(current.important)
      || entry.important === current.important && (entry.rank > current.rank || entry.rank === current.rank && entry.order >= current.order)) {
      into.set(name, entry);
    }
  };
  let order = 0;
  const uncertain = new Set<Element>();
  const styles: Element[] = [];
  let nodes = 0;
  const collectStyles = (parent: Root | Element): void => {
    for (const node of parent.children) {
      if (++nodes > limits.maxNodes) throw new InheritanceLimitError('Word stylesheet node limit');
      if (node.type !== 'element') continue;
      if (node.tagName === 'style') styles.push(node);
      else collectStyles(node);
    }
  };
  collectStyles(tree);
  for (const node of styles) {
    if (typeof node.properties.type === 'string' && node.properties.type.toLowerCase() !== 'text/css') continue;
    if (node.properties.media !== undefined && !['all', 'screen'].includes(node.properties.media.trim().toLowerCase())) continue;
    for (const child of node.children) {
      if (child.type !== 'text') continue;
      const css = child.value;
      forEachStyleRule(css, (start, open, end) => {
        if (open - start > maxRuleLength) { uncertain.add(node); return; }
        const prelude = css.slice(start, open).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(cssSpace, '');
        // Word's list, page and font declarations are handled elsewhere or describe source layout.
        if (/^@(?:list|page|font-face)\b/i.test(prelude)) return;
        const body = css.slice(open + 1, end);
        if (body.includes('\\')) { uncertain.add(node); return; }
        if (!/font|color|(?:^|;)\s*all\s*:/i.test(body)) return;
        if (prelude.startsWith('@')) { uncertain.add(node); return; }
        const parsed = declarations(body);
        if (parsed === undefined) { uncertain.add(node); return; }
        if (parsed.length === 0) return;
        const parts = prelude.split(',');
        if (order + parts.length > maxRules) { uncertain.add(node); return; }
        const selectors = parts.map(selector => selectorPattern.exec(selector.replace(cssSpace, '')));
        if (selectors.some(match => match === null) || order + selectors.length > maxRules) { uncertain.add(node); return; }
        for (const matched of selectors) {
          if (matched === null) continue;
          const tag = (matched[1] ?? matched[2])?.toLowerCase();
          const className = matched[3];
          const key = className === undefined ? `tag:${tag ?? ''}` : `class:${className}:${tag ?? '*'}`;
          let bucket = rules.get(key);
          if (bucket === undefined) { bucket = new Map(); rules.set(key, bucket); }
          const rank = (className === undefined ? 0 : 10) + (tag === undefined ? 0 : 1);
          const sourceOrder = order++;
          for (const entry of parsed) offer(bucket, entry.name, { ...entry, rank, order: sourceOrder });
        }
      }, unknown => { if (unknown.replace(/\/\*[\s\S]*?\*\//g, ' ').trim() !== '') uncertain.add(node); });
    }
  }
  for (const node of uncertain) report(node);
  if (order === 0 || uncertain.size > 0) return;
  let generated = 0;
  const visit = (node: Root | Element): void => {
    for (const child of node.children) {
      if (child.type !== 'element' || child.tagName === 'style') continue;
      const candidates = new Map<string, Candidate>();
      const collect = (key: string): void => {
        for (const [name, entry] of rules.get(key) ?? []) offer(candidates, name, entry);
      };
      collect(`tag:${child.tagName}`);
      if (Array.isArray(child.properties.className)) {
        for (const name of new Set(child.properties.className)) if (typeof name === 'string') {
          collect(`class:${name}:*`);
          collect(`class:${name}:${child.tagName}`);
        }
      }
      if (candidates.size > 0) {
        const style = child.properties.style;
        const inline = typeof style === 'string' ? readDeclarations(style, maxDeclarations + 1) : [];
        // A shorthand can reset every font property, and an oversized declaration list can hide a later winner.
        if (typeof style === 'string' && (style.includes('\\') || readBoundedStyleDeclarations(style, maxDeclarations) === undefined)
          || inline.length > maxDeclarations || inline.some(entry => entry.name === 'font' || entry.name === 'all')) report(child);
        else {
          let unknownValue = false;
          for (const [index, entry] of inline.entries()) if (properties.has(entry.name)) {
            const value = entry.text.slice(entry.text.indexOf(':') + 1).replace(importance, '').replace(cssSpace, '');
            const kind = valueKind(entry.name, value);
            if (kind === 'unknown') unknownValue = true;
            else if (kind === 'supported') offer(candidates, entry.name, { value, important: entry.important, rank: 100, order: index });
          }
          if (unknownValue || [...candidates].some(([name, entry]) => plainDeclarations(`${name}:${entry.value}`)?.length !== 1)) {
            report(child); visit(child); continue;
          }
          const rest = inline.filter(entry => !properties.has(entry.name)).map(entry => entry.text);
          const added = [...candidates].map(([name, entry]) => `${name}:${entry.value}`);
          const next = [...rest, ...added].join(';');
          generated += Math.max(0, next.length - (typeof style === 'string' ? style.length : 0));
          if (generated > limits.maxInputLength) throw new InheritanceLimitError('Word stylesheet expansion limit');
          child.properties.style = next;
        }
      }
      visit(child);
    }
  };
  visit(tree);
}
