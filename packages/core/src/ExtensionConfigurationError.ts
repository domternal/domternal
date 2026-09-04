/**
 * Fatal extension misconfiguration. Extension hook errors are normally
 * isolated (turned into 'error' events) so one broken extension cannot crash
 * the editor; this class opts out. Throw it from a creation-time hook when
 * the extension cannot work at all, and `new Editor(...)` fails loudly
 * instead of leaving a silently degraded editor running.
 *
 * `options.cause` follows the standard `Error` constructor, so an extension
 * that turns a lower-level refusal into guidance keeps the original error.
 */
export class ExtensionConfigurationError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ExtensionConfigurationError';
  }
}
