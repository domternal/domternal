import { useCallback } from 'react';
import type {
  Editor,
  IconSet,
  ToolbarButton as ToolbarButtonType,
  ToolbarDropdown as ToolbarDropdownType,
  ToolbarItem,
  ToolbarLayoutEntry,
} from '@domternal/core';
import { useCurrentEditor } from '../EditorContext.js';
import { useToolbarController } from './useToolbarController.js';
import { useToolbarIcons } from './useToolbarIcons.js';
import { useTooltip } from './useTooltip.js';
import { useKeyboardNav } from './useKeyboardNav.js';
import { getComputedStyleAtCursor, getInlineStyleAtCursor } from './useComputedStyle.js';
import { ToolbarButton } from './ToolbarButton.js';
import { ToolbarDropdown } from './ToolbarDropdown.js';

export interface DomternalToolbarProps {
  /** The editor instance. If omitted, uses EditorProvider context. */
  editor?: Editor;
  /** Custom icon set. When provided, only these icons are used (no defaultIcons fallback). */
  icons?: IconSet;
  /** Custom toolbar layout. */
  layout?: ToolbarLayoutEntry[];
}

export function DomternalToolbar({ editor: editorProp, icons, layout }: DomternalToolbarProps) {
  const { editor: contextEditor } = useCurrentEditor();
  const editor = editorProp ?? contextEditor;

  const {
    controller: controllerRef,
    groups,
    focusedIndex,
    openDropdown,
    activeVersion,
    toolbarRef,
    isActive,
    isDisabled,
    isDropdownActive,
    getAriaExpanded,
    getFlatIndex,
    handleDropdownToggle,
    closeDropdown,
    syncState,
  } = useToolbarController(editor, layout);

  const {
    getCachedIcon,
    getCachedItemContent,
    getDropdownTriggerHtml,
  } = useToolbarIcons(icons);

  const { getTooltip } = useTooltip();
  const { onKeyDown } = useKeyboardNav(controllerRef, toolbarRef, closeDropdown);

  const onButtonClick = useCallback((item: ToolbarButtonType, event: React.MouseEvent) => {
    if (!editor) return;

    // Close any open dropdown first
    if (controllerRef.current?.openDropdown) {
      closeDropdown();
    }

    if (item.emitEvent) {
      const anchor = event.currentTarget as HTMLElement;
      (editor.emit as (e: string, d: unknown) => void)(item.emitEvent, { anchorElement: anchor });
      return;
    }
    controllerRef.current?.executeCommand(item);
  }, [editor, controllerRef, closeDropdown]);

  const onDropdownItemClick = useCallback((item: ToolbarButtonType, event: React.MouseEvent) => {
    if (!editor) return;

    let anchor: HTMLElement | undefined;
    if (item.emitEvent) {
      const wrapper = (event.currentTarget as HTMLElement).closest('.dm-toolbar-dropdown-wrapper');
      anchor = wrapper?.querySelector('.dm-toolbar-dropdown-trigger') as HTMLElement | undefined;
    }

    closeDropdown();

    if (item.emitEvent) {
      (editor.emit as (e: string, d: unknown) => void)(item.emitEvent, { anchorElement: anchor });
    } else {
      controllerRef.current?.executeCommand(item);
    }
  }, [editor, controllerRef, closeDropdown]);

  const onButtonFocus = useCallback((name: string) => {
    const index = controllerRef.current?.getFlatIndex(name) ?? -1;
    if (index >= 0) {
      controllerRef.current?.setFocusedIndex(index);
    }
  }, [controllerRef]);

  // Force re-read of activeVersion in render to subscribe to state changes
  void activeVersion;

  if (!editor) return null;

  return (
    <div
      ref={toolbarRef}
      className="dm-toolbar"
      role="toolbar"
      aria-label="Editor formatting"
      onKeyDown={onKeyDown}
    >
      {groups.map((group, gi) => (
        <div key={group.name} className="dm-toolbar-group" role="group" aria-label={group.name || 'Tools'}>
          {gi > 0 && <div className="dm-toolbar-separator" role="separator" />}
          {group.items.map((item: ToolbarItem) => {
            if (item.type === 'button') {
              const btn = item as ToolbarButtonType;
              return (
                <ToolbarButton
                  key={btn.name}
                  item={btn}
                  isActive={isActive(btn.name)}
                  isDisabled={isDisabled(btn.name)}
                  tabIndex={getFlatIndex(btn.name) === focusedIndex ? 0 : -1}
                  tooltip={getTooltip(btn)}
                  iconHtml={getCachedIcon(btn.icon)}
                  ariaExpanded={getAriaExpanded(btn)}
                  onClick={onButtonClick}
                  onFocus={onButtonFocus}
                />
              );
            }
            if (item.type === 'dropdown') {
              const dd = item as ToolbarDropdownType;
              const activeItem = dd.items.find((sub) => controllerRef.current?.activeMap.get(sub.name));

              // Handle dynamic label with computed style
              let triggerHtml = getDropdownTriggerHtml(dd, activeItem);
              if (dd.dynamicLabel && !activeItem && dd.computedStyleProperty) {
                let computed: string | null;
                if (dd.computedStyleProperty === 'font-family') {
                  computed = getInlineStyleAtCursor(editor, dd.computedStyleProperty);
                  if (computed) {
                    const first = computed.split(',')[0]?.replace(/['"]+/g, '').trim();
                    computed = first || null;
                  }
                } else {
                  computed = getComputedStyleAtCursor(editor, dd.computedStyleProperty);
                }
                if (computed) {
                  // Re-generate trigger with computed value
                  triggerHtml = `<span class="dm-toolbar-trigger-label">${computed}</span><svg class="dm-dropdown-caret" width="10" height="10" viewBox="0 0 10 10"><path d="M2 4l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
                }
              }

              return (
                <ToolbarDropdown
                  key={dd.name}
                  dropdown={dd}
                  isOpen={openDropdown === dd.name}
                  isActive={isActive}
                  isDropdownActive={isDropdownActive(dd)}
                  isDisabled={isDisabled(dd.name)}
                  tabIndex={getFlatIndex(dd.name) === focusedIndex ? 0 : -1}
                  triggerHtml={triggerHtml}
                  getCachedItemContent={getCachedItemContent}
                  getCachedIcon={getCachedIcon}
                  onToggle={handleDropdownToggle}
                  onItemClick={onDropdownItemClick}
                  onFocus={onButtonFocus}
                />
              );
            }
            return null;
          })}
        </div>
      ))}
    </div>
  );
}
