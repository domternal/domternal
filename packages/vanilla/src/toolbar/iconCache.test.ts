import { describe, expect, it } from 'vitest';
import type { ToolbarButton, ToolbarDropdown } from '@domternal/core';
import { createIconCache } from './iconCache.js';

const TRUSTED_ICON = '<svg viewBox="0 0 10 10"><path d="M0 0h10v10z"/></svg>';

function button(color?: string): ToolbarButton {
  return {
    type: 'button',
    name: 'color',
    command: 'setColor',
    icon: 'custom',
    label: 'Color',
    ...(color === undefined ? {} : { color }),
  };
}

function gridDropdown(defaultIndicatorColor?: string): ToolbarDropdown {
  return {
    type: 'dropdown',
    name: 'colors',
    icon: 'custom',
    label: 'Colors',
    layout: 'grid',
    items: [button()],
    ...(defaultIndicatorColor === undefined ? {} : { defaultIndicatorColor }),
  };
}

function rendered(html: string): HTMLDivElement {
  const container = document.createElement('div');
  container.innerHTML = html;
  return container;
}

describe('createIconCache security boundaries', () => {
  it('preserves trusted custom SVG and invalidates it when the icon set changes', () => {
    const cache = createIconCache({ custom: TRUSTED_ICON });
    expect(cache.getIcon('custom')).toBe(TRUSTED_ICON);

    const replacement = '<svg viewBox="0 0 8 8"><circle cx="4" cy="4" r="3"/></svg>';
    cache.setIcons({ custom: replacement });
    expect(cache.getIcon('custom')).toBe(replacement);
  });

  it('renders labels as text instead of markup', () => {
    const cache = createIconCache({ custom: TRUSTED_ICON });
    const label = `<img src=x onerror="globalThis.compromised=true"> & "quoted" 'single'`;

    for (const html of [
      cache.getTriggerLabel(label),
      cache.getItemContent('custom', label, 'text'),
      cache.getItemContent('custom', label, 'icon-text'),
    ]) {
      const container = rendered(html);
      expect(container.querySelector('img')).toBeNull();
      expect(container.textContent).toContain(label);
    }
  });

  it.each([
    '#fff"></span><img src=x onerror="globalThis.compromised=true">',
    '#fff&quot;><img src=x>',
    '#fff;background-image:url(javascript:alert(1))',
    '#fff\nbackground-image:url(https://attacker.invalid)',
    'url(javascript:alert(1))',
  ])('omits an unsafe default indicator color: %s', (color) => {
    const cache = createIconCache({ custom: TRUSTED_ICON });
    const container = rendered(cache.getDropdownTriggerHtml(gridDropdown(color), undefined));

    expect(container.querySelector('.dm-toolbar-color-indicator')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.innerHTML).not.toContain('javascript:');
  });

  it.each(['#000', '#00000080', 'rgb(1, 2, 3)', 'var(--brand-color)'])(
    'keeps a valid indicator color: %s',
    (color) => {
      const cache = createIconCache({ custom: TRUSTED_ICON });
      const container = rendered(cache.getDropdownTriggerHtml(gridDropdown(color), undefined));
      const indicator = container.querySelector<HTMLElement>('.dm-toolbar-color-indicator');

      expect(indicator).not.toBeNull();
      expect(indicator?.style.backgroundColor).not.toBe('');
    },
  );

  it('validates the active item color before it overrides the safe default', () => {
    const cache = createIconCache({ custom: TRUSTED_ICON });
    const active = button('#fff"></span><img src=x>');
    const container = rendered(cache.getDropdownTriggerHtml(gridDropdown('#123456'), active));

    expect(container.querySelector('.dm-toolbar-color-indicator')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });
});
