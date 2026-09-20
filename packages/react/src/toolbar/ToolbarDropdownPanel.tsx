import type { ReactNode } from 'react';
import type { ToolbarButton, ToolbarDropdown } from '@domternal/core';
import { useInnerHtml } from '../useInnerHtml.js';
import { useTooltip } from './useTooltip.js';

export interface ToolbarDropdownPanelProps {
  dropdown: ToolbarDropdown;
  isActive: (name: string) => boolean;
  getCachedIcon: (icon: string) => string;
  onItemClick: (item: ToolbarButton, event: React.MouseEvent) => void;
}

export function ToolbarDropdownPanel({
  dropdown,
  isActive,
  getCachedIcon,
  onItemClick,
}: ToolbarDropdownPanelProps): ReactNode {
  // Before the grid early return: hooks cannot sit behind a branch.
  const innerHtml = useInnerHtml();
  const { getTooltip } = useTooltip();
  if (dropdown.layout === 'grid') {
    return (
      <div
        className="dm-toolbar-dropdown-panel dm-color-palette"
        role="menu"
        style={{ '--dm-palette-columns': String(dropdown.gridColumns ?? 10) } as React.CSSProperties}
      >
        {dropdown.items.map((sub: ToolbarButton) =>
          sub.color ? (
            <button
              key={sub.name}
              type="button"
              className={`dm-color-swatch${isActive(sub.name) ? ' dm-color-swatch--active' : ''}`}
              role="menuitem"
              tabIndex={-1}
              aria-label={sub.label}
              lang={sub.labelLanguage ?? ''}
              title={getTooltip(sub)}
              style={{ backgroundColor: sub.color }}
              onMouseDown={(e) => { e.preventDefault(); }}
              onClick={(e) => { onItemClick(sub, e); }}
            />
          ) : (
            <button
              key={sub.name}
              type="button"
              className="dm-color-palette-reset"
              role="menuitem"
              tabIndex={-1}
              aria-label={sub.label}
              lang={sub.labelLanguage ?? ''}
              title={getTooltip(sub)}
              onMouseDown={(e) => { e.preventDefault(); }}
              onClick={(e) => { onItemClick(sub, e); }}
            >
              <span style={{ display: 'contents' }} aria-hidden="true" dangerouslySetInnerHTML={innerHtml(getCachedIcon(sub.icon))} />
              {' '}{sub.label}
            </button>
          ),
        )}
      </div>
    );
  }

  return (
    <div
      className="dm-toolbar-dropdown-panel"
      role="menu"
      data-display-mode={dropdown.displayMode ?? null}
    >
      {dropdown.items.map((sub: ToolbarButton) => (
        <button
          key={sub.name}
          type="button"
          className={`dm-toolbar-dropdown-item${isActive(sub.name) ? ' dm-toolbar-dropdown-item--active' : ''}`}
          role="menuitem"
          tabIndex={-1}
          aria-label={sub.label}
          lang={sub.labelLanguage ?? ''}
          title={getTooltip(sub)}
          ref={(el: HTMLButtonElement | null) => { if (el && sub.style) el.setAttribute('style', sub.style); }}
          onMouseDown={(e) => { e.preventDefault(); }}
          onClick={(e) => { onItemClick(sub, e); }}
        >
          {dropdown.displayMode !== 'text' && <span style={{ display: 'contents' }} aria-hidden="true" dangerouslySetInnerHTML={innerHtml(getCachedIcon(sub.icon))} />}
          {dropdown.displayMode !== 'icon' && <>{dropdown.displayMode !== 'text' && ' '}{sub.label}</>}
        </button>
      ))}
    </div>
  );
}
