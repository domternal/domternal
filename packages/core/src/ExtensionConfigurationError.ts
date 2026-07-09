/**
 * Fatal extension misconfiguration. Extension hook errors are normally
 * isolated (turned into 'error' events) so one broken extension cannot crash
 * the editor; this class opts out. Throw it from a creation-time hook when
 * the extension cannot work at all, and `new Editor(...)` fails loudly
 * instead of leaving a silently degraded editor running.
 */
export class ExtensionConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExtensionConfigurationError';
  }
}
