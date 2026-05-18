/**
 * Fixtures for the bubble menu `icons` override e2e suite.
 *
 * Each fixture SVG carries a `data-test-icon="custom-<key>"` attribute so
 * Playwright can assert which icon was rendered for each button.
 */

import type { IconSet } from '@domternal/core';

export type BubbleIconsParam = 'default' | 'full' | 'partial' | 'empty' | 'malformed' | 'html';

function customSvgFor(name: string): string {
  return `<svg viewBox="0 0 24 24" data-test-icon="custom-${name}" width="16" height="16"><circle cx="12" cy="12" r="10"/></svg>`;
}

export const FULL_OVERRIDE: IconSet = {
  bold: customSvgFor('bold'),
  italic: customSvgFor('italic'),
  underline: customSvgFor('underline'),
  strike: customSvgFor('strike'),
  code: customSvgFor('code'),
  link: customSvgFor('link'),
  highlight: customSvgFor('highlight'),
  subscript: customSvgFor('subscript'),
  superscript: customSvgFor('superscript'),
  textAlignLeft: customSvgFor('textAlignLeft'),
  textAlignCenter: customSvgFor('textAlignCenter'),
  textAlignRight: customSvgFor('textAlignRight'),
  textAlignJustify: customSvgFor('textAlignJustify'),
  dotsThree: customSvgFor('dotsThree'),
};

export const PARTIAL_OVERRIDE: IconSet = {
  bold: customSvgFor('bold'),
  italic: customSvgFor('italic'),
};

export const EMPTY_OVERRIDE: IconSet = {};

export const MALFORMED_OVERRIDE: IconSet = {
  bold: '',
};

export const HTML_OVERRIDE: IconSet = {
  bold: '<span class="my-bold-icon">B</span>',
};

export function resolveBubbleIcons(param: BubbleIconsParam | null): IconSet | undefined {
  switch (param) {
    case 'full': return FULL_OVERRIDE;
    case 'partial': return PARTIAL_OVERRIDE;
    case 'empty': return EMPTY_OVERRIDE;
    case 'malformed': return MALFORMED_OVERRIDE;
    case 'html': return HTML_OVERRIDE;
    case 'default':
    case null:
    default:
      return undefined;
  }
}

export function parseBubbleIconsParam(): BubbleIconsParam | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const value = params.get('bubble-icons');
  if (value === 'full' || value === 'partial' || value === 'empty' || value === 'malformed' || value === 'html' || value === 'default') {
    return value;
  }
  return null;
}

export function parseBubbleItemsParam(): string[] | undefined {
  if (typeof window === 'undefined') return undefined;
  const params = new URLSearchParams(window.location.search);
  const value = params.get('bubble-items');
  if (!value) return undefined;
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}
