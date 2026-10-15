import { afterEach, describe, expect, it, vi } from 'vitest';
import { BulletList, Document, Editor, ListItem, ListLabels, OrderedList, Paragraph, Text } from '@domternal/core';
import { Schema } from '@domternal/pm/model';
import { officeLabelCapability } from './listLabelCapabilities.js';

const editors: Editor[] = [];
afterEach(() => { editors.splice(0).forEach(editor => { editor.destroy(); }); });
function schema(labels = true): Schema {
  const editor = new Editor({ extensions: [Document, Paragraph, Text, ListItem, OrderedList, BulletList, ...(labels ? [ListLabels] : [])] });
  editors.push(editor); return editor.schema;
}
const counter = { kind: 'counter', format: 'upper-alpha', prefix: 'Part ', suffix: ') ' } as const;
const bullet = { kind: 'text', text: '✓' } as const;

describe('optional Word label destination proof', () => {
  it('proves zero and nonzero starts, Unicode bullets and all supported depths without an HTML sink', () => {
    const capability = officeLabelCapability(schema(), document);
    const sink = vi.spyOn(Element.prototype, 'innerHTML', 'set').mockImplementation(() => { throw new Error('No HTML sink'); });
    try {
      for (let level = 1; level <= 9; level++) {
        expect(capability(counter, level)).toBe(true);
        expect(capability(bullet, level)).toBe(true);
      }
      expect(sink).not.toHaveBeenCalled();
    } finally { sink.mockRestore(); }
  });

  it('rejects legacy and foreign attributes even when their JSON happens to match', () => {
    const original = schema(false);
    expect(officeLabelCapability(original, document)(counter, 1)).toBe(false);
    const spec = original.spec.nodes.get('orderedList')!;
    const foreign = new Schema({ nodes: original.spec.nodes.update('orderedList', { ...spec,
      attrs: { ...spec.attrs, listLabel: { default: counter } },
    }) });
    expect(officeLabelCapability(foreign, document)(counter, 1)).toBe(false);
  });

  it('rejects a parser that changes zero or nested labels, and a renderer that drops companion CSS', () => {
    const original = schema(); const spec = original.spec.nodes.get('orderedList')!;
    const read = (element: HTMLElement): Record<string, unknown> => ({ start: Number(element.getAttribute('start') ?? 1),
      listStyleType: element.style.listStyleType, listLabel: counter });
    const cases = [
      { ...spec, parseDOM: [{ tag: 'ol', getAttrs: (element: HTMLElement) => ({ ...read(element), start: Math.max(1, Number(element.getAttribute('start'))) }) }] },
      { ...spec, parseDOM: [{ tag: 'ol', getAttrs: (element: HTMLElement) => ({ ...read(element), listLabel: element.closest('li') ? null : counter }) }] },
      { ...spec, toDOM: () => ['ol', { 'data-dm-list-label': JSON.stringify(counter) }, 0] as const },
    ];
    for (const changed of cases) {
      const destination = new Schema({ nodes: original.spec.nodes.update('orderedList', changed) });
      expect(officeLabelCapability(destination, document)(counter, 2)).toBe(false);
    }
  });

  it('caches exact depth and label probes and bounds distinct work', () => {
    const original = schema(); const spec = original.spec.nodes.get('orderedList')!;
    const serialize = vi.fn(spec.toDOM);
    const destination = new Schema({ nodes: original.spec.nodes.update('orderedList', { ...spec, toDOM: serialize }) });
    const capability = officeLabelCapability(destination, document);
    expect(capability(counter, 1)).toBe(true);
    const calls = serialize.mock.calls.length;
    expect(capability(counter, 1)).toBe(true);
    expect(serialize).toHaveBeenCalledTimes(calls);
    expect(capability(counter, 2)).toBe(true);
    for (let index = 0; index < 254; index++) expect(capability({ ...counter, prefix: String(index) }, 1)).toBe(true);
    expect(capability({ ...counter, prefix: 'Over limit' }, 1)).toBe(false);
    expect(capability(counter, 1)).toBe(true);
    expect(capability(counter, 0)).toBe(false);
    expect(capability(counter, 10)).toBe(false);
  });
});
