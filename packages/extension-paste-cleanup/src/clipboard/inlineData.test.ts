// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { safeImage } from '../html/urls.js';
import { qualifyClipboardInlineData } from './inlineData.js';
import type { ClipboardInlineDataAllowance } from './inlineData.js';
import type { ClipboardRasterMime } from './destination.js';

// Synthetic container fixtures. Header qualification is not full image decoding.
const PNG = atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC');
const WEBP = atob('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==');
const JPEG = '\xff\xd8\xff\xc0\x00\x08\x08\x00\x01\x00\x01\x01\xff\xda\x00\x06\x01\x00\x00\x00x\xff\xd9';
const GIF_FRAME = ',\0\0\0\0\x01\0\x01\0\0\x02\x02\x44\x01\0';
const GIF = 'GIF89a\x01\0\x01\0\x80\0\0\xff\xff\xff\0\0\0' + GIF_FRAME + ';';
const URL = 'data:image/png;base64,' + btoa(PNG);
const POLICY = Object.freeze({ allowedMimeTypes: Object.freeze(['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as ClipboardRasterMime[]), maxFileBytes: 1_048_576 });
const LIMITS: ClipboardInlineDataAllowance = Object.freeze({ maxInputUnits: 2_000_000, maxResourceBytes: 1_048_576,
  remainingResourceBytes: 4_194_304, remainingPixels: 50_000_000, placements: 1 });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function source(format: string, bytes: string): string { return `data:image/${format};base64,${btoa(bytes)}`; }
function qualify(value: unknown = URL, overrides: Partial<ClipboardInlineDataAllowance> = {}): ReturnType<typeof qualifyClipboardInlineData> {
  return qualifyClipboardInlineData(value, POLICY, { ...LIMITS, ...overrides });
}

describe('private bounded inline raster qualification', () => {
  it.each([
    { format: 'png', bytes: PNG }, { format: 'jpeg', bytes: JPEG }, { format: 'gif', bytes: GIF }, { format: 'webp', bytes: WEBP },
  ])('returns immutable exact binary and one-placement metrics for $format', ({ format, bytes }) => {
    const decode = vi.spyOn(globalThis, 'atob');
    const result = qualify(source(format, bytes));
    expect(result).toMatchObject({ status: 'qualified', chargedBytes: bytes.length, chargedPixels: 1,
      resource: { binary: bytes, mimeType: `image/${format}`, byteLength: bytes.length, pixels: 1 } });
    expect(decode).toHaveBeenCalledOnce();
    expect(Object.isFrozen(result)).toBe(true);
    if (result.status !== 'qualified') throw new Error('Expected qualification');
    expect(Object.isFrozen(result.resource)).toBe(true);
    expect(result).not.toHaveProperty('source');
    expect(result).not.toHaveProperty('html');
  });

  it.each([PNG, GIF, JPEG, WEBP])('preflights exact padded decoded bytes before calling the decoder', bytes => {
    const format = bytes === PNG ? 'png' : bytes === GIF ? 'gif' : bytes === JPEG ? 'jpeg' : 'webp';
    const value = source(format, bytes);
    const decode = vi.spyOn(globalThis, 'atob');
    expect(qualify(value, { maxResourceBytes: bytes.length - 1 })).toMatchObject({ status: 'rejected', reason: 'image-size-limit' });
    expect(qualify(value, { remainingResourceBytes: bytes.length - 1 })).toMatchObject({ status: 'rejected', reason: 'image-size-limit' });
    expect(decode).not.toHaveBeenCalled();
    expect(qualify(value, { maxResourceBytes: bytes.length, remainingResourceBytes: bytes.length }).status).toBe('qualified');
    expect(decode).toHaveBeenCalledOnce();
  });

  it('shares a caller-owned aggregate allowance with prior File or inline charges', () => {
    const capacity = { ...LIMITS, remainingResourceBytes: PNG.length * 3, remainingPixels: 3 };
    // The future batch has already reserved one equivalent resource from a File.
    capacity.remainingResourceBytes -= PNG.length;
    capacity.remainingPixels--;
    for (let index = 0; index < 2; index++) {
      const result = qualifyClipboardInlineData(URL, POLICY, capacity);
      if (result.status !== 'qualified') throw new Error('Expected qualification');
      capacity.remainingResourceBytes -= result.chargedBytes;
      capacity.remainingPixels -= result.chargedPixels;
    }
    const decode = vi.spyOn(globalThis, 'atob');
    expect(qualifyClipboardInlineData(URL, POLICY, capacity)).toMatchObject({ status: 'rejected', reason: 'image-size-limit' });
    expect(decode).not.toHaveBeenCalled();
    expect(capacity.remainingResourceBytes).toBe(0);
    expect(capacity.remainingPixels).toBe(0);
  });

  it('charges every rendered placement without multiplying the decoded resource byte charge', () => {
    expect(qualify(URL, { placements: 200, remainingPixels: 200 })).toMatchObject({
      status: 'qualified', chargedBytes: PNG.length, chargedPixels: 200, resource: { pixels: 1 },
    });
    const decode = vi.spyOn(globalThis, 'atob');
    expect(qualify(URL, { placements: 200, remainingPixels: 199 })).toMatchObject({ status: 'rejected', reason: 'pixel-limit' });
    expect(decode).not.toHaveBeenCalled();
  });

  it('uses the shared GIF frame allocation estimate in repeated-placement budgeting', () => {
    const twoFrames = source('gif', GIF.slice(0, -1) + GIF_FRAME + ';');
    expect(qualify(twoFrames, { placements: 3, remainingPixels: 6 })).toMatchObject({ status: 'qualified', chargedPixels: 6, resource: { pixels: 2 } });
    expect(qualify(twoFrames, { placements: 3, remainingPixels: 5 })).toMatchObject({ status: 'rejected', reason: 'pixel-limit' });
    const tooManyFrames = source('gif', GIF.slice(0, 19) + GIF_FRAME.repeat(101) + ';');
    expect(qualify(tooManyFrames)).toMatchObject({ status: 'rejected', reason: 'invalid-raster' });
  });

  it('enforces source units before regex or binary allocation', () => {
    const decode = vi.spyOn(globalThis, 'atob');
    expect(qualify(URL, { maxInputUnits: URL.length - 1 })).toMatchObject({ status: 'rejected', reason: 'input-limit' });
    expect(qualify('data:image/png;base64,' + 'A'.repeat(2_000_000))).toMatchObject({ status: 'rejected', reason: 'input-limit' });
    expect(decode).not.toHaveBeenCalled();
    expect(qualify(URL, { maxInputUnits: URL.length }).status).toBe('qualified');
  });

  it('honors destination MIME and byte limits without requiring embedded storage permission', () => {
    const decode = vi.spyOn(globalThis, 'atob');
    expect(qualifyClipboardInlineData(URL, { ...POLICY, allowedMimeTypes: ['image/jpeg'] }, LIMITS))
      .toMatchObject({ status: 'rejected', reason: 'unsupported-image-type' });
    expect(qualifyClipboardInlineData(URL, { ...POLICY, maxFileBytes: PNG.length - 1 }, LIMITS))
      .toMatchObject({ status: 'rejected', reason: 'image-size-limit' });
    expect(decode).not.toHaveBeenCalled();
    expect(qualifyClipboardInlineData(URL, { ...POLICY, maxFileBytes: PNG.length }, LIMITS).status).toBe('qualified');
  });

  it.each([
    null, undefined, 1, {}, '', 'https://example.test/image.png', 'blob:https://example.test/id', 'file:///tmp/image.png',
    'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/jpg;base64,/9j/', 'data:image/png,PNG',
    'data:image/png;charset=utf-8;base64,AAAA', 'data:image/png;base64,', 'data:image/png;base64,AAA',
    'data:image/png;base64,AAAA=', 'data:image/png;base64,AA=A', 'data:image/png;base64,====',
    'data:image/png;base64,AA==AAAA', 'data:image/png;base64,AA A', 'data:image/png;base64,AAA\n',
    'data:image/png;base64,AAA_', 'data:image/png;base64,AAA-', 'data:image/png;baſe64,AAAA',
    ' data:image/png;base64,AAAA', 'data:image/png;base64,AAAA ',
  ])('refuses unsupported source syntax without invoking the decoder: %j', value => {
    const decode = vi.spyOn(globalThis, 'atob');
    expect(qualifyClipboardInlineData(value, POLICY, LIMITS)).toMatchObject({ status: 'rejected', reason: 'invalid-data-url' });
    expect(decode).not.toHaveBeenCalled();
  });

  it('matches safeImage acceptance for the same supported vocabulary and hostile container corpus', () => {
    const values = [URL, source('jpeg', JPEG), source('gif', GIF), source('webp', WEBP), URL.replace('data:image/png;base64', 'DATA:IMAGE/PNG;BASE64'),
      source('png', PNG.slice(0, -1)), source('png', PNG.slice(0, 33) + PNG.slice(-12)), source('jpeg', PNG), source('gif', GIF.slice(0, -1)),
      source('png', PNG.slice(0, 33) + '\0\0\0\0acTL\0\0\0\0' + PNG.slice(33)),
      source('webp', WEBP.slice(0, 12) + 'ANIM' + WEBP.slice(16)),
      source('gif', GIF.slice(0, 19) + GIF_FRAME.repeat(101) + ';'),
      'data:image/png;baſe64,AAAA', 'data:image/png;base64,AA==AAAA', 'data:image/png;base64,AA A',
      'data:image/svg+xml;base64,PHN2Zy8+', 'data:image/png;name=a;base64,AAAA'];
    for (const value of values) expect(qualify(value).status === 'qualified', value.slice(0, 35)).toBe(safeImage(value, false, true) !== undefined);
  });

  it('does not claim full codec integrity beyond the shared raster header policy', () => {
    const changedCRC = PNG.slice(0, -1) + String.fromCharCode(PNG.charCodeAt(PNG.length - 1) ^ 1);
    expect(qualify(source('png', changedCRC)).status).toBe('qualified');
    expect(safeImage(source('png', changedCRC), false, true)).toBeDefined();
  });

  it('snapshots metadata and limits before decoding and ignores custom array iterators', () => {
    const limits = { ...LIMITS, remainingResourceBytes: PNG.length };
    const mimes: ClipboardRasterMime[] = ['image/png'];
    Object.defineProperty(mimes, Symbol.iterator, { value: () => { throw new Error('Iterator must not run'); } });
    const policy = { maxFileBytes: PNG.length, allowedMimeTypes: mimes };
    const decode = atob;
    vi.spyOn(globalThis, 'atob').mockImplementation(value => {
      limits.remainingResourceBytes = 0; policy.maxFileBytes = 0; mimes[0] = 'image/jpeg';
      return decode(value);
    });
    expect(qualifyClipboardInlineData(URL, policy, limits)).toMatchObject({ status: 'qualified', chargedBytes: PNG.length });
  });

  it('retains the captured MIME count when an indexed getter appends more entries', () => {
    const mimes: ClipboardRasterMime[] = ['image/png'];
    Object.defineProperty(mimes, 0, { get() { mimes.push('image/jpeg'); return 'image/png'; } });
    expect(qualifyClipboardInlineData(URL, { ...POLICY, allowedMimeTypes: mimes }, LIMITS).status).toBe('qualified');
  });

  it('returns bounded static failures for unreadable destination data and decoder errors', () => {
    const policy = { ...POLICY, get maxFileBytes(): number { throw new Error('Private policy data'); } };
    expect(qualifyClipboardInlineData(URL, policy, LIMITS)).toEqual({ status: 'rejected', reason: 'unreadable-input' });
    vi.spyOn(globalThis, 'atob').mockImplementation(() => { throw new Error('Private source data'); });
    expect(qualify()).toEqual({ status: 'rejected', reason: 'invalid-data-url' });
  });

  it('quarantines an unreadable abort state and cancellation concurrent with a decoder error', () => {
    const signal = { get aborted(): boolean { throw new Error('Private abort data'); } } as AbortSignal;
    expect(qualifyClipboardInlineData(URL, POLICY, LIMITS, { signal })).toEqual({ status: 'rejected', reason: 'unreadable-input' });
    const invalid = { aborted: 'yes' } as unknown as AbortSignal;
    expect(qualifyClipboardInlineData(URL, POLICY, LIMITS, { signal: invalid })).toEqual({ status: 'rejected', reason: 'unreadable-input' });
    const controller = new AbortController();
    vi.spyOn(globalThis, 'atob').mockImplementation(() => { controller.abort(); throw new Error('Decoder failure'); });
    expect(qualifyClipboardInlineData(URL, POLICY, LIMITS, { signal: controller.signal })).toEqual({ status: 'cancelled' });
  });

  it('refuses an unexpected decoder length without publishing any bytes', () => {
    vi.spyOn(globalThis, 'atob').mockReturnValue(PNG + '\0');
    expect(qualify()).toEqual({ status: 'rejected', reason: 'invalid-data-url' });
  });

  it('checks abort before decode and after a synchronous decode finishes', () => {
    const before = new AbortController(); before.abort();
    const decode = vi.spyOn(globalThis, 'atob');
    expect(qualifyClipboardInlineData(URL, POLICY, LIMITS, { signal: before.signal })).toEqual({ status: 'cancelled' });
    expect(decode).not.toHaveBeenCalled();
    decode.mockRestore();
    const during = new AbortController();
    const original = atob;
    vi.spyOn(globalThis, 'atob').mockImplementation(value => { during.abort(); return original(value); });
    expect(qualifyClipboardInlineData(URL, POLICY, LIMITS, { signal: during.signal })).toEqual({ status: 'cancelled' });
  });

  it('creates no Blob, typed byte copy, File, DOM resource, network request or object URL', () => {
    const unexpected = vi.fn(() => { throw new Error('Unexpected allocation or I/O'); });
    for (const name of ['Blob', 'File', 'FileReader', 'Uint8Array', 'Image', 'fetch']) vi.stubGlobal(name, unexpected);
    const createURL = vi.spyOn(globalThis.URL, 'createObjectURL').mockImplementation(unexpected);
    expect(qualify().status).toBe('qualified');
    expect(unexpected).not.toHaveBeenCalled();
    expect(createURL).not.toHaveBeenCalled();
  });

  it.each([
    { maxInputUnits: 0 }, { maxInputUnits: 2_000_001 }, { maxResourceBytes: 0 }, { maxResourceBytes: 5_242_881 },
    { remainingResourceBytes: -1 }, { remainingResourceBytes: 5_242_881 }, { remainingPixels: -1 }, { remainingPixels: 50_000_001 },
    { placements: 0 }, { placements: 201 }, { placements: 1.5 }, { remainingResourceBytes: Infinity }, { maxInputUnits: NaN },
  ])('rejects invalid allowances before decoding: %j', limits => {
    const decode = vi.spyOn(globalThis, 'atob');
    expect(() => qualify(URL, limits)).toThrow(RangeError);
    expect(decode).not.toHaveBeenCalled();
  });

  it.each([null, undefined, []])('rejects an invalid allowance container: %j', allowance => {
    expect(() => qualifyClipboardInlineData(URL, POLICY, allowance as unknown as ClipboardInlineDataAllowance)).toThrow(RangeError);
  });

  it.each([null, [], { maxFileBytes: 0, allowedMimeTypes: ['image/png'] }, { maxFileBytes: 1024, allowedMimeTypes: ['image/avif'] },
    { maxFileBytes: 1024, allowedMimeTypes: ['image/png', 'image/png', 'image/png', 'image/png', 'image/png'] }])('refuses malformed destination metadata: %j', policy => {
    expect(qualifyClipboardInlineData(URL, policy as unknown as Parameters<typeof qualifyClipboardInlineData>[1], LIMITS).status).toBe('rejected');
  });
});
