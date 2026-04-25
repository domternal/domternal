import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeToClipboard } from './clipboard.js';

// jsdom doesn't populate `document.execCommand` natively — define a stub we
// can spy on, then remove it after each test so we don't leak state.
interface ExecCommandDoc {
  execCommand?: (command: string) => boolean;
}

describe('writeToClipboard', () => {
  let originalClipboard: typeof navigator.clipboard | undefined;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  let originalExecCommand: typeof document.execCommand | undefined;

  beforeEach(() => {
    originalClipboard = navigator.clipboard;
    originalExecCommand = (document as unknown as ExecCommandDoc).execCommand;
    // Install a stub so tests can spy on it.
    (document as unknown as ExecCommandDoc).execCommand = () => true;
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: originalClipboard,
      configurable: true,
    });
    if (originalExecCommand === undefined) {
      delete (document as unknown as ExecCommandDoc).execCommand;
    } else {
      (document as unknown as ExecCommandDoc).execCommand = originalExecCommand;
    }
    vi.restoreAllMocks();
  });

  it('uses navigator.clipboard.writeText when available and returns true on success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    const ok = await writeToClipboard('hello');

    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('falls back to execCommand when async API rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    const execSpy = vi.spyOn(document, 'execCommand').mockReturnValue(true);

    const ok = await writeToClipboard('hello');

    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalled();
    expect(execSpy).toHaveBeenCalledWith('copy');
  });

  it('falls back to execCommand when async API is missing', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      configurable: true,
    });
    const execSpy = vi.spyOn(document, 'execCommand').mockReturnValue(true);

    const ok = await writeToClipboard('hello');

    expect(ok).toBe(true);
    expect(execSpy).toHaveBeenCalledWith('copy');
  });

  it('returns false when execCommand reports failure', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      configurable: true,
    });
    vi.spyOn(document, 'execCommand').mockReturnValue(false);

    const ok = await writeToClipboard('hello');

    expect(ok).toBe(false);
  });

  it('removes the temporary textarea after copying', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      configurable: true,
    });
    vi.spyOn(document, 'execCommand').mockReturnValue(true);

    await writeToClipboard('hello');

    // No orphan textareas hanging around in the body.
    expect(document.querySelectorAll('textarea').length).toBe(0);
  });

  it('returns false and cleans up when execCommand throws', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      configurable: true,
    });
    vi.spyOn(document, 'execCommand').mockImplementation(() => {
      throw new Error('copy blocked');
    });

    const ok = await writeToClipboard('hello');

    expect(ok).toBe(false);
    expect(document.querySelectorAll('textarea').length).toBe(0);
  });
});
