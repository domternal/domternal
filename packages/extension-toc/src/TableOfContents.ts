/**
 * TableOfContents - Notion-style data layer for headings in the document.
 *
 * Phase 1 placeholder: a no-op extension that registers under the name
 * `tableOfContents` so it can be added to `extensions: []` and wired up
 * incrementally in Phase 2 (heading walk + data-toc-id assignment) and
 * Phase 5 (active-state IntersectionObserver).
 *
 * The shipped storage shape mirrors what consumers will read on
 * `editor.storage.toc`. Keep the empty defaults here so the type contract
 * is stable from day 1.
 */
import { Extension } from '@domternal/core';
import type { TocStorage } from './types.js';

export const TableOfContents = Extension.create<Record<string, never>, TocStorage>({
  name: 'toc',

  addStorage() {
    return {
      content: [],
      activeId: null,
    };
  },
});
