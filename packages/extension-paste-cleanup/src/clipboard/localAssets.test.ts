/// <reference types="node" />
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { Schema } from '@domternal/pm/model';
import { createClipboardImageDestination } from './destination.js';
import type { ClipboardImageDestination } from './destination.js';
import type { ClipboardMatchedImage } from './references.js';
import { prepareClipboardEmbeddedAssets } from './localAssets.js';
import type { ClipboardEmbeddedAssetLimits, ClipboardEmbeddedAssetOptions } from './localAssets.js';

// Complete one-pixel PNG also used by raster.test.ts. This is not an Office capture.
const PNG = atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC');
const WEBP = atob('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==');
const JPEG = atob('/9j/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9sAQwACAgICAgIDAgIDBQMDAwUGBQUFBQYIBgYGBgYICggICAgICAoKCgoKCgoKDAwMDAwMDg4ODg4PDw8PDw8PDw8P/9sAQwECAgIEBAQHBAQHEAsJCxAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ/90ABAAB/9oADAMBAAIRAxEAPwD9/KKKKAP/2Q==');
const GIF_FRAME = ',\0\0\0\0\x01\0\x01\0\0\x02\x02\x44\x01\0';
const GIF_HEADER = 'GIF89a\x01\0\x01\0\x80\0\0\xff\xff\xff\0\0\0';
const limits: ClipboardEmbeddedAssetLimits = {
  maxPlacements: 16, maxFiles: 16, maxFileBytes: 4096, maxTotalFileBytes: 8192,
  maxTotalPixels: 100, maxPreparedUrlUnits: 20_000, maxMetadataLength: 128,
  maxDescriptionLength: 256, maxDimension: 10_000,
};

function bytes(binary = PNG): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function fromBinary(binary: string, type = 'image/png', id = 'a', itemIndex = 0): ClipboardMatchedImage {
  const result = match(id, new File([bytes(binary)], 'source-image', { type }), itemIndex);
  return { ...result, mimeType: type as ClipboardMatchedImage['mimeType'] };
}

function pending<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function prepare(
  matches: readonly ClipboardMatchedImage[] = [match()],
  cap: ClipboardEmbeddedAssetLimits = limits,
  options: ClipboardEmbeddedAssetOptions = { signal: new AbortController().signal },
  policy = destination(),
): ReturnType<typeof prepareClipboardEmbeddedAssets> {
  return prepareClipboardEmbeddedAssets(matches, policy, cap, options);
}

function match(id = 'a', file = new File([bytes()], 'private.png', { type: 'image/png' }), itemIndex = 0): ClipboardMatchedImage {
  return { reference: { placementId: id, rawReference: 'file:///private/image.png', sourceOffset: 3 }, file, fileSize: file.size, mimeType: 'image/png', itemIndex };
}

function destination(overrides: { allowEmbedded?: boolean; maxFileBytes?: number; allowedMimeTypes?: readonly string[] } = {}): ClipboardImageDestination {
  const schema = new Schema({ nodes: {
    doc: { content: 'block+' }, paragraph: { group: 'block', content: 'text*' }, text: {},
    image: { group: 'block', attrs: { src: { default: null } } },
  } });
  const result = createClipboardImageDestination(schema, {
    nodeTypeName: 'image', sourceAttribute: 'src', inline: false, allowEmbedded: true,
    allowedMimeTypes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'], maxFileBytes: 4096,
    policyVersion: 'test:1', ...overrides,
  }, { maxMetadataLength: 128, maxMimeTypes: 16, maxFileBytes: 4096 });
  if (result.status !== 'available') throw new Error('Expected image destination');
  return result.destination;
}

afterEach(() => vi.restoreAllMocks());

