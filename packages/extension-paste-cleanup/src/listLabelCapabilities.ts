import { getNodeListLabel } from '@domternal/core';
import { readListLabel } from '@domternal/core/list-labels';
import type { ListLabel } from '@domternal/core/list-labels';
import { DOMParser, DOMSerializer } from '@domternal/pm/model';
import type { DOMOutputSpec, Node as PMNode, Schema } from '@domternal/pm/model';
import { listLabelStyleName, readCompanionListStyle } from './html/listLabels.js';

/** Confirm the exact label through the receiving parser, validator and serializer before removing source text. */
export function officeLabelCapability(schema: Schema, document: Document): (label: ListLabel, level: number) => boolean {
  const parser = DOMParser.fromSchema(schema);
  const serializer = DOMSerializer.fromSchema(schema);
  const cache = new Map<string, boolean>();
  const accepts = (label: ListLabel, level: number, start: number): boolean => {
    const kind = label.kind === 'text' ? 'bulletList' : 'orderedList';
    const tag = kind === 'bulletList' ? 'ul' : 'ol';
    const marker = label.kind === 'counter' ? label.format : 'disc';
    const serialized = JSON.stringify(label);
    const name = listLabelStyleName(label);
    let spec: DOMOutputSpec | undefined;
    for (let depth = 0; depth < level; depth++) {
      spec = [tag, { start: String(start), style: `list-style-type:${marker}`, 'data-dm-list-label': serialized },
        ['li', ['p', 'A'], ...(spec === undefined ? [] : [spec])]];
    }
    if (spec === undefined) return false;
    const container = document.createElement('div');
    container.appendChild(DOMSerializer.renderSpec(document, spec).dom);
    const slice = parser.parseSlice(container);
    if (slice.content.childCount !== 1) return false;
    let node: PMNode | null = slice.content.firstChild;
    node?.check();
    for (let depth = 0; depth < level; depth++) {
      if (node?.type.name !== kind || node.childCount !== 1 || node.attrs['listStyleType'] !== marker
        || kind === 'orderedList' && node.attrs['start'] !== start || JSON.stringify(getNodeListLabel(node)) !== serialized) return false;
      const item: PMNode | null = node.firstChild;
      const paragraph = item?.firstChild;
      if (item?.type.name !== 'listItem' || item.childCount !== (depth + 1 === level ? 1 : 2)
        || paragraph?.type.name !== 'paragraph' || paragraph.childCount !== 1 || paragraph.firstChild?.isText !== true
        || paragraph.textContent !== 'A') return false;
      node = depth + 1 === level ? null : item.lastChild;
    }
    const rendered = document.createElement('div');
    rendered.appendChild(serializer.serializeFragment(slice.content, { document }));
    const lists = rendered.querySelectorAll('ol,ul');
    if (lists.length !== level) return false;
    for (const list of Array.from(lists)) {
      if (list.localName !== tag || list.getAttribute('data-dm-list-label') !== serialized
        || readCompanionListStyle((list as HTMLElement).style.listStyleType, tag, name) === undefined) return false;
    }
    return parser.parseSlice(rendered).content.eq(slice.content);
  };
  return (input, level) => {
    const label = readListLabel(input);
    if (label === null || !Number.isInteger(level) || level < 1 || level > 9) return false;
    const key = `${String(level)}:${JSON.stringify(label)}`;
    const known = cache.get(key);
    if (known !== undefined) return known;
    // One paste can contain many items, but only a bounded number of distinct presentation probes.
    if (cache.size >= 256) return false;
    let supported = false;
    try { supported = accepts(label, level, 7) && (label.kind === 'text' || accepts(label, level, 0)); } catch {
      // A host parser or renderer that cannot preserve the contract keeps the original marker text.
    }
    cache.set(key, supported);
    return supported;
  };
}
