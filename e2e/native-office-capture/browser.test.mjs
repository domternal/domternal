import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC';
const hostileHTML = '<p>Private source text</p><img src="https://invalid.example/private.png" onerror="window.sourceExecuted=true"><script>window.sourceExecuted=true</script>';

async function enable(page) {
  await page.goto('/');
  await expect(page.locator('#capture')).toBeDisabled();
  for (const [name, value] of Object.entries({
    os: 'Synthetic OS 1.0 build 1', application: 'Synthetic editor 1.0 build 1',
    browser: 'Automated browser test, exact build recorded by runner', fixtureId: 'synthetic-ui-fixture',
    fixtureSha256: 'a'.repeat(64), copyMethod: 'Synthetic ClipboardEvent dispatched by test; no Office application involved',
  })) await page.locator(`[name="${name}"]`).fill(value);
  await page.locator('[name="scenario"]').selectOption({ label: 'mixed-one-image' });
  await page.locator('[name="syntheticSourceConfirmed"]').check();
  await page.getByRole('button', { name: 'Enable capture area' }).click();
  await expect(page.locator('#capture')).toBeEnabled();
  await expect(page.locator('#capture')).toBeFocused();
}

async function paste(page, { held = false, text = hostileHTML } = {}) {
  await page.evaluate(({ png, held, text }) => {
    if (held) {
      const original = File.prototype.arrayBuffer;
      window.releaseCapturedRead = undefined;
      File.prototype.arrayBuffer = function () {
        const read = original.bind(this);
        return new Promise(resolve => {
          window.releaseCapturedRead = async () => {
            const bytes = await read();
            resolve(bytes);
          };
        });
      };
    }
    const transfer = new DataTransfer();
    transfer.setData('text/html', text);
    transfer.setData('text/plain', 'Private source text');
    transfer.items.add(new File([Uint8Array.from(atob(png), char => char.charCodeAt(0))], 'private-source.png', { type: 'image/png', lastModified: 1 }));
    // Firefox does not preserve the supplied DataTransfer in a constructed ClipboardEvent.
    // This explicit synthetic transport tests extraction without claiming a native capture.
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: transfer });
    document.querySelector('#capture').dispatchEvent(event);
  }, { png: PNG, held, text });
}

async function downloadBundle(page) {
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download capture JSON' }).click();
  const download = await waiting;
  return JSON.parse(await readFile(await download.path(), 'utf8'));
}

test('captures exact source bytes, keeps source HTML inert and exports only on request', async ({ page }) => {
  const errors = [];
  const downloads = [];
  const remote = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('download', value => downloads.push(value));
  page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:5896/')) remote.push(request.url()); });
  await enable(page);
  await paste(page);
  await expect(page.locator('#status')).toContainText('Capture complete');
  await expect(page.locator('#capture')).toHaveValue('');
  await expect(page.locator('#preview')).not.toContainText('Private source text');
  await expect(page.locator('#preview')).not.toContainText('private-source.png');
  expect(downloads).toHaveLength(0);
  expect(await page.evaluate(() => window.sourceExecuted)).toBeUndefined();
  const bundle = await downloadBundle(page);
  expect(bundle.status).toBe('complete');
  expect(bundle.qualification).toBe(false);
  expect(bundle.provenance).toEqual({ eventKind: 'synthetic-event', nativeClipboardCaptured: false, sourceApplicationVerified: false });
  expect(bundle.payload.text['text/html']).toBe(hostileHTML);
  const fileItem = bundle.payload.items.find(item => item.kind === 'file');
  expect(fileItem.itemIndex).toBeGreaterThan(0);
  expect(fileItem.file.name).toBe('private-source.png');
  const bytes = Buffer.from(PNG, 'base64');
  expect(bundle.payload.files).toEqual([{ itemIndex: fileItem.itemIndex, base64: PNG, byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }]);
  expect(remote).toEqual([]);
  expect(errors).toEqual([]);
});

test('constructed browser ClipboardEvents cannot claim native provenance', async ({ page }) => {
  await enable(page);
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.setData('text/plain', 'Constructed event');
    document.querySelector('#capture').dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }));
  });
  await expect(page.locator('#status')).toContainText('Capture complete');
  const bundle = await downloadBundle(page);
  expect(bundle.provenance.nativeClipboardCaptured).toBe(false);
  expect(bundle.provenance.sourceApplicationVerified).toBe(false);
  expect(bundle.qualification).toBe(false);
});

test('cancels pending native reads, ignores late completion and exports diagnostic evidence only', async ({ page }) => {
  await enable(page);
  await paste(page, { held: true });
  await expect(page.locator('#cancel')).toBeEnabled();
  await page.locator('#cancel').click();
  await expect(page.locator('#status')).toContainText('Capture incomplete');
  const cancelled = await downloadBundle(page);
  expect(cancelled.status).toBe('incomplete');
  expect(cancelled.diagnostics).toContain('cancelled');
  expect(cancelled.payload).toBeNull();
  expect(cancelled.provenance.nativeClipboardCaptured).toBe(false);
  await page.evaluate(async () => { await window.releaseCapturedRead(); });
  await expect(page.locator('#status')).toContainText('Capture incomplete');
  expect(await downloadBundle(page)).toEqual(cancelled);
});

test('clear discards old evidence and prevents a late read from restoring its download', async ({ page }) => {
  await enable(page);
  await paste(page, { held: true });
  await page.getByRole('button', { name: 'Clear captured evidence' }).click();
  await page.evaluate(async () => { await window.releaseCapturedRead(); });
  await expect(page.locator('#download')).toBeDisabled();
  await expect(page.locator('#cancel')).toBeDisabled();
  await expect(page.locator('#preview')).toBeEmpty();
  await expect(page.locator('#status')).toContainText('No capture');
});
