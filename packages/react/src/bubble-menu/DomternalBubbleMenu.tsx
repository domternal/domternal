import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Editor, BubbleMenuOptions, ToolbarButton, ToolbarDropdown } from '@domternal/core';
import { defaultIcons, positionFloatingOnce } from '@domternal/core';
import { useCurrentEditor } from '../EditorContext.js';
import { useBubbleMenu } from './useBubbleMenu.js';

export interface DomternalBubbleMenuProps {
  /** The editor instance. If omitted, uses EditorProvider context. */
  editor?: Editor;
  /** Custom visibility function. */
  shouldShow?: BubbleMenuOptions['shouldShow'];
  /** Position relative to selection. @default 'top' */
  placement?: 'top' | 'bottom';
  /** Pixel offset from selection. @default 8 */
  offset?: number;
  /** Debounce delay in ms. @default 0 */
  updateDelay?: number;
  /** Fixed item names, e.g. ['bold', 'italic', 'code']. */
  items?: string[];
  /** Context-aware: map context names to item arrays, true for all, or null to disable. */
  contexts?: Record<string, string[] | true | null>;
  /** Additional content rendered after buttons. */
  children?: React.ReactNode;
}

const DROPDOWN_CARET =
  '<svg class="dm-dropdown-caret" width="10" height="10" viewBox="0 0 10 10">' +
  '<path d="M2 4l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export function DomternalBubbleMenu({
  editor: editorProp,
  shouldShow,
  placement,
  offset,
  updateDelay,
  items,
  contexts,
  children,
}: DomternalBubbleMenuProps): ReactNode {
  const { editor: contextEditor } = useCurrentEditor();
  const editor = editorProp ?? contextEditor;

  const htmlCacheRef = useRef(new Map<string, string>());

  const {
    menuRef,
    resolvedItems,
    isItemActive,
    isItemDisabled,
    executeCommand,
    activeVersion,
    getCachedIcon,
    trailing,
    openColorPicker,
    openBlockContextMenu,
  } = useBubbleMenu({
    editor,
    shouldShow,
    placement,
    offset,
    updateDelay,
    items,
    contexts,
  });

  // Force re-read of activeVersion in render to subscribe to state changes.
  void activeVersion;

  const getCachedHtml = useCallback((name: string): string => {
    const cache = htmlCacheRef.current;
    const cached = cache.get(name);
    if (cached) return cached;
    const html = getCachedIcon(name);
    cache.set(name, html);
    return html;
  }, [getCachedIcon]);

  // Only one dropdown is open at a time across the entire bubble menu - the
  // Angular component enforces the same constraint via `openDropdown` signal.
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const closeDropdown = useCallback(() => { setOpenDropdown(null); }, []);

  // Refs to the trailing trigger buttons so we can pass the element as anchor
  // to the color picker and block context menu (positioning targets).
  const colorBtnRef = useRef<HTMLButtonElement>(null);
  const blockMenuBtnRef = useRef<HTMLButtonElement>(null);

  return (
    <div ref={menuRef} className="dm-bubble-menu" role="toolbar" aria-label="Text formatting">
      {resolvedItems.map((item) => {
        if (item.type === 'separator') {
          return <span key={item.name} className="dm-toolbar-separator" role="separator" />;
        }
        if (item.type === 'dropdown') {
          return (
            <BubbleDropdown
              key={item.name}
              dropdown={item}
              isOpen={openDropdown === item.name}
              onToggle={() => { setOpenDropdown(openDropdown === item.name ? null : item.name); }}
              onClose={closeDropdown}
              isItemActive={isItemActive}
              getCachedHtml={getCachedHtml}
              activeVersion={activeVersion}
              executeSubItem={(sub) => {
                closeDropdown();
                executeCommand(sub);
                requestAnimationFrame(() => { editor?.view.focus(); });
              }}
            />
          );
        }
        const btn = item;
        const active = isItemActive(btn);
        return (
          <button
            key={btn.name}
            type="button"
            className={`dm-toolbar-button${active ? ' dm-toolbar-button--active' : ''}`}
            disabled={isItemDisabled(btn)}
            title={btn.label}
            aria-label={btn.label}
            aria-pressed={active}
            dangerouslySetInnerHTML={{ __html: getCachedHtml(btn.icon) }}
            onMouseDown={(e) => { e.preventDefault(); }}
            onClick={(e) => { executeCommand(btn, e); }}
          />
        );
      })}
      {trailing.showColorPickerButton && !trailing.isNodeSelection && (
        <>
          <span className="dm-toolbar-separator" role="separator" />
          <button
            ref={colorBtnRef}
            type="button"
            className={`dm-toolbar-button dm-ncp-trigger${trailing.hasAnyColor ? ' dm-toolbar-button--active' : ''}`}
            title="Text and background color"
            aria-label="Text and background color"
            aria-haspopup="dialog"
            onMouseDown={(e) => { e.preventDefault(); }}
            onClick={() => { if (colorBtnRef.current) openColorPicker(colorBtnRef.current); }}
          >
            <span
              className="dm-ncp-trigger-glyph"
              style={trailing.currentTextColorVar ? { color: trailing.currentTextColorVar } : undefined}
            >A</span>
            <span
              className="dm-ncp-trigger-underline"
              style={trailing.currentBgColorVar ? { backgroundColor: trailing.currentBgColorVar } : undefined}
            />
          </button>
        </>
      )}
      {trailing.showBlockMenuButton && !trailing.isNodeSelection && (
        <>
          <span className="dm-toolbar-separator" role="separator" />
          <button
            ref={blockMenuBtnRef}
            type="button"
            className="dm-toolbar-button"
            disabled={trailing.blockMenuButtonDisabled}
            title={trailing.blockMenuButtonDisabled
              ? 'Block actions (select within a single block)'
              : 'More options'}
            aria-label="More options"
            aria-haspopup="menu"
            dangerouslySetInnerHTML={{ __html: getCachedHtml('dotsThree') }}
            onMouseDown={(e) => { e.preventDefault(); }}
            onClick={() => { if (blockMenuBtnRef.current) openBlockContextMenu(blockMenuBtnRef.current); }}
          />
        </>
      )}
      {children}
    </div>
  );
}

