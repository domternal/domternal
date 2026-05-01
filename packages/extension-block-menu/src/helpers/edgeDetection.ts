/**
 * Edge detection for the Tiptap-style "promote to parent at the gutter"
 * behaviour. When the cursor is within `threshold` px of a configured
 * edge of a candidate's DOM rect, the candidate's score is reduced by
 * `strength * depth`. Deeper candidates are penalised more, so a top-
 * level container can outscore a deeply nested child near the edge.
 *
 * Default preset matches Tiptap (`@tiptap/extension-drag-handle@3.x`):
 * edges `['left', 'top']`, threshold 12, strength 500.
 */

/** Which side(s) of a candidate trigger the score deduction. */
export type DragEdge = 'left' | 'right' | 'top' | 'bottom';

/**
 * Named presets for `promoteOnEdge`:
 *  - `'left'`  → ['left', 'top']  (Tiptap's default; what `nested: true` enables)
 *  - `'right'` → ['right', 'top'] (RTL-friendly)
 *  - `'both'`  → ['left', 'right', 'top']
 *  - `'none'`  → no edge promotion (Notion behaviour)
 */
export type EdgePreset = 'left' | 'right' | 'both' | 'none';

export interface EdgeDetectionConfig {
  /** Edges that trigger the score deduction. */
  edges: DragEdge[];
  /** Distance from the edge (CSS pixels) at which the deduction kicks in. */
  threshold: number;
  /** Per-depth strength of the deduction (`strength * depth`). */
  strength: number;
}

const DEFAULTS: EdgeDetectionConfig = {
  edges: ['left', 'top'],
  threshold: 12,
  strength: 500,
};

/**
 * Normalise the user-facing `promoteOnEdge` value into a concrete
 * `EdgeDetectionConfig` or `null` (Notion mode - no scoring needed).
 *
 * - `false` / `undefined` / `'none'` → `null` (no edge promotion)
 * - `true` / `'left'`                → defaults
 * - `'right'`                        → mirror to right edge
 * - `'both'`                         → both horizontal edges
 * - object                           → merged with defaults
 */
export function normalizeEdgeDetection(
  value: boolean | EdgePreset | Partial<EdgeDetectionConfig> | undefined,
): EdgeDetectionConfig | null {
  if (value === undefined || value === false || value === 'none') return null;
  if (value === true || value === 'left') return { ...DEFAULTS };
  if (value === 'right') return { ...DEFAULTS, edges: ['right', 'top'] };
  if (value === 'both') return { ...DEFAULTS, edges: ['left', 'right', 'top'] };
  // Custom partial - merge over defaults so callers can override one knob
  // without redeclaring the rest.
  return {
    edges: value.edges ?? DEFAULTS.edges,
    threshold: value.threshold ?? DEFAULTS.threshold,
    strength: value.strength ?? DEFAULTS.strength,
  };
}

/**
 * True when (`x`, `y`) sits within `config.threshold` px of any edge in
 * `config.edges`, measured against the candidate's bounding rect.
 */
export function isNearEdge(
  x: number,
  y: number,
  rect: DOMRect,
  config: EdgeDetectionConfig,
): boolean {
  const t = config.threshold;
  for (const edge of config.edges) {
    if (edge === 'left' && x <= rect.left + t) return true;
    if (edge === 'right' && x >= rect.right - t) return true;
    if (edge === 'top' && y <= rect.top + t) return true;
    if (edge === 'bottom' && y >= rect.bottom - t) return true;
  }
  return false;
}

/**
 * Score deduction applied when the cursor is near a candidate's edge.
 * Linear in `depth` so that deeply-nested children are penalised more
 * heavily and yield to shallower ancestors at the boundary.
 */
export function calculateEdgeDeduction(
  x: number,
  y: number,
  rect: DOMRect,
  depth: number,
  config: EdgeDetectionConfig,
): number {
  return isNearEdge(x, y, rect, config) ? config.strength * depth : 0;
}
