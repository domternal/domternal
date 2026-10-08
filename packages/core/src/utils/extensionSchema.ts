/**
 * The schema each extension instance's node and mark specs were built into.
 * A parse rule that must know which nodes the schema holds, such as Heading's,
 * reads it at parse time, when the schema exists. The ExtensionManager records
 * it after building the schema, for editors and the SSR helpers alike; a spec
 * built outside it has none.
 */
import type { Schema } from '@domternal/pm/model';

const schemas = new WeakMap<object, Schema>();

/** Records the schema an extension instance's specs were built into. */
export function recordExtensionSchema(extension: object, schema: Schema): void {
  schemas.set(extension, schema);
}

/** The schema an extension instance's specs were built into, if the ExtensionManager built it. */
export function extensionSchema(extension: object): Schema | undefined {
  return schemas.get(extension);
}
