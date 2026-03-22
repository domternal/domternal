import type { ToolbarButton as ToolbarButtonType } from '@domternal/core';

export interface ToolbarButtonProps {
  item: ToolbarButtonType;
  isActive: boolean;
  isDisabled: boolean;
  tabIndex: number;
  tooltip: string;
  iconHtml: string;
  ariaExpanded?: string | null;
  onClick: (item: ToolbarButtonType, event: React.MouseEvent) => void;
  onFocus: (name: string) => void;
}

export function ToolbarButton({
  item,
  isActive,
  isDisabled,
  tabIndex,
  tooltip,
  iconHtml,
  ariaExpanded,
  onClick,
  onFocus,
}: ToolbarButtonProps) {
  return (
    <button
      type="button"
      className={`dm-toolbar-button${isActive ? ' dm-toolbar-button--active' : ''}`}
      aria-pressed={isActive}
      aria-expanded={ariaExpanded ?? undefined}
      aria-label={item.label}
      title={tooltip}
      tabIndex={tabIndex}
      disabled={isDisabled}
      dangerouslySetInnerHTML={{ __html: iconHtml }}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => onClick(item, e)}
      onFocus={() => onFocus(item.name)}
    />
  );
}
