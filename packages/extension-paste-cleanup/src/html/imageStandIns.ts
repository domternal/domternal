/**
 * The alt texts normalization leaves in place of the images it removes, in document order, with
 * an empty string for an image without alt text. The editor compares them with the pasted slice:
 * a slice that holds nothing else has no text of its own, so the clipboard's image files can be
 * the paste. They travel beside a result, never as a property of the public result.
 */
const standIns = new WeakMap<object, readonly string[]>();

/** Records the stand-ins of a normalization result that removed an image. */
export function recordImageStandIns(result: object, values: readonly string[]): void {
  if (values.length > 0) standIns.set(result, Object.freeze([...values]));
}

/** The stand-ins recorded for a normalization result; empty when it removed no image. */
export function imageStandIns(result: object | undefined): readonly string[] {
  return result === undefined ? [] : standIns.get(result) ?? [];
}
