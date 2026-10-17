import { describe, expect, it } from 'vitest';
import { Editor } from '../Editor.js';
import { StarterKit } from './StarterKit.js';
import { ListLabels } from './ListLabels.js';
import { nodeListLabel, nodeExtendedListLabel } from '../utils/listLabelAttribute.js';
import { formatListLabel, formatExtendedListLabel, readListLabel, readExtendedListLabel } from '../utils/listLabel.js';

const counter = { kind: 'counter', format: 'decimal', prefix: 'Step ', suffix: ')' };
const text = { kind: 'text', text: '*' };
const compound = { kind: 'compound', parts: [{ ancestor: 0, format: 'decimal' }, ')'], fallback: 'decimal' };
const picture = { kind: 'image', text: '*', src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAwAAAAMCAYAAABWdVznAAAAFklEQVR4nGO4o2zznxTMMKphVAN2DAArDECw1uKo8wAAAABJRU5ErkJggg==' };

describe('list label compatibility for existing consumers', () => {
  it.each([counter, text])('keeps legacy readers and formatting for $kind', label => {
    expect(readListLabel(label)).toEqual(label);
    expect(readExtendedListLabel(label)).toEqual(label);
    expect(formatListLabel(label, 4)).toBe(label.kind === 'counter' ? 'Step 4)' : '*');
    expect(formatExtendedListLabel(label, 4)).toBe(formatListLabel(label, 4));
  });

  it.each([compound, picture])('does not widen the legacy reader at runtime for $kind', label => {
    expect(readListLabel(label)).toBeNull();
    expect(formatListLabel(label, 4)).toBeNull();
    expect(readExtendedListLabel(label)).toEqual(label);
    expect(formatExtendedListLabel(label, 4)).toBe(label.kind === 'compound' ? '4)' : '*');
  });

  it.each([counter, text, compound, picture])('keeps the old node reader closed while the editor preserves $kind', label => {
    const type = label.kind === 'counter' || label.kind === 'compound' ? 'orderedList' : 'bulletList';
    const editor = new Editor({ extensions: [StarterKit, ListLabels], content: {
      type: 'doc', content: [{ type, attrs: { listLabel: label }, content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body' }] }] },
      ] }],
    } });
    try {
      const list = editor.state.doc.firstChild;
      if (list === null) throw new Error('Missing list');
      expect(nodeExtendedListLabel(list)).toEqual(label);
      expect(nodeListLabel(list)).toEqual(label.kind === 'counter' || label.kind === 'text' ? label : null);
      expect(editor.getJSON().content?.[0]?.attrs?.['listLabel']).toEqual(label);
      expect(editor.getHTML()).toContain('data-dm-list-label');
    } finally { editor.destroy(); }
  });
});
