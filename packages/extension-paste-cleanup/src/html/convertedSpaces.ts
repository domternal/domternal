import type { Element, Root } from 'hast';

/** A span WebKit wrote around one space it converted to a no-break space. */
function convertedSpace(node: Element): boolean {
  const className = node.properties.className;
  const only = node.children.length === 1 ? node.children[0] : undefined;
  return node.tagName === 'span' && Array.isArray(className) && className.includes('Apple-converted-space')
    && only?.type === 'text' && only.value === '\u00a0';
}

/**
 * WebKit copies a space that would not render on its own as a no-break space in a span of the class
 * `Apple-converted-space`. ProseMirror's paste turns such a span back into a space in WebKit only, and
 * only while the class is present, which cleanup removes: Safari's Word text then kept no-break spaces
 * between words. Restored here, with ProseMirror's rule, a copy pastes the same spaces in every engine.
 */
export function restoreConvertedSpaces(tree: Root): void {
  const pending: (Root | Element)[] = [tree];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    for (const [index, child] of node.children.entries()) {
      if (child.type !== 'element') continue;
      if (convertedSpace(child)) node.children[index] = { type: 'text', value: ' ', ...(child.position === undefined ? {} : { position: child.position }) };
      else pending.push(child);
    }
  }
}

/** A span with no attribute left whose only content is one no-break space. */
function bareSpace(node: Element): boolean {
  const only = node.children.length === 1 ? node.children[0] : undefined;
  return node.tagName === 'span' && Object.keys(node.properties).length === 0 && only?.type === 'text' && only.value === '\u00a0';
}

/**
 * Chromium's ProseMirror paste also turns a span without a class or style that holds only one no-break
 * space into a space; Firefox and WebKit keep the no-break space. Cleanup leaves such spans behind once
 * it removed their class, as around the first space of a partial Word selection, so the same copy pasted
 * " a" in one engine and "a" in another. Done here, on the cleaned output, every engine pastes a space.
 */
export function restoreBareSpaces(tree: Root): void {
  const pending: (Root | Element)[] = [tree];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    for (const [index, child] of node.children.entries()) {
      if (child.type !== 'element') continue;
      if (bareSpace(child)) node.children[index] = { type: 'text', value: ' ', ...(child.position === undefined ? {} : { position: child.position }) };
      else pending.push(child);
    }
  }
}
