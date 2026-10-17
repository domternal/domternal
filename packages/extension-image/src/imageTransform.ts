/** Non-destructive image geometry. Crop edges are fractions of the original image. */
export interface ImageTransform {
  /** Intrinsic dimensions recorded when the transform is authored. */
  naturalWidth: number;
  naturalHeight: number;
  crop?: { top?: number; right?: number; bottom?: number; left?: number };
  /** Clockwise degrees, with any finite whole turns normalized away. */
  rotation?: number;
  flipX?: boolean;
  flipY?: boolean;
}

export interface NormalizedImageTransform extends ImageTransform {
  crop: { top: number; right: number; bottom: number; left: number };
  rotation: number;
  flipX: boolean;
  flipY: boolean;
}

const MAX_DIMENSION = 1_000_000;
const MIN_REMAINING = 1 / 65_536;
const MAX_ROTATION = 1_000_000;
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function finite(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

/** Null means identity; undefined means malformed or outside the geometry limits. */
export function normalizeImageTransform(value: unknown): NormalizedImageTransform | null | undefined {
  if (value === null || value === undefined) return null;
  if (!record(value)) return undefined;
  const width = value['naturalWidth'];
  const height = value['naturalHeight'];
  if (!finite(width, 1, MAX_DIMENSION) || !finite(height, 1, MAX_DIMENSION)) return undefined;
  const crop = value['crop'] ?? {};
  if (!record(crop)) return undefined;
  const edges = { top: crop['top'] ?? 0, right: crop['right'] ?? 0, bottom: crop['bottom'] ?? 0, left: crop['left'] ?? 0 };
  const { top, right, bottom, left } = edges;
  if (!finite(top, 0, 1) || !finite(right, 0, 1) || !finite(bottom, 0, 1) || !finite(left, 0, 1)) return undefined;
  if (top + bottom > 1 - MIN_REMAINING || left + right > 1 - MIN_REMAINING) return undefined;
  const angle = value['rotation'] ?? 0;
  if (!finite(angle, -MAX_ROTATION, MAX_ROTATION)) return undefined;
  const rotation = ((angle % 360) + 360) % 360;
  const flipX = value['flipX'] ?? false;
  const flipY = value['flipY'] ?? false;
  if (typeof flipX !== 'boolean' || typeof flipY !== 'boolean') return undefined;
  if (top === 0 && right === 0 && bottom === 0 && left === 0 && rotation === 0 && !flipX && !flipY) return null;
  return { naturalWidth: width, naturalHeight: height, crop: { top, right, bottom, left }, rotation, flipX, flipY };
}

export interface ImageTransformBox {
  /** Unrotated crop viewport in the recorded intrinsic coordinate system. */
  cropWidth: number;
  cropHeight: number;
  /** Occupied bounding box after cropping, mirroring and rotation. */
  width: number;
  height: number;
}

export function imageTransformBox(transform: NormalizedImageTransform): ImageTransformBox {
  const cropWidth = transform.naturalWidth * (1 - transform.crop.left - transform.crop.right);
  const cropHeight = transform.naturalHeight * (1 - transform.crop.top - transform.crop.bottom);
  const radians = transform.rotation * Math.PI / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  // Exact quarter turns must not leave microscopic blank strips.
  const c = cos < 1e-12 ? 0 : cos;
  const s = sin < 1e-12 ? 0 : sin;
  return { cropWidth, cropHeight, width: cropWidth * c + cropHeight * s, height: cropHeight * c + cropWidth * s };
}

/** Only generated finite numbers enter styles; source strings are never interpolated. */
export function imageTransformStyles(transform: NormalizedImageTransform): {
  viewport: string; crop: string; image: string;
} {
  const box = imageTransformBox(transform);
  const width = 1 - transform.crop.left - transform.crop.right;
  const height = 1 - transform.crop.top - transform.crop.bottom;
  return {
    viewport: `position:relative;display:inline-block;vertical-align:middle;aspect-ratio:${String(box.width)}/${String(box.height)};max-width:100%;`,
    crop: `position:absolute;left:50%;top:50%;width:${String(box.cropWidth / box.width * 100)}%;height:${String(box.cropHeight / box.height * 100)}%;overflow:hidden;transform:translate(-50%,-50%) rotate(${String(transform.rotation)}deg) scale(${transform.flipX ? '-1' : '1'},${transform.flipY ? '-1' : '1'});`,
    image: `position:absolute;display:block;left:${String(-transform.crop.left / width * 100)}%;top:${String(-transform.crop.top / height * 100)}%;width:${String(100 / width)}%;height:${String(100 / height)}%;max-width:none;margin:0;`,
  };
}

/** This attribute is deliberately small and contains no source URL or arbitrary CSS. */
export function parseImageTransform(value: string | null): NormalizedImageTransform | null {
  if (value === null || value.length > 512) return null;
  try { return normalizeImageTransform(JSON.parse(value)) ?? null; } catch { return null; }
}
