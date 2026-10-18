/** Optional preparation for resources already present in the live print root. */
export interface PrintResourceOptions {
  /** Maximum wait for fonts, image loading and decoding. @default 10000 */
  timeoutMs?: number;
}

/** Completion of an accepted asynchronous print request. */
export type PrintPreparationResult =
  | { status: 'printed' }
  | { status: 'cancelled' }
  | { status: 'failed'; error: Error };

const DEFAULT_TIMEOUT = 10_000;

/** Wait without fetching new URLs or changing the document's stored content. */
export async function waitForPrintResources(
  root: HTMLElement,
  options: PrintResourceOptions,
  signal: AbortSignal,
): Promise<void> {
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT;
  if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 120_000) {
    throw new RangeError('Print resource timeout must be between 1 and 120000 milliseconds');
  }
  const cleanup = new Set<() => void>();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      const abort = (): void => { reject(new Error('Print preparation was cancelled')); };
      signal.addEventListener('abort', abort, { once: true });
      cleanup.add(() => { signal.removeEventListener('abort', abort); });
      if (signal.aborted) { abort(); return; }
      timer = setTimeout(() => { reject(new Error('Print resources did not become ready before the timeout')); }, timeout);
      const prepare = async (): Promise<void> => {
        while (!signal.aborted && !stopped) {
          const cycleCleanup = new Set<() => void>();
          const restore = (): void => { for (const action of cycleCleanup) action(); cycleCleanup.clear(); };
          cleanup.add(restore);
          try {
            // A layout read requests the fonts used by the mounted document before fonts.ready is read.
            root.getBoundingClientRect();
            let changed!: () => void;
            const changedPromise = new Promise<'changed'>(yes => { changed = () => { yes('changed'); }; });
            const Observer = root.ownerDocument.defaultView?.MutationObserver;
            const observer = Observer ? new Observer(changed) : null;
            observer?.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'srcset', 'sizes'] });
            cycleCleanup.add(() => observer?.disconnect());
            const fontSet = (root.ownerDocument as { fonts?: FontFaceSet }).fonts;
            const fonts = fontSet?.ready ?? Promise.resolve();
            const images = collectImages(root).map(image => waitForImage(image, cycleCleanup));
            const result = await Promise.race([Promise.all([fonts, ...images]).then(() => 'ready'), changedPromise]);
            if (result === 'ready') return;
          } finally {
            restore();
            cleanup.delete(restore);
          }
        }
      };
      prepare().then(() => { resolve(); }, reject);
    });
  } finally {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
    for (const restore of cleanup) restore();
  }
}

function collectImages(root: HTMLElement): HTMLImageElement[] {
  const images: HTMLImageElement[] = [];
  if (root.tagName === 'IMG') images.push(root as HTMLImageElement);
  images.push(...Array.from(root.querySelectorAll<HTMLImageElement>('img')));
  return images;
}

function waitForImage(image: HTMLImageElement, cleanup: Set<() => void>): Promise<void> {
  // An empty image has no resource to load. Do not turn it into a request for the page URL.
  if (!image.currentSrc && !image.getAttribute('src') && !image.getAttribute('srcset')) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown): void => {
      if (settled) return;
      settled = true;
      image.removeEventListener('load', loaded);
      image.removeEventListener('error', failed);
      if (error !== undefined) reject(error instanceof Error ? error : new Error('A print image could not be decoded'));
      else resolve();
    };
    const failed = (): void => { finish(new Error('A print image could not be loaded')); };
    const loaded = (): void => {
      if (image.naturalWidth === 0) { failed(); return; }
      if (typeof image.decode !== 'function') { finish(); return; }
      try { image.decode().then(() => { finish(); }, finish); }
      catch (error) { finish(error); }
    };
    image.addEventListener('load', loaded);
    image.addEventListener('error', failed);
    cleanup.add(() => {
      image.removeEventListener('load', loaded);
      image.removeEventListener('error', failed);
    });
    // Lazy images outside the viewport otherwise never receive a load event.
    const loading = image.getAttribute('loading');
    if (loading === 'lazy') {
      image.setAttribute('loading', 'eager');
      cleanup.add(() => {
        if (image.getAttribute('loading') === 'eager') image.setAttribute('loading', loading);
      });
    }
    if (image.complete) loaded();
  });
}
