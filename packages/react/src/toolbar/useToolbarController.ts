import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ToolbarController,
  positionFloatingOnce,
} from '@domternal/core';
import type {
  Editor,
  ToolbarButton,
  ToolbarDropdown,
  ToolbarControllerEditor,
  ToolbarGroup,
  ToolbarLayoutEntry,
} from '@domternal/core';

export function useToolbarController(
  editor: Editor | null,
  layout?: ToolbarLayoutEntry[],
) {
  const [groups, setGroups] = useState<ToolbarGroup[]>([]);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [activeVersion, setActiveVersion] = useState(0);

  const controllerRef = useRef<ToolbarController | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const cleanupFloatingRef = useRef<(() => void) | null>(null);
  const clickOutsideRef = useRef<((e: Event) => void) | null>(null);
  const dismissOverlayRef = useRef<(() => void) | null>(null);
  const editorElRef = useRef<HTMLElement | null>(null);

  const syncStateRafRef = useRef(0);
  const syncState = useCallback(() => {
    // Defer state update to next animation frame so it doesn't interrupt
    // the current event cycle (e.g. mousedown → click on toolbar buttons).
    // Without this, a no-op transaction between mousedown and click causes
    // React to re-render and replace DOM nodes, swallowing the click event.
    cancelAnimationFrame(syncStateRafRef.current);
    syncStateRafRef.current = requestAnimationFrame(() => {
      const controller = controllerRef.current;
      if (!controller) return;

      const controllerGroups = controller.groups;
      setGroups(prev => prev.length !== controllerGroups.length ? controllerGroups : prev);
      setFocusedIndex(controller.focusedIndex);
      setOpenDropdown(controller.openDropdown);
      setActiveVersion(v => v + 1);
    });
  }, []);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;

    const controller = new ToolbarController(
      editor as unknown as ToolbarControllerEditor,
      syncState,
      layout,
    );
    controller.subscribe();
    controllerRef.current = controller;
    syncState();

    // Click outside to close dropdown
    const clickOutside = (e: Event) => {
      if (controller.openDropdown && toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        cleanupFloatingRef.current?.();
        cleanupFloatingRef.current = null;
        controller.closeDropdown();
        syncState();
      }
    };
    clickOutsideRef.current = clickOutside;
    document.addEventListener('mousedown', clickOutside);

    // Dismiss overlays (e.g. table handle clicks)
    const editorEl = editor.view.dom.closest('.dm-editor') as HTMLElement | null;
    editorElRef.current = editorEl;
    if (editorEl) {
      const dismiss = () => {
        if (controller.openDropdown) {
          cleanupFloatingRef.current?.();
          cleanupFloatingRef.current = null;
          controller.closeDropdown();
          syncState();
        }
      };
      dismissOverlayRef.current = dismiss;
      editorEl.addEventListener('dm:dismiss-overlays', dismiss);
    }

    return () => {
      cleanupFloatingRef.current?.();
      cleanupFloatingRef.current = null;

      if (clickOutsideRef.current) {
        document.removeEventListener('mousedown', clickOutsideRef.current);
        clickOutsideRef.current = null;
      }

      if (dismissOverlayRef.current && editorElRef.current) {
        editorElRef.current.removeEventListener('dm:dismiss-overlays', dismissOverlayRef.current);
        dismissOverlayRef.current = null;
        editorElRef.current = null;
      }

      controller.destroy();
      controllerRef.current = null;
    };
  }, [editor, layout, syncState]);

  const isActive = useCallback((name: string): boolean => {
    // activeVersion used in component render to subscribe to changes
    return controllerRef.current?.activeMap.get(name) ?? false;
  }, []);

  const isDisabled = useCallback((name: string): boolean => {
    return controllerRef.current?.disabledMap.get(name) ?? false;
  }, []);

  const isDropdownActive = useCallback((dropdown: ToolbarDropdown): boolean => {
    if (dropdown.layout === 'grid') return false;
    if (dropdown.dynamicLabel) return false;
    const controller = controllerRef.current;
    if (!controller) return false;
    return dropdown.items.some((item: ToolbarButton) => controller.activeMap.get(item.name) ?? false);
  }, []);

  const getAriaExpanded = useCallback((item: ToolbarButton): string | null => {
    if (!item.emitEvent) return null;
    return controllerRef.current?.expandedMap.get(item.name) ? 'true' : null;
  }, []);

  const getFlatIndex = useCallback((name: string): number => {
    return controllerRef.current?.getFlatIndex(name) ?? -1;
  }, []);

  const focusCurrentButton = useCallback(() => {
    const idx = controllerRef.current?.focusedIndex ?? 0;
    const buttons = toolbarRef.current?.querySelectorAll('.dm-toolbar-button') as NodeListOf<HTMLButtonElement> | undefined;
    buttons?.[idx]?.focus();
  }, []);

  const handleDropdownToggle = useCallback((dropdown: ToolbarDropdown) => {
    const controller = controllerRef.current;
    if (!controller) return;

    cleanupFloatingRef.current?.();
    cleanupFloatingRef.current = null;
    controller.toggleDropdown(dropdown.name);
    syncState();

    if (controller.openDropdown) {
      requestAnimationFrame(() => {
        const trigger = toolbarRef.current?.querySelector('[aria-expanded="true"]') as HTMLElement | null;
        const panel = trigger?.parentElement?.querySelector('.dm-toolbar-dropdown-panel') as HTMLElement | null;
        if (trigger && panel) {
          const placement = dropdown.layout === 'grid' ? 'bottom' : 'bottom-start';
          cleanupFloatingRef.current = positionFloatingOnce(trigger, panel, {
            placement,
            offsetValue: 4,
          });
        }
      });
    }
  }, [syncState]);

  const closeDropdown = useCallback(() => {
    cleanupFloatingRef.current?.();
    cleanupFloatingRef.current = null;
    controllerRef.current?.closeDropdown();
    syncState();
  }, [syncState]);

  return {
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
    focusCurrentButton,
    handleDropdownToggle,
    closeDropdown,
    syncState,
  };
}
