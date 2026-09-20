import { describe, expect, it } from 'vitest';
import { patchIconText, safeIndicatorColor } from './presentation.js';

const TRUSTED_ICON = '<svg viewBox="0 0 10 10"><path d="M0 0h10v10z"/></svg>';

describe('presentation security boundaries', () => {
  it('renders labels as text and rejects an unsafe indicator color', () => {
    const element = document.createElement('button');
    const label = `<img src=x onerror="globalThis.compromised=true"> & "quoted" 'single'`;

    patchIconText(element, TRUSTED_ICON, label, {
      color: '#fff"></span><img src=x onerror="globalThis.compromised=true">',
    });

    expect(element.querySelector('img')).toBeNull();
    expect(element.textContent).toContain(label);
    expect(element.querySelector('.dm-toolbar-color-indicator')).toBeNull();
  });

  it('keeps and updates valid indicator colors through the DOM style property', () => {
    const element = document.createElement('button');

    patchIconText(element, TRUSTED_ICON, null, { color: '#123456' });
    const indicator = element.querySelector<HTMLElement>('.dm-toolbar-color-indicator');
    expect(indicator?.style.backgroundColor).toBe('rgb(18, 52, 86)');

    patchIconText(element, TRUSTED_ICON, null, { color: 'rgb(1, 2, 3)' });
    expect(element.querySelector('.dm-toolbar-color-indicator')).toBe(indicator);
    expect(indicator?.style.backgroundColor).toBe('rgb(1, 2, 3)');
  });

  it.each([
    'red; background-image: url(https://attacker.invalid)',
    '#fff&NewLine;background-image:url(https://attacker.invalid)',
    "#fff'",
    '#fff\u0000',
    '#fff\n',
  ])('rejects unsafe CSS or HTML syntax: %s', (color) => {
    expect(safeIndicatorColor(color)).toBeNull();
  });

  it('rejects non-string runtime input', () => {
    expect(safeIndicatorColor({ toString: () => '#123456' } as unknown as string)).toBeNull();
  });
});
