/**
 * Shared helpers for building ProseMirror node/mark specs.
 *
 * Used by both Node.createNodeSpec() and Mark.createMarkSpec() to
 * eliminate duplicated attribute conversion and HTML attribute building.
 */
import type { AttributeSpecs } from '../types/AttributeSpec.js';

/**
 * Converts extension AttributeSpecs to ProseMirror-compatible `attrs` object.
 *
 * @example
 * spec.attrs = buildProseMirrorAttrs(attributeSpecs);
 */
export function buildProseMirrorAttrs(
  attributeSpecs: AttributeSpecs,
): Record<string, { default?: unknown }> {
  const attrs: Record<string, { default?: unknown }> = {};

  for (const [name, attrSpec] of Object.entries(attributeSpecs)) {
    const attr: Record<string, unknown> = {
      default: attrSpec.default,
    };
    // Add validate if defined (ProseMirror 1.22.0+)
    if (attrSpec.validate) {
      attr['validate'] = attrSpec.validate;
    }
    attrs[name] = attr;
  }

  return attrs;
}

/**
 * Builds an HTML attributes object from a node/mark's attrs using the
 * attribute specs' renderHTML functions.
 *
 * Used inside toDOM wrappers for both nodes and marks.
 *
 * @example
 * const htmlAttrs = buildHTMLAttributes(node.attrs, attrSpecs);
 * return renderFn.call(instance, { node, HTMLAttributes: htmlAttrs });
 */
export function buildHTMLAttributes(
  attrs: Record<string, unknown>,
  attrSpecs: AttributeSpecs,
): Record<string, unknown> {
  let htmlAttrs: Record<string, unknown> = {};

  for (const [name, attrSpec] of Object.entries(attrSpecs)) {
    // Skip if not rendered
    if (attrSpec.rendered === false) continue;

    // Use renderHTML if defined, otherwise add directly
    if (attrSpec.renderHTML) {
      const rendered = attrSpec.renderHTML(attrs);
      if (rendered) {
        Object.assign(htmlAttrs, rendered);
      }
    } else if (attrs[name] !== undefined && attrs[name] !== null) {
      // Default: use attribute value directly
      htmlAttrs[name] = attrs[name];
    }
  }

  return htmlAttrs;
}
