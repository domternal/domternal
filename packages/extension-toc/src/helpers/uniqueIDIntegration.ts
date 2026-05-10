/**
 * uniqueIDIntegration - small helpers for reading UniqueID's config
 * from a sibling extension's runtime context.
 *
 * UniqueID is the canonical block-id system in `@domternal/core`. TOC
 * and its UI plugins (FloatingTocOutline, TableOfContentsBlock) all
 * READ UniqueID's per-block id; none of them write their own. This
 * file centralizes the detection idiom so a future change to the
 * extension shape (rename, attribute, etc.) only ripples through here.
 */

import type { Editor } from '@domternal/core';

/**
 * Default attribute name used when UniqueID is loaded but its
 * `attributeName` option is missing or invalid. Matches UniqueID's
 * own default (`'id'`), giving us native HTML id semantics.
 */
const DEFAULT_ATTR_NAME = 'id';

/**
 * Resolve the attribute name (DOM + node.attrs key) under which
 * UniqueID stores per-block stable ids.
 *
 *   - Returns the configured `attributeName` from UniqueID's options
 *     when UniqueID is loaded and the option is a non-empty string.
 *   - Returns the default `'id'` when UniqueID is loaded but the
 *     option is missing/blank (defensive fallback).
 *   - Returns `null` when UniqueID is NOT loaded — callers should
 *     treat this as "TOC peer dep missing" and short-circuit
 *     accordingly (typically: surface a console.error and bail).
 */
export function resolveUniqueIDAttrName(editor: Editor): string | null {
  const ext = editor.extensionManager.extensions.find((e) => e.name === 'uniqueID');
  if (!ext) return null;
  const raw = (ext.options as { attributeName?: unknown }).attributeName;
  return typeof raw === 'string' && raw.length > 0 ? raw : DEFAULT_ATTR_NAME;
}
