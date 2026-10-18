import { describe, expect, it } from 'vitest';
import { imageTransformBox, imageTransformStyles, normalizeImageTransform, parseImageTransform } from './imageTransform.js';

const base = { naturalWidth: 400, naturalHeight: 200 };
describe('image transform geometry', () => {
  it.each([null, undefined, base, { ...base, rotation: 720 }])('keeps the identity as default markup: %j', value => {
    expect(normalizeImageTransform(value)).toBeNull();
  });
  it.each([false, [], 4, {}, { ...base, naturalWidth: 0 }, { ...base, naturalHeight: Infinity },
    { ...base, naturalWidth: 1_000_001 }, { ...base, rotation: NaN }, { ...base, rotation: 1_000_001 },
    { ...base, flipX: 'true' }, { ...base, flipY: 1 }, { ...base, crop: [] },
    { ...base, crop: { top: -0.1 } }, { ...base, crop: { top: Infinity } },
    { ...base, crop: { left: 0.5, right: 0.5 } }, { ...base, crop: { top: 0.99999999 } },
  ])('rejects malformed or impractical geometry: %j', value => {
    expect(normalizeImageTransform(value)).toBeUndefined();
  });
  it('normalizes clockwise turns and copies input instead of mutating it', () => {
    const input = Object.freeze({ ...base, crop: Object.freeze({ left: 0.25 }), rotation: -90, flipY: true });
    expect(normalizeImageTransform(input)).toEqual({ ...base, crop: { top: 0, right: 0, bottom: 0, left: 0.25 }, rotation: 270, flipX: false, flipY: true });
  });
  it.each([
    [0, 300, 200], [90, 200, 300], [180, 300, 200], [270, 200, 300],
  ])('fits the cropped viewport into its true bounding box at %i degrees', (rotation, width, height) => {
    const transform = normalizeImageTransform({ ...base, crop: { left: 0.25 }, rotation });
    expect(transform).toBeTruthy();
    if (!transform) throw new Error('invalid fixture');
    expect(imageTransformBox(transform)).toEqual({ cropWidth: 300, cropHeight: 200, width, height });
  });
  it('computes diagonal rotation and leaves dimensions unchanged by mirroring', () => {
    const transform = normalizeImageTransform({ ...base, rotation: 45, flipX: true, flipY: true });
    if (!transform) throw new Error('invalid fixture');
    const box = imageTransformBox(transform);
    expect(box.width).toBeCloseTo(600 / Math.sqrt(2));
    expect(box.height).toBeCloseTo(600 / Math.sqrt(2));
  });
  it('creates crop and image styles from safe numeric values only', () => {
    const transform = normalizeImageTransform({ ...base, crop: { left: 0.25, bottom: 0.5 }, rotation: 90, flipX: true });
    if (!transform) throw new Error('invalid fixture');
    const styles = imageTransformStyles(transform);
    expect(styles.viewport).toContain('aspect-ratio:100/300');
    expect(styles.crop).toContain('rotate(90deg) scale(-1,1)');
    expect(styles.image).toContain('width:133.33333333333334%;height:200%');
    expect(styles.image).toContain('max-width:none');
  });
  it('reads only a bounded valid serialized transform', () => {
    const json = JSON.stringify({ ...base, rotation: 90 });
    expect(parseImageTransform(json)?.rotation).toBe(90);
    for (const value of [null, '{', 'x'.repeat(513), JSON.stringify({ ...base, rotation: 'url(evil)' })]) {
      expect(parseImageTransform(value)).toBeNull();
    }
  });
});
