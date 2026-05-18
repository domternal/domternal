/**
 * Gutter-bias resolution for nested drag-target selection.
 *
 * When the cursor sits near a configured edge of a candidate's rect, the
 * candidate is treated as "in the gutter" and its rank weight is reduced
 * proportionally to its tree depth. Shallower (outer) ancestors therefore
 * win against deeply-nested descendants in the gutter zone.
 *
 * The "deepest-match" mode skips this bias entirely and always returns the
 * innermost allowed block under the cursor.
 */

/** Cardinal edge of a candidate's bounding rect. */
export type GutterEdge = 'left' | 'right' | 'top' | 'bottom';

/**
 * Named presets for the bias config:
 *  - `'left'`  → ['left', 'top']  (left gutter, default)
 *  - `'right'` → ['right', 'top'] (right gutter, RTL-friendly)
 *  - `'both'`  → ['left', 'right', 'top']
 *  - `'none'`  → no gutter bias (deepest match wins)
 */
export type GutterBiasPreset = 'left' | 'right' | 'both' | 'none';

export interface GutterBiasConfig {
  /** Edges that constitute the "gutter" zone. */
  edges: GutterEdge[];
  /** Pixel distance from the edge at which the bias activates. */
  threshold: number;
  /** Bias factor applied per depth level when in the gutter. */
  strength: number;
}

const PRESET_DEFAULT: GutterBiasConfig = {
  edges: ['left', 'top'],
  threshold: 12,
  strength: 500,
};

const PRESET_RIGHT: GutterBiasConfig = { ...PRESET_DEFAULT, edges: ['right', 'top'] };
const PRESET_BOTH: GutterBiasConfig = { ...PRESET_DEFAULT, edges: ['left', 'right', 'top'] };

/**
 * Resolve the user-facing `promoteOnEdge` input into a concrete bias
 * configuration, or `null` when bias is disabled.
 *
 * Returns `null` for `undefined`, `false`, or `'none'` (deepest-match wins).
 */
export function resolveGutterBias(
  input: boolean | GutterBiasPreset | Partial<GutterBiasConfig> | undefined,
): GutterBiasConfig | null {
  switch (input) {
    case undefined:
    case false:
    case 'none':
      return null;
    case true:
    case 'left':
      return { ...PRESET_DEFAULT };
    case 'right':
      return { ...PRESET_RIGHT };
    case 'both':
      return { ...PRESET_BOTH };
    default:
      return {
        edges: input.edges ?? PRESET_DEFAULT.edges,
        threshold: input.threshold ?? PRESET_DEFAULT.threshold,
        strength: input.strength ?? PRESET_DEFAULT.strength,
      };
  }
}

/**
 * True when `(x, y)` falls inside the gutter zone defined by `config`.
 * The zone is the union of strips `threshold` px wide along each
 * configured edge of `rect`.
 */
export function isInGutter(
  x: number,
  y: number,
  rect: DOMRect,
  config: GutterBiasConfig,
): boolean {
  const t = config.threshold;
  for (const edge of config.edges) {
    if (edge === 'left' && x - rect.left <= t) return true;
    if (edge === 'right' && rect.right - x <= t) return true;
    if (edge === 'top' && y - rect.top <= t) return true;
    if (edge === 'bottom' && rect.bottom - y <= t) return true;
  }
  return false;
}

/**
 * Compute the rank-weight penalty for a candidate at `depth` whose rect
 * is in the gutter zone. Returns 0 when the candidate is outside the
 * gutter (no penalty applied).
 */
export function gutterBiasWeight(
  x: number,
  y: number,
  rect: DOMRect,
  depth: number,
  config: GutterBiasConfig,
): number {
  return isInGutter(x, y, rect, config) ? config.strength * depth : 0;
}
