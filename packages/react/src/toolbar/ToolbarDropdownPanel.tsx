import type { ToolbarButton, ToolbarDropdown } from '@domternal/core';

export interface ToolbarDropdownPanelProps {
  dropdown: ToolbarDropdown;
  isActive: (name: string) => boolean;
  getCachedItemContent: (icon: string, label: string, mode?: 'icon-text' | 'text' | 'icon') => string;
  onItemClick: (item: ToolbarButton, event: React.MouseEvent) => void;
}

export function ToolbarDropdownPanel({
  dropdown,
  isActive,
  getCachedItemContent,
  onItemClick,
}: ToolbarDropdownPanelProps) {
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
              aria-label={sub.label}
              title={sub.label}
              style={{ backgroundColor: sub.color }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => onItemClick(sub, e)}
            />
          ) : (
            <button
              key={sub.name}
              type="button"
              className="dm-color-palette-reset"
              role="menuitem"
              aria-label={sub.label}
              dangerouslySetInnerHTML={{ __html: getCachedItemContent(sub.icon, sub.label) }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => onItemClick(sub, e)}
            />
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
          aria-label={sub.label}
          ref={(el: HTMLButtonElement | null) => { if (el && sub.style) el.setAttribute('style', sub.style); }}
          dangerouslySetInnerHTML={{ __html: getCachedItemContent(sub.icon, sub.label, dropdown.displayMode) }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => onItemClick(sub, e)}
        />
      ))}
    </div>
  );
}
