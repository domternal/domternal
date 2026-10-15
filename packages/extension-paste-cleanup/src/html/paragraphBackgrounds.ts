import type { Element, Root } from 'hast';
import type { PasteDestinationFeature } from './destinationDemand.js';
import { readSafeStyles, serializeStyles } from './styles.js';

export const PARAGRAPH_BACKGROUNDS: Readonly<Record<string, PasteDestinationFeature>> = Object.freeze({
  p: 'paragraph-background', h1: 'heading-1-background', h2: 'heading-2-background', h3: 'heading-3-background',
  h4: 'heading-4-background', h5: 'heading-5-background', h6: 'heading-6-background',
});
export const PARAGRAPH_BACKGROUND_FEATURES: readonly PasteDestinationFeature[] = Object.freeze(Object.values(PARAGRAPH_BACKGROUNDS));

/**
 * A missing block fill capability keeps its text highlight where available, with an explicit warning about
 * the lost full-width fill. The caller rechecks generated tree bounds before serializing this detached tree.
 */
export function adaptParagraphBackgrounds(
  tree: Root,
  destination: (features: readonly PasteDestinationFeature[]) => readonly PasteDestinationFeature[],
  report: (node: Element) => void,
): boolean {
  const supports = new Map<PasteDestinationFeature, boolean>();
  const supported = (feature: PasteDestinationFeature): boolean => {
    let found = supports.get(feature);
    if (found === undefined) { found = !destination([feature]).includes(feature); supports.set(feature, found); }
    return found;
  };
  let generated = false;
  const visit = (node: Root | Element): void => {
    for (const child of node.children) {
      if (child.type !== 'element') continue;
      visit(child);
      const feature = Object.hasOwn(PARAGRAPH_BACKGROUNDS, child.tagName) ? PARAGRAPH_BACKGROUNDS[child.tagName] : undefined;
      if (feature === undefined || child.properties['dataBgColor'] !== undefined) continue;
      const styles = readSafeStyles(child.properties.style, false, child.tagName).styles;
      const background = styles.get('background-color');
      if (background === undefined || supported(feature)) continue;
      report(child);
      styles.delete('background-color');
      if (styles.size > 0) child.properties.style = serializeStyles(styles);
      else delete child.properties.style;
      if (child.children.length > 0 && supported('highlight')) {
        child.children = [{ type: 'element', tagName: 'span', properties: { style: `background-color:${background}` }, children: child.children }];
        generated = true;
      }
    }
  };
  visit(tree);
  return generated;
}
