/**
 * The units the maintained evidence tool can verify, assemble and replay,
 * by report stem.
 *
 * Only the latest Free unit is ported. The styled-breaks report and the paste
 * performance summary are covered by the serialization and digest goldens of
 * `check` and by the records in their `historical-tools` MANIFEST.json, not
 * by a Node port; see those manifests for why.
 */
import * as listMarkers from './2026-09-27-list-markers.mjs';

export const UNITS = new Map([[listMarkers.STEM, listMarkers]]);

/** The unit module for a stem, or an error naming the known stems. */
export function unitFor(stem) {
  const unit = UNITS.get(stem);
  if (!unit) throw new Error(`Unknown evidence unit "${String(stem)}"; known units: ${[...UNITS.keys()].join(', ')}`);
  return unit;
}
