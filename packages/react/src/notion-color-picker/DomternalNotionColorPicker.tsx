/**
 * DomternalNotionColorPicker
 *
 * Notion-style inline color picker rendered via `createPortal` into the
 * `.dm-editor` host. The portal target keeps the panel inside the editor's
 * CSS-variable scope (theme tokens cascade) without imperative DOM moves.
 *
 * Opens in response to the `notionColorOpen` event emitted by the bubble
 * menu's "A" trigger. Two sections: text color (top), background color
 * (bottom). Each section is a default-swatch plus the named-token palette.
 *
 * The default UI is rendered when no `children` prop is provided. Pass
 * `children` to take over rendering while keeping the hook's lifecycle.
 */
import {
  useId,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@domternal/core';
import { positionFloating } from '@domternal/core';
import { useCurrentEditor } from '../EditorContext.js';
import { useNotionColorPicker, type UseNotionColorPickerResult } from './useNotionColorPicker.js';

export interface DomternalNotionColorPickerProps {
  /** The editor instance. If omitted, uses EditorProvider context. */
  editor?: Editor;
  /** Custom panel content. When provided, replaces the default swatch grid. */
  children?: ReactNode | ((api: UseNotionColorPickerResult) => ReactNode);
}

export function DomternalNotionColorPicker({
  editor: editorProp,
  children,
}: DomternalNotionColorPickerProps): ReactNode {
  const { editor: contextEditor } = useCurrentEditor();
  const editor = editorProp ?? contextEditor;

  const api = useNotionColorPicker({ editor });
  const {
    isOpen,
    hostEl,
    anchorEl,
    panelRef,
    currentTextToken,
    currentBgToken,
    palette,
    applyText,
    applyBg,
    tokenLabel,
    onPanelKeydown,
  } = api;

  const panelId = useId();

  // Position panel against anchor and run the two-rAF focus chain. Tracking
  // rAF ids so cleanup can cancel mid-flight if the picker hides between
  // frames (D5 in the plan).
  const rafIdsRef = useRef<number[]>([]);
  useLayoutEffect(() => {
    if (!isOpen || !anchorEl || !panelRef.current) return;
    const panel = panelRef.current;

    const cleanupFloating = positionFloating(anchorEl, panel, {
      placement: 'bottom-start',
      offsetValue: 4,
    });

    // First rAF: position has been committed. Second rAF: paint flushed,
    // safe to focus without racing the bubble menu's blur handler. Guard
    // against close-between-frames via `panel.isConnected` (cleanup may not
    // have run yet when an rAF callback fires after `close()`).
    const id1 = requestAnimationFrame(() => {
      const id2 = requestAnimationFrame(() => {
        if (!panel.isConnected) return;
        const active = panel.querySelector<HTMLElement>('.dm-ncp-swatch.dm-ncp-active');
        const fallback = panel.querySelector<HTMLElement>('.dm-ncp-swatch--text[data-color="null"]');
        (active ?? fallback)?.focus({ preventScroll: true });
      });
      rafIdsRef.current.push(id2);
    });
    rafIdsRef.current.push(id1);

    return () => {
      for (const id of rafIdsRef.current) cancelAnimationFrame(id);
      rafIdsRef.current = [];
      cleanupFloating();
    };
  }, [isOpen, anchorEl, palette, panelRef]);

  // Reposition the panel when the anchor moves (window resize, content shift)
  // is handled inside `positionFloating`'s autoUpdate; nothing extra needed.

  // Unmount the entire portal subtree when closed - cheaper than hiding.
  // SSR-safe: hostEl is only populated in the editor `[editor]` effect on
  // the client.
  if (!isOpen || !hostEl) return null;

  const defaultContent = (
    <>
      <div className="dm-ncp-section">
        <div className="dm-ncp-label">Text color</div>
        <div className="dm-ncp-grid">
          <button
            type="button"
            className={`dm-ncp-swatch dm-ncp-swatch--text${currentTextToken === null ? ' dm-ncp-active' : ''}`}
            aria-pressed={currentTextToken === null}
            data-color="null"
            title="Default text color"
            aria-label="Default text color"
            onMouseDown={(e) => { e.preventDefault(); }}
            onClick={() => { applyText(null); }}
          />
          {palette.map((t) => (
            <button
              key={t}
              type="button"
              className={`dm-ncp-swatch dm-ncp-swatch--text${currentTextToken === t ? ' dm-ncp-active' : ''}`}
              aria-pressed={currentTextToken === t}
              data-color={t}
              title={tokenLabel(t)}
              aria-label={`${tokenLabel(t)} text`}
              onMouseDown={(e) => { e.preventDefault(); }}
              onClick={() => { applyText(t); }}
            />
          ))}
        </div>
      </div>
      <div className="dm-ncp-section">
        <div className="dm-ncp-label">Background color</div>
        <div className="dm-ncp-grid">
          <button
            type="button"
            className={`dm-ncp-swatch dm-ncp-swatch--bg${currentBgToken === null ? ' dm-ncp-active' : ''}`}
            aria-pressed={currentBgToken === null}
            data-color="null"
            title="Default background"
            aria-label="Default background"
            onMouseDown={(e) => { e.preventDefault(); }}
            onClick={() => { applyBg(null); }}
          />
          {palette.map((t) => (
            <button
              key={t}
              type="button"
              className={`dm-ncp-swatch dm-ncp-swatch--bg${currentBgToken === t ? ' dm-ncp-active' : ''}`}
              aria-pressed={currentBgToken === t}
              data-color={t}
              title={`${tokenLabel(t)} background`}
              aria-label={`${tokenLabel(t)} background`}
              onMouseDown={(e) => { e.preventDefault(); }}
              onClick={() => { applyBg(t); }}
            />
          ))}
        </div>
      </div>
    </>
  );

  const content = typeof children === 'function'
    ? (children as (api: UseNotionColorPickerResult) => ReactNode)(api)
    : (children ?? defaultContent);

  return createPortal(
    <div
      ref={panelRef}
      id={panelId}
      className="dm-notion-color-picker"
      data-show
      data-dm-editor-ui
      role="dialog"
      aria-modal="false"
      aria-label="Text and background color"
      onKeyDown={onPanelKeydown}
    >
      {content}
    </div>,
    hostEl,
  );
}
