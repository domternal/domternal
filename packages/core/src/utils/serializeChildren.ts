/**
 * HTML Serialization Helper
 *
 * The HTML of a container's children, with every attribute value escaped as
 * the HTML standard serializes it, whatever DOM implementation built them.
 */

/** Documents whose own serializer escapes `&` in attribute values, as browsers and jsdom do. */
const escapesAmpersand = new WeakMap<Document, boolean>();

function serializerEscapesAmpersand(document: Document): boolean {
  let escapes = escapesAmpersand.get(document);
  if (escapes === undefined) {
    const probe = document.createElement('span');
    probe.setAttribute('title', '&');
    escapes = probe.outerHTML.includes('&amp;');
    escapesAmpersand.set(document, escapes);
  }
  return escapes;
}

/**
 * @internal The `innerHTML` of a container the caller owns.
 *
 * linkedom, the Node peer of the SSR helpers, writes attribute values of an
 * HTML document without escaping `&`. The browser that reads such output
 * decodes every character reference in them, so a stored title such as
 * `Tom &amp; Jerry` would arrive as `Tom & Jerry`, and an address or style
 * value would be read differently from the one the editor checked. Where the
 * document's serializer leaves `&` as it is, each attribute value holding one
 * is given its escaped spelling first, which that serializer then writes
 * unchanged. The container's descendants are changed, so it must be one the
 * caller built for serializing.
 */
export function serializeChildren(container: Element): string {
  if (!serializerEscapesAmpersand(container.ownerDocument)) {
    for (const element of Array.from(container.querySelectorAll('*'))) {
      for (const attribute of Array.from(element.attributes)) {
        if (attribute.value.includes('&')) attribute.value = attribute.value.replace(/&/g, '&amp;');
      }
    }
  }
  return container.innerHTML;
}
