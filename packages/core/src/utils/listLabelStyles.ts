import type { JSONContent } from '../types/Content.js';
import type { ListLabel } from '../types/ListLabel.js';
import { listLabelForKind, quoteListLabelCSS, readListLabel, serializeListLabel } from './listLabel.js';

/** Full canonical UTF-16 encoding gives bounded, collision-free CSS identifiers. */
export function listLabelStyleName(label: ListLabel): string {
  const canonical = serializeListLabel(label);
  if (canonical === null) throw new RangeError('Invalid list label');
  let name = 'dm-ll-';
  for (let index = 0; index < canonical.length; index++) name += canonical.charCodeAt(index).toString(16).padStart(4, '0');
  return name;
}

/** Compile only closed records. CSS never contains a document-supplied identifier or declaration. */
export function compileListLabelStyles(values: readonly ListLabel[]): string {
  const labels = new Map<string, ListLabel>();
  for (const value of values) {
    const label = readListLabel(value);
    if (label !== null) labels.set(listLabelStyleName(label), label);
  }
  const rules: string[] = [];
  const properties: string[] = [];
  for (const [name, label] of [...labels].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) {
    const definition = label.kind === 'counter'
      ? `system: extends ${label.format}; prefix: ${quoteListLabelCSS(label.prefix)}; suffix: ${quoteListLabelCSS(label.suffix)};`
      : `system: cyclic; symbols: ${quoteListLabelCSS(label.text)}; suffix: " ";`;
    rules.push(`@counter-style ${name} { ${definition} }`);
    properties.push(`--${name}: ${name};`);
  }
  if (properties.length > 0) {
    const variables = properties.join(' ');
    rules.push(`:root { ${variables} }`, `:host { ${variables} }`);
  }
  return rules.join('\n');
}

/**
 * Companion CSS for HTML produced with ListLabels. Insert it through the host's
 * normal stylesheet/CSP policy. HTML alone retains semantic list fallbacks.
 */
export function getListLabelStyleSheet(content: JSONContent | readonly JSONContent[]): string {
  const pending: JSONContent[] = Array.isArray(content) ? [...content as readonly JSONContent[]] : [content as JSONContent];
  const seen = new WeakSet<JSONContent>();
  const labels: ListLabel[] = [];
  while (pending.length > 0) {
    const node = pending.pop();
    if (node === undefined || seen.has(node)) continue;
    seen.add(node);
    const label = listLabelForKind(node.type, node.attrs?.['listLabel']);
    if (label !== null) labels.push(label);
    if (Array.isArray(node.content)) for (const child of node.content) pending.push(child);
  }
  return compileListLabelStyles(labels);
}
