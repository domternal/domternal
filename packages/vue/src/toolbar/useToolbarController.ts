import { onScopeDispose, ref, shallowRef, watch } from 'vue';
import type { ShallowRef } from 'vue';
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
import { useDebouncedRef } from '../utils.js';

export function useToolbarController(
  editor: ShallowRef<Editor | null>,
  layout?: ToolbarLayoutEntry[],
) {
  const groups = shallowRef<ToolbarGroup[]>([]);
  const focusedIndex = ref(0);
  const openDropdown = ref<string | null>(null);
  const activeVersion = useDebouncedRef(0);

  let controller: ToolbarController | null = null;
  const toolbarRef = ref<HTMLDivElement>();
  let cleanupFloating: (() => void) | null = null;
  let clickOutsideHandler: ((e: Event) => void) | null = null;
  let dismissOverlayHandler: (() => void) | null = null;
  let editorEl: HTMLElement | null = null;
  let syncStateRaf = 0;

  function syncState() {
    cancelAnimationFrame(syncStateRaf);
    syncStateRaf = requestAnimationFrame(() => {
      if (!controller) return;

      const controllerGroups = controller.groups;
      if (groups.value.length !== controllerGroups.length) {
        groups.value = controllerGroups;
      }
      focusedIndex.value = controller.focusedIndex;
      openDropdown.value = controller.openDropdown;
      activeVersion.value++;
    });
  }

  // Initialize controller when editor becomes available. Using watch with
  // immediate:true handles both cases: editor already set (manual mode via
  // v-if) and editor set later (compound mode where the toolbar mounts
  // before the parent useEditor finishes).
  watch(
    editor,
    (ed) => {
      if (controller || !ed || ed.isDestroyed) return;

      controller = new ToolbarController(
        ed as unknown as ToolbarControllerEditor,
        syncState,
        layout,
      );
      controller.subscribe();
      syncState();

      clickOutsideHandler = (e: Event) => {
        if (controller?.openDropdown && toolbarRef.value && !toolbarRef.value.contains(e.target as Node)) {
          cleanupFloating?.();
          cleanupFloating = null;
          controller.closeDropdown();
          syncState();
        }
      };
      document.addEventListener('mousedown', clickOutsideHandler);

      editorEl = ed.view.dom.closest('.dm-editor') as HTMLElement | null;
      if (editorEl) {
        dismissOverlayHandler = () => {
          if (controller?.openDropdown) {
            cleanupFloating?.();
            cleanupFloating = null;
            controller.closeDropdown();
            syncState();
          }
        };
        editorEl.addEventListener('dm:dismiss-overlays', dismissOverlayHandler);
      }
    },
    { immediate: true },
  );

  onScopeDispose(() => {
    cancelAnimationFrame(syncStateRaf);
    cleanupFloating?.();
    cleanupFloating = null;

    if (clickOutsideHandler) {
      document.removeEventListener('mousedown', clickOutsideHandler);
      clickOutsideHandler = null;
    }
    if (dismissOverlayHandler && editorEl) {
      editorEl.removeEventListener('dm:dismiss-overlays', dismissOverlayHandler);
      dismissOverlayHandler = null;
      editorEl = null;
    }

    controller?.destroy();
    controller = null;
  });

  function isActive(name: string): boolean {
    return controller?.activeMap.get(name) ?? false;
  }

  function isDisabled(name: string): boolean {
    return controller?.disabledMap.get(name) ?? false;
  }

  function isDropdownActive(dropdown: ToolbarDropdown): boolean {
    if (dropdown.layout === 'grid') return false;
    if (dropdown.dynamicLabel) return false;
    if (!controller) return false;
    return dropdown.items.some((item: ToolbarButton) => controller!.activeMap.get(item.name) ?? false);
  }

  function getAriaExpanded(item: ToolbarButton): string | null {
    if (!item.emitEvent) return null;
    return controller?.expandedMap.get(item.name) ? 'true' : null;
  }

  function getFlatIndex(name: string): number {
    return controller?.getFlatIndex(name) ?? -1;
  }

  function handleDropdownToggle(dropdown: ToolbarDropdown) {
    if (!controller) return;

    cleanupFloating?.();
    cleanupFloating = null;
    controller.toggleDropdown(dropdown.name);
    syncState();

    if (controller.openDropdown) {
      requestAnimationFrame(() => {
        const trigger = toolbarRef.value?.querySelector('[aria-expanded="true"]') as HTMLElement | null;
        const panel = trigger?.parentElement?.querySelector('.dm-toolbar-dropdown-panel') as HTMLElement | null;
        if (trigger && panel) {
          const placement = dropdown.layout === 'grid' ? 'bottom' : 'bottom-start';
          cleanupFloating = positionFloatingOnce(trigger, panel, {
            placement,
            offsetValue: 4,
          });
        }
      });
    }
  }

  function closeDropdown() {
    cleanupFloating?.();
    cleanupFloating = null;
    controller?.closeDropdown();
    syncState();
  }

  function executeCommand(item: ToolbarButton) {
    controller?.executeCommand(item);
  }

  return {
    controller: { get current() { return controller; } },
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
    executeCommand,
    syncState,
  };
}
