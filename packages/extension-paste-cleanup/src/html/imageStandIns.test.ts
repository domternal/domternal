import { describe, expect, it } from 'vitest';
import { normalizeClipboardHTML, normalizePasteHTML } from './normalize.js';
import { imageStandIns, recordImageStandIns } from './imageStandIns.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC';

describe('image stand-ins of a normalization', () => {
  it('records the alt text left in place of each removed image, in document order, empty without alt', () => {
    const html = '<img src="https://example.com/a.png" alt="First"><p>Text</p><img src="blob:https://example.com/1">'
      + '<img src="file:///C:/b.png" alt="Local">';
    const { result } = normalizeClipboardHTML(html);
    expect(result.diagnostics.filter(diagnostic => diagnostic.code === 'image-removed')).toHaveLength(3);
    expect(imageStandIns(result)).toEqual(['First', '', 'Local']);
    expect(Object.isFrozen(imageStandIns(result))).toBe(true);
  });

  it('records an image removed over the image limit', () => {
    const { result } = normalizeClipboardHTML(`<img src="${PNG}" alt="Kept"><img src="${PNG}" alt="Over">`, { limits: { maxImages: 1 } });
    expect(imageStandIns(result)).toEqual(['Over']);
  });

  it('records nothing for kept images, and keeps the public result shape', () => {
    const { result } = normalizeClipboardHTML(`<img src="${PNG}" alt="Kept">`);
    expect(imageStandIns(result)).toEqual([]);
    expect(Object.keys(normalizePasteHTML('<img src="https://example.com/a.png" alt="A">'))).toEqual(['status', 'html', 'source', 'diagnostics', 'diagnosticsTruncated']);
  });

  it('reads nothing for an unknown or missing result and ignores an empty record', () => {
    const target = {};
    recordImageStandIns(target, []);
    expect(imageStandIns(target)).toEqual([]);
    expect(imageStandIns(undefined)).toEqual([]);
  });
});
