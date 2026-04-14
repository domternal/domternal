import { useCallback } from 'react';
import type { ToolbarController } from '@domternal/core';

export function useKeyboardNav(
  controllerRef: React.RefObject<ToolbarController | null>,
  toolbarRef: React.RefObject<HTMLDivElement | null>,
  closeDropdown: () => void,
) {
  const focusCurrentButton = useCallback(() => {
    const idx = controllerRef.current?.focusedIndex ?? 0;
    const buttons = toolbarRef.current?.querySelectorAll('.dm-toolbar-button') as NodeListOf<HTMLButtonElement> | undefined;
    buttons?.[idx]?.focus();
  }, []); // controllerRef and toolbarRef are stable refs

  const focusDropdownItem = useCallback((direction: number, first?: boolean) => {
    const panel = toolbarRef.current?.querySelector('.dm-toolbar-dropdown-panel') as HTMLElement | null;
    if (!panel) return;
    const items = Array.from(panel.querySelectorAll('[role="menuitem"]')) as HTMLElement[];
    if (!items.length) return;
    if (first) { items[0]?.focus(); return; }
    const current = document.activeElement as HTMLElement;
    const idx = items.indexOf(current);
    const next = idx === -1
      ? (direction > 0 ? 0 : items.length - 1)
      : (idx + direction + items.length) % items.length;
    items[next]?.focus();
  }, []);

  const onKeyDown = useCallback((event: React.KeyboardEvent) => {
    const controller = controllerRef.current;
    if (!controller) return;

    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        controller.navigateNext();
        focusCurrentButton();
        break;
      case 'ArrowLeft':
        event.preventDefault();
        controller.navigatePrev();
        focusCurrentButton();
        break;
      case 'ArrowDown': {
        event.preventDefault();
        if (controller.openDropdown) {
          focusDropdownItem(1);
        } else {
          const btn = document.activeElement as HTMLElement | null;
          if (btn?.getAttribute('aria-haspopup') && btn.closest('.dm-toolbar')) {
            btn.click();
            requestAnimationFrame(() => focusDropdownItem(0, true));
          }
        }
        break;
      }
      case 'ArrowUp': {
        event.preventDefault();
        if (controller.openDropdown) {
          focusDropdownItem(-1);
        }
        break;
      }
      case 'Home':
        event.preventDefault();
        controller.navigateFirst();
        focusCurrentButton();
        break;
      case 'End':
        event.preventDefault();
        controller.navigateLast();
        focusCurrentButton();
        break;
      case 'Escape':
        if (controller.openDropdown) {
          event.preventDefault();
          closeDropdown();
          focusCurrentButton();
        }
        break;
    }
  }, [closeDropdown, focusCurrentButton, focusDropdownItem]);

  return { onKeyDown, focusCurrentButton };
}
