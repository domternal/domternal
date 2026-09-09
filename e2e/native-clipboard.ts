import { mkdir, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { test as base } from './fixtures.js';

/** Native clipboard contents are shared by pages in different test workers. */
export const test = base.extend<{ nativeClipboard: boolean }>({
  nativeClipboard: [async ({ browserName }, use, testInfo) => {
    const lock = join(testInfo.project.outputDir, '.native-clipboard-lock');
    await mkdir(testInfo.project.outputDir, { recursive: true });
    const deadline = Date.now() + 60_000;
    let acquired = false;
    while (!acquired && Date.now() < deadline) {
      try {
        await mkdir(lock);
        acquired = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        await setTimeout(50);
      }
    }
    if (!acquired) throw new Error(`Timed out waiting for the ${browserName} native clipboard test lock`);
    try {
      await use(true);
    } finally {
      await rmdir(lock);
    }
  }, { auto: true, timeout: 75_000 }],
});
