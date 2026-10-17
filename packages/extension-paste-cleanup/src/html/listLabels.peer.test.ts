// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type * as LabelHelpers from '@domternal/core/list-labels';
import type { ListLabel } from '@domternal/core/list-labels';

// Core 1.5.0 and 1.5.1 expose only these three standalone runtime helpers.
vi.mock('@domternal/core/list-labels', async importOriginal => {
  const original = await importOriginal<typeof LabelHelpers>();
  return {
    formatListLabel: original.formatListLabel,
    getListLabelStyleSheet: original.getListLabelStyleSheet,
    readListLabel(value: unknown): ListLabel | null {
      const label = original.readListLabel(value);
      return label?.kind === 'counter' || label?.kind === 'text' ? label : null;
    },
  };
});

import { normalizePasteHTML } from './normalize.js';

function html(label: unknown): string {
  return `<ol data-dm-list-label="${JSON.stringify(label).replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"><li>Body</li></ol>`;
}

describe('supported older Core standalone list label API', () => {
  it('loads with only the original helpers and preserves their validated label kinds', () => {
    const result = normalizePasteHTML(html({ kind: 'counter', format: 'decimal', prefix: 'Step ', suffix: ')' }));
    expect(result.status).toBe('cleaned'); expect(result.diagnostics).toEqual([]);
    expect(result.html).toContain('data-dm-list-label'); expect(result.html).toContain('Step ');
  });
  it('keeps ordinary content and reports newer records that the installed Core cannot validate', () => {
    const result = normalizePasteHTML(html({ kind: 'compound', parts: [{ ancestor: 0, format: 'decimal' }], fallback: 'decimal' }));
    expect(result.html).not.toContain('data-dm-list-label'); expect(result.html).toContain('Body');
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'unsupported-formatting' }));
  });
});
