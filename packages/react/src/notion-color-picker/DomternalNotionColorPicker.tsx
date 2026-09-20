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
  useLayoutEffect,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@domternal/core';
import { coreMessages, localizeMessage, resolveColorSwatch, positionFloating } from '@domternal/core';
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

  // Position + two-rAF focus chain. `palette` excluded from deps: the swatch
  // list changing must not steal focus.
  useLayoutEffect(() => {
    if (!isOpen || !anchorEl || !panelRef.current) return;
    const panel = panelRef.current;

    const cleanupFloating = positionFloating(anchorEl, panel, {
      placement: 'bottom-start',
      offsetValue: 4,
    });

    // Second rAF waits for paint so focus doesn't race the bubble-menu blur.
    let id2 = 0;
    const id1 = requestAnimationFrame(() => {
      id2 = requestAnimationFrame(() => {
        if (!panel.isConnected) return;
        const active = panel.querySelector<HTMLElement>('.dm-ncp-swatch.dm-ncp-active');
        const fallback = panel.querySelector<HTMLElement>('.dm-ncp-swatch--text[data-color="null"]');
        (active ?? fallback)?.focus({ preventScroll: true });
      });
    });

    return () => {
      cancelAnimationFrame(id1);
      if (id2) cancelAnimationFrame(id2);
      cleanupFloating();
    };
  }, [isOpen, anchorEl, panelRef]);

  if (!isOpen || !hostEl) return null;

  const i18n = editor?.i18n;
  const panelLabel = localizeMessage(i18n, coreMessages.notionColorLabel);
  const textLabel = localizeMessage(i18n, coreMessages.colorText);
  const backgroundLabel = localizeMessage(i18n, coreMessages.colorBackground);
  const defaultText = resolveColorSwatch(i18n, null, 'text');
  const defaultBackground = resolveColorSwatch(i18n, null, 'bg');
  const defaultContent = (
    <>
      <div className="dm-ncp-section">
        <div className="dm-ncp-label" lang={textLabel.language}>{textLabel.text}</div>
        <div className="dm-ncp-grid">
          <button
            type="button"
            className={`dm-ncp-swatch dm-ncp-swatch--text${currentTextToken === null ? ' dm-ncp-active' : ''}`}
            aria-pressed={currentTextToken === null}
            data-color="null"
            title={defaultText.text}
            lang={defaultText.language}
            aria-label={defaultText.text}
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
              aria-label={resolveColorSwatch(i18n, t, 'text').text}
              lang={resolveColorSwatch(i18n, t, 'text').language}
              onMouseDown={(e) => { e.preventDefault(); }}
              onClick={() => { applyText(t); }}
            />
          ))}
        </div>
      </div>
      <div className="dm-ncp-section">
        <div className="dm-ncp-label" lang={backgroundLabel.language}>{backgroundLabel.text}</div>
        <div className="dm-ncp-grid">
          <button
            type="button"
            className={`dm-ncp-swatch dm-ncp-swatch--bg${currentBgToken === null ? ' dm-ncp-active' : ''}`}
            aria-pressed={currentBgToken === null}
            data-color="null"
            title={defaultBackground.text}
            lang={defaultBackground.language}
            aria-label={defaultBackground.text}
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
              title={resolveColorSwatch(i18n, t, 'bg').text}
              lang={resolveColorSwatch(i18n, t, 'bg').language}
              aria-label={resolveColorSwatch(i18n, t, 'bg').text}
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
      className="dm-notion-color-picker"
      data-show
      data-dm-editor-ui
      role="dialog"
      aria-label={panelLabel.text}
      lang={panelLabel.language}
      aria-modal="false"
      onKeyDown={onPanelKeydown}
    >
      {content}
    </div>,
    hostEl,
  );
}
