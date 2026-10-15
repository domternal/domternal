import { describe, expect, it } from 'vitest';
import { compileListLabelStyles, getListLabelStyleSheet, listLabelStyleName } from './listLabelStyles.js';
import type { JSONContent } from '../types/Content.js';
import type { ListLabel } from '../types/ListLabel.js';

const counter: ListLabel = { kind: 'counter', format: 'upper-roman', prefix: '[', suffix: '] ' };
const bullet: ListLabel = { kind: 'text', text: '✓' };

describe('companion list label stylesheets', () => {
  it('has stable collision-free bounded names and deterministic deduplicated CSS', () => {
    expect(listLabelStyleName(counter)).toMatch(/^dm-ll-[a-f0-9]+$/u);
    expect(listLabelStyleName(counter).length).toBeLessThan(4_102);
    expect(listLabelStyleName(counter)).not.toBe(listLabelStyleName(bullet));
    expect(compileListLabelStyles([counter, bullet, counter])).toBe(compileListLabelStyles([bullet, counter]));
    const css = compileListLabelStyles([counter, bullet]);
    expect(css.match(/@counter-style/g)).toHaveLength(2);
    expect(css).toContain('system: extends upper-roman; prefix: "["; suffix: "] ";');
    expect(css).toContain('system: cyclic; symbols: "✓"; suffix: " ";');
    expect(css).toContain(':root {'); expect(css).toContain(':host {');
  });

  it('keeps style terminators and CSS syntax inside escaped string tokens', () => {
    const css = compileListLabelStyles([{ kind: 'text', text: '</style><script>"\\' }]);
    expect(css).not.toContain('</style>'); expect(css).not.toContain('<script>');
    expect(css).toContain('symbols: "\\3c /style\\3e \\3c script\\3e \\22 \\5c ";');
  });

  it('collects only labels belonging to actual list kinds and does not mutate source JSON', () => {
    const source: JSONContent = { type: 'doc', content: [
      { type: 'orderedList', attrs: { listLabel: counter }, content: [{ type: 'listItem', content: [{ type: 'paragraph' }, { type: 'bulletList', attrs: { listLabel: bullet } }] }] },
      { type: 'paragraph', attrs: { listLabel: counter } },
      { type: 'orderedList', attrs: { listLabel: bullet } },
    ] };
    const before = JSON.stringify(source);
    expect(getListLabelStyleSheet(source)).toBe(compileListLabelStyles([counter, bullet]));
    expect(getListLabelStyleSheet(source.content ?? [])).toBe(compileListLabelStyles([counter, bullet]));
    expect(JSON.stringify(source)).toBe(before);
  });

  it('terminates on shared or cyclic host objects and ignores invalid labels', () => {
    const source: JSONContent = { type: 'orderedList', attrs: { listLabel: counter }, content: [] };
    source.content?.push(source);
    expect(getListLabelStyleSheet(source)).toBe(compileListLabelStyles([counter]));
    expect(getListLabelStyleSheet({ type: 'orderedList', attrs: { listLabel: { kind: 'unknown' } } })).toBe('');
    expect(compileListLabelStyles([])).toBe('');
  });
});
