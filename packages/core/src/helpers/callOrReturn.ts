/**
 * callOrReturn - Helper for context binding in extension config
 *
 * Used to call config functions with proper `this` context,
 * or return the value directly if it's not a function.
 *
 * This enables patterns like:
 * ```typescript
 * const Bold = Mark.create({
 *   name: 'bold',
 *   addCommands() {
 *     return {
 *       toggleBold: () => ({ commands }) => {
 *         return commands.toggleMark(this.name); // this.name = 'bold'
 *       },
 *     };
 *   },
 * });
 * ```
 */

/**
 * Calls a function with the given context, or returns the value if not a function
 *
 * @param value - Function to call or value to return
 * @param context - The `this` context to bind when calling the function
 * @param args - Additional arguments to pass to the function
 * @returns The function result or the value itself
 */
export function callOrReturn<T>(
  value: T | ((...args: unknown[]) => T),
  context: unknown,
  ...args: unknown[]
): T {
  if (typeof value === 'function') {
    return (value as (...args: unknown[]) => T).call(context, ...args);
  }
  return value;
}
