import { describe, expect, it } from 'vitest';
import { TableOfContents } from './TableOfContents.js';

describe('TableOfContents (Phase 1 placeholder)', () => {
  it('registers under name "toc"', () => {
    expect(TableOfContents.name).toBe('toc');
  });

  it('initialises empty TocStorage', () => {
    // Storage default is provided via the `addStorage` hook on the
    // extension config. We assert the contract here so future phases can
    // safely expand the shape without breaking consumer expectations.
    const storage = TableOfContents.config.addStorage?.call({} as never);
    expect(storage).toEqual({ content: [], activeId: null });
  });
});
