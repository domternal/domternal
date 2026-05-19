/**
 * Fixtures for the bubble menu `icons` override e2e suite.
 *
 * Each fixture SVG carries a `data-test-icon="custom-<label>"` attribute so
 * Playwright can assert which icon was rendered for each button.
 *
 * IconSet keys must match core's actual icon names (e.g. Bold uses `textB`).
 * The marker label stays user-readable (e.g. `custom-bold`) so tests stay
 * readable.
 */

import type { IconSet } from '@domternal/core';

export type BubbleIconsParam = 'default' | 'full' | 'partial' | 'empty' | 'malformed' | 'html';

function customSvgFor(label: string): string {
  return `<svg viewBox="0 0 24 24" data-test-icon="custom-${label}" width="16" height="16"><circle cx="12" cy="12" r="10"/></svg>`;
}

export const FULL_OVERRIDE: IconSet = {
  textB: customSvgFor('bold'),
  textItalic: customSvgFor('italic'),
  textUnderline: customSvgFor('underline'),
  textStrikethrough: customSvgFor('strike'),
  code: customSvgFor('code'),
  link: customSvgFor('link'),
  highlighterCircle: customSvgFor('highlight'),
  textSubscript: customSvgFor('subscript'),
  textSuperscript: customSvgFor('superscript'),
  textAlignLeft: customSvgFor('textAlignLeft'),
  textAlignCenter: customSvgFor('textAlignCenter'),
  textAlignRight: customSvgFor('textAlignRight'),
  textAlignJustify: customSvgFor('textAlignJustify'),
  dotsThree: customSvgFor('dotsThree'),
};

export const PARTIAL_OVERRIDE: IconSet = {
  textB: customSvgFor('bold'),
  textItalic: customSvgFor('italic'),
};

export const EMPTY_OVERRIDE: IconSet = {};

export const MALFORMED_OVERRIDE: IconSet = {
  textB: '',
};

export const HTML_OVERRIDE: IconSet = {
  textB: '<span class="my-bold-icon">B</span>',
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