describe('bounded local clipboard asset preparation', () => {
  it('prepares a canonical URL without retaining Files or raw source references', async () => {
    const result = await prepareClipboardEmbeddedAssets([match()], destination(), limits, { signal: new AbortController().signal });
    expect(result.status).toBe('prepared');
    if (result.status !== 'prepared') return;
    expect(result.resources).toEqual([{ dataUrl: 'data:image/png;base64,' + btoa(PNG), mimeType: 'image/png', byteLength: PNG.length, pixels: 1 }]);
    expect(result.placements).toEqual([{ placementId: 'a', resourceIndex: 0, sourceOffset: 3 }]);
    expect(result.readBytes).toBe(PNG.length);
    expect(result.preparedUrlUnits).toBe(result.resources[0]?.dataUrl.length);
    expect(result.pixelCount).toBe(1);
    expect(JSON.stringify(result)).not.toContain('private');
    for (const value of [result, result.resources, result.placements, ...result.resources, ...result.placements]) expect(Object.isFrozen(value)).toBe(true);
  });

  it.each([
    { mime: 'image/png', binary: PNG }, { mime: 'image/jpeg', binary: JPEG },
    { mime: 'image/webp', binary: WEBP }, { mime: 'image/gif', binary: GIF_HEADER + GIF_FRAME + ';' },
  ])('prepares qualified $mime bytes with the exact canonical MIME prefix', async ({ mime, binary }) => {
    const result = await prepare([fromBinary(binary, mime)]);
    expect(result.status).toBe('prepared');
    if (result.status !== 'prepared') return;
    expect(result.resources[0]).toEqual({ dataUrl: `data:${mime};base64,` + btoa(binary), mimeType: mime, byteLength: binary.length, pixels: 1 });
  });

  it('rejects a URL budget before reading or base64 encoding', async () => {
    const readFile = vi.fn(() => Promise.resolve(bytes().buffer));
    const encode = vi.spyOn(globalThis, 'btoa');
    const result = await prepareClipboardEmbeddedAssets([match()], destination(), { ...limits, maxPreparedUrlUnits: 1 }, { signal: new AbortController().signal, readFile });
    expect(result).toEqual({ status: 'rejected', reason: 'input-limit', placementId: 'a' });
    expect(readFile).not.toHaveBeenCalled();
    expect(encode).not.toHaveBeenCalled();
  });

  it('reads one File once while preserving every placement and charging every URL and pixel use', async () => {
    const first = match();
    const second = { ...match('b', first.file, 1), reference: { placementId: 'b', rawReference: 'cid:1', alt: 'Second', width: 20.5, height: 9 } };
    const readFile = vi.fn(() => Promise.resolve(bytes().buffer));
    const result = await prepare([first, second], limits, { signal: new AbortController().signal, readFile });
    expect(result.status).toBe('prepared');
    if (result.status !== 'prepared') return;
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(result.resources).toHaveLength(1);
    expect(result.placements).toEqual([
      { placementId: 'a', resourceIndex: 0, sourceOffset: 3 },
      { placementId: 'b', resourceIndex: 0, alt: 'Second', width: 20.5, height: 9 },
    ]);
    expect(result.readBytes).toBe(PNG.length);
    expect(result.preparedUrlUnits).toBe(2 * ('data:image/png;base64,'.length + 4 * Math.ceil(PNG.length / 3)));
    expect(result.pixelCount).toBe(2);
  });

  it('deduplicates exact content in different Files after charging and reading both', async () => {
    const first = match();
    const second = match('b', new File([bytes()], 'another-name', { type: 'image/png' }), 1);
    const readFile = vi.fn(() => Promise.resolve(bytes().buffer));
    const result = await prepare([first, second], limits, { signal: new AbortController().signal, readFile });
    expect(result.status).toBe('prepared');
    if (result.status !== 'prepared') return;
    expect(readFile).toHaveBeenCalledTimes(2);
    expect(result.resources).toHaveLength(1);
    expect(result.placements.map(placement => placement.resourceIndex)).toEqual([0, 0]);
    expect(result.readBytes).toBe(2 * PNG.length);
    expect(result.pixelCount).toBe(2);
  });

  it('keeps different bytes distinct even when filename, MIME, size and dimensions agree', async () => {
    const changed = PNG.slice(0, 29) + String.fromCharCode(PNG.charCodeAt(29) ^ 1) + PNG.slice(30);
    // A changed CRC illustrates the documented header-only qualification, not full codec validity.
    const result = await prepare([fromBinary(PNG), fromBinary(changed, 'image/png', 'b', 1)]);
    expect(result.status).toBe('prepared');
    if (result.status !== 'prepared') return;
    expect(result.resources).toHaveLength(2);
    expect(result.resources[0]?.dataUrl).not.toBe(result.resources[1]?.dataUrl);
    expect(result.placements.map(placement => placement.resourceIndex)).toEqual([0, 1]);
  });

  it('checks all read budgets before reading the first file, without assuming later content dedupe', async () => {
    const inputs = [match(), match('b', undefined, 1)];
    const readFile = vi.fn(() => Promise.resolve(bytes().buffer));
    for (const cap of [
      { ...limits, maxPlacements: 1 }, { ...limits, maxFiles: 1 },
      { ...limits, maxFileBytes: PNG.length - 1 }, { ...limits, maxTotalFileBytes: PNG.length * 2 - 1 },
    ]) expect((await prepare(inputs, cap, { signal: new AbortController().signal, readFile })).status).toBe('rejected');
    expect(readFile).not.toHaveBeenCalled();
  });

  it('accepts exact byte and URL boundaries and counts repeated placements before reading', async () => {
    const input = match();
    const urlUnits = 'data:image/png;base64,'.length + 4 * Math.ceil(PNG.length / 3);
    const exact = { ...limits, maxFileBytes: PNG.length, maxTotalFileBytes: PNG.length, maxPreparedUrlUnits: urlUnits * 2, maxTotalPixels: 2 };
    const inputs = [input, match('b', input.file, 1)];
    expect((await prepare(inputs, exact)).status).toBe('prepared');
    const readFile = vi.fn(() => Promise.resolve(bytes().buffer));
    expect((await prepare(inputs, { ...exact, maxPreparedUrlUnits: urlUnits * 2 - 1 }, { signal: new AbortController().signal, readFile })).status).toBe('rejected');
    expect(readFile).not.toHaveBeenCalled();
  });

  it('rejects disabled embedding, destination type restrictions and size restrictions before I/O', async () => {
    const readFile = vi.fn(() => Promise.resolve(bytes().buffer));
    for (const [policy, reason] of [
      [destination({ allowEmbedded: false }), 'embedding-disabled'],
      [destination({ allowedMimeTypes: ['image/jpeg'] }), 'unsupported-image-type'],
      [destination({ maxFileBytes: PNG.length - 1 }), 'image-size-limit'],
      [destination({ maxFileBytes: 0 }), 'image-size-limit'],
    ] as const) {
      expect(await prepare([match()], limits, { signal: new AbortController().signal, readFile }, policy)).toMatchObject({ status: 'rejected', reason });
    }
    expect(readFile).not.toHaveBeenCalled();
  });

  it('rejects inconsistent metadata for the same File, repeated item index or duplicate placement', async () => {
    const first = match();
    const other = match('b', first.file, 1);
    const readFile = vi.fn(() => Promise.resolve(bytes().buffer));
    for (const inputs of [
      [first, { ...other, fileSize: first.fileSize + 1 }],
      [first, { ...other, mimeType: 'image/jpeg' as const }],
      [first, match('b')], [first, { ...other, reference: first.reference }],
    ]) expect(await prepare(inputs, limits, { signal: new AbortController().signal, readFile })).toMatchObject({ status: 'rejected', reason: 'invalid-metadata' });
    expect(readFile).not.toHaveBeenCalled();
  });

  it.each([0, -1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid captured file size %s before I/O', async fileSize => {
    const readFile = vi.fn(() => Promise.resolve(bytes().buffer));
    const result = await prepare([{ ...match(), fileSize }], limits, { signal: new AbortController().signal, readFile });
    expect(result).toMatchObject({ status: 'rejected', reason: 'invalid-metadata' });
    expect(readFile).not.toHaveBeenCalled();
  });

  it('rejects arithmetic overflow before allocation with safe integer inputs', async () => {
    const readFile = vi.fn(() => Promise.resolve(bytes().buffer));
    const policy = { ...destination(), maxFileBytes: Number.MAX_SAFE_INTEGER };
    const cap = { ...limits, maxFileBytes: Number.MAX_SAFE_INTEGER, maxTotalFileBytes: Number.MAX_SAFE_INTEGER, maxPreparedUrlUnits: Number.MAX_SAFE_INTEGER };
    expect(await prepare([{ ...match(), fileSize: Number.MAX_SAFE_INTEGER }], cap, { signal: new AbortController().signal, readFile }, policy)).toMatchObject({ status: 'rejected', reason: 'input-limit' });
    expect(readFile).not.toHaveBeenCalled();
  });

  it('accepts foreign realm native ArrayBuffers and does not mutate caller-owned bytes', async () => {
    const foreign: unknown = runInNewContext('new ArrayBuffer(' + String(PNG.length) + ')');
    expect(foreign).not.toBeInstanceOf(ArrayBuffer);
    new Uint8Array(foreign as ArrayBuffer).set(bytes());
    const result = await prepare([match()], limits, { signal: new AbortController().signal, readFile: () => Promise.resolve(foreign) });
    expect(result.status).toBe('prepared');
    expect(Array.from(new Uint8Array(foreign as ArrayBuffer))).toEqual(Array.from(bytes()));
  });

  it.each([
    { label: 'shared buffer', value: () => new SharedArrayBuffer(PNG.length) },
    { label: 'typed array', value: () => bytes() },
    { label: 'DataView', value: () => new DataView(bytes().buffer) },
    { label: 'spoofed tag', value: () => ({ byteLength: PNG.length, [Symbol.toStringTag]: 'ArrayBuffer' }) },
    { label: 'null', value: () => null },
  ])('rejects $label returned by a reader', async ({ value }) => {
    const encode = vi.spyOn(globalThis, 'btoa');
    expect(await prepare([match()], limits, { signal: new AbortController().signal, readFile: () => Promise.resolve(value()) })).toMatchObject({ status: 'rejected', reason: 'invalid-buffer' });
    expect(encode).not.toHaveBeenCalled();
  });

  it.each([0, PNG.length - 1, PNG.length + 1, 8193])('rejects actual byte length %s before encoding', async length => {
    const encode = vi.spyOn(globalThis, 'btoa');
    expect(await prepare([match()], limits, { signal: new AbortController().signal, readFile: () => Promise.resolve(new ArrayBuffer(length)) })).toMatchObject({ status: 'rejected', reason: 'size-mismatch' });
    expect(encode).not.toHaveBeenCalled();
  });

  it('rejects a detached ArrayBuffer', async () => {
    const buffer = bytes().buffer;
    structuredClone(buffer, { transfer: [buffer] });
    expect(await prepare([match()], limits, { signal: new AbortController().signal, readFile: () => Promise.resolve(buffer) })).toMatchObject({ status: 'rejected', reason: 'size-mismatch' });
  });

  it('uses intrinsic byteLength rather than an overridable instance property', async () => {
    const buffer = bytes().buffer;
    const getter = vi.fn(() => { throw new Error('Instance byte length must not be read'); });
    Object.defineProperty(buffer, 'byteLength', { get: getter });
    expect((await prepare([match()], limits, { signal: new AbortController().signal, readFile: () => Promise.resolve(buffer) })).status).toBe('prepared');
    expect(getter).not.toHaveBeenCalled();
  });

  it('charges pixel limits per placement before encoding, including duplicate File placements', async () => {
    const first = match();
    const encode = vi.spyOn(globalThis, 'btoa');
    expect(await prepare([first, match('b', first.file, 1)], { ...limits, maxTotalPixels: 1 })).toMatchObject({ status: 'rejected', reason: 'pixel-limit' });
    expect(encode).not.toHaveBeenCalled();
  });

  it('charges identical-content different Files toward the total pixel allowance', async () => {
    expect(await prepare([match(), match('b', undefined, 1)], { ...limits, maxTotalPixels: 1 })).toMatchObject({ status: 'rejected', reason: 'pixel-limit', placementId: 'b' });
  });

  it('charges animated GIF frame pixels for each placement and preserves the frame ceiling', async () => {
    const first = fromBinary(GIF_HEADER + GIF_FRAME.repeat(2) + ';', 'image/gif');
    const second = { ...first, reference: { ...first.reference, placementId: 'b' } };
    expect(await prepare([first, second], { ...limits, maxTotalPixels: 3 })).toMatchObject({ status: 'rejected', reason: 'pixel-limit' });
    const result = await prepare([first, second], { ...limits, maxTotalPixels: 4 });
    expect(result.status).toBe('prepared');
    if (result.status === 'prepared') {
      expect(result.resources[0]?.pixels).toBe(2);
      expect(result.pixelCount).toBe(4);
    }
    expect(await prepare([fromBinary(GIF_HEADER + GIF_FRAME.repeat(101) + ';', 'image/gif')], { ...limits, maxTotalPixels: 1000 })).toMatchObject({ status: 'rejected', reason: 'invalid-raster' });
  });

  it('retains the raster inspector limits and does not accept APNG or a MIME mismatch', async () => {
    const apngChunk = '\0\0\0\x08acTL\0\0\0\x02\0\0\0\0\0\0\0\0';
    const apng = PNG.slice(0, 33) + apngChunk + PNG.slice(33);
    const excessiveSide = PNG.slice(0, 16) + '\0\0\x40\x01' + PNG.slice(20);
    const excessivePixels = PNG.slice(0, 16) + '\0\0\x13\x89\0\0\x13\x88' + PNG.slice(24);
    const encode = vi.spyOn(globalThis, 'btoa');
    for (const input of [fromBinary(apng), fromBinary(excessiveSide), fromBinary(excessivePixels), fromBinary(PNG, 'image/jpeg'), fromBinary('not an image')]) {
      expect(await prepare([input], { ...limits, maxTotalPixels: Number.MAX_SAFE_INTEGER })).toMatchObject({ status: 'rejected', reason: 'invalid-raster' });
    }
    expect(encode).not.toHaveBeenCalled();
  });

  it('rejects reader failure without returning partial resources or exposing private errors', async () => {
    const readFile = vi.fn().mockResolvedValueOnce(bytes().buffer).mockRejectedValueOnce(new Error('Private filename'));
    const result = await prepare([match(), match('b', undefined, 1)], limits, { signal: new AbortController().signal, readFile });
    expect(result).toEqual({ status: 'rejected', reason: 'read-failed', placementId: 'b' });
    expect(JSON.stringify(result)).not.toContain('Private');
    const throwing = (): Promise<unknown> => { throw new Error('Private filename'); };
    expect(await prepare([match()], limits, { signal: new AbortController().signal, readFile: throwing })).toMatchObject({ status: 'rejected', reason: 'read-failed' });
  });

  it('cancels before inspecting File methods or starting reads', async () => {
    const controller = new AbortController();
    controller.abort();
    const source = match();
    const method = vi.fn(() => { throw new Error('Must not inspect File'); });
    Object.defineProperty(source.file, 'arrayBuffer', { get: method });
    expect(await prepare([source], limits, { signal: controller.signal })).toEqual({ status: 'cancelled' });
    expect(method).not.toHaveBeenCalled();
  });

  it('cancels a pending read promptly, removes its listener and discards a late result', async () => {
    const controller = new AbortController();
    const work = pending<unknown>();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const readFile = vi.fn(() => work.promise);
    const encode = vi.spyOn(globalThis, 'btoa');
    const result = prepare([match(), match('b', undefined, 1)], limits, { signal: controller.signal, readFile });
    expect(readFile).toHaveBeenCalledTimes(1);
    controller.abort();
    expect(await result).toEqual({ status: 'cancelled' });
    expect(remove).toHaveBeenCalledTimes(1);
    work.resolve(bytes().buffer);
    await work.promise;
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(encode).not.toHaveBeenCalled();
  });

  it('handles a late rejection after cancellation and abortion during read settlement', async () => {
    const controller = new AbortController();
    const work = pending<unknown>();
    const result = prepare([match()], limits, { signal: controller.signal, readFile: () => work.promise });
    controller.abort();
    expect(await result).toEqual({ status: 'cancelled' });
    work.reject(new Error('Late native failure'));
    await expect(work.promise).rejects.toThrow('Late native failure');
    const afterRead = new AbortController();
    expect(await prepare([match()], limits, { signal: afterRead.signal, readFile: () => { afterRead.abort(); return Promise.resolve(bytes().buffer); } })).toEqual({ status: 'cancelled' });
  });

  it('does not start another file or return prepared URLs after synchronous cancellation during encoding', async () => {
    const controller = new AbortController();
    const original = btoa;
    const encode = vi.spyOn(globalThis, 'btoa').mockImplementation(value => { controller.abort(); return original(value); });
    const readFile = vi.fn(() => Promise.resolve(bytes().buffer));
    expect(await prepare([match(), match('b', undefined, 1)], limits, { signal: controller.signal, readFile })).toEqual({ status: 'cancelled' });
    expect(encode).toHaveBeenCalledTimes(1);
    expect(readFile).toHaveBeenCalledTimes(1);
  });

  it('snapshots all metadata, policy, limits and the reader before the first await', async () => {
    const first = { ...match(), reference: { ...match().reference, alt: 'Original' } };
    const second = { ...match('b', undefined, 1) };
    const originalSecondFile = second.file;
    const inputs = [first, second];
    const cap = { ...limits };
    const policy = { ...destination(), allowedMimeTypes: ['image/png'] as ClipboardImageDestination['allowedMimeTypes'] };
    const work = pending<unknown>();
    const reader = vi.fn().mockReturnValueOnce(work.promise).mockResolvedValue(bytes().buffer);
    const controller = new AbortController();
    const options = { signal: controller.signal, readFile: reader };
    const result = prepare(inputs, cap, options, policy);
    first.reference.alt = 'Changed';
    first.fileSize = 1;
    second.file = first.file;
    inputs.length = 0;
    cap.maxTotalFileBytes = 1;
    policy.allowEmbedded = false;
    policy.allowedMimeTypes = [];
    options.readFile = vi.fn(() => Promise.reject(new Error('Changed reader')));
    options.signal = new AbortController().signal;
    work.resolve(bytes().buffer);
    const prepared = await result;
    expect(prepared.status).toBe('prepared');
    if (prepared.status !== 'prepared') return;
    expect(prepared.placements).toHaveLength(2);
    expect(prepared.placements[0]?.alt).toBe('Original');
    expect(prepared.readBytes).toBe(2 * PNG.length);
    expect(reader).toHaveBeenNthCalledWith(2, originalSecondFile, controller.signal);
    expect(options.readFile).not.toHaveBeenCalled();
  });

  it('snapshots default File readers before awaiting and never rereads captured File metadata', async () => {
    const first = match();
    const second = match('b', undefined, 1);
    const work = pending<ArrayBuffer>();
    const firstRead = vi.fn(() => work.promise);
    const secondRead = vi.fn(() => Promise.resolve(bytes().buffer));
    Object.defineProperty(first.file, 'arrayBuffer', { value: firstRead, configurable: true });
    Object.defineProperty(second.file, 'arrayBuffer', { value: secondRead, configurable: true });
    const fail = vi.fn(() => { throw new Error('Captured metadata must not be reread'); });
    for (const file of [first.file, second.file]) {
      for (const key of ['name', 'size', 'type']) Object.defineProperty(file, key, { get: fail });
    }
    const result = prepare([first, second]);
    Object.defineProperty(second.file, 'arrayBuffer', { get: fail });
    work.resolve(bytes().buffer);
    expect((await result).status).toBe('prepared');
    expect(secondRead).toHaveBeenCalledTimes(1);
    expect(fail).not.toHaveBeenCalled();
  });

  it('bounds entries before reading them and uses a fixed count without custom iterators', async () => {
    const inputs = [match(), match('b', undefined, 1)];
    const fail = vi.fn(() => { throw new Error('Must not read entries'); });
    Object.defineProperty(inputs, '0', { get: fail });
    expect((await prepare(inputs, { ...limits, maxPlacements: 1 })).status).toBe('rejected');
    expect(fail).not.toHaveBeenCalled();
    const growing = [match()];
    const original = growing[0];
    Object.defineProperty(growing, '0', { get: () => { growing.push(match('b', undefined, 1)); return original; } });
    Object.defineProperty(growing, Symbol.iterator, { value: fail });
    const result = await prepare(growing, { ...limits, maxPlacements: 1 });
    expect(result.status).toBe('prepared');
    if (result.status === 'prepared') expect(result.placements).toHaveLength(1);
    expect(fail).not.toHaveBeenCalled();
  });

  it('fails closed for throwing metadata getters before reading a valid first file', async () => {
    const broken = { ...match('b', undefined, 1) };
    Object.defineProperty(broken, 'reference', { get: () => { throw new Error('Private source'); } });
    const readFile = vi.fn(() => Promise.resolve(bytes().buffer));
    expect(await prepare([match(), broken], limits, { signal: new AbortController().signal, readFile })).toEqual({ status: 'rejected', reason: 'unreadable-input' });
    expect(readFile).not.toHaveBeenCalled();
  });

  it('bounds and validates consumed placement metadata without rendering source content', async () => {
    const input = match();
    for (const change of [
      { placementId: '' }, { sourceOffset: -1 }, { width: 0 }, { height: Infinity },
      { placementId: 'x'.repeat(129) }, { alt: 'x'.repeat(257) }, { width: 10_001 },
    ]) expect((await prepare([{ ...input, reference: { ...input.reference, ...change } }])).status).toBe('rejected');
    const reference = { ...input.reference };
    const rawGetter = vi.fn(() => { throw new Error('Raw source is not needed'); });
    Object.defineProperty(reference, 'rawReference', { get: rawGetter });
    expect((await prepare([{ ...input, reference }])).status).toBe('prepared');
    expect(rawGetter).not.toHaveBeenCalled();
  });

  it('requires explicit positive safe integer limits before reading any inputs', async () => {
    const inputs = [match()];
    const fail = vi.fn(() => { throw new Error('Must not read inputs'); });
    Object.defineProperty(inputs, '0', { get: fail });
    for (const key of Object.keys(limits)) {
      for (const value of [0, -1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1, undefined]) {
        await expect(prepare(inputs, { ...limits, [key]: value })).rejects.toThrow(RangeError);
      }
    }
    expect(fail).not.toHaveBeenCalled();
  });

  it('returns an empty frozen preparation for no matches and never reads', async () => {
    const readFile = vi.fn(() => Promise.resolve(bytes().buffer));
    expect(await prepare([], limits, { signal: new AbortController().signal, readFile })).toEqual({
      status: 'prepared', resources: [], placements: [], readBytes: 0, preparedUrlUnits: 0, pixelCount: 0,
    });
    expect(readFile).not.toHaveBeenCalled();
  });

  it('fails closed if base64 encoding throws or returns an incorrect length', async () => {
    const encode = vi.spyOn(globalThis, 'btoa').mockImplementation(() => { throw new Error('Encoder failed'); });
    expect(await prepare()).toMatchObject({ status: 'rejected', reason: 'encoding-failed' });
    encode.mockReturnValue('');
    expect(await prepare()).toMatchObject({ status: 'rejected', reason: 'encoding-failed' });
  });
});