// ===== Bubble-menu-embedded dropdown =====

interface BubbleDropdownProps {
  dropdown: ToolbarDropdown;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  isItemActive: (item: ToolbarButton) => boolean;
  getCachedHtml: (name: string) => string;
  activeVersion: number;
  executeSubItem: (sub: ToolbarButton) => void;
}

/**
 * Bubble-menu-embedded dropdown (e.g. text-align). Manages its own outside-
 * click / Escape / `dm:dismiss-overlays` lifecycle. Panel stays INSIDE
 * `.dm-bubble-menu` so it inherits bubble-scoped active-state tokens.
 */
function BubbleDropdown({
  dropdown,
  isOpen,
  onToggle,
  onClose,
  isItemActive,
  getCachedHtml,
  activeVersion,
  executeSubItem,
}: BubbleDropdownProps): ReactNode {
  void activeVersion;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const dropdownActive = dropdown.items.some((sub) => isItemActive(sub));
  const activeChild = dropdown.dynamicIcon
    ? dropdown.items.find((sub) => isItemActive(sub))
    : undefined;
  const triggerIcon = activeChild?.icon ?? dropdown.icon;
  const triggerHtml = (defaultIcons[triggerIcon] ?? getCachedHtml(triggerIcon)) + DROPDOWN_CARET;

  // Position dropdown + outside-close / Escape / cooperative dismissal via
  // a single AbortController.
  useLayoutEffect(() => {
    if (!isOpen) return;
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;

    const cleanupFloating = positionFloatingOnce(trigger, panel, {
      placement: 'bottom-start',
      offsetValue: 4,
    });

    const controller = new AbortController();
    const { signal } = controller;

    document.addEventListener('mousedown', (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (panel.contains(target)) return;
      if (trigger.contains(target)) return;
      onClose();
    }, { signal });

    document.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }, { signal });

    // Cooperative dismissal: other overlays (color picker, link popover)
    // broadcast this event when opening; our dropdown closes in response.
    const editorEl = trigger.closest<HTMLElement>('.dm-editor');
    if (editorEl) {
      editorEl.addEventListener('dm:dismiss-overlays', () => { onClose(); }, { signal });
    }

    return () => {
      controller.abort();
      cleanupFloating();
    };
  }, [isOpen, onClose]);

  return (
    <div className="dm-toolbar-dropdown-wrapper" data-dropdown-wrapper={dropdown.name}>
      <button
        ref={triggerRef}
        type="button"
        className={`dm-toolbar-button dm-toolbar-dropdown-trigger${dropdownActive ? ' dm-toolbar-button--active' : ''}`}
        aria-expanded={isOpen}
        aria-haspopup="true"
        aria-label={dropdown.label}
        title={dropdown.label}
        data-dropdown={dropdown.name}
        dangerouslySetInnerHTML={{ __html: triggerHtml }}
        onMouseDown={(e) => { e.preventDefault(); }}
        onClick={onToggle}
      />
      {isOpen && (
        <div
          ref={panelRef}
          className="dm-toolbar-dropdown-panel"
          role="menu"
          data-dm-editor-ui
          data-dropdown-panel={dropdown.name}
        >
          {dropdown.items.map((sub) => {
            const subActive = isItemActive(sub);
            const subHtml = `${defaultIcons[sub.icon] ?? getCachedHtml(sub.icon)} ${sub.label}`;
            return (
              <button
                key={sub.name}
                type="button"
                className={`dm-toolbar-dropdown-item${subActive ? ' dm-toolbar-dropdown-item--active' : ''}`}
                role="menuitem"
                aria-label={sub.label}
                dangerouslySetInnerHTML={{ __html: subHtml }}
                onMouseDown={(e) => { e.preventDefault(); }}
                onClick={() => { executeSubItem(sub); }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
