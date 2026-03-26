import type { ToolbarButton, ToolbarDropdown as ToolbarDropdownType } from '@domternal/core';
import { ToolbarDropdownPanel } from './ToolbarDropdownPanel.js';

export interface ToolbarDropdownProps {
  dropdown: ToolbarDropdownType;
  isOpen: boolean;
  isActive: (name: string) => boolean;
  isDropdownActive: boolean;
  isDisabled: boolean;
  tabIndex: number;
  triggerHtml: string;
  getCachedItemContent: (icon: string, label: string, mode?: 'icon-text' | 'text' | 'icon') => string;
  onToggle: (dropdown: ToolbarDropdownType) => void;
  onItemClick: (item: ToolbarButton, event: React.MouseEvent) => void;
  onFocus: (name: string) => void;
}

export function ToolbarDropdown({
  dropdown,
  isOpen,
  isActive,
  isDropdownActive,
  isDisabled,
  tabIndex,
  triggerHtml,
  getCachedItemContent,
  onToggle,
  onItemClick,
  onFocus,
}: ToolbarDropdownProps) {
  return (
    <div className="dm-toolbar-dropdown-wrapper">
      <button
        type="button"
        className={`dm-toolbar-button dm-toolbar-dropdown-trigger${isDropdownActive ? ' dm-toolbar-button--active' : ''}`}
        aria-expanded={isOpen}
        aria-haspopup="true"
        aria-label={dropdown.label}
        title={dropdown.label}
        tabIndex={tabIndex}
        disabled={isDisabled}
        data-dropdown={dropdown.name}
        dangerouslySetInnerHTML={{ __html: triggerHtml }}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onToggle(dropdown)}
        onFocus={() => onFocus(dropdown.name)}
      />
      {isOpen && (
        <ToolbarDropdownPanel
          dropdown={dropdown}
          isActive={isActive}
          getCachedItemContent={getCachedItemContent}
          onItemClick={onItemClick}
        />
      )}
    </div>
  );
}
