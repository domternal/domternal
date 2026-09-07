import type { Editor } from '@domternal/core';
import type { EditorView } from '@domternal/pm/view';
import type { TableOfContentsOptions } from '../types.js';
import { scrollToHeading, type ScrollToHeadingOptions } from './scrollToHeading.js';

export interface TocTrackingOptions {
  activeScrollParent: Element | Document | null;
  activeRootMargin: string;
  activeOffset: number;
  clickOverrideMs: number;
}

/** Explicit observer options win; omitted options retain legacy outline values. */
export function resolveTocTrackingOptions(editor: Editor | null): TocTrackingOptions {
  const extensions = editor?.extensionManager.extensions;
  const toc = extensions?.find((extension) => extension.name === 'toc')?.options as
    Partial<TableOfContentsOptions> | undefined;
  const outline = extensions?.find((extension) => extension.name === 'floatingTocOutline')?.options as
    Partial<TocTrackingOptions> | undefined;
  return {
    activeScrollParent: toc?.activeScrollParent !== undefined
      ? toc.activeScrollParent
      : outline?.activeScrollParent ?? null,
    activeRootMargin: toc?.activeRootMargin ?? outline?.activeRootMargin ?? '0px 0px -85% 0px',
    activeOffset: toc?.activeOffset ?? 0,
    clickOverrideMs: toc?.clickOverrideMs ?? outline?.clickOverrideMs ?? 500,
  };
}

type Navigate = (id: string) => boolean;
const navigation = new WeakMap<EditorView, Navigate>();

export function registerTocNavigation(view: EditorView, navigate: Navigate): () => void {
  navigation.set(view, navigate);
  return () => {
    if (navigation.get(view) === navigate) navigation.delete(view);
  };
}

/** Share the observer's scroll root and click override across all TOC consumers. */
export function navigateToc(
  view: EditorView,
  id: string,
  fallbackOptions: ScrollToHeadingOptions = {},
): boolean {
  const navigate = navigation.get(view);
  return navigate ? navigate(id) : scrollToHeading(view, id, fallbackOptions);
}
