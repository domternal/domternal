/**
 * Clipboard helper — writes plain text to the system clipboard.
 *
 * Tries the modern async Clipboard API first; if unavailable or denied
 * (Safari private mode, insecure context, missing user gesture), falls
 * back to a hidden textarea + `document.execCommand('copy')`.
 *
 * Returns `true` on success, `false` on failure. Never throws — callers
 * decide how to surface failure (toast, re-throw, silent).
 *
 * @example
 * ```ts
 * const ok = await writeToClipboard('https://example.com#block-abc123');
 * if (!ok) showError('Copy failed');
 * ```
 */
export async function writeToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to execCommand fallback.
    }
  }

  if (typeof document === 'undefined') return false;

  const textarea = document.createElement('textarea');
  textarea.value = text;
  // Hide the textarea off-screen but keep it focusable.
  textarea.style.position = 'fixed';
  textarea.style.top = '-1000px';
  textarea.style.left = '-1000px';
  textarea.style.opacity = '0';
  textarea.setAttribute('readonly', '');
  document.body.appendChild(textarea);

  try {
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    // `execCommand` is deprecated but remains the only synchronous fallback
    // for clipboard writes when the async API is unavailable.
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}
