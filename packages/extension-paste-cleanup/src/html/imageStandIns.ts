/**
 * The alt texts normalization leaves in place of the images it removes, in document order, with
 * null for an image without alt text and an empty string for an explicitly decorative image.
 * The editor compares them with the pasted slice:
 * a slice that holds nothing else has no text of its own, so the clipboard's image files can be
 * the paste. They travel beside a result, never as a property of the public result.
 */
const standIns = new WeakMap<object, { text: readonly string[]; alts: readonly (string | null)[] }>();

/** Records the stand-ins of a normalization result that removed an image. */
export function recordImageStandIns(result: object, values: readonly (string | null)[]): void {
  if (values.length > 0) standIns.set(result, {
    text: Object.freeze(values.map(value => value ?? '')),
    alts: Object.freeze([...values]),
  });
}

/** The stand-ins recorded for a normalization result; empty when it removed no image. */
export function imageStandIns(result: object | undefined): readonly string[] {
  return result === undefined ? [] : standIns.get(result)?.text ?? [];
}

/** Source alt attributes, preserving the distinction lost in textual stand-ins. */
export function imageStandInAlts(result: object | undefined): readonly (string | null)[] {
  return result === undefined ? [] : standIns.get(result)?.alts ?? [];
}
