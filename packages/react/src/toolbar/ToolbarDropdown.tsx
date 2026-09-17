import type { ReactNode } from 'react';
import type { ToolbarButton, ToolbarDropdown as ToolbarDropdownType } from '@domternal/core';
import { useInnerHtml } from '../useInnerHtml.js';
import { DROPDOWN_CARET } from './useToolbarIcons.js';
import { ToolbarDropdownPanel } from './ToolbarDropdownPanel.js';

export interface ToolbarDropdownProps {
  dropdown: ToolbarDropdownType;
  isOpen: boolean;
  isActive: (name: string) => boolean;
  isDropdownActive: boolean;
  isDisabled: boolean;
  tabIndex: number;
  activeItem?: ToolbarButton | undefined;
  computedLabel?: string | undefined;
  getCachedIcon: (icon: string) => string;
  onToggle: (dropdown: ToolbarDropdownType) => void;
  onItemClick: (item: ToolbarButton, event: React.MouseEvent) => void;
  onFocus: (name: string) => void;
}

export function ToolbarDropdown({
  dropdown, isOpen, isActive, isDropdownActive, isDisabled, tabIndex,
  activeItem, computedLabel, getCachedIcon, onToggle, onItemClick, onFocus,
}: ToolbarDropdownProps): ReactNode {
  const innerHtml = useInnerHtml();
  const isGrid = dropdown.layout === 'grid';
  const label = !isGrid && dropdown.dynamicLabel
    ? computedLabel ?? activeItem?.label ?? dropdown.dynamicLabelFallback
    : undefined;
  const labelLanguage = computedLabel ? undefined : (activeItem ? activeItem.labelLanguage : dropdown.labelLanguage);
  const icon = !isGrid && dropdown.dynamicIcon && activeItem ? activeItem.icon : dropdown.icon;
  const color = isGrid ? activeItem?.color ?? dropdown.defaultIndicatorColor : undefined;
  return (
    <div className="dm-toolbar-dropdown-wrapper">
      <button
        type="button"
        className={`dm-toolbar-button dm-toolbar-dropdown-trigger${isDropdownActive ? ' dm-toolbar-button--active' : ''}`}
        aria-expanded={isOpen}
        aria-haspopup="true"
        aria-label={dropdown.label}
        lang={dropdown.labelLanguage ?? ''}
        title={dropdown.label}
        tabIndex={tabIndex}
        disabled={isDisabled}
        data-dropdown={dropdown.name}
        onMouseDown={(e) => { e.preventDefault(); }}
        onClick={() => { onToggle(dropdown); }}
        onFocus={() => { onFocus(dropdown.name); }}
      >
        {label !== undefined
          ? <span className="dm-toolbar-trigger-label" lang={labelLanguage ?? ''}>{label}</span>
          : <span className={dropdown.dynamicLabel && !isGrid ? 'dm-toolbar-trigger-label' : undefined}
              style={dropdown.dynamicLabel && !isGrid ? undefined : { display: 'contents' }} aria-hidden="true" dangerouslySetInnerHTML={innerHtml(getCachedIcon(icon))} />}
        <span style={{ display: 'contents' }} aria-hidden="true" dangerouslySetInnerHTML={innerHtml(DROPDOWN_CARET)} />
        {color && <span className="dm-toolbar-color-indicator" style={{ backgroundColor: color }} />}
      </button>
      {isOpen && (
        <ToolbarDropdownPanel
          dropdown={dropdown}
          isActive={isActive}
          getCachedIcon={getCachedIcon}
          onItemClick={onItemClick}
        />
      )}
    </div>
  );
}
