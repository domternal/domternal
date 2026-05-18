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

/** Extension `name` exposed by the UniqueID extension in core. */
const UNIQUE_ID_EXTENSION_NAME = 'uniqueID';

/**
 * True when the UniqueID extension is loaded on the given editor.
 * Use this when you only need the boolean (e.g. to emit a clear
 * `console.error` before short-circuiting). Use `resolveUniqueIDAttrName`
 * when you also need the attribute name.
 */
export function isUniqueIDLoaded(editor: Editor): boolean {
  return editor.extensionManager.extensions.some(
    (e) => e.name === UNIQUE_ID_EXTENSION_NAME,
  );
}

/**
 * Resolve the attribute name (DOM + node.attrs key) under which
 * UniqueID stores per-block stable ids. Always returns a non-empty
 * string: the default `'id'` is used both when UniqueID is absent
 * and when its `attributeName` option is missing or blank. Callers
 * that need to distinguish "absent" from "default" should also call
 * `isUniqueIDLoaded`.
 */
export function resolveUniqueIDAttrName(editor: Editor): string {
  const ext = editor.extensionManager.extensions.find(
    (e) => e.name === UNIQUE_ID_EXTENSION_NAME,
  );
  if (!ext) return DEFAULT_ATTR_NAME;
  const raw = (ext.options as { attributeName?: unknown }).attributeName;
  return typeof raw === 'string' && raw.length > 0 ? raw : DEFAULT_ATTR_NAME;
}
