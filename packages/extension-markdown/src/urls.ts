/**
 * Link and image addresses in Markdown, judged by the core URL policy so an
 * import or export never carries an address the editor itself would not
 * store or render.
 */
import { checkUrl, isSupportedAttributeValue } from '@domternal/core';
import type { Schema } from '@domternal/pm/model';

/** The image profile of the URL policy: any scheme but file:, relative and network paths, data images. */
const IMAGE_POLICY = { protocols: 'any', allowRelative: true, allowNetworkPath: true, allowDataImages: true } as const;
/** Every address that can run no script: the floor under any link configuration. */
const LINK_FLOOR = { protocols: 'any', allowRelative: true, allowNetworkPath: true } as const;

/** Strips what browsers strip before parsing an address: outer controls and spaces, inner tabs and line breaks. */
function cleanUrl(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value.charCodeAt(start) <= 0x20) start++;
  while (end > start && value.charCodeAt(end - 1) <= 0x20) end--;
  return value.slice(start, end).replace(/[\t\n\r]/g, '');
}

/**
 * The spelling of a link href that the schema's link mark keeps, or null:
 * the Link's own policy decides, as loading JSON content does, and a value
 * that could run script is refused whatever the schema says, such as for a
 * custom link mark without a policy.
 */
export function allowedLinkHref(schema: Schema, markName: string, href: unknown): string | null {
  if (typeof href !== 'string') return null;
  if (!isSupportedAttributeValue(schema, markName, 'href', href)) return null;
  if (checkUrl(href, LINK_FLOOR).status === 'unsafe') return null;
  return cleanUrl(href);
}

/** The spelling of an image source the Image renders, or null. */
export function allowedImageSource(src: unknown): string | null {
  const check = checkUrl(src, IMAGE_POLICY);
  return check.status === 'allowed' ? check.url : null;
}
